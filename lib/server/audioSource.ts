/**
 * Audio source adapter for offline downloads (`/api/music/audio`).
 *
 * Easvarafy streams songs online through the official YouTube IFrame player.
 * That player does not expose a downloadable audio file, and pulling raw audio
 * from YouTube is against its Terms of Service, so downloads come from an audio
 * source *you* control and configure:
 *
 *   1. AUDIO_SOURCE_URL_TEMPLATE — one or more URL templates (comma separated),
 *      e.g. `https://cdn.example.com/audio/{videoId}.mp3`.
 *      Placeholders: {videoId}, {title}, {artist} (URL-encoded).
 *   2. Supabase Storage — public bucket AUDIO_STORAGE_BUCKET (default
 *      `offline-audio`) containing `<videoId>.mp3` / `.m4a` / `.opus` / `.webm`.
 *
 * Nothing configured / file missing -> the route answers 404 with a clear
 * message and the UI shows it instead of crashing the player.
 */

export interface AudioSourceCandidate {
  url: string;
  /** Short label for diagnostics (never contains secrets). */
  label: string;
}

export interface AudioSourceEnv {
  AUDIO_SOURCE_URL_TEMPLATE?: string;
  AUDIO_STORAGE_BUCKET?: string;
  AUDIO_STORAGE_DISABLED?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
}

export interface AudioTrackMeta {
  title?: string;
  artist?: string;
}

export const DEFAULT_AUDIO_BUCKET = 'offline-audio';
export const STORAGE_EXTENSIONS = ['mp3', 'm4a', 'opus', 'webm'] as const;

function fillTemplate(template: string, videoId: string, meta: AudioTrackMeta): string {
  return template
    .replace(/\{videoId\}/g, encodeURIComponent(videoId))
    .replace(/\{title\}/g, encodeURIComponent(meta.title ?? ''))
    .replace(/\{artist\}/g, encodeURIComponent(meta.artist ?? ''));
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Ordered list of URLs to try for a given videoId. Pure — no network. */
export function buildAudioSourceCandidates(
  videoId: string,
  meta: AudioTrackMeta,
  env: AudioSourceEnv
): AudioSourceCandidate[] {
  const out: AudioSourceCandidate[] = [];
  const templates = (env.AUDIO_SOURCE_URL_TEMPLATE ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  templates.forEach((template, i) => {
    const url = fillTemplate(template, videoId, meta);
    if (isHttpUrl(url)) out.push({ url, label: `template-${i + 1}` });
  });

  const storageDisabled = /^(1|true|yes)$/i.test(env.AUDIO_STORAGE_DISABLED ?? '');
  const supabaseUrl = (env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
  if (!storageDisabled && isHttpUrl(supabaseUrl)) {
    const bucket = (env.AUDIO_STORAGE_BUCKET ?? '').trim() || DEFAULT_AUDIO_BUCKET;
    for (const ext of STORAGE_EXTENSIONS) {
      out.push({
        url: `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeURIComponent(videoId)}.${ext}`,
        label: `supabase-storage:${ext}`,
      });
    }
  }
  return out;
}

export function looksLikeAudio(contentType: string | null, url: string): boolean {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.startsWith('audio/') || ct.startsWith('video/mp4') || ct.startsWith('video/webm')) return true;
  if (ct.includes('octet-stream') || ct === '') {
    return /\.(mp3|m4a|aac|opus|ogg|webm|wav|flac)(\?|$)/i.test(url);
  }
  return false;
}

export function guessMimeFromUrl(url: string): string {
  const m = /\.([a-z0-9]+)(\?|$)/i.exec(url);
  switch (m?.[1]?.toLowerCase()) {
    case 'mp3':
      return 'audio/mpeg';
    case 'm4a':
    case 'aac':
      return 'audio/mp4';
    case 'opus':
    case 'ogg':
      return 'audio/ogg';
    case 'webm':
      return 'audio/webm';
    case 'wav':
      return 'audio/wav';
    case 'flac':
      return 'audio/flac';
    default:
      return 'audio/mpeg';
  }
}

export interface ResolvedAudioSource {
  url: string;
  label: string;
  contentType: string;
  contentLength: number | null;
}

/** Probes the candidates (HEAD, falling back to a 1-byte ranged GET). */
export async function resolveAudioSource(
  candidates: AudioSourceCandidate[],
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 6000
): Promise<ResolvedAudioSource | null> {
  for (const candidate of candidates) {
    try {
      let res = await fetchImpl(candidate.url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 405 || res.status === 501) {
        res = await fetchImpl(candidate.url, {
          method: 'GET',
          headers: { Range: 'bytes=0-0' },
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs),
        });
        void res.body?.cancel().catch(() => {});
      }
      if (!res.ok) continue;
      const contentType = res.headers.get('content-type');
      if (!looksLikeAudio(contentType, candidate.url)) continue;
      let contentLength: number | null = null;
      const range = res.headers.get('content-range');
      const rangeTotal = range ? Number(range.split('/')[1]) : NaN;
      if (Number.isFinite(rangeTotal) && rangeTotal > 0) {
        contentLength = rangeTotal;
      } else {
        const len = Number(res.headers.get('content-length'));
        contentLength = Number.isFinite(len) && len > 1 ? len : null;
      }
      return {
        url: candidate.url,
        label: candidate.label,
        contentType:
          contentType && !contentType.includes('octet-stream')
            ? contentType
            : guessMimeFromUrl(candidate.url),
        contentLength,
      };
    } catch {
      // try next candidate
    }
  }
  return null;
}
