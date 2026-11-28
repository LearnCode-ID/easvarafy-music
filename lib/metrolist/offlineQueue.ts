/**
 * Pure (framework-free) logic for offline downloads:
 *  - the download queue state machine (queued -> downloading -> saving -> done / error)
 *  - progress maths, byte formatting, file naming, index (de)serialisation.
 *
 * No browser / Capacitor APIs here so everything is unit-testable with node:test
 * (see offlineQueue.test.ts). The I/O lives in offlineAudio.ts.
 */
import type { LyricsPayload, Track } from './types';

export interface DownloadedTrack {
  provider?: string;
  sha256?: string;
  videoId: string;
  title: string;
  artist: string;
  album: string | null;
  duration: number | null;
  /** Original (remote) artwork URL. */
  thumbnail: string;
  /**
   * Where the audio lives:
   *  - Android APK: `file:///data/user/0/com.easvarafy.app/files/offline/audio/<id>.<ext>`
   *  - Web: `idb://audio/<id>` (IndexedDB blob store)
   */
  localUri: string;
  /** Local artwork copy (same scheme as localUri) or null when it could not be saved. */
  localThumbUri: string | null;
  mimeType: string;
  fileSizeBytes: number;
  downloadedAt: number;
  lyrics: LyricsPayload | null;
  /** Full track object so the song can be queued / played offline as-is. */
  track: Track;
  /** Which configured audio source served the file (for diagnostics). */
  source?: string;
}

export type DownloadStatus = 'queued' | 'downloading' | 'saving' | 'error' | 'cancelled';

export interface DownloadJob {
  videoId: string;
  track: Track;
  status: DownloadStatus;
  /** 0–100, or null while the total size is unknown. */
  progress: number | null;
  receivedBytes: number;
  totalBytes: number | null;
  error: string | null;
  enqueuedAt: number;
}

export interface DownloadQueueState {
  jobs: Record<string, DownloadJob>;
  /** FIFO order of videoIds. */
  order: string[];
}

export function downloadKey(track: Pick<Track, 'videoId' | 'provider'> | string): string {
  if (typeof track === 'string') return track.includes(':') ? track.trim() : `youtube:${track.trim()}`;
  return `${track.provider || 'youtube'}:${track.videoId.trim()}`;
}
export const OFFLINE_INDEX_VERSION = 2;
export const MAX_CONCURRENT_DOWNLOADS = 2;

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

export function sanitizeVideoId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  return VIDEO_ID_RE.test(id) ? id : null;
}

export function createDownloadQueue(): DownloadQueueState {
  return { jobs: {}, order: [] };
}

/** Adds a track to the queue. Re-queues a failed job; ignores one already in flight. */
export function enqueueDownload(
  state: DownloadQueueState,
  track: Track,
  now: number = Date.now()
): DownloadQueueState {
  if (!sanitizeVideoId(track?.videoId) || !/^[a-z0-9_-]+$/.test(track.provider || 'youtube')) return state;
  track = { ...track, videoId: sanitizeVideoId(track.videoId)! };
  const id = downloadKey(track);
  const existing = state.jobs[id];
  if (existing && existing.status !== 'error' && existing.status !== 'cancelled') return state;
  const job: DownloadJob = {
    videoId: track.videoId,
    track,
    status: 'queued',
    progress: null,
    receivedBytes: 0,
    totalBytes: null,
    error: null,
    enqueuedAt: now,
  };
  return {
    jobs: { ...state.jobs, [id]: job },
    order: existing ? state.order : [...state.order, id],
  };
}

export function activeDownloadCount(state: DownloadQueueState): number {
  return state.order.reduce((n, id) => {
    const s = state.jobs[id]?.status;
    return s === 'downloading' || s === 'saving' ? n + 1 : n;
  }, 0);
}

/** Next queued job to start, respecting the concurrency limit. */
export function nextQueuedJob(
  state: DownloadQueueState,
  maxConcurrent: number = MAX_CONCURRENT_DOWNLOADS
): DownloadJob | null {
  if (activeDownloadCount(state) >= maxConcurrent) return null;
  for (const id of state.order) {
    const job = state.jobs[id];
    if (job?.status === 'queued') return job;
  }
  return null;
}

function patchJob(
  state: DownloadQueueState,
  videoId: string,
  patch: Partial<DownloadJob>
): DownloadQueueState {
  videoId = downloadKey(videoId);
  const job = state.jobs[videoId];
  if (!job) return state;
  return { ...state, jobs: { ...state.jobs, [videoId]: { ...job, ...patch } } };
}

export function markDownloadStarted(state: DownloadQueueState, videoId: string): DownloadQueueState {
  return patchJob(state, videoId, { status: 'downloading', progress: null, error: null });
}

export function updateDownloadProgress(
  state: DownloadQueueState,
  videoId: string,
  receivedBytes: number,
  totalBytes: number | null
): DownloadQueueState {
  return patchJob(state, videoId, {
    receivedBytes,
    totalBytes,
    progress: computeProgressPercent(receivedBytes, totalBytes),
  });
}

export function markDownloadSaving(state: DownloadQueueState, videoId: string): DownloadQueueState {
  return patchJob(state, videoId, { status: 'saving' });
}

export function markDownloadFailed(
  state: DownloadQueueState,
  videoId: string,
  message: string
): DownloadQueueState {
  return patchJob(state, videoId, { status: 'error', error: message, progress: null });
}

/** Removes a job (finished, cancelled or dismissed). */
export function removeDownloadJob(state: DownloadQueueState, videoId: string): DownloadQueueState {
  videoId = downloadKey(videoId);
  if (!state.jobs[videoId]) return state;
  const jobs = { ...state.jobs };
  delete jobs[videoId];
  return { jobs, order: state.order.filter((id) => id !== videoId) };
}

/**
 * Percentage 0–100 (floored, never 100 until the last byte) or null when the
 * server did not send a Content-Length.
 */
export function computeProgressPercent(received: number, total: number | null | undefined): number | null {
  if (!total || !Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(received) || received <= 0) return 0;
  if (received >= total) return 100;
  return Math.max(0, Math.min(99, Math.floor((received / total) * 100)));
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function totalDownloadedBytes(records: readonly DownloadedTrack[]): number {
  return records.reduce((sum, r) => sum + (Number.isFinite(r.fileSizeBytes) ? r.fileSizeBytes : 0), 0);
}

const MIME_EXT: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
};

export function extensionForMime(mime: string | null | undefined): string {
  const base = (mime || '').split(';')[0].trim().toLowerCase();
  return MIME_EXT[base] ?? 'audio';
}

export function audioFileName(videoId: string, mime: string | null | undefined): string {
  return `${videoId}.${extensionForMime(mime)}`;
}

/** Newest first, one record per videoId. */
export function upsertDownloadRecord(
  records: readonly DownloadedTrack[],
  record: DownloadedTrack
): DownloadedTrack[] {
  return [record, ...records.filter((r) => downloadKey(r) !== downloadKey(record))].sort(
    (a, b) => b.downloadedAt - a.downloadedAt
  );
}

export function removeDownloadRecord(
  records: readonly DownloadedTrack[],
  videoId: string
): DownloadedTrack[] {
  return records.filter((r) => downloadKey(r) !== downloadKey(videoId));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Validates a stored index (JSON) and drops anything malformed. */
export function parseOfflineIndex(raw: unknown): DownloadedTrack[] {
  const list = isRecord(raw) && Array.isArray(raw.tracks) ? raw.tracks : Array.isArray(raw) ? raw : [];
  const out: DownloadedTrack[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!isRecord(item)) continue;
    const videoId = sanitizeVideoId(item.videoId);
    const provider = typeof item.provider === 'string' && /^[a-z0-9_-]+$/.test(item.provider) ? item.provider : 'youtube';
    const key = downloadKey({videoId: videoId || '', provider});
    if (!videoId || seen.has(key)) continue;
    if (typeof item.localUri !== 'string' || !item.localUri) continue;
    const track = isRecord(item.track) ? (item.track as unknown as Track) : null;
    const title = typeof item.title === 'string' ? item.title : track?.title ?? 'Tanpa judul';
    const artist = typeof item.artist === 'string' ? item.artist : track?.artist ?? '';
    const thumbnail = typeof item.thumbnail === 'string' ? item.thumbnail : track?.thumbnail ?? '';
    const duration = typeof item.duration === 'number' ? item.duration : track?.duration ?? null;
    seen.add(key);
    out.push({
      videoId,
      provider,
      ...(typeof item.sha256 === 'string' ? { sha256: item.sha256 } : {}),
      title,
      artist,
      album: typeof item.album === 'string' ? item.album : null,
      duration,
      thumbnail,
      localUri: item.localUri,
      localThumbUri: typeof item.localThumbUri === 'string' ? item.localThumbUri : null,
      mimeType: typeof item.mimeType === 'string' ? item.mimeType : 'audio/mpeg',
      fileSizeBytes: typeof item.fileSizeBytes === 'number' ? item.fileSizeBytes : 0,
      downloadedAt: typeof item.downloadedAt === 'number' ? item.downloadedAt : 0,
      lyrics: isRecord(item.lyrics) ? (item.lyrics as unknown as LyricsPayload) : null,
      track: track ? { ...track, provider } : {
        provider,
        videoId,
        title,
        artist,
        artists: [{ artistId: null, name: artist }],
        album: null,
        duration,
        thumbnail,
        type: 'SONG',
      },
      ...(typeof item.source === 'string' ? { source: item.source } : {}),
    });
  }
  return out.sort((a, b) => b.downloadedAt - a.downloadedAt);
}

export function serializeOfflineIndex(records: readonly DownloadedTrack[]): string {
  return JSON.stringify({ version: OFFLINE_INDEX_VERSION, tracks: records });
}

/** Human-readable (Indonesian) error for a failed audio request. */
export function describeDownloadError(status: number | null, serverMessage?: string | null): string {
  if (serverMessage && serverMessage.trim()) return serverMessage.trim();
  if (status === null) return 'Tidak ada koneksi internet. Coba lagi saat online.';
  if (status === 401 || status === 403) return 'Provider menolak akses atau URL unduhan kedaluwarsa. Coba lagi untuk meminta sumber baru; jika tetap ditolak, lagu tidak dapat diunduh.';
  if (status === 422) return 'Sumber bukan file audio tunggal yang didukung untuk unduhan.';
  if (status === 404) return 'Audio lagu ini belum tersedia untuk diunduh.';
  if (status === 400) return 'Permintaan unduhan tidak valid.';
  if (status === 413) return 'Ukuran file audio terlalu besar.';
  if (status === 429) return 'Terlalu banyak unduhan. Coba lagi sebentar lagi.';
  if (status >= 500) return 'Server audio sedang bermasalah. Coba lagi nanti.';
  return `Gagal mengunduh lagu (HTTP ${status}).`;
}

/** Converts bytes to base64 in 32 KB slices (avoids call-stack limits). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + step) as unknown as number[]
    );
  }
  return btoa(binary);
}

/** Merges small stream chunks into ~`targetSize` blocks for efficient disk writes. */
export function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  const size = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
