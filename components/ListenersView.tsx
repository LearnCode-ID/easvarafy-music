'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Clock3,
  Crown,
  Headphones,
  Heart,
  ListMusic,
  RefreshCw,
  Search,
  Sparkles,
  Trophy,
  User as UserIcon,
  Users,
} from 'lucide-react';
import { useMusic } from './MusicProvider';
import { useAuth } from './auth/AuthProvider';
import { VerifiedBadge } from './auth/VerifiedBadge';
import { publicRoleLabelOf } from '@/lib/auth/types';
import {
  fetchMonthlyTopListeners,
  formatListenDuration,
  formatMonthLabel,
  getCurrentMonthKey,
  getRecentMonthKeys,
  searchPublicProfiles,
  type PublicProfileSummary,
  type TopListenerEntry,
} from '@/lib/social/community';
import { cn } from '@/lib/utils';

function UserAvatarCircle({
  name,
  avatarUrl,
  size = 'md',
}: {
  name: string;
  avatarUrl: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const initials = (name || 'U')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  const sizeClass =
    size === 'lg'
      ? 'h-16 w-16 text-lg'
      : size === 'sm'
      ? 'h-10 w-10 text-xs'
      : 'h-12 w-12 text-sm';

  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name}
        referrerPolicy="no-referrer"
        className={cn(sizeClass, 'shrink-0 rounded-full object-cover ring-2 ring-white/10')}
      />
    );
  }

  return (
    <div
      className={cn(
        sizeClass,
        'flex shrink-0 items-center justify-center rounded-full bg-[var(--m3-primary-container)] font-extrabold text-[var(--m3-on-primary-container)]'
      )}
    >
      {initials || 'U'}
    </div>
  );
}

export function ListenersView() {
  const { openDetail } = useMusic();
  const { userId: currentUserId, profile: ownProfile } = useAuth();

  const monthKeys = useMemo(() => getRecentMonthKeys(4), []);
  const [selectedMonth, setSelectedMonth] = useState<string>(() => getCurrentMonthKey());

  const [topListeners, setTopListeners] = useState<TopListenerEntry[]>([]);
  const [loadingBoard, setLoadingBoard] = useState(true);
  const [boardError, setBoardError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [directory, setDirectory] = useState<PublicProfileSummary[]>([]);
  const [loadingDirectory, setLoadingDirectory] = useState(true);

  const loadLeaderboard = async (monthKey: string) => {
    setLoadingBoard(true);
    setBoardError(null);
    const res = await fetchMonthlyTopListeners(monthKey, 30);
    if (res.error) setBoardError(res.error);
    setTopListeners(res.rows);
    setLoadingBoard(false);
  };

  useEffect(() => {
    let active = true;
    const run = async () => {
      setLoadingBoard(true);
      setBoardError(null);
      const res = await fetchMonthlyTopListeners(selectedMonth, 30);
      if (!active) return;
      if (res.error) setBoardError(res.error);
      setTopListeners(res.rows);
      setLoadingBoard(false);
    };
    void run();
    return () => {
      active = false;
    };
  }, [selectedMonth]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setLoadingDirectory(true);
      const res = await searchPublicProfiles(searchQuery, 24);
      if (!active) return;
      setDirectory(res.rows);
      setLoadingDirectory(false);
    }, 220);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  const visitProfile = (id: string, name: string) => {
    openDetail({ kind: 'user-profile', id, title: name });
  };

  const podium = topListeners.slice(0, 3);
  const restBoard = topListeners.slice(3);

  return (
    <div className="space-y-8 pb-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--m3-primary-container)] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[var(--m3-on-primary-container)]">
            <Trophy className="h-3.5 w-3.5" />
            Komunitas Pendengar
          </span>
          <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-[var(--m3-on-surface)] sm:text-4xl">
            Top Pendengar Bulan Ini
          </h1>
          <p className="mt-1 text-sm text-[var(--m3-on-surface-variant)]">
            Lihat pendengar paling aktif di {formatMonthLabel(selectedMonth)} dan kunjungi profil untuk melihat playlist serta lagu mereka.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {currentUserId && (
            <button
              type="button"
              onClick={() =>
                visitProfile(currentUserId, ownProfile?.name || 'Profil Saya')
              }
              className="inline-flex items-center gap-2 rounded-full bg-[var(--m3-primary)] px-4 py-2 text-xs font-bold text-[var(--m3-on-primary)] transition hover:brightness-110"
            >
              <UserIcon className="h-3.5 w-3.5" />
              Profil Saya
            </button>
          )}
          <button
            type="button"
            onClick={() => void loadLeaderboard(selectedMonth)}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--m3-surface-container-high)] px-3.5 py-2 text-xs font-semibold text-[var(--m3-on-surface)] transition hover:bg-[var(--m3-surface-container-highest)]"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loadingBoard && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {/* Month Filter Pills */}
      <div className="flex flex-wrap items-center gap-2">
        {monthKeys.map((mk) => {
          const active = mk === selectedMonth;
          return (
            <button
              key={mk}
              type="button"
              onClick={() => setSelectedMonth(mk)}
              className={cn(
                'rounded-full px-4 py-1.5 text-xs font-bold transition',
                active
                  ? 'bg-[var(--m3-primary)] text-[var(--m3-on-primary)] shadow-sm'
                  : 'bg-[var(--m3-surface-container-high)] text-[var(--m3-on-surface-variant)] hover:text-[var(--m3-on-surface)]'
              )}
            >
              {formatMonthLabel(mk)}
            </button>
          );
        })}
      </div>

      {/* Leaderboard Section */}
      {boardError ? (
        <div className="m3-card p-6 text-center text-sm text-rose-400">
          {boardError}
        </div>
      ) : loadingBoard ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="m3-card h-44 animate-pulse bg-[var(--m3-surface-container)]"
            />
          ))}
        </div>
      ) : topListeners.length === 0 ? (
        <div className="m3-card p-8 text-center">
          <Headphones className="mx-auto mb-3 h-10 w-10 text-[var(--m3-on-surface-variant)]" />
          <p className="text-base font-bold text-[var(--m3-on-surface)]">
            Belum ada statistik pendengar di {formatMonthLabel(selectedMonth)}
          </p>
          <p className="mt-1 text-xs text-[var(--m3-on-surface-variant)]">
            Putar lagu saat login untuk muncul sebagai Top Pendengar bulan ini!
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Top 3 Podium */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {podium.map((entry, idx) => {
              const rank = entry.rank || idx + 1;
              const isMe = currentUserId === entry.user_id;
              const accentClass =
                rank === 1
                  ? 'border-amber-400/50 bg-gradient-to-br from-amber-500/15 via-[var(--m3-surface-container)] to-[var(--m3-surface-container-high)]'
                  : rank === 2
                  ? 'border-slate-300/40 bg-gradient-to-br from-slate-400/10 via-[var(--m3-surface-container)] to-[var(--m3-surface-container-high)]'
                  : 'border-orange-400/40 bg-gradient-to-br from-orange-500/10 via-[var(--m3-surface-container)] to-[var(--m3-surface-container-high)]';

              const rankBadge =
                rank === 1
                  ? 'bg-amber-400 text-slate-950'
                  : rank === 2
                  ? 'bg-slate-200 text-slate-900'
                  : 'bg-orange-400 text-slate-950';

              return (
                <button
                  key={entry.user_id}
                  type="button"
                  onClick={() => visitProfile(entry.user_id, entry.name)}
                  className={cn(
                    'group relative flex flex-col justify-between rounded-3xl border p-5 text-left transition hover:-translate-y-0.5 hover:border-[var(--m3-primary)]/60 hover:shadow-lg',
                    accentClass
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="relative">
                        <UserAvatarCircle
                          name={entry.name}
                          avatarUrl={entry.avatar_url}
                          size="lg"
                        />
                        <span
                          className={cn(
                            'absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-black shadow',
                            rankBadge
                          )}
                        >
                          {rank === 1 ? <Crown className="h-3.5 w-3.5" /> : `#${rank}`}
                        </span>
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-display text-base font-extrabold text-[var(--m3-on-surface)] group-hover:text-[var(--m3-primary)]">
                            {entry.name}
                          </span>
                          <VerifiedBadge role={entry.role} size="md" />
                        </div>
                        <p className="text-[11px] font-semibold text-[var(--m3-on-surface-variant)]">
                          {publicRoleLabelOf(entry.role)}
                          {isMe ? ' · Kamu' : ''}
                        </p>
                      </div>
                    </div>

                    <span className="shrink-0 rounded-full bg-[var(--m3-surface-container-highest)] px-2.5 py-1 text-[11px] font-bold text-[var(--m3-on-surface)]">
                      #{rank}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-black/10 p-2.5 text-center dark:bg-white/5">
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-[var(--m3-on-surface-variant)]">
                        Putar
                      </p>
                      <p className="font-display text-sm font-extrabold text-[var(--m3-on-surface)]">
                        {entry.play_count}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-[var(--m3-on-surface-variant)]">
                        Durasi
                      </p>
                      <p className="font-display text-sm font-extrabold text-[var(--m3-on-surface)]">
                        {formatListenDuration(entry.listen_seconds)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-[var(--m3-on-surface-variant)]">
                        Playlist
                      </p>
                      <p className="font-display text-sm font-extrabold text-[var(--m3-on-surface)]">
                        {entry.playlist_count}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-[var(--m3-on-surface-variant)]">
                    <span className="truncate">
                      {entry.last_track_title
                        ? `Terakhir: ${entry.last_track_title}`
                        : `${entry.liked_count} lagu disukai`}
                    </span>
                    <span className="shrink-0 font-bold text-[var(--m3-primary)] group-hover:underline">
                      Kunjungi →
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Ranks #4+ */}
          {restBoard.length > 0 && (
            <div className="m3-card divide-y divide-[var(--m3-outline-variant)]/25 overflow-hidden">
              {restBoard.map((entry, idx) => {
                const rank = entry.rank || idx + 4;
                const isMe = currentUserId === entry.user_id;
                return (
                  <button
                    key={entry.user_id}
                    type="button"
                    onClick={() => visitProfile(entry.user_id, entry.name)}
                    className="group flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition hover:bg-[var(--m3-surface-container-high)]/70"
                  >
                    <span className="w-7 shrink-0 text-center font-display text-sm font-extrabold text-[var(--m3-on-surface-variant)]">
                      #{rank}
                    </span>

                    <UserAvatarCircle
                      name={entry.name}
                      avatarUrl={entry.avatar_url}
                      size="sm"
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-bold text-[var(--m3-on-surface)] group-hover:text-[var(--m3-primary)]">
                          {entry.name}
                        </span>
                        <VerifiedBadge role={entry.role} size="sm" />
                        {isMe && (
                          <span className="rounded-full bg-[var(--m3-primary)]/15 px-2 py-0.5 text-[10px] font-bold text-[var(--m3-primary)]">
                            Kamu
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-[var(--m3-on-surface-variant)]">
                        {entry.last_track_title
                          ? `Terakhir memutar ${entry.last_track_title} · ${entry.last_track_artist || ''}`
                          : `${entry.playlist_count} playlist · ${entry.liked_count} lagu disukai`}
                      </p>
                    </div>

                    <div className="hidden shrink-0 items-center gap-4 text-xs text-[var(--m3-on-surface-variant)] sm:flex">
                      <span className="inline-flex items-center gap-1 font-semibold text-[var(--m3-on-surface)]">
                        <Headphones className="h-3.5 w-3.5 text-[var(--m3-primary)]" />
                        {entry.play_count}x
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="h-3.5 w-3.5" />
                        {formatListenDuration(entry.listen_seconds)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <ListMusic className="h-3.5 w-3.5" />
                        {entry.playlist_count}
                      </span>
                    </div>

                    <span className="shrink-0 text-xs font-bold text-[var(--m3-primary)]">
                      Profil →
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Community Directory / Visit Other Users */}
      <section className="space-y-4 pt-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 font-display text-xl font-extrabold text-[var(--m3-on-surface)]">
              <Users className="h-5 w-5 text-[var(--m3-primary)]" />
              Jelajahi Profil Pengguna
            </h2>
            <p className="text-xs text-[var(--m3-on-surface-variant)]">
              Kunjungi profil sesama pengguna untuk melihat playlist dan memutar lagu favorit mereka.
            </p>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--m3-on-surface-variant)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama pengguna..."
              className="w-full rounded-full border border-[var(--m3-outline-variant)]/40 bg-[var(--m3-surface-container-high)] py-2 pl-10 pr-4 text-xs text-[var(--m3-on-surface)] placeholder:text-[var(--m3-on-surface-variant)] focus:border-[var(--m3-primary)] focus:outline-none"
            />
          </div>
        </div>

        {loadingDirectory ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="m3-card h-24 animate-pulse bg-[var(--m3-surface-container)]"
              />
            ))}
          </div>
        ) : directory.length === 0 ? (
          <div className="m3-card p-6 text-center text-xs text-[var(--m3-on-surface-variant)]">
            Tidak ada pengguna yang cocok dengan pencarian &ldquo;{searchQuery}&rdquo;.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {directory.map((person) => {
              const isMe = currentUserId === person.id;
              return (
                <button
                  key={person.id}
                  type="button"
                  onClick={() => visitProfile(person.id, person.name)}
                  className="group flex items-center gap-3.5 rounded-2xl border border-[var(--m3-outline-variant)]/30 bg-[var(--m3-surface-container)] p-3.5 text-left transition hover:border-[var(--m3-primary)]/50 hover:bg-[var(--m3-surface-container-high)]"
                >
                  <UserAvatarCircle
                    name={person.name}
                    avatarUrl={person.avatar_url}
                    size="md"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-bold text-[var(--m3-on-surface)] group-hover:text-[var(--m3-primary)]">
                        {person.name}
                      </span>
                      <VerifiedBadge role={person.role} size="sm" />
                      {isMe && (
                        <span className="rounded-full bg-[var(--m3-primary)]/15 px-1.5 py-0.5 text-[9px] font-bold text-[var(--m3-primary)]">
                          Kamu
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2.5 text-[11px] text-[var(--m3-on-surface-variant)]">
                      <span className="inline-flex items-center gap-1">
                        <Headphones className="h-3 w-3 text-[var(--m3-primary)]" />
                        {person.month_play_count}x bulan ini
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <ListMusic className="h-3 w-3" />
                        {person.playlist_count} playlist
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Heart className="h-3 w-3 text-rose-400" />
                        {person.liked_count}
                      </span>
                    </div>
                  </div>

                  <Sparkles className="h-4 w-4 shrink-0 text-[var(--m3-on-surface-variant)] opacity-0 transition group-hover:text-[var(--m3-primary)] group-hover:opacity-100" />
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
