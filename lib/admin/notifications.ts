import { apiUrl } from '@/lib/api/base';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import type {
  ComposerInput,
  NotificationAudience,
  NotificationCategory,
  NotificationTargetRole,
  PushStatus,
} from '@/lib/notifications/shared';

export interface NotificationStats {
  devices_total: number;
  devices_android: number;
  devices_web: number;
  active_24h: number;
  active_7d: number;
  logged_in: number;
  push_ready: number;
  notifications_enabled: number;
  broadcasts_total: number;
  broadcasts_7d: number;
}

export interface BroadcastRecord {
  id: string;
  title: string;
  body: string;
  category: NotificationCategory;
  image_url: string | null;
  action_url: string | null;
  target_audience: NotificationAudience;
  target_role: NotificationTargetRole | null;
  recipient_count: number;
  delivered_count: number;
  read_count: number;
  push_status: PushStatus;
  push_sent_count: number;
  push_failed_count: number;
  push_error: string | null;
  created_at: string;
}

const COLUMNS =
  'id, title, body, category, image_url, action_url, target_audience, target_role, recipient_count, delivered_count, read_count, push_status, push_sent_count, push_failed_count, push_error, created_at';

/** Admin-only (the RPC raises 42501 "forbidden" for user/developer). */
export async function getNotificationStats(): Promise<{ stats: NotificationStats | null; error?: string }> {
  if (!isSupabaseConfigured) return { stats: null, error: 'Supabase belum dikonfigurasi.' };
  const { data, error } = await getSupabase().rpc('admin_notification_stats');
  if (error) return { stats: null, error: error.code === '42501' ? 'Akses ditolak.' : error.message };
  return { stats: data as NotificationStats };
}

export async function listBroadcasts(limit = 30): Promise<{ rows: BroadcastRecord[]; error?: string }> {
  if (!isSupabaseConfigured) return { rows: [], error: 'Supabase belum dikonfigurasi.' };
  const { data, error } = await getSupabase()
    .from('broadcast_notifications')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as BroadcastRecord[] };
}

async function authHeader(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ? `Bearer ${data.session.access_token}` : null;
}

export interface SendResult {
  notification?: BroadcastRecord;
  error?: string;
  fields?: Partial<Record<keyof ComposerInput, string>>;
}

async function postSend(payload: Record<string, unknown>): Promise<SendResult> {
  const auth = await authHeader();
  if (!auth) return { error: 'Sesi berakhir. Silakan login ulang.' };
  try {
    const res = await fetch(apiUrl('/api/admin/notifications/send'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as SendResult;
    if (!res.ok) return { error: body.error ?? `Gagal mengirim (HTTP ${res.status})`, fields: body.fields };
    return body;
  } catch {
    return { error: 'Tidak dapat terhubung ke server. Periksa koneksi.' };
  }
}

export function sendBroadcast(input: ComposerInput) {
  return postSend({ ...input });
}

export function resendBroadcastPush(id: string) {
  return postSend({ resendId: id });
}

export async function deleteBroadcast(id: string): Promise<{ error?: string }> {
  const { data, error } = await getSupabase().from('broadcast_notifications').delete().eq('id', id).select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: 'Tidak bisa menghapus (akses ditolak).' };
  return {};
}
