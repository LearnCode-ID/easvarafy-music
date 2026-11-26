'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowDownToLine, CheckCircle2, Loader2, Trash2, X } from 'lucide-react';
import { useMusic } from './MusicProvider';
import type { Track } from '@/lib/metrolist/types';
import {
  cancelDownload,
  downloadTrack,
  formatBytes,
  isOfflineDownloadSupported,
  removeDownloadedTrack,
} from '@/lib/metrolist/offlineAudio';
import { useOfflineTrackState, type OfflineTrackState } from '@/lib/metrolist/useOfflineLibrary';

/** Starts a download and reports the result through the app toast. */
export function useTrackDownloadActions() {
  const { showToast } = useMusic();
  const start = (track: Track) => {
    if (!isOfflineDownloadSupported()) {
      showToast('Perangkat ini tidak mendukung penyimpanan offline');
      return;
    }
    showToast(`Mengunduh "${track.title}"…`);
    downloadTrack(track).then(
      () => showToast(`"${track.title}" tersimpan offline`),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Gagal mengunduh lagu';
        if (msg !== 'Unduhan dibatalkan.') showToast(msg);
      }
    );
  };
  const remove = (track: Track) => {
    removeDownloadedTrack(track.videoId).then(
      () => showToast(`Unduhan "${track.title}" dihapus`),
      () => showToast('Gagal menghapus unduhan')
    );
  };
  const cancel = (track: Track) => {
    cancelDownload(track.videoId);
    showToast('Unduhan dibatalkan');
  };
  return { start, remove, cancel };
}

/** Circular progress ring (0–100, or indeterminate when null). */
export function ProgressRing({
  progress,
  size = 22,
  stroke = 2.5,
}: {
  progress: number | null;
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = progress === null ? 25 : Math.max(0, Math.min(100, progress));
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={progress === null ? 'animate-spin' : undefined}
      aria-hidden="true"
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--m3-primary)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c - (pct / 100) * c}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 150ms linear' }}
      />
    </svg>
  );
}

function stateLabel(state: OfflineTrackState): string {
  switch (state.kind) {
    case 'idle':
      return 'Download';
    case 'queued':
      return 'Menunggu antrean…';
    case 'downloading':
      return state.progress === null ? 'Mengunduh…' : `Mengunduh ${state.progress}%`;
    case 'saving':
      return 'Menyimpan…';
    case 'error':
      return 'Gagal — coba lagi';
    case 'downloaded':
      return 'Tersimpan Offline';
  }
}

interface DownloadButtonProps {
  track: Track;
  /**
   * icon: compact round button for song rows
   * pill: labelled button (Now Playing sheet)
   */
  variant?: 'icon' | 'pill';
  className?: string;
}

/** Download / progress % / "Tersimpan Offline" (+ remove) status button. */
export function DownloadButton({ track, variant = 'icon', className = '' }: DownloadButtonProps) {
  const state = useOfflineTrackState(track.videoId);
  const { start, remove, cancel } = useTrackDownloadActions();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!confirmOpen) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setConfirmOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [confirmOpen]);

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    switch (state.kind) {
      case 'idle':
      case 'error':
        start(track);
        break;
      case 'queued':
      case 'downloading':
        cancel(track);
        break;
      case 'downloaded':
        setConfirmOpen((v) => !v);
        break;
      default:
        break;
    }
  };

  const label = stateLabel(state);
  const title =
    state.kind === 'error'
      ? state.message
      : state.kind === 'downloading' || state.kind === 'queued'
        ? `${label} — ketuk untuk batal`
        : state.kind === 'downloaded'
          ? `Tersimpan Offline (${formatBytes(state.fileSizeBytes)})`
          : `Download "${track.title}" untuk diputar offline`;

  const icon = (() => {
    switch (state.kind) {
      case 'idle':
        return <ArrowDownToLine className="w-4 h-4" />;
      case 'queued':
        return <ProgressRing progress={null} size={variant === 'pill' ? 18 : 20} />;
      case 'downloading':
        return (
          <span className="relative inline-flex items-center justify-center">
            <ProgressRing progress={state.progress} size={variant === 'pill' ? 18 : 22} />
            {variant === 'icon' && state.progress !== null && (
              <span className="absolute text-[7px] font-bold tabular-nums">{state.progress}</span>
            )}
          </span>
        );
      case 'saving':
        return <Loader2 className="w-4 h-4 animate-spin text-[var(--m3-primary)]" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      case 'downloaded':
        return <CheckCircle2 className="w-4 h-4 text-[var(--m3-primary)] fill-[var(--m3-primary-soft)]" />;
    }
  })();

  return (
    <div className={`relative inline-flex ${className}`} ref={wrapRef}>
      {variant === 'pill' ? (
        <button
          type="button"
          onClick={onClick}
          title={title}
          aria-label={title}
          data-testid="download-button"
          data-state={state.kind}
          className={`inline-flex items-center gap-2 h-9 px-3.5 rounded-full text-xs font-semibold transition-colors border ${
            state.kind === 'downloaded'
              ? 'border-[var(--m3-primary)]/40 bg-[var(--m3-primary-soft)] text-[var(--m3-primary)]'
              : state.kind === 'error'
                ? 'border-red-500/40 text-red-500 bg-red-500/10'
                : 'border-black/10 bg-black/5 text-slate-700 hover:bg-black/10 dark:border-white/15 dark:bg-white/10 dark:text-white dark:hover:bg-white/20'
          }`}
        >
          {icon}
          <span className="whitespace-nowrap">{label}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={onClick}
          title={title}
          aria-label={title}
          data-testid="download-button"
          data-state={state.kind}
          className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        >
          {icon}
        </button>
      )}

      {confirmOpen && state.kind === 'downloaded' && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-11 z-50 w-56 rounded-2xl liquid-glass-elevated p-1.5 text-sm shadow-2xl"
          role="dialog"
          aria-label="Opsi unduhan"
        >
          <div className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
            Tersimpan Offline · {formatBytes(state.fileSizeBytes)}
          </div>
          <button
            type="button"
            onClick={() => {
              remove(track);
              setConfirmOpen(false);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-red-500 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            <span>Hapus unduhan</span>
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(false)}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-slate-700 dark:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
            <span>Batal</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** Row for menus (TrackContextMenu). */
export function DownloadMenuItem({ track, onDone }: { track: Track; onDone?: () => void }) {
  const state = useOfflineTrackState(track.videoId);
  const { start, remove, cancel } = useTrackDownloadActions();
  const label =
    state.kind === 'downloaded'
      ? `Hapus Unduhan (${formatBytes(state.fileSizeBytes)})`
      : state.kind === 'downloading' || state.kind === 'queued'
        ? `${stateLabel(state)} · Batal`
        : state.kind === 'error'
          ? 'Coba Download Lagi'
          : 'Download (Offline)';
  return (
    <button
      type="button"
      data-testid="download-menu-item"
      onClick={() => {
        if (state.kind === 'downloaded') remove(track);
        else if (state.kind === 'downloading' || state.kind === 'queued') cancel(track);
        else if (state.kind !== 'saving') start(track);
        onDone?.();
      }}
      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-slate-800 dark:text-slate-100 hover:bg-black/5 dark:hover:bg-white/10 transition-colors whitespace-nowrap"
    >
      {state.kind === 'downloaded' ? (
        <Trash2 className="w-4 h-4 text-red-500" />
      ) : state.kind === 'downloading' ? (
        <ProgressRing progress={state.progress} size={16} stroke={2} />
      ) : state.kind === 'queued' || state.kind === 'saving' ? (
        <Loader2 className="w-4 h-4 animate-spin text-[var(--m3-primary)]" />
      ) : state.kind === 'error' ? (
        <AlertCircle className="w-4 h-4 text-red-500" />
      ) : (
        <ArrowDownToLine className="w-4 h-4 text-slate-500 dark:text-slate-400" />
      )}
      <span>{label}</span>
    </button>
  );
}

/** Small "Offline" badge for song rows that are already downloaded. */
export function OfflineBadge({ videoId }: { videoId: string }) {
  const state = useOfflineTrackState(videoId);
  if (state.kind !== 'downloaded') return null;
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[var(--m3-primary)]"
      title="Tersimpan Offline"
    >
      <CheckCircle2 className="w-3 h-3" />
    </span>
  );
}
