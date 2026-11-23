import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { UserRole } from '@/lib/auth/types';
import type { PlayEvent, Track, UserPlaylist } from '@/lib/metrolist/types';

export interface TopListenerEntry {
  user_id: string;
  name: string;
  avatar_url: string | null;
  role: UserRole;
  play_count: number;
  listen_seconds: number;
  last_track_video_id: string | null;
  last_track_title: string | null;
  last_track_artist: string | null;
  last_track_thumbnail: string | null;
  playlist_count: number;
  liked_count: number;
  rank: number;
}

export interface PublicProfileDetail {
  id: string;
  name: string;
  avatar_url: string | null;
  role: UserRole;
  created_at: string;
  month_play_count: number;
  month_listen_seconds: number;
  last_track_video_id: string | null;
  last_track_title: string | null;
  last_track_artist: string | null;
  last_track_thumbnail: string | null;
  playlist_count: number;
  liked_count: number;
}

export interface PublicProfileSummary {
  id: string;
  name: string;
  avatar_url: string | null;
  role: UserRole;
  created_at: string;
  month_play_count: number;
  playlist_count: number;
  liked_count: number;
}

export interface PublicUserPlaylist {
  id: string;
  user_id: string;
  name: string;
  description: string;
  tags: string[];
  tracks: Track[];
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export function getCurrentMonthKey(): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date());
    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    if (year && month) return `${year}-${month}`;
  } catch {
    // fallback below
  }
  return new Date().toISOString().slice(0, 7);
}

export function getRecentMonthKeys(count = 4): string[] {
  const current = getCurrentMonthKey();
  const [yStr, mStr] = current.split('-');
  const year = Number(yStr) || new Date().getFullYear();
  const month = (Number(mStr) || 1) - 1;
  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(year, month - i, 1));
    const yy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    keys.push(`${yy}-${mm}`);
  }
  return keys;
}

export function formatMonthLabel(monthKey: string): string {
  const [yStr, mStr] = monthKey.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  if (!year || !month) return monthKey;
  try {
    const date = new Date(Date.UTC(year, month - 1, 1));
    return new Intl.DateTimeFormat('id-ID', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return monthKey;
  }
}

export function formatListenDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours > 0) return `${hours}j ${minutes}m`;
  if (minutes > 0) return `${minutes} mnt`;
  return `${safe} dtk`;
}

export async function recordMonthlyPlay(track: Track): Promise<void> {
  if (!isSupabaseConfigured || !track?.videoId) return;
  try {
    await supabase.rpc('record_user_play', {
      p_video_id: track.videoId,
      p_title: track.title,
      p_artist: track.artist,
      p_thumbnail: track.thumbnail,
      p_duration_seconds: Math.round(track.duration ?? 180),
    });
  } catch {
    // non-fatal background telemetry
  }
}

export async function syncMonthlyBaseline(history: PlayEvent[]): Promise<void> {
  if (!isSupabaseConfigured || history.length === 0) return;
  const currentMonth = getCurrentMonthKey();
  const thisMonthEvents = history.filter((evt) => {
    try {
      const mk = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
      }).format(new Date(evt.lastPlayedAt));
      return mk.startsWith(currentMonth);
    } catch {
      return false;
    }
  });

  if (thisMonthEvents.length === 0) return;
  const totalPlays = thisMonthEvents.reduce((sum, e) => sum + Math.max(1, e.playCount || 1), 0);
  const totalSecs = thisMonthEvents.reduce(
    (sum, e) => sum + Math.max(1, e.playCount || 1) * Math.round(e.track.duration ?? 180),
    0
  );
  const latest = thisMonthEvents[0]?.track;

  try {
    await supabase.rpc('sync_monthly_listening_baseline', {
      p_play_count: totalPlays,
      p_listen_seconds: totalSecs,
      p_video_id: latest?.videoId ?? null,
      p_title: latest?.title ?? null,
      p_artist: latest?.artist ?? null,
      p_thumbnail: latest?.thumbnail ?? null,
    });
  } catch {
    // non-fatal
  }
}

export async function fetchMonthlyTopListeners(
  monthKey?: string,
  limit = 30
): Promise<{ rows: TopListenerEntry[]; error?: string }> {
  if (!isSupabaseConfigured) {
    return { rows: [], error: 'Supabase belum dikonfigurasi.' };
  }
  const { data, error } = await supabase.rpc('get_monthly_top_listeners', {
    p_month_key: monthKey || getCurrentMonthKey(),
    p_limit: limit,
  });
  if (error) {
    return { rows: [], error: error.message };
  }
  const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    user_id: String(r.user_id),
    name: String(r.name || 'Listener'),
    avatar_url: typeof r.avatar_url === 'string' ? r.avatar_url : null,
    role: (r.role as UserRole) || 'user',
    play_count: Number(r.play_count ?? 0),
    listen_seconds: Number(r.listen_seconds ?? 0),
    last_track_video_id: typeof r.last_track_video_id === 'string' ? r.last_track_video_id : null,
    last_track_title: typeof r.last_track_title === 'string' ? r.last_track_title : null,
    last_track_artist: typeof r.last_track_artist === 'string' ? r.last_track_artist : null,
    last_track_thumbnail: typeof r.last_track_thumbnail === 'string' ? r.last_track_thumbnail : null,
    playlist_count: Number(r.playlist_count ?? 0),
    liked_count: Number(r.liked_count ?? 0),
    rank: Number(r.rank ?? 0),
  }));
  return { rows };
}

export async function fetchPublicProfile(
  userId: string,
  monthKey?: string
): Promise<{ profile: PublicProfileDetail | null; error?: string }> {
  if (!isSupabaseConfigured || !userId) {
    return { profile: null, error: 'Profil tidak ditemukan.' };
  }
  const { data, error } = await supabase.rpc('get_public_profile', {
    p_user_id: userId,
    p_month_key: monthKey || getCurrentMonthKey(),
  });
  if (error) {
    return { profile: null, error: error.message };
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return { profile: null };
  const r = rows[0];
  return {
    profile: {
      id: String(r.id),
      name: String(r.name || 'Listener'),
      avatar_url: typeof r.avatar_url === 'string' ? r.avatar_url : null,
      role: (r.role as UserRole) || 'user',
      created_at: String(r.created_at),
      month_play_count: Number(r.month_play_count ?? 0),
      month_listen_seconds: Number(r.month_listen_seconds ?? 0),
      last_track_video_id: typeof r.last_track_video_id === 'string' ? r.last_track_video_id : null,
      last_track_title: typeof r.last_track_title === 'string' ? r.last_track_title : null,
      last_track_artist: typeof r.last_track_artist === 'string' ? r.last_track_artist : null,
      last_track_thumbnail: typeof r.last_track_thumbnail === 'string' ? r.last_track_thumbnail : null,
      playlist_count: Number(r.playlist_count ?? 0),
      liked_count: Number(r.liked_count ?? 0),
    },
  };
}

export async function searchPublicProfiles(
  query = '',
  limit = 24
): Promise<{ rows: PublicProfileSummary[]; error?: string }> {
  if (!isSupabaseConfigured) return { rows: [] };
  const { data, error } = await supabase.rpc('search_public_profiles', {
    p_query: query.trim(),
    p_limit: limit,
  });
  if (error) return { rows: [], error: error.message };
  const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    name: String(r.name || 'Listener'),
    avatar_url: typeof r.avatar_url === 'string' ? r.avatar_url : null,
    role: (r.role as UserRole) || 'user',
    created_at: String(r.created_at),
    month_play_count: Number(r.month_play_count ?? 0),
    playlist_count: Number(r.playlist_count ?? 0),
    liked_count: Number(r.liked_count ?? 0),
  }));
  return { rows };
}

export async function fetchPublicUserPlaylists(
  userId: string
): Promise<PublicUserPlaylist[]> {
  if (!isSupabaseConfigured || !userId) return [];
  const { data, error } = await supabase
    .from('user_playlists')
    .select('id, user_id, name, description, tags, tracks, is_public, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    user_id: String(row.user_id),
    name: String(row.name || 'Playlist'),
    description: String(row.description || ''),
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    tracks: Array.isArray(row.tracks) ? (row.tracks as Track[]) : [],
    is_public: row.is_public !== false,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }));
}

export async function fetchPublicUserLikedTracks(userId: string): Promise<Track[]> {
  if (!isSupabaseConfigured || !userId) return [];
  const { data, error } = await supabase
    .from('user_liked_tracks')
    .select('track')
    .eq('user_id', userId)
    .order('liked_at', { ascending: false });

  if (error || !data) return [];
  return (data as Array<{ track: Track }>)
    .map((row) => row.track)
    .filter((t) => Boolean(t && t.videoId));
}

export async function fetchOwnCloudLibrary(userId: string): Promise<{
  playlists: UserPlaylist[];
  likedTracks: Track[];
  ok: boolean;
}> {
  if (!isSupabaseConfigured || !userId) {
    return { playlists: [], likedTracks: [], ok: false };
  }
  try {
    const [plRes, likedRes] = await Promise.all([
      supabase
        .from('user_playlists')
        .select('id, name, description, tags, tracks, created_at, updated_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false }),
      supabase
        .from('user_liked_tracks')
        .select('track, liked_at')
        .eq('user_id', userId)
        .order('liked_at', { ascending: false }),
    ]);

    if (plRes.error || likedRes.error) {
      return { playlists: [], likedTracks: [], ok: false };
    }

    const playlists: UserPlaylist[] = ((plRes.data ?? []) as Array<Record<string, unknown>>).map(
      (row) => {
        const tracks = Array.isArray(row.tracks) ? (row.tracks as Track[]) : [];
        return {
          id: String(row.id),
          name: String(row.name || 'Untitled Playlist'),
          description: String(row.description || ''),
          tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
          createdAt: row.created_at ? new Date(String(row.created_at)).getTime() : Date.now(),
          updatedAt: row.updated_at ? new Date(String(row.updated_at)).getTime() : Date.now(),
          tracks,
          coverUrl: tracks[0]?.thumbnail,
        };
      }
    );

    const likedTracks: Track[] = ((likedRes.data ?? []) as Array<{ track: Track }>)
      .map((r) => r.track)
      .filter((t) => Boolean(t && t.videoId));

    return { playlists, likedTracks, ok: true };
  } catch {
    return { playlists: [], likedTracks: [], ok: false };
  }
}

export async function upsertOwnPlaylistToCloud(
  userId: string,
  playlist: UserPlaylist
): Promise<void> {
  if (!isSupabaseConfigured || !userId || !playlist.id || playlist.id === 'login-required') return;
  try {
    await supabase.from('user_playlists').upsert(
      {
        id: playlist.id,
        user_id: userId,
        name: playlist.name,
        description: playlist.description ?? '',
        tags: playlist.tags ?? [],
        tracks: playlist.tracks,
        is_public: true,
        created_at: new Date(playlist.createdAt || Date.now()).toISOString(),
        updated_at: new Date(playlist.updatedAt || Date.now()).toISOString(),
      },
      { onConflict: 'user_id,id' }
    );
  } catch {
    // non-fatal
  }
}

export async function deleteOwnPlaylistFromCloud(
  userId: string,
  playlistId: string
): Promise<void> {
  if (!isSupabaseConfigured || !userId || !playlistId) return;
  try {
    await supabase
      .from('user_playlists')
      .delete()
      .eq('user_id', userId)
      .eq('id', playlistId);
  } catch {
    // non-fatal
  }
}

export async function syncOwnAllPlaylistsToCloud(
  userId: string,
  playlists: UserPlaylist[]
): Promise<void> {
  if (!isSupabaseConfigured || !userId) return;
  const valid = playlists.filter((p) => p.id && p.id !== 'login-required');
  if (valid.length === 0) return;
  try {
    await supabase.from('user_playlists').upsert(
      valid.map((pl) => ({
        id: pl.id,
        user_id: userId,
        name: pl.name,
        description: pl.description ?? '',
        tags: pl.tags ?? [],
        tracks: pl.tracks,
        is_public: true,
        created_at: new Date(pl.createdAt || Date.now()).toISOString(),
        updated_at: new Date(pl.updatedAt || Date.now()).toISOString(),
      })),
      { onConflict: 'user_id,id' }
    );
  } catch {
    // non-fatal
  }
}

export async function setOwnLikedTrackInCloud(
  userId: string,
  track: Track,
  liked: boolean
): Promise<void> {
  if (!isSupabaseConfigured || !userId || !track?.videoId) return;
  try {
    if (liked) {
      await supabase.from('user_liked_tracks').upsert(
        {
          user_id: userId,
          video_id: track.videoId,
          track,
          liked_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,video_id' }
      );
    } else {
      await supabase
        .from('user_liked_tracks')
        .delete()
        .eq('user_id', userId)
        .eq('video_id', track.videoId);
    }
  } catch {
    // non-fatal
  }
}

export async function syncOwnAllLikedTracksToCloud(
  userId: string,
  tracks: Track[]
): Promise<void> {
  if (!isSupabaseConfigured || !userId || tracks.length === 0) return;
  try {
    const now = Date.now();
    await supabase.from('user_liked_tracks').upsert(
      tracks.map((track, idx) => ({
        user_id: userId,
        video_id: track.videoId,
        track,
        liked_at: new Date(now - idx * 1000).toISOString(),
      })),
      { onConflict: 'user_id,video_id' }
    );
  } catch {
    // non-fatal
  }
}
