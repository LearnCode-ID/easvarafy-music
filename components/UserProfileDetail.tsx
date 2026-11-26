'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  Clock3,
  Disc3,
  Headphones,
  Heart,
  ListMusic,
  Play,
  Search,
  Settings,
  Shuffle,
  Sparkles,
  User as UserIcon,
} from 'lucide-react';
import { ArtworkImage } from './ArtworkImage';
import { useMusic } from './MusicProvider';
import { TrackContextMenu } from './TrackContextMenu';
import { useAuth } from './auth/AuthProvider';
import { VerifiedBadge } from './auth/VerifiedBadge';
import { publicRoleLabelOf } from '@/lib/auth/types';
import { formatDuration } from '@/lib/metrolist/lyrics';
import { filterTracksByQuery } from '@/lib/metrolist/statsEngine';
import {
  fetchPublicProfile,
  fetchPublicUserLikedTracks,
  fetchPublicUserPlaylists,
  formatListenDuration,
  formatMonthLabel,
  getCurrentMonthKey,
  type PublicProfileDetail,
  type PublicUserPlaylist,
} from '@/lib/social/community';
import type { Track } from '@/lib/metrolist/types';
import { cn } from '@/lib/utils';

interface UserProfileDetailProps {
  userId: string;
}

export function UserProfileDetail({ userId }: UserProfileDetailProps) {
  const { openDetail, playTrack, currentTrack, setActiveTab } = useMusic();
  const { userId: currentAuthUserId } = useAuth();

  const [profile, setProfile] = useState<PublicProfileDetail | null>(null);
  const [playlists, setPlaylists] = useState<PublicUserPlaylist[]>([]);
  const [likedTracks, setLikedTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [section, setSection] = useState<'playlists' | 'liked'>('playlists');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [trackQuery, setTrackQuery] = useState('');

  const monthKey = useMemo(() => getCurrentMonthKey(), []);
  const monthLabel = useMemo(() => formatMonthLabel(monthKey), [monthKey]);
  const isOwnProfile = Boolean(currentAuthUserId && currentAuthUserId === userId);

  useEffect(() => {
    let cancelled = false;

    const loadAll = async () => {
      setLoading(true);
      setError(null);
      setTrackQuery('');
      try {
        const [profRes, plRows, likedRows] = await Promise.all([
          fetchPublicProfile(userId, monthKey),
          fetchPublicUserPlaylists(userId),
          fetchPublicUserLikedTracks(userId),
        ]);

        if (cancelled) return;
        if (profRes.error) {
          setError(profRes.error);
          setProfile(null);
        } else {
          setProfile(profRes.profile);
        }
        setPlaylists(plRows);
        setLikedTracks(likedRows);

        const defaultPl =
          plRows.find((p) => p.tracks.length > 0) ?? plRows[0] ?? null;
        setSelectedPlaylistId(defaultPl?.id ?? null);
      } catch {
        if (!cancelled) {
          setError('Gagal memuat profil pengguna.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadAll();
    return () => {
      cancelled = true;
    };
  }, [userId, monthKey]);

  const activePlaylist = useMemo(
    () => playlists.find((p) => p.id === selectedPlaylistId) ?? playlists[0] ?? null,
    [playlists, selectedPlaylistId]
  );

  const filteredPlaylistTracks = useMemo(
    () => filterTracksByQuery(activePlaylist?.tracks ?? [], trackQuery),
    [activePlaylist, trackQuery]
  );

  const filteredLikedTracks = useMemo(
    () => filterTracksByQuery(likedTracks, trackQuery),
    [likedTracks, trackQuery]
  );

  const handleShufflePlay = (tracks: Track[]) => {
    if (tracks.length === 0) return;
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    playTrack(shuffled[0], shuffled);
  };

  if (loading) {
    return (
      <div className="space-y-6 pb-8">
        <button
          type="button"
          onClick={() => openDetail(null)}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--m3-surface-container-high)] px-4 py-2 text-xs font-semibold text-[var(--m3-on-surface)] transition hover:bg-[var(--m3-surface-container-highest)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Kembali
        </button>
        <div className="m3-card animate-pulse p-6">
          <div className="flex items-center gap-5">
            <div className="h-24 w-24 rounded-full bg-[var(--m3-surface-container-highest)]" />
            <div className="space-y-3">
              <div className="h-6 w-48 rounded-lg bg-[var(--m3-surface-container-highest)]" />
              <div className="h-4 w-32 rounded-lg bg-[var(--m3-surface-container-highest)]" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="m3-card h-36 animate-pulse bg-[var(--m3-surface-container)]"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="space-y-4 pb-8">
        <button
          type="button"
          onClick={() => openDetail(null)}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--m3-surface-container-high)] px-4 py-2 text-xs font-semibold text-[var(--m3-on-surface)] transition hover:bg-[var(--m3-surface-container-highest)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Kembali
        </button>
        <div className="m3-card p-8 text-center">
          <UserIcon className="mx-auto mb-3 h-10 w-10 text-[var(--m3-on-surface-variant)]" />
          <p className="text-base font-bold text-[var(--m3-on-surface)]">
            {error || 'Profil tidak ditemukan'}
          </p>
          <p className="mt-1 text-sm text-[var(--m3-on-surface-variant)]">
            Pengguna mungkin belum tersedia atau tautan profil tidak valid.
          </p>
        </div>
      </div>
    );
  }

  const initials = (profile.name || 'L')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  const joinedLabel = (() => {
    try {
      return new Intl.DateTimeFormat('id-ID', {
        month: 'short',
        year: 'numeric',
      }).format(new Date(profile.created_at));
    } catch {
      return '';
    }
  })();

  const roleBadgeClass =
    profile.role === 'developer'
      ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
      : profile.role === 'admin'
      ? 'bg-sky-500/15 text-sky-400 border-sky-500/30'
      : 'bg-[var(--m3-surface-container-high)] text-[var(--m3-on-surface-variant)] border-[var(--m3-outline-variant)]/40';

  return (
    <div className="space-y-6 pb-8">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => openDetail(null)}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--m3-surface-container-high)] px-4 py-2 text-xs font-semibold text-[var(--m3-on-surface)] transition hover:bg-[var(--m3-surface-container-highest)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Kembali
        </button>

        {isOwnProfile && (
          <button
            type="button"
            onClick={() => {
              openDetail(null);
              setActiveTab('settings');
            }}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--m3-primary-container)] px-4 py-2 text-xs font-semibold text-[var(--m3-on-primary-container)] transition hover:brightness-105"
          >
            <Settings className="h-3.5 w-3.5" />
            Edit Profil Saya
          </button>
        )}
      </div>

      {/* Hero Profile Card */}
      <section className="m3-card relative overflow-hidden p-5 sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4 sm:gap-5">
            {profile.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.avatar_url}
                alt={profile.name}
                referrerPolicy="no-referrer"
                className="h-20 w-20 shrink-0 rounded-full object-cover ring-2 ring-[var(--m3-primary)]/40 sm:h-24 sm:w-24"
              />
            ) : (
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-[var(--m3-primary-container)] text-2xl font-extrabold text-[var(--m3-on-primary-container)] ring-2 ring-[var(--m3-primary)]/30 sm:h-24 sm:w-24">
                {initials || 'U'}
              </div>
            )}

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate font-display text-2xl font-extrabold tracking-tight text-[var(--m3-on-surface)] sm:text-3xl">
                  {profile.name}
                </h1>
                <VerifiedBadge role={profile.role} size="lg" />
                {isOwnProfile && (
                  <span className="rounded-full bg-[var(--m3-primary)]/15 px-2.5 py-0.5 text-[11px] font-bold text-[var(--m3-primary)]">
                    Profil Kamu
                  </span>
                )}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                    roleBadgeClass
                  )}
                >
                  <VerifiedBadge role={profile.role} size="xs" />
                  {publicRoleLabelOf(profile.role)}
                </span>
                {joinedLabel && (
                  <span className="inline-flex items-center gap-1 text-xs text-[var(--m3-on-surface-variant)]">
                    <Calendar className="h-3.5 w-3.5" />
                    Bergabung {joinedLabel}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Last Played Quick Card */}
          {profile.last_track_video_id && profile.last_track_title && (
            <button
              type="button"
              onClick={() =>
                playTrack({
                  videoId: profile.last_track_video_id!,
                  title: profile.last_track_title!,
                  artist: profile.last_track_artist || 'Unknown Artist',
                  artists: [{ name: profile.last_track_artist || 'Unknown Artist', artistId: null }],
                  thumbnail: profile.last_track_thumbnail || '',
                  duration: null,
                  type: 'SONG',
                })
              }
              className="group flex items-center gap-3 rounded-2xl border border-[var(--m3-outline-variant)]/40 bg-[var(--m3-surface-container-high)]/75 p-2.5 pr-4 text-left transition hover:border-[var(--m3-primary)]/50 hover:bg-[var(--m3-surface-container-highest)] sm:max-w-[290px]"
            >
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl">
                <ArtworkImage
                  src={profile.last_track_thumbnail || ''}
                  alt={profile.last_track_title}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
                  <Play className="h-4 w-4 fill-white text-white" />
                </div>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--m3-primary)]">
                  Terakhir Diputar
                </p>
                <p className="truncate text-xs font-semibold text-[var(--m3-on-surface)]">
                  {profile.last_track_title}
                </p>
                <p className="truncate text-[11px] text-[var(--m3-on-surface-variant)]">
                  {profile.last_track_artist || 'Unknown Artist'}
                </p>
              </div>
            </button>
          )}
        </div>

        {/* Monthly & Library Stats */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl bg-[var(--m3-surface-container-high)]/70 p-3.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--m3-on-surface-variant)]">
              <Headphones className="h-3.5 w-3.5 text-[var(--m3-primary)]" />
              Putar · {monthLabel}
            </div>
            <p className="mt-1 font-display text-xl font-extrabold text-[var(--m3-on-surface)]">
              {profile.month_play_count.toLocaleString('id-ID')}
            </p>
          </div>

          <div className="rounded-2xl bg-[var(--m3-surface-container-high)]/70 p-3.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--m3-on-surface-variant)]">
              <Clock3 className="h-3.5 w-3.5 text-[var(--m3-primary)]" />
              Durasi Bulan Ini
            </div>
            <p className="mt-1 font-display text-xl font-extrabold text-[var(--m3-on-surface)]">
              {formatListenDuration(profile.month_listen_seconds)}
            </p>
          </div>

          <div className="rounded-2xl bg-[var(--m3-surface-container-high)]/70 p-3.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--m3-on-surface-variant)]">
              <ListMusic className="h-3.5 w-3.5 text-[var(--m3-primary)]" />
              Playlist Publik
            </div>
            <p className="mt-1 font-display text-xl font-extrabold text-[var(--m3-on-surface)]">
              {playlists.length}
            </p>
          </div>

          <div className="rounded-2xl bg-[var(--m3-surface-container-high)]/70 p-3.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--m3-on-surface-variant)]">
              <Heart className="h-3.5 w-3.5 text-rose-400" />
              Lagu Disukai
            </div>
            <p className="mt-1 font-display text-xl font-extrabold text-[var(--m3-on-surface)]">
              {likedTracks.length}
            </p>
          </div>
        </div>
      </section>

      {/* Section Switcher + Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-full bg-[var(--m3-surface-container-high)] p-1">
          <button
            type="button"
            onClick={() => {
              setSection('playlists');
              setTrackQuery('');
            }}
            className={cn(
              'inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition',
              section === 'playlists'
                ? 'bg-[var(--m3-primary)] text-[var(--m3-on-primary)] shadow-sm'
                : 'text-[var(--m3-on-surface-variant)] hover:text-[var(--m3-on-surface)]'
            )}
          >
            <ListMusic className="h-3.5 w-3.5" />
            Playlist ({playlists.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setSection('liked');
              setTrackQuery('');
            }}
            className={cn(
              'inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition',
              section === 'liked'
                ? 'bg-[var(--m3-primary)] text-[var(--m3-on-primary)] shadow-sm'
                : 'text-[var(--m3-on-surface-variant)] hover:text-[var(--m3-on-surface)]'
            )}
          >
            <Heart className="h-3.5 w-3.5" />
            Lagu Disukai ({likedTracks.length})
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--m3-on-surface-variant)]" />
          <input
            type="text"
            value={trackQuery}
            onChange={(e) => setTrackQuery(e.target.value)}
            placeholder="Cari lagu di profil ini..."
            className="w-full rounded-full border border-[var(--m3-outline-variant)]/40 bg-[var(--m3-surface-container-high)] py-2 pl-10 pr-4 text-xs text-[var(--m3-on-surface)] placeholder:text-[var(--m3-on-surface-variant)] focus:border-[var(--m3-primary)] focus:outline-none"
          />
        </div>
      </div>

      {/* Playlists & Songs Inside Selected Playlist */}
      {section === 'playlists' ? (
        playlists.length === 0 ? (
          <div className="m3-card p-8 text-center">
            <Disc3 className="mx-auto mb-3 h-10 w-10 text-[var(--m3-on-surface-variant)]" />
            <p className="text-sm font-semibold text-[var(--m3-on-surface)]">
              Belum ada playlist publik
            </p>
            <p className="mt-1 text-xs text-[var(--m3-on-surface-variant)]">
              {profile.name} belum membuat atau menyinkronkan playlist ke profilnya.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            {/* Left column: Playlist Selector */}
            <div className="space-y-2.5 lg:col-span-5">
              <p className="px-1 text-xs font-bold uppercase tracking-wider text-[var(--m3-on-surface-variant)]">
                Daftar Playlist ({playlists.length})
              </p>
              <div className="space-y-2">
                {playlists.map((pl) => {
                  const selected = activePlaylist?.id === pl.id;
                  const cover = pl.tracks[0]?.thumbnail;
                  return (
                    <button
                      key={pl.id}
                      type="button"
                      onClick={() => setSelectedPlaylistId(pl.id)}
                      className={cn(
                        'flex w-full items-center gap-3.5 rounded-2xl border p-3 text-left transition',
                        selected
                          ? 'border-[var(--m3-primary)] bg-[var(--m3-primary-container)]/35 shadow-sm'
                          : 'border-[var(--m3-outline-variant)]/30 bg-[var(--m3-surface-container)] hover:bg-[var(--m3-surface-container-high)]'
                      )}
                    >
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-[var(--m3-surface-container-highest)]">
                        {cover ? (
                          <ArtworkImage
                            src={cover}
                            alt={pl.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[var(--m3-on-surface-variant)]">
                            <ListMusic className="h-6 w-6" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-[var(--m3-on-surface)]">
                          {pl.name}
                        </p>
                        {pl.description && (
                          <p className="truncate text-xs text-[var(--m3-on-surface-variant)]">
                            {pl.description}
                          </p>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--m3-on-surface-variant)]">
                          <span>{pl.tracks.length} lagu</span>
                          {pl.tags.slice(0, 2).map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full bg-[var(--m3-surface-container-high)] px-2 py-0.5 text-[10px] font-medium"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right column: Songs Inside Selected Playlist */}
            <div className="lg:col-span-7">
              {activePlaylist && (
                <div className="m3-card p-4 sm:p-5">
                  <div className="flex flex-col gap-3 border-b border-[var(--m3-outline-variant)]/30 pb-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[var(--m3-primary)]">
                        <Sparkles className="h-3 w-3" />
                        Lagu di Playlist
                      </span>
                      <h2 className="truncate font-display text-lg font-extrabold text-[var(--m3-on-surface)]">
                        {activePlaylist.name}
                      </h2>
                      <p className="text-xs text-[var(--m3-on-surface-variant)]">
                        {activePlaylist.tracks.length} lagu
                        {activePlaylist.description ? ` · ${activePlaylist.description}` : ''}
                      </p>
                    </div>

                    {activePlaylist.tracks.length > 0 && (
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            playTrack(activePlaylist.tracks[0], activePlaylist.tracks)
                          }
                          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--m3-primary)] px-4 py-2 text-xs font-bold text-[var(--m3-on-primary)] transition hover:brightness-110"
                        >
                          <Play className="h-3.5 w-3.5 fill-current" />
                          Putar Semua
                        </button>
                        <button
                          type="button"
                          onClick={() => handleShufflePlay(activePlaylist.tracks)}
                          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--m3-surface-container-high)] px-3.5 py-2 text-xs font-semibold text-[var(--m3-on-surface)] transition hover:bg-[var(--m3-surface-container-highest)]"
                        >
                          <Shuffle className="h-3.5 w-3.5" />
                          Acak
                        </button>
                      </div>
                    )}
                  </div>

                  {filteredPlaylistTracks.length === 0 ? (
                    <div className="py-10 text-center text-xs text-[var(--m3-on-surface-variant)]">
                      {activePlaylist.tracks.length === 0
                        ? 'Playlist ini belum berisi lagu.'
                        : 'Tidak ada lagu yang cocok dengan pencarian.'}
                    </div>
                  ) : (
                    <div className="mt-3 divide-y divide-[var(--m3-outline-variant)]/20">
                      {filteredPlaylistTracks.map((track, idx) => {
                        const isCurrent = currentTrack?.videoId === track.videoId;
                        return (
                          <div
                            key={`${activePlaylist.id}-${track.videoId}-${idx}`}
                            className={cn(
                              'group flex items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-[var(--m3-surface-container-high)]/70',
                              isCurrent && 'bg-[var(--m3-primary-container)]/30'
                            )}
                          >
                            <span className="w-6 shrink-0 text-center text-xs font-semibold text-[var(--m3-on-surface-variant)]">
                              {idx + 1}
                            </span>

                            <button
                              type="button"
                              onClick={() => playTrack(track, activePlaylist.tracks)}
                              className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg"
                            >
                              <ArtworkImage
                                src={track.thumbnail}
                                alt={track.title}
                                className="h-full w-full object-cover"
                              />
                              <div className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition group-hover:opacity-100">
                                <Play className="h-4 w-4 fill-white text-white" />
                              </div>
                            </button>

                            <button
                              type="button"
                              onClick={() => playTrack(track, activePlaylist.tracks)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <p
                                className={cn(
                                  'truncate text-sm font-semibold',
                                  isCurrent
                                    ? 'text-[var(--m3-primary)]'
                                    : 'text-[var(--m3-on-surface)]'
                                )}
                              >
                                {track.title}
                              </p>
                              <p className="truncate text-xs text-[var(--m3-on-surface-variant)]">
                                {track.artist}
                              </p>
                            </button>

                            <span className="hidden shrink-0 text-xs tabular-nums text-[var(--m3-on-surface-variant)] sm:inline">
                              {formatDuration(track.duration)}
                            </span>

                            <TrackContextMenu track={track} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      ) : (
        /* Liked Tracks Section */
        <div className="m3-card p-4 sm:p-5">
          <div className="flex flex-col gap-3 border-b border-[var(--m3-outline-variant)]/30 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-lg font-extrabold text-[var(--m3-on-surface)]">
                Lagu yang Disukai {profile.name}
              </h2>
              <p className="text-xs text-[var(--m3-on-surface-variant)]">
                {likedTracks.length} lagu favorit
              </p>
            </div>
            {likedTracks.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => playTrack(likedTracks[0], likedTracks)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[var(--m3-primary)] px-4 py-2 text-xs font-bold text-[var(--m3-on-primary)] transition hover:brightness-110"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  Putar Semua
                </button>
                <button
                  type="button"
                  onClick={() => handleShufflePlay(likedTracks)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[var(--m3-surface-container-high)] px-3.5 py-2 text-xs font-semibold text-[var(--m3-on-surface)] transition hover:bg-[var(--m3-surface-container-highest)]"
                >
                  <Shuffle className="h-3.5 w-3.5" />
                  Acak
                </button>
              </div>
            )}
          </div>

          {filteredLikedTracks.length === 0 ? (
            <div className="py-10 text-center text-xs text-[var(--m3-on-surface-variant)]">
              {likedTracks.length === 0
                ? `${profile.name} belum menyukai lagu apa pun.`
                : 'Tidak ada lagu yang cocok dengan pencarian.'}
            </div>
          ) : (
            <div className="mt-3 divide-y divide-[var(--m3-outline-variant)]/20">
              {filteredLikedTracks.map((track, idx) => {
                const isCurrent = currentTrack?.videoId === track.videoId;
                return (
                  <div
                    key={`liked-${track.videoId}-${idx}`}
                    className={cn(
                      'group flex items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-[var(--m3-surface-container-high)]/70',
                      isCurrent && 'bg-[var(--m3-primary-container)]/30'
                    )}
                  >
                    <span className="w-6 shrink-0 text-center text-xs font-semibold text-[var(--m3-on-surface-variant)]">
                      {idx + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => playTrack(track, likedTracks)}
                      className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg"
                    >
                      <ArtworkImage
                        src={track.thumbnail}
                        alt={track.title}
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition group-hover:opacity-100">
                        <Play className="h-4 w-4 fill-white text-white" />
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => playTrack(track, likedTracks)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p
                        className={cn(
                          'truncate text-sm font-semibold',
                          isCurrent
                            ? 'text-[var(--m3-primary)]'
                            : 'text-[var(--m3-on-surface)]'
                        )}
                      >
                        {track.title}
                      </p>
                      <p className="truncate text-xs text-[var(--m3-on-surface-variant)]">
                        {track.artist}
                      </p>
                    </button>
                    <span className="hidden shrink-0 text-xs tabular-nums text-[var(--m3-on-surface-variant)] sm:inline">
                      {formatDuration(track.duration)}
                    </span>
                    <TrackContextMenu track={track} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
