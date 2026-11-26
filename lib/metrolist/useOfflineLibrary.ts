'use client';

import { useEffect, useSyncExternalStore } from 'react';
import {
  ensureOfflineLibraryLoaded,
  getOfflineServerSnapshot,
  getOfflineSnapshot,
  subscribeOffline,
  type OfflineSnapshot,
} from './offlineAudio';

/** Live view of downloaded songs + the download queue. */
export function useOfflineLibrary(): OfflineSnapshot {
  const snap = useSyncExternalStore(subscribeOffline, getOfflineSnapshot, getOfflineServerSnapshot);
  useEffect(() => {
    void ensureOfflineLibraryLoaded();
  }, []);
  return snap;
}

export type OfflineTrackState =
  | { kind: 'idle' }
  | { kind: 'queued' }
  | { kind: 'downloading'; progress: number | null }
  | { kind: 'saving' }
  | { kind: 'error'; message: string }
  | { kind: 'downloaded'; fileSizeBytes: number };

export function offlineStateFor(snap: OfflineSnapshot, videoId: string | null | undefined): OfflineTrackState {
  if (!videoId) return { kind: 'idle' };
  const record = snap.byId.get(videoId);
  if (record) return { kind: 'downloaded', fileSizeBytes: record.fileSizeBytes };
  const job = snap.queue.jobs[videoId];
  if (!job) return { kind: 'idle' };
  switch (job.status) {
    case 'queued':
      return { kind: 'queued' };
    case 'downloading':
      return { kind: 'downloading', progress: job.progress };
    case 'saving':
      return { kind: 'saving' };
    case 'error':
      return { kind: 'error', message: job.error ?? 'Gagal mengunduh.' };
  }
}

/** Download state of one song. */
export function useOfflineTrackState(videoId: string | null | undefined): OfflineTrackState {
  return offlineStateFor(useOfflineLibrary(), videoId);
}

/** Tracks the browser's online/offline state. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
    () => true
  );
}
