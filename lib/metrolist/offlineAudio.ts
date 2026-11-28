'use client';

/** Device-local audio library. Android uses the foreground-only native direct-to-file
 * plugin; web stores validated blobs in IndexedDB. Metadata never leaves this device.
 * Completion follows content validation + file verification + durable index write.
 */
import { NativeDownload, hasNativeDownloads, getWifiOnly, transferError } from '@/lib/native/downloads';
import { validateAudioTransfer, MAX_AUDIO_BYTES } from './audioValidation';
import { Capacitor } from '@capacitor/core';
import { apiUrl } from '@/lib/api/base';
import type { LyricsPayload, Track } from './types';
import {
  downloadKey,
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
  error: string | null;
  records: DownloadedTrack[];
  byId: ReadonlyMap<string, DownloadedTrack>;
  queue: DownloadQueueState;
  totalBytes: number;
}

let loadError: string | null = null;

function buildSnapshot(ready: boolean, records: DownloadedTrack[], queue: DownloadQueueState): OfflineSnapshot {
  return {
    ready,
    error: loadError,
    records,
    byId: new Map(records.map((r) => [downloadKey(r), r])),
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
function relativeOfflinePath(uri: string): string | null {
  const idx = uri.indexOf(`/${OFFLINE_DIR}/`);
  if (idx < 0) return null;
  const path = decodeURIComponent(uri.slice(idx + 1));
  return /^offline\/(audio|art)\/[A-Za-z0-9_:.-]+$/.test(path) && !path.includes('..') ? path : null;
}

async function fs() {
  return import('@capacitor/filesystem');
}

const nativeBackend: OfflineBackend = {
  async loadIndex() {
    if (hasNativeDownloads()) {
      const { json } = await NativeDownload.readIndex();
      const raw = JSON.parse(json);
      if (!Array.isArray(raw) && !(raw && Array.isArray(raw.tracks))) throw new Error('Format indeks unduhan rusak. Pulihkan data sebelum melanjutkan.');
      return parseOfflineIndex(raw);
    }
    const { Filesystem, Directory, Encoding } = await fs();
    try {
      const res = await Filesystem.readFile({
        path: INDEX_PATH,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
      const text = typeof res.data === 'string' ? res.data : await res.data.text();
      return parseOfflineIndex(JSON.parse(text));
    } catch (err) {
      if ((err as { code?: string })?.code === 'OS-PLUG-FILE-0008') return [];
      throw new Error('Daftar unduhan lokal tidak dapat dibaca. Jangan hapus data aplikasi; coba buka ulang.');
    }
  },

  async saveIndex(records) {
    if (hasNativeDownloads()) {
      await NativeDownload.writeIndex({ json: serializeOfflineIndex(records) });
      return;
    }
    const { Filesystem, Directory, Encoding } = await fs();
    await Filesystem.writeFile({
      path: `${INDEX_PATH}.tmp`,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      data: serializeOfflineIndex(records),
      recursive: true,
    });
    await Filesystem.rename({ from: `${INDEX_PATH}.tmp`, to: INDEX_PATH, directory: Directory.Data, toDirectory: Directory.Data });
  },

  async createWriter() {
    throw new Error('Transfer audio native harus memakai EasvarafyDownload, bukan base64.');
  },

  async removeFiles(record) {
    const { Filesystem, Directory } = await fs();
    for (const uri of [record.localUri, record.localThumbUri]) {
      if (!uri) continue;
      const path = relativeOfflinePath(uri);
      if (!path) continue;
      try {
        await Filesystem.deleteFile({ path, directory: Directory.Data });
      } catch (err) {
        if ((err as {code?: string})?.code !== 'OS-PLUG-FILE-0008') throw new Error('File tidak dapat dihapus. Periksa akses penyimpanan aplikasi.');
      }
    }
  },

  async clearAll() {
    const { Filesystem, Directory } = await fs();
    try {
      await Filesystem.rmdir({ path: OFFLINE_DIR, directory: Directory.Data, recursive: true });
    } catch (err) {
      if ((err as {code?: string})?.code !== 'OS-PLUG-FILE-0008') throw new Error('Folder unduhan tidak dapat dihapus. Coba lagi.');
    }
  },

  async resolveUrl(localUri) {
    if (!localUri) return null;
    const { Filesystem, Directory } = await fs();
    const path = relativeOfflinePath(localUri);
    if (!path) return null;
    const st = await Filesystem.stat({ path, directory: Directory.Data });
    return st.size > 0 ? Capacitor.convertFileSrc(localUri) : null;
  },
};

// ---- Web: IndexedDB --------------------------------------------------------

const IDB_NAME = 'easvarafy-offline';
const IDB_VERSION = 2;
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
  try {
    const result = await run(tx);
    await done;
    return result;
  } catch (err) {
    try { tx.abort(); } catch { /* already complete/aborted */ }
    await done.catch(() => {});
    throw err;
  }
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
      return parseOfflineIndex(rows.map((r) => ({ ...r, videoId: r.track?.videoId || r.videoId })));
    } catch {
      throw new Error('Database unduhan browser tidak dapat dibaca. Periksa izin penyimpanan.');
    }
  },

  async saveIndex(records) {
    await idbTx([STORE_TRACKS], 'readwrite', (tx) => {
      const store = tx.objectStore(STORE_TRACKS);
      store.clear();
      for (const r of records) store.put({ ...r, videoId: downloadKey(r) });
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

  async removeFiles(record) {
    revokeObjectUrl(record.localUri);
    revokeObjectUrl(record.localThumbUri);
    await idbTx([STORE_BLOBS], 'readwrite', (tx) => {
      const store = tx.objectStore(STORE_BLOBS);
      store.delete(idbKeyFromUri(record.localUri) || `audio:${downloadKey(record)}`);
      store.delete(idbKeyFromUri(record.localThumbUri || '') || `art:${downloadKey(record)}`);
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
    if (!(blob instanceof Blob) || !blob.size) return null;
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
  if (isNativeOfflineStorage()) return hasNativeDownloads();
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
    loadError = null;
    loadPromise = (async () => {
      if (isNativeOfflineStorage() && hasNativeDownloads()) await NativeDownload.cleanupParts();
      const stored = await backend().loadIndex();
      const records: DownloadedTrack[] = [];
      for (const record of stored) if (await validateStoredRecord(record)) records.push(record);
      if (records.length !== stored.length) await backend().saveIndex(records);
      const uris = records.flatMap(r => [r.localUri, ...(r.localThumbUri ? [r.localThumbUri] : [])]);
      if (isNativeOfflineStorage() && hasNativeDownloads()) await NativeDownload.prune({ uris });
      if (!isNativeOfflineStorage()) {
        const keep = new Set(uris.map(uri => idbKeyFromUri(uri)));
        await idbTx([STORE_BLOBS], 'readwrite', async tx => {
          const store = tx.objectStore(STORE_BLOBS);
          const keys = await idbRequest(store.getAllKeys());
          for (const key of keys) if (!keep.has(String(key))) store.delete(key);
        });
      }
      setSnapshot({ ready: true, records });
    })().catch((err) => { loadPromise = null; loadError = err instanceof Error ? err.message : 'Daftar unduhan tidak dapat dibaca.'; setSnapshot({ ready: false }); throw err; });
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
  proxyUrl: string;
  contentType: string | null;
  contentLength: number | null;
  label: string;
}

async function resolveSource(track: Track, signal: AbortSignal): Promise<ResolvedSource> {
  const params = new URLSearchParams({ videoId: track.videoId, provider: track.provider || 'youtube', title: track.title, artist: track.artist });
  const proxyUrl = apiUrl(`/api/music/audio?${params}`);
  const res = await fetch(`${proxyUrl}&resolve=1`, { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]), cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok || body.downloadAllowed !== true) {
    throw new DownloadError(describeDownloadError(res.status, body.message));
  }
  return { proxyUrl, contentType: body.contentType ?? null, contentLength: body.contentLength ?? null, label: body.source ?? 'configured' };
}

async function validateStoredRecord(record: DownloadedTrack): Promise<boolean> {
  try {
    if (isNativeOfflineStorage()) {
      if (!hasNativeDownloads()) {
        const { Filesystem, Directory } = await fs();
        const path = relativeOfflinePath(record.localUri);
        if (!path) return false;
        return (await Filesystem.stat({ path, directory: Directory.Data })).size === record.fileSizeBytes;
      }
      return (await NativeDownload.inspect({ uri: record.localUri, size: record.fileSizeBytes, sha256: record.sha256 })).valid;
    }
    const key = idbKeyFromUri(record.localUri);
    if (!key) return false;
    const blob = await idbTx([STORE_BLOBS], 'readonly', tx => idbRequest(tx.objectStore(STORE_BLOBS).get(key))) as Blob | undefined;
    if (!(blob instanceof Blob) || blob.size !== record.fileSizeBytes) return false;
    validateAudioTransfer(new Uint8Array(await blob.slice(0,64).arrayBuffer()), blob.size, record.fileSizeBytes, record.mimeType);
    if (record.sha256 && await blobHash(blob) !== record.sha256) return false;
    return true;
  } catch { return false; }
}
async function validatePlayableBlob(blob: Blob): Promise<void> {
  // Node integration tests cover I/O; the separate browser suite exercises the decoder.
  if (typeof document === 'undefined') return;
  const audio = document.createElement('audio');
  const url = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Validasi audio melewati batas waktu.')), 15_000);
      const finish = (error?: Error) => {
        clearTimeout(timer); audio.onloadedmetadata = null; audio.onerror = null;
        if (error) reject(error); else resolve();
      };
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => Number.isFinite(audio.duration) && audio.duration > 0
        ? finish() : finish(new Error('Durasi audio tidak valid. Format mungkin tidak didukung browser.'));
      audio.onerror = () => finish(new Error('Audio rusak atau format tidak dapat diputar browser ini.'));
      audio.src = url;
    });
  } finally { audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url); }
}
async function blobHash(blob: Blob): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

// Index writes and record mutations must be serialised: two finishing jobs used
// to overwrite one another's metadata. No audio is ever synced to an account.
let mutationTail: Promise<unknown> = Promise.resolve();
function mutate<T>(work: () => Promise<T>): Promise<T> {
  const result = mutationTail.then(work);
  mutationTail = result.catch(() => {});
  return result;
}
let clearing = false;
const running = new Map<string, Promise<void>>();

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

async function runJob(videoId: string) {
  const job = snapshot.queue.jobs[videoId];
  if (!job) return;
  const track = job.track;
  const controller = new AbortController();
  controllers.set(videoId, controller);
  setQueue((q) => markDownloadStarted(q, videoId));

  const store = backend();
  let writer: AudioWriter | null = null;
  let saved: DownloadedTrack | null = null;
  const timeout = setTimeout(() => controller.abort(new Error('Batas waktu unduhan 10 menit tercapai.')), 10 * 60_000);
  try {
    if (isNativeOfflineStorage() && getWifiOnly() && !(await NativeDownload.network()).wifi)
      throw new DownloadError('Unduh hanya lewat Wi-Fi aktif. Sambungkan Wi-Fi lalu coba lagi.');
    const src = await resolveSource(track, controller.signal);
    controller.signal.throwIfAborted();
    let localUri: string, size: number, contentType: string, sha256: string | undefined;
    if (isNativeOfflineStorage()) {
      const listener = await NativeDownload.addListener('progress', event => {
        if (event.id === videoId) setQueue(q => updateDownloadProgress(q, videoId, event.received, event.total));
      });
      const abort = () => { void NativeDownload.cancel({ id: videoId }).catch(() => {}); };
      try {
        controller.signal.throwIfAborted();
        // Start call before registering abort so cancel cannot race ahead of transfer.
        const transfer = NativeDownload.transfer({ id: videoId, url: new URL(src.proxyUrl, window.location.href).href, wifiOnly: getWifiOnly() });
        controller.signal.addEventListener('abort', abort, { once: true });
        ({ localUri, size, mimeType: contentType, sha256 } = await transfer);
      } catch (err) {
        if (controller.signal.aborted) throw err;
        throw new DownloadError(transferError(err));
      } finally {
        controller.signal.removeEventListener('abort', abort);
        await listener.remove();
      }
    } else {
      // Same-origin validated proxy only. It resolves a fresh provider URL on every attempt.
      const res = await fetch(src.proxyUrl, { signal: controller.signal, cache: 'no-store' });
      if (res.status !== 200) throw new DownloadError(describeDownloadError(res.status));
      const type = res.headers.get('content-type') || src.contentType;
      const length = Number(res.headers.get('content-length') || res.headers.get('x-audio-length'));
      const total = length > 0 ? length : src.contentLength;
      if (total && total > MAX_AUDIO_BYTES) throw new DownloadError('File melebihi batas 250 MB.');
      if (!res.body) throw new DownloadError('Browser tidak mendukung transfer audio streaming.');
      const reader = res.body.getReader();
      let received = 0;
      const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.signal.throwIfAborted();
          received += value.byteLength;
          if (received > MAX_AUDIO_BYTES) throw new DownloadError('File melebihi batas 250 MB.');
          chunks.push(value);
          setQueue(q => updateDownloadProgress(q, videoId, received, total));
        }
      } finally { await reader.cancel().catch(() => {}); }
      const blob = new Blob(chunks as BlobPart[]);
      const format = validateAudioTransfer(new Uint8Array(await blob.slice(0,64).arrayBuffer()), received, total, type);
      contentType = format.mimeType;
      await validatePlayableBlob(blob);
      sha256 = await blobHash(blob);
      writer = await store.createWriter(videoId, contentType);
      for (const chunk of chunks) { controller.signal.throwIfAborted(); await writer.write(chunk); }
      ({ localUri, size } = await writer.finish());
      writer = null;
    }
    // Track the finalized file immediately, so cancellation/index failure cleans it too.
    saved = {
      videoId: track.videoId, provider: track.provider || 'youtube', sha256,
      title: track.title, artist: track.artist, album: track.album?.name ?? null,
      duration: track.duration ?? null, thumbnail: track.thumbnail, localUri,
      localThumbUri: null, mimeType: contentType, fileSizeBytes: size,
      downloadedAt: Date.now(), lyrics: null, track, source: src.label,
    };
    controller.signal.throwIfAborted();
    setQueue(q => markDownloadSaving(q, videoId));
    if (!await validateStoredRecord(saved)) throw new DownloadError('File tidak tersedia atau tidak valid setelah disimpan.');
    // Optional lyrics must not hold a valid audio file hostage to a slow network.
    saved.lyrics = await fetchLyrics(track, AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]));
    controller.signal.throwIfAborted();
    const record = saved;
    await mutate(async () => {
      controller.signal.throwIfAborted();
      const records = upsertDownloadRecord(snapshot.records, record);
      await store.saveIndex(records);
      if (controller.signal.aborted) {
        await store.saveIndex(snapshot.records);
        controller.signal.throwIfAborted();
      }
      setSnapshot({ records, queue: removeDownloadJob(snapshot.queue, videoId) });
    });
    saved = null;
    settle(videoId, record);
  } catch (err) {
    if (writer) await writer.abort().catch(() => {});
    if (saved) await store.removeFiles(saved).catch(() => {});
    const message = controller.signal.aborted
      ? (controller.signal.reason instanceof Error && controller.signal.reason.name !== 'AbortError' ? controller.signal.reason.message : 'Unduhan dibatalkan.')
      : err instanceof Error ? (err.name === 'QuotaExceededError' ? 'Penyimpanan browser penuh. Hapus unduhan lain lalu coba lagi.' : err.name === 'TypeError' ? 'Koneksi audio terputus. Periksa internet lalu coba lagi.' : err.message) : 'Gagal menyimpan audio.';
    setQueue(q => markDownloadFailed(q, videoId, message));
    if (message === 'Unduhan dibatalkan.') setQueue(q => ({ ...q, jobs: { ...q.jobs, [videoId]: { ...q.jobs[videoId], status: 'cancelled' } } }));
    settle(videoId, new Error(message));
  } finally {
    clearTimeout(timeout);
    controllers.delete(videoId);
  }
}

function pump() {
  if (clearing) return;
  for (;;) {
    const next = nextQueuedJob(snapshot.queue);
    if (!next) return;
    // mark synchronously so the loop does not pick it twice
    const key = downloadKey(next.track);
    setQueue((q) => markDownloadStarted(q, key));
    const promise = runJob(key);
    running.set(key, promise);
    void promise.finally(() => { running.delete(key); pump(); });
  }
}

let persistRequested = false;

/**
 * Queues a song for offline download. Resolves with the saved record, rejects
 * with an Error whose message is ready to show in the UI.
 */
export async function downloadTrack(track: Track): Promise<DownloadedTrack> {
  if (clearing) throw new Error('Tunggu penghapusan unduhan selesai.');
  if (!sanitizeVideoId(track?.videoId) || !/^[a-z0-9_-]+$/.test(track.provider || 'youtube')) throw new Error('Identitas lagu tidak valid.');
  track = { ...track, videoId: sanitizeVideoId(track.videoId)! };
  const videoId = downloadKey(track);
  if (!videoId) throw new Error('ID lagu tidak valid.');
  if (!isOfflineDownloadSupported()) {
    throw new Error('Perangkat ini tidak mendukung penyimpanan offline.');
  }
  await ensureOfflineLibraryLoaded();
  const existing = snapshot.byId.get(videoId);
  if (existing && await validateStoredRecord(existing)) return existing;
  if (existing) await removeDownloadedTrack(videoId);
  if (clearing) throw new Error('Tunggu penghapusan selesai.');

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
  videoId = downloadKey(videoId);
  const controller = controllers.get(videoId);
  if (controller) {
    controller.abort();
    return;
  }
  setQueue(q => { const job = q.jobs[videoId]; return job ? { ...q, jobs: { ...q.jobs, [videoId]: { ...job, status: 'cancelled', error: 'Unduhan dibatalkan.' } } } : q; });
  settle(videoId, new Error('Unduhan dibatalkan.'));
}

/** Hides a failed download's error badge. */
export function dismissDownloadError(videoId: string) {
  videoId = downloadKey(videoId);
  if (['error', 'cancelled'].includes(snapshot.queue.jobs[videoId]?.status)) {
    setQueue((q) => removeDownloadJob(q, videoId));
  }
}

export async function removeDownloadedTrack(videoId: string): Promise<void> {
  await ensureOfflineLibraryLoaded();
  videoId = downloadKey(videoId);
  await mutate(async () => {
    const record = snapshot.byId.get(videoId);
    if (!record) return;
    await backend().removeFiles(record);
    const records = removeDownloadRecord(snapshot.records, videoId);
    await backend().saveIndex(records);
    setSnapshot({ records });
  });
}

export async function getDownloadedTrack(videoId: string): Promise<DownloadedTrack | null> {
  await ensureOfflineLibraryLoaded();
  return snapshot.byId.get(downloadKey(videoId)) ?? null;
}

export function getDownloadedTrackSync(track: Pick<Track, 'videoId' | 'provider'> | string | null | undefined): DownloadedTrack | null {
  return track ? snapshot.byId.get(downloadKey(track)) ?? null : null;
}

export async function listDownloadedTracks(): Promise<DownloadedTrack[]> {
  await ensureOfflineLibraryLoaded();
  return snapshot.records;
}

export async function clearAllDownloads(): Promise<void> {
  await ensureOfflineLibraryLoaded();
  clearing = true;
  try {
    for (const id of snapshot.queue.order) cancelDownload(id);
    await Promise.allSettled([...running.values()]);
    await mutate(async () => {
      await backend().clearAll();
      setSnapshot({ records: [], queue: createDownloadQueue() });
    });
  } finally { clearing = false; pump(); }
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
    if (await validateStoredRecord(record)) return await backend().resolveUrl(record.localUri);
    revokeObjectUrl(record.localUri);
    await mutate(async () => {
      const records = removeDownloadRecord(snapshot.records, downloadKey(record));
      await backend().saveIndex(records);
      setSnapshot({ records });
    });
    return null;
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
  return m ? snapshot.byId.get(downloadKey(m[1])) ?? null : null;
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
  return typeof navigator !== 'undefined' && !navigator.onLine ? '/favicon.svg' : record.thumbnail;
}
