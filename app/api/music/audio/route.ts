import { downloadFetch } from '@/lib/server/downloadFetch';
import { detectAudioFormat } from '@/lib/metrolist/audioValidation';
import { NextRequest, NextResponse } from 'next/server';
import { CORS_HEADERS } from '@/lib/server/cors';
import {
  buildAudioSourceCandidates,
  resolveAudioSource,
  type ResolvedAudioSource,
} from '@/lib/server/audioSource';
import { sanitizeVideoId } from '@/lib/metrolist/offlineQueue';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/music/audio?videoId=...&title=...&artist=...
 *   -> streams the complete audio file (no resume) with CORS headers so the web
 *      app / APK can download it with progress tracking.
 * GET /api/music/audio?videoId=...&resolve=1
 *   -> JSON download entitlement and type/size hints (never a raw provider URL).
 *      Actual transfers always resolve the configured source again.
 *
 * See lib/server/audioSource.ts for how sources are configured.
 */

const AUDIO_CORS_HEADERS: Record<string, string> = {
  ...CORS_HEADERS,
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
  'Access-Control-Expose-Headers':
    'Content-Length, Content-Range, Content-Type, Accept-Ranges, X-Audio-Source, X-Audio-Length',
};

const UNAVAILABLE_MESSAGE =
  'Audio lagu ini belum tersedia untuk diunduh. Lagu tetap bisa diputar online.';

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json(
    { ok: false, error, message },
    { status, headers: { ...AUDIO_CORS_HEADERS, 'Cache-Control': 'no-store' } }
  );
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: AUDIO_CORS_HEADERS });
}

async function resolveFromRequest(req: NextRequest): Promise<
  { ok: true; source: ResolvedAudioSource } | { ok: false; response: NextResponse }
> {
  const { searchParams } = new URL(req.url);
  const provider = searchParams.get('provider') || 'youtube';
  if (provider !== 'youtube') return { ok: false, response: jsonError(422, 'unsupported_provider', 'Provider ini belum memiliki adaptor unduh resmi di Easvarafy.') };
  if (process.env.AUDIO_DOWNLOADS_ENABLED !== 'true') {
    return { ok: false, response: jsonError(403, 'streaming_only', 'Lagu hanya tersedia untuk streaming. Sumber unduhan berizin belum diaktifkan oleh pengelola.') };
  }
  const videoId = sanitizeVideoId(searchParams.get('videoId'));
  if (!videoId) {
    return { ok: false, response: jsonError(400, 'invalid_video_id', 'ID lagu tidak valid.') };
  }
  const candidates = buildAudioSourceCandidates(
    videoId,
    {
      title: searchParams.get('title')?.slice(0, 300) ?? undefined,
      artist: searchParams.get('artist')?.slice(0, 300) ?? undefined,
    },
    {
      AUDIO_SOURCE_URL_TEMPLATE: process.env.AUDIO_SOURCE_URL_TEMPLATE,
      AUDIO_STORAGE_BUCKET: process.env.AUDIO_STORAGE_BUCKET,
      AUDIO_STORAGE_DISABLED: process.env.AUDIO_STORAGE_DISABLED,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    }
  );
  if (candidates.length === 0) {
    return {
      ok: false,
      response: jsonError(404, 'audio_source_not_configured', UNAVAILABLE_MESSAGE),
    };
  }
  const source = await resolveAudioSource(candidates);
  if (!source) {
    return { ok: false, response: jsonError(404, 'audio_unavailable', UNAVAILABLE_MESSAGE) };
  }
  return { ok: true, source };
}

export async function HEAD(req: NextRequest) {
  const resolved = await resolveFromRequest(req);
  if (!resolved.ok) {
    return new NextResponse(null, { status: resolved.response.status, headers: AUDIO_CORS_HEADERS });
  }
  const headers: Record<string, string> = {
    ...AUDIO_CORS_HEADERS,
    'Content-Type': resolved.source.contentType,
    'Accept-Ranges': 'none',
    'X-Audio-Source': resolved.source.label,
  };
  if (resolved.source.contentLength) {
    headers['Content-Length'] = String(resolved.source.contentLength);
    headers['X-Audio-Length'] = String(resolved.source.contentLength);
  }
  return new NextResponse(null, { status: 200, headers });
}

export async function GET(req: NextRequest) {
  if (req.headers.has('range')) return jsonError(416, 'partial_not_supported', 'Unduhan memerlukan file audio lengkap; resume belum didukung.');
  const resolved = await resolveFromRequest(req);
  if (!resolved.ok) return resolved.response;
  const { source } = resolved;

  const { searchParams } = new URL(req.url);
  if (searchParams.get('resolve') === '1') {
    return NextResponse.json(
      {
        ok: true,
        downloadAllowed: true,
        contentType: source.contentType,
        contentLength: source.contentLength,
        source: source.label,
      },
      { headers: { ...AUDIO_CORS_HEADERS, 'Cache-Control': 'no-store' } }
    );
  }

  const upstreamHeaders: Record<string, string> = {};
  const range = req.headers.get('range');
  if (range) upstreamHeaders.Range = range;

  let upstream: Response;
  try {
    upstream = await downloadFetch(source.url, {
      headers: upstreamHeaders,
      redirect: 'error',
      signal: AbortSignal.timeout(55_000),
    });
  } catch {
    return jsonError(502, 'audio_upstream_failed', 'Server audio tidak merespons. Coba lagi nanti.');
  }
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel().catch(() => {});
    return jsonError(
      [401, 403, 404, 429].includes(upstream.status) ? upstream.status : 502,
      'audio_upstream_failed',
      upstream.status === 404 ? UNAVAILABLE_MESSAGE : 'Gagal mengambil file audio dari server.'
    );
  }

  const headers: Record<string, string> = {
    ...AUDIO_CORS_HEADERS,
    'Content-Type': upstream.headers.get('content-type')?.includes('octet-stream')
      ? source.contentType
      : upstream.headers.get('content-type') ?? source.contentType,
    'Accept-Ranges': 'none',
    'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="${sanitizeVideoId(searchParams.get('videoId'))}.audio"`,
    'X-Audio-Source': source.label,
  };
  for (const name of ['content-length', 'content-range']) {
    const value = upstream.headers.get(name);
    if (value) headers[name === 'content-length' ? 'Content-Length' : 'Content-Range'] = value;
  }
  // Streamed responses may lose Content-Length (chunked); keep the size for progress UIs.
  const knownLength = upstream.headers.get('content-length') ?? (source.contentLength ? String(source.contentLength) : null);
  if (knownLength && upstream.status === 200) headers['X-Audio-Length'] = knownLength;

  // Validate the actual GET body before exposing it as audio. Ranged playback
  // is unnecessary for downloads; refuse partial requests rather than blessing
  // arbitrary middle bytes as a complete file.
  if (range || upstream.status !== 200) { await upstream.body.cancel(); return jsonError(416, 'partial_not_supported', 'Unduhan memerlukan file audio lengkap.'); }
  const reader = upstream.body.getReader();
  const prefix: Uint8Array[] = [];
  let prefixSize = 0;
  try {
    while (prefixSize < 64) {
      const { done, value } = await reader.read();
      if (done) break;
      prefix.push(value); prefixSize += value.length;
    }
  } catch { await reader.cancel().catch(() => {}); return jsonError(502, 'interrupted', 'Koneksi sumber audio terputus.'); }
  const first = new Uint8Array(prefixSize);
  let offset = 0;
  for (const chunk of prefix) { first.set(chunk, offset); offset += chunk.length; }
  const format = detectAudioFormat(first);
  const actualType = upstream.headers.get('content-type') || '';
  if (!format || /text\/|json|mpegurl|dash\+xml/i.test(actualType)) {
    await reader.cancel();
    return jsonError(422, 'unsupported_audio', 'Sumber bukan file audio tunggal yang didukung. Halaman error, manifest, dan format tidak dikenal tidak disimpan.');
  }
  headers['Content-Type'] = format.mimeType;
  headers['Content-Disposition'] = `attachment; filename="${sanitizeVideoId(searchParams.get('videoId'))}.${format.extension}"`;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { for (const chunk of prefix) controller.enqueue(chunk); },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) controller.close(); else controller.enqueue(value);
      } catch (err) { controller.error(err); }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
  return new NextResponse(stream, { status: 200, headers });
}
