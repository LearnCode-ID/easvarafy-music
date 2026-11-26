import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { validateComposer, type ComposerInput } from '@/lib/notifications/shared';
import { parseServiceAccount, sendBroadcastPush, type BroadcastPushPayload } from '@/lib/server/fcm';

/**
 * POST /api/admin/notifications/send   (role `admin` only)
 *
 * Body: { title, body, category, imageUrl, actionUrl, audience, targetRole }
 *   -> inserts the broadcast (as the admin: RLS + trigger enforce admin-only)
 *      and sends FCM push to every targeted device that has a token.
 * Body: { resendId }  -> re-sends FCM push for an existing broadcast.
 *
 * Auth: `Authorization: Bearer <supabase access token>`; the caller must be a
 * non-banned profile with role `admin` (developer/user -> 403).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function requireAdmin(req: Request): Promise<{ client: SupabaseClient; userId: string } | NextResponse> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json(500, { error: 'Supabase belum dikonfigurasi.' });
  const auth = req.headers.get('authorization') ?? '';
  const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim();
  if (!token) return json(401, { error: 'Login diperlukan.' });

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) return json(401, { error: 'Sesi tidak valid. Silakan login ulang.' });

  const { data: profile } = await client
    .from('profiles')
    .select('role, is_banned')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (!profile || profile.role !== 'admin' || profile.is_banned) {
    return json(403, { error: 'Akses ditolak. Fitur notifikasi hanya untuk admin.' });
  }
  return { client, userId: userData.user.id };
}

interface BroadcastRow extends BroadcastPushPayload {
  recipient_count: number;
  push_status: string;
}

async function deliverPush(client: SupabaseClient, row: BroadcastRow) {
  const sa = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const update = async (patch: Record<string, unknown>) => {
    await client.from('broadcast_notifications').update(patch).eq('id', row.id);
    return patch;
  };

  if (!sa) {
    return update({
      push_status: 'skipped',
      push_sent_count: 0,
      push_failed_count: 0,
      push_error: 'FCM belum dikonfigurasi (FIREBASE_SERVICE_ACCOUNT_JSON). Dikirim lewat poller Android & realtime.',
    });
  }

  const { data: targets, error } = await client.rpc('admin_broadcast_push_targets', {
    p_notification_id: row.id,
  });
  if (error) return update({ push_status: 'failed', push_error: error.message.slice(0, 500) });
  const tokens = [
    ...new Set(
      ((targets ?? []) as Array<{ fcm_token: string | null }>).map((t) => t.fcm_token).filter((t): t is string => !!t)
    ),
  ];
  if (tokens.length === 0) {
    return update({
      push_status: 'skipped',
      push_sent_count: 0,
      push_failed_count: 0,
      push_error: 'Belum ada perangkat dengan token FCM. Dikirim lewat poller Android & realtime.',
    });
  }

  try {
    const result = await sendBroadcastPush(sa, tokens, row);
    if (result.invalidTokens.length > 0) {
      // Admin may update app_devices (RLS): drop dead tokens.
      await client.from('app_devices').update({ fcm_token: null }).in('fcm_token', result.invalidTokens);
    }
    return update({
      push_status: result.failed === 0 ? 'sent' : result.sent > 0 ? 'partial' : 'failed',
      push_sent_count: result.sent,
      push_failed_count: result.failed,
      push_error: result.firstError ? result.firstError.slice(0, 500) : null,
    });
  } catch (e) {
    return update({
      push_status: 'failed',
      push_sent_count: 0,
      push_failed_count: tokens.length,
      push_error: (e instanceof Error ? e.message : 'FCM error').slice(0, 500),
    });
  }
}

const SELECT_COLUMNS =
  'id, title, body, category, image_url, action_url, target_audience, target_role, recipient_count, delivered_count, read_count, push_status, push_sent_count, push_failed_count, push_error, created_at';

export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  const { client } = admin;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: 'Body JSON tidak valid.' });
  }

  // Re-send push for an existing broadcast.
  if (typeof body.resendId === 'string') {
    const { data: row, error } = await client
      .from('broadcast_notifications')
      .select(SELECT_COLUMNS)
      .eq('id', body.resendId)
      .maybeSingle();
    if (error || !row) return json(404, { error: 'Notifikasi tidak ditemukan.' });
    const push = await deliverPush(client, row as BroadcastRow);
    return json(200, { notification: { ...row, ...push }, push });
  }

  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const input: ComposerInput = {
    title: str(body.title),
    body: str(body.body),
    category: str(body.category) || 'info',
    imageUrl: str(body.imageUrl),
    actionUrl: str(body.actionUrl),
    audience: str(body.audience) || 'all',
    targetRole: str(body.targetRole),
  };
  const valid = validateComposer(input);
  if (!valid.ok) return json(422, { error: 'Data notifikasi tidak valid.', fields: valid.errors });

  // Insert as the admin: RLS + the BEFORE INSERT trigger enforce role admin,
  // set sent_by and compute recipient_count server-side.
  const { data: inserted, error: insertError } = await client
    .from('broadcast_notifications')
    .insert(valid.value)
    .select(SELECT_COLUMNS)
    .single();
  if (insertError || !inserted) {
    const denied = insertError?.code === '42501' || /row-level security/i.test(insertError?.message ?? '');
    return json(denied ? 403 : 500, {
      error: denied ? 'Akses ditolak. Fitur notifikasi hanya untuk admin.' : insertError?.message ?? 'Gagal menyimpan.',
    });
  }

  const push = await deliverPush(client, inserted as BroadcastRow);
  return json(200, { notification: { ...inserted, ...push }, push });
}

export function GET() {
  return json(405, { error: 'Gunakan POST.' });
}
