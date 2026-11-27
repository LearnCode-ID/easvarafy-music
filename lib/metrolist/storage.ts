import { DEFAULT_SETTINGS } from './seed';
import type { PlayEvent, PlayerSettings, Track, UserPlaylist } from './types';

const KEYS = {
  HISTORY: 'sonora_play_history_v1',
  SETTINGS: 'sonora_settings_v1',
  SEARCH_HISTORY: 'sonora_search_history_v1',
  SAVED_COLLECTION: 'sonora_saved_collection_v1',
};

export interface SavedCollectionItem {
  kind: 'album' | 'playlist' | 'artist';
  id: string;
  title: string;
  subtitle: string;
  thumbnail: string;
  savedAt: number;
}

export interface PersistedLibraryState {
  history: PlayEvent[];
  likedTracks: Track[];
  playlists: UserPlaylist[];
  settings: PlayerSettings;
  searchHistory: string[];
  savedCollection: SavedCollectionItem[];
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadLibraryState(): PersistedLibraryState {
  const empty = {
    history: [],
    likedTracks: [],
    playlists: [],
    savedCollection: [],
  };
  if (typeof window === 'undefined')
    return { ...empty, settings: DEFAULT_SETTINGS, searchHistory: [] };
  // Personal playlists/likes come only from Supabase. Legacy unscoped browser
  // records are left untouched for manual recovery, never imported or seeded.
  return {
    ...empty,
    settings: {
      ...DEFAULT_SETTINGS,
      ...safeParse<Partial<PlayerSettings>>(window.localStorage.getItem(KEYS.SETTINGS), {}),
    },
    searchHistory: safeParse<string[]>(window.localStorage.getItem(KEYS.SEARCH_HISTORY), []),
  };
}

export function saveHistory(history: PlayEvent[], userId?: string | null) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `${KEYS.HISTORY}:${userId || 'guest'}`,
      JSON.stringify(history.slice(0, 120))
    );
  } catch {
    // ignore quota errors
  }
}

export function saveSettings(settings: PlayerSettings) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
  } catch {
    // ignore quota errors
  }
}

export function saveSearchHistory(queries: string[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEYS.SEARCH_HISTORY, JSON.stringify(queries.slice(0, 12)));
  } catch {
    // ignore quota errors
  }
}

export function saveCollection(items: SavedCollectionItem[], userId?: string | null) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `${KEYS.SAVED_COLLECTION}:${userId || 'guest'}`,
      JSON.stringify(items)
    );
  } catch {
    // ignore quota errors
  }
}

export function recordTrackPlay(
  history: PlayEvent[],
  track: Track,
  nowMs = Date.now()
): PlayEvent[] {
  const idx = history.findIndex((e) => e.track.videoId === track.videoId);
  if (idx >= 0) {
    const existing = history[idx];
    const updated: PlayEvent = {
      track,
      playCount: existing.playCount + 1,
      lastPlayedAt: nowMs,
      firstPlayedAt: existing.firstPlayedAt,
    };
    return [updated, ...history.filter((_, i) => i !== idx)];
  }
  return [
    {
      track,
      playCount: 1,
      lastPlayedAt: nowMs,
      firstPlayedAt: nowMs,
    },
    ...history,
  ];
}

/** Device-only history/editorial bookmarks are scoped per account. Legacy
 * unscoped collections are intentionally not auto-imported into any account. */
export function loadAccountDeviceState(userId: string | null): {
  history: PlayEvent[];
  savedCollection: SavedCollectionItem[];
} {
  if (typeof window === 'undefined') return { history: [], savedCollection: [] };
  return {
    history: safeParse(window.localStorage.getItem(`${KEYS.HISTORY}:${userId || 'guest'}`), []),
    savedCollection: safeParse(
      window.localStorage.getItem(`${KEYS.SAVED_COLLECTION}:${userId || 'guest'}`),
      []
    ),
  };
}
