'use client';

/**
 * Offline song storage (download + play without internet).
 *
 *  - Android APK (Capacitor): audio, cover art and the index live in the app's
 *    private storage (`Directory.Data/offline/...`) through @capacitor/filesystem.
 *    Playback uses `Capacitor.convertFileSrc(fileUri)`.
 *  - Web browser: audio + cover blobs and metadata live in IndexedDB; playback
 *    uses `URL.createObjectURL(blob)`.
 *
 * Downloads go through a small queue (max 2 at a time) with live progress
 * (0–100 %) read from the fetch ReadableStream. State is exposed as an external
 * store so React components can subscribe (see useOfflineLibrary.ts).
 *
 * Pure logic (queue, progress, index parsing) lives in offlineQueue.ts.
 */
import { Capacitor } from '@capacitor/core';
import { apiUrl } from '@/lib/api/base';
import { upgradeArtworkUrl } from '@/lib/native/mediaControls';
import type { LyricsPayload, Track } from './types';
import {
  audioFileName,
  bytesToBase64,
  concatChunks,
  createDownloadQueue,
  describeDownloadError,
  markDownloadFailed,
  markDownloadSaving,
  markDownloadStarted,
  nextQueuedJob,
  enqueueDownload,
  parseOfflineIndex,
  removeDownloadJob,
  removeDownloadRecord,
  sanitizeVideoId,
  serializeOfflineIndex,
  totalDownloadedBytes,
  updateDownloadProgress,
  upsertDownloadRecord,
  type DownloadQueueState,
  type DownloadedTrack,
} from './offlineQueue';

export type { DownloadedTrack, DownloadJob, DownloadQueueState } from './offlineQueue';
export { formatBytes } from './offlineQueue';

// ---------------------------------------------------------------------------
// External store
// ---------------------------------------------------------------------------

export interface OfflineSnapshot {
  ready: boolean;
  records: DownloadedTrack[];
  byId: ReadonlyMap<string, DownloadedTrack>;
  queue: DownloadQueueState;
  totalBytes: number;
}

function buildSnapshot(ready: boolean, records: DownloadedTrack[], queue: DownloadQueueState): OfflineSnapshot {
  return {
    ready,
    records,
    byId: new Map(records.map((r) => [r.videoId, r])),
    queue,
    totalBytes: totalDownloadedBytes(records),
  };
}

const SERVER_SNAPSHOT: OfflineSnapshot = buildSnapshot(false, [], createDownloadQueue());
let snapshot: OfflineSnapshot = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();

function setSnapshot(next: Partial<Pick<OfflineSnapshot, 'ready' | 'records' | 'queue'>>) {
  snapshot = buildSnapshot(
    next.ready ?? snapshot.ready,
    next.records ?? snapshot.records,
    next.queue ?? snapshot.queue
  );
  for (const l of listeners) l();
}

function setQueue(updater: (q: DownloadQueueState) => DownloadQueueState) {
  setSnapshot({ queue: updater(snapshot.queue) });
}

export function subscribeOffline(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getOfflineSnapshot(): OfflineSnapshot {
  return snapshot;
}

export function getOfflineServerSnapshot(): OfflineSnapshot {
  return SERVER_SNAPSHOT;
}

// ---------------------------------------------------------------------------
// Storage backends
// ---------------------------------------------------------------------------

interface AudioWriter {
  write(chunk: Uint8Array): Promise<void>;
  finish(): Promise<{ localUri: string; size: number }>;
  abort(): Promise<void>;
}

interface OfflineBackend {
  loadIndex(): Promise<DownloadedTrack[]>;
  saveIndex(records: DownloadedTrack[]): Promise<void>;
  createWriter(videoId: string, mimeType: string): Promise<AudioWriter>;
  saveThumb(videoId: string, blob: Blob): Promise<string | null>;
  removeFiles(record: DownloadedTrack): Promise<void>;
  clearAll(): Promise<void>;
  resolveUrl(localUri: string): Promise<string | null>;
}

export function isNativeOfflineStorage(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

// ---- Android / iOS: @capacitor/filesystem --------------------------------

const OFFLINE_DIR = 'offline';
const INDEX_PATH = `${OFFLINE_DIR}/index.json`;
/** Flush to disk every ~512 KB (base64 over the bridge). */
const NATIVE_FLUSH_BYTES = 512 * 1024;

function relativeOfflinePath(uri: string): string | null {
  const idx = uri.indexOf(`/${OFFLINE_DIR}/`);
  if (idx < 0) return null;
  return decodeURIComponent(uri.slice(idx + 1));
}

async function fs() {
  return import('@capacitor/filesystem');
}

const nativeBackend: OfflineBackend = {
  async loadIndex() {
    const { Filesystem, Directory, Encoding } = await fs();
    try {
      const res = await Filesystem.readFile({
        path: INDEX_PATH,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
      const text = typeof res.data === 'string' ? res.data : await res.data.text();
      return parseOfflineIndex(JSON.parse(text));
    } catch {
      return [];
    }
  },

  async saveIndex(records) {
    const { Filesystem, Directory, Encoding } = await fs();
    await Filesystem.writeFile({
      path: INDEX_PATH,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      data: serializeOfflineIndex(records),
      recursive: true,
    });
  },

  async createWriter(videoId, mimeType) {
    const { Filesystem, Directory } = await fs();
    const finalPath = `${OFFLINE_DIR}/audio/${audioFileName(videoId, mimeType)}`;
    const partPath = `${finalPath}.part`;
    let pending: Uint8Array[] = [];
    let pendingBytes = 0;
    let written = 0;
    let started = false;

    const flush = async () => {
      if (pendingBytes === 0 && started) return;
      const data = bytesToBase64(concatChunks(pending));
      pending = [];
      written += pendingBytes;
      pendingBytes = 0;
      if (!started) {
        await Filesystem.writeFile({ path: partPath, directory: Directory.Data, data, recursive: true });
        started = true;
      } else {
        await Filesystem.appendFile({ path: partPath, directory: Directory.Data, data });
      }
    };

    return {
      async write(chunk) {
        pending.push(chunk);
        pendingBytes += chunk.byteLength;
        if (pendingBytes >= NATIVE_FLUSH_BYTES) await flush();
      },
      async finish() {
        await flush();
        try {
          await Filesystem.deleteFile({ path: finalPath, directory: Directory.Data });
        } catch {
          // no previous copy
        }
        await Filesystem.rename({
          from: partPath,
          to: finalPath,
          directory: Directory.Data,
          toDirectory: Directory.Data,
        });
        const { uri } = await Filesystem.getUri({ path: finalPath, directory: Directory.Data });
        let size = written;
        try {
          const st = await Filesystem.stat({ path: finalPath, directory: Directory.Data });
          if (st.size > 0) size = st.size;
        } catch {
          // keep counted size
        }
        return { localUri: uri, size };
      },
      async abort() {
        pending = [];
        try {
          await Filesystem.deleteFile({ path: partPath, directory: Directory.Data });
        } catch {
          // nothing written yet
        }
      },
    };
  },

  async saveThumb(videoId, blob) {
    const { Filesystem, Directory } = await fs();
    const path = `${OFFLINE_DIR}/art/${videoId}.jpg`;
    const data = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    await Filesystem.writeFile({ path, directory: Directory.Data, data, recursive: true });
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
    return uri;
  },

  async removeFiles(record) {
    const { Filesystem, Directory } = await fs();
    for (const uri of [record.localUri, record.localThumbUri]) {
      if (!uri) continue;
      const path = relativeOfflinePath(uri);
      if (!path) continue;
      try {
        await Filesystem.deleteFile({ path, directory: Directory.Data });
      } catch {
        // already gone
      }
    }
  },

  async clearAll() {
    const { Filesystem, Directory } = await fs();
    try {
      await Filesystem.rmdir({ path: OFFLINE_DIR, directory: Directory.Data, recursive: true });
    } catch {
      // nothing stored
    }
  },

  async resolveUrl(localUri) {
    if (!localUri) return null;
    return Capacitor.convertFileSrc(localUri);
  },
};

// ---- Web: IndexedDB --------------------------------------------------------

const IDB_NAME = 'easvarafy-offline';
const IDB_VERSION = 1;
const STORE_TRACKS = 'tracks';
const STORE_BLOBS = 'blobs';

let idbPromise: Promise<IDBDatabase> | null = null;

function openIdb(): Promise<IDBDatabase> {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB tidak tersedia di browser ini.'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_TRACKS)) {
        db.createObjectStore(STORE_TRACKS, { keyPath: 'videoId' });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Gagal membuka IndexedDB.'));
  });
  idbPromise.catch(() => {
    idbPromise = null;
  });
  return idbPromise;
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbTx<T>(
  stores: string[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => Promise<T> | T
): Promise<T> {
  const db = await openIdb();
  const tx = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Transaksi IndexedDB dibatalkan.'));
    tx.onerror = () => reject(tx.error);
  });
  const result = await run(tx);
  await done;
  return result;
}

const objectUrls = new Map<string, string>();

function idbKeyFromUri(uri: string): string | null {
  const m = /^idb:\/\/(audio|art)\/(.+)$/.exec(uri);
  return m ? `${m[1]}:${m[2]}` : null;
}

function revokeObjectUrl(uri: string | null | undefined) {
  if (!uri) return;
  const url = objectUrls.get(uri);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrls.delete(uri);
  }
}

const webBackend: OfflineBackend = {
  async loadIndex() {
    try {
      const rows = await idbTx([STORE_TRACKS], 'readonly', (tx) =>
        idbRequest(tx.objectStore(STORE_TRACKS).getAll())
      );
      return parseOfflineIndex(rows);
    } catch {
      return [];
    }
  },

  async saveIndex(records) {
    await idbTx([STORE_TRACKS], 'readwrite', (tx) => {
      const store = tx.objectStore(STORE_TRACKS);
      store.clear();
      for (const r of records) store.put(r);
    });
  },

  async createWriter(videoId, mimeType) {
    let chunks: Uint8Array[] = [];
    let size = 0;
    return {
      async write(chunk) {
        chunks.push(chunk);
        size += chunk.byteLength;
      },
      async finish() {
        const blob = new Blob(chunks as BlobPart[], { type: mimeType || 'audio/mpeg' });
        chunks = [];
        const localUri = `idb://audio/${videoId}`;
        revokeObjectUrl(localUri);
        await idbTx([STORE_BLOBS], 'readwrite', (tx) => {
          tx.objectStore(STORE_BLOBS).put(blob, `audio:${videoId}`);
        });
        return { localUri, size: blob.size || size };
      },
      async abort() {
        chunks = [];
      },
    };
  },

  async saveThumb(videoId, blob) {
    const uri = `idb://art/${videoId}`;
    revokeObjectUrl(uri);
    await idbTx([STORE_BLOBS], 'readwrite', (tx) => {
      tx.objectStore(STORE_BLOBS).put(blob, `art:${videoId}`);
    });
    return uri;
  },

  async removeFiles(record) {
    revokeObjectUrl(record.localUri);
    revokeObjectUrl(record.localThumbUri);
    await idbTx([STORE_BLOBS], 'readwrite', (tx) => {
      const store = tx.objectStore(STORE_BLOBS);
      store.delete(`audio:${record.videoId}`);
      store.delete(`art:${record.videoId}`);
    });
  },

  async clearAll() {
    for (const uri of [...objectUrls.keys()]) revokeObjectUrl(uri);
    await idbTx([STORE_TRACKS, STORE_BLOBS], 'readwrite', (tx) => {
      tx.objectStore(STORE_TRACKS).clear();
      tx.objectStore(STORE_BLOBS).clear();
    });
  },

  async resolveUrl(localUri) {
    const cached = objectUrls.get(localUri);
    if (cached) return cached;
    const key = idbKeyFromUri(localUri);
    if (!key) return null;
    const blob = await idbTx([STORE_BLOBS], 'readonly', (tx) =>
      idbRequest(tx.objectStore(STORE_BLOBS).get(key) as IDBRequest<Blob | undefined>)
    );
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    objectUrls.set(localUri, url);
    return url;
  },
};

function backend(): OfflineBackend {
  return isNativeOfflineStorage() ? nativeBackend : webBackend;
}

export function isOfflineDownloadSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (isNativeOfflineStorage()) return true;
  return typeof indexedDB !== 'undefined' && typeof ReadableStream !== 'undefined';
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

let loadPromise: Promise<void> | null = null;

/** Loads the offline index once (safe to call from anywhere). */
export function ensureOfflineLibraryLoaded(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (!loadPromise) {
    loadPromise = backend()
      .loadIndex()
      .then((records) => setSnapshot({ ready: true, records }))
      .catch(() => setSnapshot({ ready: true, records: [] }));
  }
  return loadPromise;
}

// ---------------------------------------------------------------------------
// Downloading
// ---------------------------------------------------------------------------

class DownloadError extends Error {}

const controllers = new Map<string, AbortController>();
const deferreds = new Map<
  string,
  Array<{ resolve: (r: DownloadedTrack) => void; reject: (e: Error) => void }>
>();

function settle(videoId: string, result: DownloadedTrack | Error) {
  const waiters = deferreds.get(videoId) ?? [];
  deferreds.delete(videoId);
  for (const w of waiters) {
    if (result instanceof Error) w.reject(result);
    else w.resolve(result);
  }
}

interface ResolvedSource {
  url: string;
  proxyUrl: string;
  contentType: string | null;
  contentLength: number | null;
  label: string;
}

async function resolveSource(track: Track, signal: AbortSignal): Promise<ResolvedSource> {
  const params = new URLSearchParams({
    videoId: track.videoId,
    title: track.title ?? '',
    artist: track.artist ?? '',
  });
  const proxyUrl = apiUrl(`/api/music/audio?${params.toString()}`);
  let res: Response;
  try {
    res = await fetch(`${proxyUrl}&resolve=1`, { signal, cache: 'no-store' });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new DownloadError(describeDownloadError(null));
  }
  let body: { ok?: boolean; url?: string; message?: string; contentType?: string; contentLength?: number; source?: string } = {};
  try {
    body = await res.json();
  } catch {
    // non-JSON error page
  }
  if (!res.ok || !body.ok || !body.url) {
    throw new DownloadError(describeDownloadError(res.status, body.message));
  }
  return {
    url: body.url,
    proxyUrl,
    contentType: body.contentType ?? null,
    contentLength: typeof body.contentLength === 'number' ? body.contentLength : null,
    label: body.source ?? 'unknown',
  };
}

async function openAudioStream(src: ResolvedSource, signal: AbortSignal): Promise<Response> {
  // 1) straight from the (CORS-enabled) source; 2) through our proxy route.
  for (const url of [src.url, src.proxyUrl]) {
    try {
      const res = await fetch(url, { signal, cache: 'no-store' });
      if (res.ok) return res;
      if (url === src.proxyUrl) {
        let message: string | undefined;
        try {
          message = ((await res.json()) as { message?: string }).message;
        } catch {
          // ignore
        }
        throw new DownloadError(describeDownloadError(res.status, message));
      }
    } catch (err) {
      if (signal.aborted || err instanceof DownloadError) throw err;
      if (url === src.proxyUrl) throw new DownloadError(describeDownloadError(null));
    }
  }
  throw new DownloadError(describeDownloadError(null));
}

async function fetchLyrics(track: Track, signal: AbortSignal): Promise<LyricsPayload | null> {
  try {
    const params = new URLSearchParams({
      videoId: track.videoId,
      title: track.title,
      artist: track.artist,
      duration: String(track.duration ?? 0),
    });
    const res = await fetch(apiUrl(`/api/music/lyrics?${params.toString()}`), { signal });
    if (!res.ok) return null;
    const data = (await res.json()) as LyricsPayload;
    return data && (data.lines?.length || data.plainText) ? data : null;
  } catch {
    return null;
  }
}

async function fetchThumb(track: Track, signal: AbortSignal): Promise<Blob | null> {
  const url = upgradeArtworkUrl(track.thumbnail);
  if (!url) return null;
  try {
    const res = await fetch(url, { signal, mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.size > 0 && blob.size < 3 * 1024 * 1024 ? blob : null;
  } catch {
    return null;
  }
}

async function runJob(videoId: string) {
  const job = snapshot.queue.jobs[videoId];
  if (!job) return;
  const track = job.track;
  const controller = new AbortController();
  controllers.set(videoId, controller);
  setQueue((q) => markDownloadStarted(q, videoId));

  const store = backend();
  let writer: AudioWriter | null = null;
  try {
    const src = await resolveSource(track, controller.signal);
    const res = await openAudioStream(src, controller.signal);
    const contentType = (res.headers.get('content-type') || src.contentType || 'audio/mpeg').split(';')[0];
    if (contentType.startsWith('text/') || contentType.includes('json')) {
      throw new DownloadError(describeDownloadError(404));
    }
    const lenHeader = Number(res.headers.get('content-length') || res.headers.get('x-audio-length'));
    const total = Number.isFinite(lenHeader) && lenHeader > 0 ? lenHeader : src.contentLength;
    writer = await store.createWriter(videoId, contentType);

    let received = 0;
    let lastEmit = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        await writer.write(value);
        received += value.byteLength;
        const now = Date.now();
        if (now - lastEmit > 150) {
          lastEmit = now;
          setQueue((q) => updateDownloadProgress(q, videoId, received, total));
        }
      }
    } else {
      const buf = new Uint8Array(await res.arrayBuffer());
      await writer.write(buf);
      received = buf.byteLength;
    }
    if (received === 0) throw new DownloadError('File audio kosong. Coba lagi nanti.');
    setQueue((q) => markDownloadSaving(updateDownloadProgress(q, videoId, received, total ?? received), videoId));

    const { localUri, size } = await writer.finish();
    writer = null;

    const [lyrics, thumbBlob] = await Promise.all([
      fetchLyrics(track, controller.signal),
      fetchThumb(track, controller.signal),
    ]);
    let localThumbUri: string | null = null;
    if (thumbBlob) {
      try {
        localThumbUri = await store.saveThumb(videoId, thumbBlob);
      } catch {
        localThumbUri = null;
      }
    }

    const record: DownloadedTrack = {
      videoId,
      title: track.title,
      artist: track.artist,
      album: track.album?.name ?? null,
      duration: track.duration ?? null,
      thumbnail: track.thumbnail,
      localUri,
      localThumbUri,
      mimeType: contentType,
      fileSizeBytes: size,
      downloadedAt: Date.now(),
      lyrics,
      track,
      source: src.label,
    };
    const records = upsertDownloadRecord(snapshot.records, record);
    await store.saveIndex(records);
    setSnapshot({ records, queue: removeDownloadJob(snapshot.queue, videoId) });
    settle(videoId, record);
  } catch (err) {
    if (writer) await writer.abort().catch(() => {});
    if (controller.signal.aborted) {
      setQueue((q) => removeDownloadJob(q, videoId));
      settle(videoId, new Error('Unduhan dibatalkan.'));
    } else {
      const message =
        err instanceof DownloadError
          ? err.message
          : 'Gagal menyimpan lagu ke perangkat. Pastikan ruang penyimpanan cukup.';
      setQueue((q) => markDownloadFailed(q, videoId, message));
      settle(videoId, new Error(message));
    }
  } finally {
    controllers.delete(videoId);
    pump();
  }
}

function pump() {
  for (;;) {
    const next = nextQueuedJob(snapshot.queue);
    if (!next) return;
    // mark synchronously so the loop does not pick it twice
    setQueue((q) => markDownloadStarted(q, next.videoId));
    void runJob(next.videoId);
  }
}

let persistRequested = false;

/**
 * Queues a song for offline download. Resolves with the saved record, rejects
 * with an Error whose message is ready to show in the UI.
 */
export async function downloadTrack(track: Track): Promise<DownloadedTrack> {
  const videoId = sanitizeVideoId(track?.videoId);
  if (!videoId) throw new Error('ID lagu tidak valid.');
  if (!isOfflineDownloadSupported()) {
    throw new Error('Perangkat ini tidak mendukung penyimpanan offline.');
  }
  await ensureOfflineLibraryLoaded();
  const existing = snapshot.byId.get(videoId);
  if (existing) return existing;

  if (!persistRequested && !isNativeOfflineStorage()) {
    persistRequested = true;
    void navigator.storage?.persist?.().catch(() => false);
  }

  const promise = new Promise<DownloadedTrack>((resolve, reject) => {
    const list = deferreds.get(videoId) ?? [];
    list.push({ resolve, reject });
    deferreds.set(videoId, list);
  });
  setQueue((q) => enqueueDownload(q, track));
  pump();
  return promise;
}

export function cancelDownload(videoId: string) {
  const controller = controllers.get(videoId);
  if (controller) {
    controller.abort();
    return;
  }
  setQueue((q) => removeDownloadJob(q, videoId));
  settle(videoId, new Error('Unduhan dibatalkan.'));
}

/** Hides a failed download's error badge. */
export function dismissDownloadError(videoId: string) {
  if (snapshot.queue.jobs[videoId]?.status === 'error') {
    setQueue((q) => removeDownloadJob(q, videoId));
  }
}

export async function removeDownloadedTrack(videoId: string): Promise<void> {
  await ensureOfflineLibraryLoaded();
  const record = snapshot.byId.get(videoId);
  if (!record) return;
  const store = backend();
  await store.removeFiles(record);
  const records = removeDownloadRecord(snapshot.records, videoId);
  await store.saveIndex(records);
  setSnapshot({ records });
}

export async function getDownloadedTrack(videoId: string): Promise<DownloadedTrack | null> {
  await ensureOfflineLibraryLoaded();
  return snapshot.byId.get(videoId) ?? null;
}

/** Synchronous lookup (null until the index has loaded). */
export function getDownloadedTrackSync(videoId: string | null | undefined): DownloadedTrack | null {
  if (!videoId) return null;
  return snapshot.byId.get(videoId) ?? null;
}

export async function listDownloadedTracks(): Promise<DownloadedTrack[]> {
  await ensureOfflineLibraryLoaded();
  return snapshot.records;
}

export async function clearAllDownloads(): Promise<void> {
  await ensureOfflineLibraryLoaded();
  for (const c of controllers.values()) c.abort();
  await backend().clearAll();
  setSnapshot({ records: [], queue: createDownloadQueue() });
}

export interface OfflineStorageUsage {
  count: number;
  bytes: number;
  /** Browser/WebView quota estimate, when available. */
  quotaBytes: number | null;
}

export async function getOfflineStorageUsage(): Promise<OfflineStorageUsage> {
  await ensureOfflineLibraryLoaded();
  let quotaBytes: number | null = null;
  try {
    const est = await navigator.storage?.estimate?.();
    quotaBytes = typeof est?.quota === 'number' ? est.quota : null;
  } catch {
    quotaBytes = null;
  }
  return { count: snapshot.records.length, bytes: snapshot.totalBytes, quotaBytes };
}

/** Playable URL for a downloaded song (`_capacitor_file_` URL or blob: URL). */
export async function resolveOfflinePlaybackUrl(record: DownloadedTrack): Promise<string | null> {
  try {
    return await backend().resolveUrl(record.localUri);
  } catch {
    return null;
  }
}

/** Local cover art URL (falls back to the remote thumbnail). */
/**
 * Finds the downloaded song an artwork URL belongs to (exact thumbnail match or
 * the YouTube video id inside an i.ytimg.com URL). Used to swap network artwork
 * for the locally stored copy when offline.
 */
export function findDownloadedByArtwork(src: string | null | undefined): DownloadedTrack | null {
  if (!src || snapshot.records.length === 0) return null;
  for (const r of snapshot.records) {
    if (r.thumbnail === src || r.track?.thumbnail === src) return r;
  }
  const m = /\/vi(?:_webp)?\/([A-Za-z0-9_-]{6,20})\//.exec(src);
  return m ? snapshot.byId.get(m[1]) ?? null : null;
}

export async function resolveOfflineArtworkUrl(record: DownloadedTrack): Promise<string> {
  if (record.localThumbUri) {
    try {
      const url = await backend().resolveUrl(record.localThumbUri);
      if (url) return url;
    } catch {
      // fall back
    }
  }
  return record.thumbnail;
}
