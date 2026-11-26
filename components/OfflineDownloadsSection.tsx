'use client';

import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowDownToLine, Play, RotateCcw, Shuffle, WifiOff, X } from 'lucide-react';
import { ArtworkImage } from './ArtworkImage';
import { DownloadButton, ProgressRing, useTrackDownloadActions } from './DownloadButton';
import { useMusic } from './MusicProvider';
import { formatDuration } from '@/lib/metrolist/lyrics';
import {
  cancelDownload,
  dismissDownloadError,
  formatBytes,
  resolveOfflineArtworkUrl,
  type DownloadedTrack,
} from '@/lib/metrolist/offlineAudio';
import { useOfflineLibrary, useOnlineStatus } from '@/lib/metrolist/useOfflineLibrary';
import { cn } from '@/lib/utils';

/** Cover art from local storage (works offline), falling back to the remote URL. */
function OfflineArtwork({ record }: { record: DownloadedTrack }) {
  const [src, setSrc] = useState(record.thumbnail);
  useEffect(() => {
    let alive = true;
    void resolveOfflineArtworkUrl(record).then((url) => {
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [record]);
  return (
    <ArtworkImage src={src} alt={record.title} className="w-11 h-11" rounded="rounded-xl" sizeHint="sm" />
  );
}

/** Library › Offline: downloaded songs + the active download queue. */
export function OfflineDownloadsSection() {
  const { playTrack, currentTrack, playbackSource } = useMusic();
  const { ready, records, queue, totalBytes } = useOfflineLibrary();
  const online = useOnlineStatus();
  const { start } = useTrackDownloadActions();
  const jobs = queue.order.map((id) => queue.jobs[id]).filter(Boolean);
  const tracks = records.map((r) => r.track);

  return (
    <div className="space-y-3" data-testid="offline-downloads-section">
      {!online && (
        <div className="flex items-start gap-3 rounded-[22px] p-4 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-sm">
          <WifiOff className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Kamu sedang offline</p>
            <p className="opacity-80">Lagu di bawah ini tetap bisa diputar tanpa internet.</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            Lagu Tersimpan Offline ({records.length})
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {formatBytes(totalBytes)} dipakai di perangkat ini
          </p>
        </div>
        {records.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => playTrack(tracks[0], tracks)}
              data-testid="offline-play-all"
              className="h-9 px-4 rounded-full bg-[var(--m3-primary)] text-[var(--m3-on-primary)] text-xs font-semibold flex items-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Putar Offline</span>
            </button>
            <button
              type="button"
              onClick={() => playTrack(tracks[Math.floor(Math.random() * tracks.length)], tracks)}
              aria-label="Acak lagu offline"
              className="h-9 px-3.5 rounded-full metro-surface text-xs font-semibold text-slate-800 dark:text-white flex items-center gap-1.5"
            >
              <Shuffle className="w-3.5 h-3.5" />
              <span>Acak</span>
            </button>
          </div>
        )}
      </div>

      {jobs.length > 0 && (
        <div className="rounded-[28px] metro-surface divide-y divide-black/5 dark:divide-white/[0.06]">
          {jobs.map((job) => (
            <div key={job.videoId} className="flex items-center gap-3 px-4 py-2.5">
              <ArtworkImage src={job.track.thumbnail} alt={job.track.title} className="w-11 h-11 opacity-70" rounded="rounded-xl" sizeHint="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate text-slate-900 dark:text-white">{job.track.title}</p>
                {job.status === 'error' ? (
                  <p className="text-xs text-red-500 flex items-center gap-1 truncate">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span className="truncate">{job.error}</span>
                  </p>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {job.status === 'queued'
                      ? 'Menunggu antrean…'
                      : job.status === 'saving'
                        ? 'Menyimpan ke perangkat…'
                        : `${job.progress === null ? '…' : `${job.progress}%`} · ${formatBytes(job.receivedBytes)}${job.totalBytes ? ` / ${formatBytes(job.totalBytes)}` : ''}`}
                  </p>
                )}
              </div>
              {job.status === 'error' ? (
                <>
                  <button
                    type="button"
                    onClick={() => start(job.track)}
                    aria-label="Coba lagi"
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full text-slate-500 hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => dismissDownloadError(job.videoId)}
                    aria-label="Tutup"
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full text-slate-500 hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <ProgressRing progress={job.status === 'queued' ? null : job.progress} size={24} />
                  <button
                    type="button"
                    onClick={() => cancelDownload(job.videoId)}
                    aria-label="Batalkan unduhan"
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full text-slate-500 hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {ready && records.length === 0 && jobs.length === 0 ? (
        <div className="rounded-[28px] metro-surface p-10 text-center text-sm text-slate-500 dark:text-slate-400">
          <ArrowDownToLine className="w-8 h-8 mx-auto mb-3 opacity-60" />
          Belum ada lagu tersimpan. Ketuk ikon download di daftar lagu atau di pemutar untuk
          menyimpan lagu agar bisa diputar tanpa internet.
        </div>
      ) : records.length > 0 ? (
        <div className="rounded-[28px] metro-surface divide-y divide-black/5 dark:divide-white/[0.06]">
          {records.map((record) => {
            const active = currentTrack?.videoId === record.videoId;
            return (
              <div
                key={record.videoId}
                data-testid="offline-track-row"
                className={cn(
                  'flex items-center gap-3 px-4 py-2.5 first:rounded-t-[28px] last:rounded-b-[28px]',
                  active && 'bg-[var(--m3-primary-soft)]'
                )}
              >
                <button
                  type="button"
                  onClick={() => playTrack(record.track, tracks)}
                  className="flex items-center gap-3 min-w-0 flex-1 text-left"
                  aria-label={`Putar offline ${record.title}`}
                >
                  <OfflineArtwork record={record} />
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'text-sm font-semibold truncate',
                        active ? 'text-[var(--m3-primary)]' : 'text-slate-900 dark:text-white'
                      )}
                    >
                      {record.title}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate flex items-center gap-1.5">
                      <span className="truncate">{record.artist}</span>
                      {record.duration !== null && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-nums">{formatDuration(record.duration)}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums bg-black/5 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                    {formatBytes(record.fileSizeBytes)}
                  </span>
                  {active && playbackSource === 'offline' && (
                    <span className="sr-only">Sedang diputar dari file offline</span>
                  )}
                </button>
                <DownloadButton track={record.track} />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
