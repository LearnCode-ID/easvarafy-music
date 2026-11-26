/**
 * Minimal Firebase Cloud Messaging HTTP v1 sender (no firebase-admin
 * dependency): OAuth2 access token from a service-account JWT signed with
 * node:crypto, then POST /v1/projects/{id}/messages:send per device token.
 *
 * Configure with FIREBASE_SERVICE_ACCOUNT_JSON (the full JSON of a service
 * account with the "Firebase Cloud Messaging API Admin" role; raw JSON or
 * base64). When it is missing, broadcasts are still delivered by the Android
 * background poller + Supabase Realtime.
 */
import { createSign } from 'node:crypto';

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export function parseServiceAccount(raw: string | undefined | null): ServiceAccount | null {
  if (!raw || !raw.trim()) return null;
  let text = raw.trim();
  if (!text.startsWith('{')) {
    try {
      text = Buffer.from(text, 'base64').toString('utf8');
    } catch {
      return null;
    }
  }
  try {
    const json = JSON.parse(text) as Partial<ServiceAccount>;
    if (!json.project_id || !json.client_email || !json.private_key) return null;
    return {
      project_id: json.project_id,
      client_email: json.client_email,
      private_key: json.private_key.replace(/\\n/g, '\n'),
      token_uri: json.token_uri,
    };
  } catch {
    return null;
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** RS256-signed JWT assertion for the Google OAuth2 token endpoint. */
export function buildServiceAccountAssertion(sa: ServiceAccount, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    })
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  signer.end();
  return `${header}.${claims}.${base64url(signer.sign(sa.private_key))}`;
}

let cachedToken: { email: string; token: string; expiresAt: number } | null = null;

export async function getAccessToken(sa: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.email === sa.client_email && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const res = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: buildServiceAccountAssertion(sa),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(`Google OAuth gagal: ${body.error_description ?? res.status}`);
  }
  cachedToken = {
    email: sa.client_email,
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return body.access_token;
}

export interface BroadcastPushPayload {
  id: string;
  title: string;
  body: string;
  category: string;
  image_url: string | null;
  action_url: string | null;
}

/** Same channel/tag as the native poller so a broadcast never shows twice. */
export const BROADCAST_CHANNEL_ID = 'easvarafy_broadcast_channel';

export function buildFcmMessage(token: string, n: BroadcastPushPayload) {
  return {
    message: {
      token,
      notification: {
        title: n.title,
        body: n.body,
        ...(n.image_url ? { image: n.image_url } : {}),
      },
      data: {
        notification_id: n.id,
        category: n.category,
        action_url: n.action_url ?? '',
      },
      android: {
        priority: 'HIGH',
        ttl: '259200s',
        collapse_key: n.id,
        notification: {
          channel_id: BROADCAST_CHANNEL_ID,
          tag: n.id,
          color: '#7C5CFF',
          ...(n.image_url ? { image: n.image_url } : {}),
        },
      },
    },
  };
}

export interface PushResult {
  sent: number;
  failed: number;
  invalidTokens: string[];
  firstError: string | null;
}

export async function sendBroadcastPush(
  sa: ServiceAccount,
  tokens: string[],
  payload: BroadcastPushPayload,
  concurrency = 10
): Promise<PushResult> {
  const result: PushResult = { sent: 0, failed: 0, invalidTokens: [], firstError: null };
  if (tokens.length === 0) return result;
  const accessToken = await getAccessToken(sa);
  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`;
  let index = 0;

  async function worker() {
    while (index < tokens.length) {
      const token = tokens[index++];
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(buildFcmMessage(token, payload)),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          result.sent++;
          continue;
        }
        result.failed++;
        const err = (await res.json().catch(() => null)) as {
          error?: { status?: string; message?: string; details?: Array<{ errorCode?: string }> };
        } | null;
        const code = err?.error?.details?.find((d) => d.errorCode)?.errorCode ?? err?.error?.status ?? '';
        if (code === 'UNREGISTERED' || (res.status === 400 && code === 'INVALID_ARGUMENT') || res.status === 404) {
          result.invalidTokens.push(token);
        }
        result.firstError ??= `${res.status} ${code || err?.error?.message || ''}`.trim();
      } catch (e) {
        result.failed++;
        result.firstError ??= e instanceof Error ? e.message : 'network error';
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tokens.length) }, worker));
  return result;
}
