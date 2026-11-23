'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Crown, Headphones, ListMusic, Trophy } from 'lucide-react';
import { useMusic } from './MusicProvider';
import { VerifiedBadge } from './auth/VerifiedBadge';
import {
  fetchMonthlyTopListeners,
  formatListenDuration,
  formatMonthLabel,
  getCurrentMonthKey,
  type TopListenerEntry,
} from '@/lib/social/community';
import { cn } from '@/lib/utils';

export function HomeTopListenersSection() {
  const { openDetail, setActiveTab } = useMusic();
  const [listeners, setListeners] = useState<TopListenerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const monthKey = useMemo(() => getCurrentMonthKey(), []);
  const monthLabel = useMemo(() => formatMonthLabel(monthKey), [monthKey]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const res = await fetchMonthlyTopListeners(monthKey, 8);
      if (!active) return;
      setListeners(res.rows);
      setLoading(false);
    };
    void load();
    return () => {
      active = false;
    };
  }, [monthKey]);

  if (!loading && listeners.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--m3-primary)]">
            <Trophy className="h-3.5 w-3.5" />
            {monthLabel}
          </span>
          <h2 className="font-display text-xl font-extrabold tracking-tight text-[var(--m3-on-surface)] sm:text-2xl">
            Top Pendengar Bulan Ini
          </h2>
        </div>

        <button
          type="button"
          onClick={() => setActiveTab('listeners')}
          className="inline-flex items-center gap-1 rounded-full bg-[var(--m3-surface-container-high)] px-3.5 py-1.5 text-xs font-bold text-[var(--m3-on-surface)] transition hover:bg-[var(--m3-surface-container-highest)]"
        >
          Lihat Semua
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {loading ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-28 w-64 shrink-0 animate-pulse rounded-2xl bg-[var(--m3-surface-container)]"
            />
          ))}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {listeners.map((entry, idx) => {
            const rank = entry.rank || idx + 1;
            const initials = (entry.name || 'U')
              .split(/\s+/)
              .slice(0, 2)
              .map((p) => p[0]?.toUpperCase() || '')
              .join('');

            return (
              <button
                key={entry.user_id}
                type="button"
                onClick={() =>
                  openDetail({
                    kind: 'user-profile',
                    id: entry.user_id,
                    title: entry.name,
                  })
                }
                className={cn(
                  'group flex w-64 shrink-0 flex-col justify-between rounded-2xl border p-3.5 text-left transition hover:-translate-y-0.5 hover:border-[var(--m3-primary)]/50',
                  rank === 1
                    ? 'border-amber-400/45 bg-gradient-to-br from-amber-500/15 to-[var(--m3-surface-container)]'
                    : 'border-[var(--m3-outline-variant)]/30 bg-[var(--m3-surface-container)] hover:bg-[var(--m3-surface-container-high)]'
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="relative shrink-0">
                    {entry.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={entry.avatar_url}
                        alt={entry.name}
                        referrerPolicy="no-referrer"
                        className="h-11 w-11 rounded-full object-cover ring-2 ring-white/10"
                      />
                    ) : (
                      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--m3-primary-container)] text-xs font-extrabold text-[var(--m3-on-primary-container)]">
                        {initials || 'U'}
                      </div>
                    )}
                    <span
                      className={cn(
                        'absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black shadow',
                        rank === 1
                          ? 'bg-amber-400 text-slate-950'
                          : rank === 2
                          ? 'bg-slate-200 text-slate-900'
                          : rank === 3
                          ? 'bg-orange-400 text-slate-950'
                          : 'bg-[var(--m3-surface-container-highest)] text-[var(--m3-on-surface)]'
                      )}
                    >
                      {rank === 1 ? <Crown className="h-3 w-3" /> : `#${rank}`}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="truncate text-sm font-bold text-[var(--m3-on-surface)] group-hover:text-[var(--m3-primary)]">
                        {entry.name}
                      </span>
                      <VerifiedBadge role={entry.role} size="sm" />
                    </div>
                    <p className="truncate text-[11px] text-[var(--m3-on-surface-variant)]">
                      {entry.play_count} putar · {formatListenDuration(entry.listen_seconds)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between text-[11px] text-[var(--m3-on-surface-variant)]">
                  <span className="inline-flex items-center gap-1">
                    <ListMusic className="h-3 w-3 text-[var(--m3-primary)]" />
                    {entry.playlist_count} playlist
                  </span>
                  <span className="inline-flex items-center gap-1 font-semibold text-[var(--m3-primary)]">
                    <Headphones className="h-3 w-3" />
                    Kunjungi
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
