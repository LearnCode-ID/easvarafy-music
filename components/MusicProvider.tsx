"use client";

import {
  usePersonalization,
  type Personalization,
} from "@/lib/recommendation/usePersonalization";
import {
  ListeningSession,
  rankCandidates,
  safeTracks,
  tasteSeeds,
  trackKey,
  type Candidate,
} from "@/lib/recommendation/engine";
import { newSignalId } from "@/lib/recommendation/store";
import { RequestGate } from "@/lib/recommendation/client";
import {
  createSnapshotStore,
  type SnapshotStore,
} from "@/lib/ui/snapshotStore";
import { playlistPath } from "@/lib/social/playlistPage";
import { usePathname, useRouter } from "next/navigation";
import { isNativeApp } from "@/lib/auth/native";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
  useSyncExternalStore,
} from "react";
import {
  advanceQueue,
  appendRadioContinuation,
  appendToQueue,
  createQueueState,
  cycleRepeatMode,
  getCurrentTrack,
  graduallyRefreshAutomaticQueue,
  insertPlayNext,
  playTrackInQueue,
  removeFromQueue,
  removeAutomaticUpcoming,
  reorderQueue,
  replaceUpcomingQueue,
  toggleShuffleQueue,
  type QueueState,
} from "@/lib/metrolist/queue";
import { DEFAULT_SETTINGS } from "@/lib/metrolist/seed";
import { resolveMetrolistTheme } from "@/lib/metrolist/theme";
import {
  loadLibraryState,
  loadAccountDeviceState,
  recordTrackPlay,
  saveCollection,
  saveHistory,
  saveSearchHistory,
  saveSettings,
  type SavedCollectionItem,
} from "@/lib/metrolist/storage";
import {
  BACKGROUND_RECOVERY_DELAYS_MS,
  buildMediaSessionPosition,
  computeElapsedWithDrift,
  shouldAutoRecoverBackgroundPlayback,
} from "@/lib/metrolist/background";
import {
  deleteOwnPlaylistFromCloud,
  fetchOwnCloudLibrary,
  recordMonthlyPlay,
  setOwnLikedTrackInCloud,
  syncOwnAllLikedTracksToCloud,
  upsertOwnPlaylistToCloud,
} from "@/lib/social/community";
import type {
  BackgroundPopupMode,
  DetailTarget,
  LyricsPayload,
  NavTab,
  PlayEvent,
  PlayerSettings,
  RepeatMode,
  Track,
  UserPlaylist,
} from "@/lib/metrolist/types";
import { apiUrl } from "@/lib/api/base";
import {
  clearNativeMedia,
  hasNativeMediaControls,
  isNativeIslandActive,
  onNativeMediaAction,
  updateNativeMedia,
  upgradeArtworkUrl,
} from "@/lib/native/mediaControls";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  ensureOfflineLibraryLoaded,
  getDownloadedTrackSync,
  getOfflineSnapshot,
  resolveOfflinePlaybackUrl,
  removeDownloadedTrack,
  subscribeOffline,
} from "@/lib/metrolist/offlineAudio";
import { BACK_PRIORITY_PAGE, useBackHandler } from "@/lib/native/backButton";

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: string | HTMLElement,
        opts: {
          height?: string | number;
          width?: string | number;
          videoId?: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (ev: { target: YTPlayerInstance }) => void;
            onStateChange?: (ev: {
              data: number;
              target: YTPlayerInstance;
            }) => void;
            onError?: () => void;
          };
        }
      ) => YTPlayerInstance;
      PlayerState?: {
        UNSTARTED?: number;
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        BUFFERING: number;
        CUED?: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
    webkitAudioContext?: typeof AudioContext;
  }
}

interface YTPlayerInstance {
  loadVideoById: (videoId: string) => void;
  cueVideoById?: (videoId: string) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  setVolume: (volume: number) => void;
  mute: () => void;
  unMute: () => void;
  setPlaybackRate: (rate: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState?: () => number;
  getIframe?: () => HTMLIFrameElement | null;
  destroy: () => void;
}

export type NowPlayingTab = "player" | "lyrics" | "queue";
export type UpNextMode = "mixed" | "discover" | "related" | "library";

interface MusicContextValue {
  // Navigation
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  detailTarget: DetailTarget | null;
  openDetail: (target: DetailTarget | null) => void;

  // Player state
  queueState: QueueState;
  currentTrack: Track | null;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  isNowPlayingOpen: boolean;
  setIsNowPlayingOpen: (open: boolean) => void;
  nowPlayingTab: NowPlayingTab;
  setNowPlayingTab: (tab: NowPlayingTab) => void;
  showVideoStage: boolean;
  setShowVideoStage: (show: boolean) => void;
  sleepTimerMinutes: number | null;
  setSleepTimer: (minutes: number | null) => void;
  sleepTimerEndOfTrack: boolean;
  setSleepTimerEndOfTrack: (enabled: boolean) => void;

  // Background Popup (iPhone 17-18 Pro Dynamic Island PiP / Overlay)
  popupMode: BackgroundPopupMode;
  setPopupMode: (mode: BackgroundPopupMode) => void;
  openBackgroundPopup: () => void;
  closeBackgroundPopup: () => void;
  toggleBackgroundPopup: () => void;
  resumePlaybackKeepAlive: () => void;
  registerPopupHandlers: (handlers: {
    open: () => void;
    close: () => void;
  }) => void;

  // Playback actions
  playTrack: (track: Track, contextQueue?: Track[]) => void;
  play: () => void;
  pause: () => void;
  togglePlayPause: () => void;
  nextTrack: (manual?: boolean) => void;
  prevTrack: () => void;
  seekTo: (seconds: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  playNextInQueue: (track: Track) => void;
  addTrackToQueue: (track: Track) => void;
  removeQueueIndex: (idx: number) => void;
  moveQueueItem: (from: number, to: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  startRadio: (track: Track, mode?: UpNextMode) => Promise<void>;
  refreshUpNext: (mode?: UpNextMode) => Promise<void>;
  upNextMode: UpNextMode;
  setUpNextMode: (mode: UpNextMode) => void;
  upNextRefreshing: boolean;
  jumpToQueueIndex: (idx: number) => void;

  personalization: Personalization;

  // Lyrics
  lyrics: LyricsPayload | null;
  lyricsLoading: boolean;

  // Library & Metrolist history
  history: PlayEvent[];
  likedTracks: Track[];
  isLiked: (videoId: string) => boolean;
  toggleLike: (track: Track) => void;
  libraryLoading: boolean;
  libraryError: string | null;
  librarySaving: boolean;
  reloadLibrary: () => Promise<void>;
  editPlaylist: (
    id: string,
    patch: Partial<
      Pick<
        UserPlaylist,
        "name" | "description" | "coverUrl" | "isPublic" | "tracks"
      >
    >
  ) => Promise<UserPlaylist | null>;
  playlists: UserPlaylist[];
  createPlaylist: (
    name: string,
    description?: string,
    initialTracks?: Track[]
  ) => Promise<UserPlaylist | null>;
  renamePlaylist: (id: string, name: string) => void;
  updatePlaylistTags: (playlistId: string, tags: string[]) => void;
  deletePlaylist: (id: string) => void;
  addTrackToPlaylist: (playlistId: string, track: Track) => void;
  removeTrackFromPlaylist: (playlistId: string, videoId: string) => void;
  playlistPickerTrack: Track | null;
  openPlaylistPicker: (track: Track | null) => void;
  savedCollection: SavedCollectionItem[];
  isSavedInCollection: (
    kind: SavedCollectionItem["kind"],
    id: string
  ) => boolean;
  toggleSaveCollection: (item: Omit<SavedCollectionItem, "savedAt">) => void;
  searchHistory: string[];
  addSearchHistory: (query: string) => void;
  removeSearchHistoryItem: (query: string) => void;
  clearSearchHistory: () => void;
  clearPlayHistory: () => void;

  // Settings, Backup & Toast
  settings: PlayerSettings;
  updateSettings: (patch: Partial<PlayerSettings>) => void;
  resetSettings: () => void;
  exportLibraryBackup: () => string;
  importLibraryBackup: (
    rawJson: string
  ) => Promise<{ ok: boolean; message: string }>;
  toastMessage: string | null;
  showToast: (msg: string) => void;

  // YT Player host ref
  ytContainerRef: React.RefObject<HTMLDivElement | null>;
  attachYouTubeHost: (node: HTMLDivElement | null) => void;

  /** 'offline' = current song plays from a downloaded file via <audio>. */
  playbackSource: PlaybackSource;
}

export type PlaybackSource = "online" | "offline";

type MusicState = Omit<MusicContextValue, "currentTime">;
const MusicContext = createContext<SnapshotStore<MusicState> | null>(null);
const ProgressContext = createContext<SnapshotStore<number> | null>(null);
const EMPTY_LIBRARY: never[] = [];
const noSubscription = () => () => {};

export function useMusic(): MusicState {
  const store = useContext(MusicContext);
  if (!store) throw new Error("useMusic must be used inside MusicProvider");
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot
  );
}

/** Only visible time displays subscribe to the 250ms clock, not the whole app. */
export function usePlaybackProgress(enabled = true): number {
  const store = useContext(ProgressContext);
  if (!store)
    throw new Error("usePlaybackProgress must be used inside MusicProvider");
  return useSyncExternalStore(
    enabled ? store.subscribe : noSubscription,
    enabled ? store.getSnapshot : () => 0,
    () => 0
  );
}

export function MusicProvider({ children }: { children: React.ReactNode }) {
  // Guest playback is always allowed. Creating playlists / liking / saving
  // requires an account, so those actions route through `requireAuth`, which
  // opens the "Login dulu yuk" popup instead of failing silently.
  const { requireAuth, userId } = useAuth();
  const personalization = usePersonalization(userId);
  const { store: tasteStore, client: recommendationClient } = personalization;
  const recommendationGate = useMemo(() => {
    void tasteStore;
    return new RequestGate();
  }, [tasteStore]);
  const listeningRef = useRef<{
    session: ListeningSession;
    store: typeof tasteStore;
    credited: boolean;
    epoch: number;
    longListen: boolean;
  } | null>(null);
  const beginListening = useCallback(
    (track: Track, origin: "explicit" | "auto") => {
      listeningRef.current = {
        session: new ListeningSession(track, origin, newSignalId()),
        store: tasteStore,
        credited: false,
        epoch: tasteStore.state.epoch,
        longListen: false,
      };
      if (origin === "explicit") tasteStore.record(track, "select");
    },
    [tasteStore]
  );
  const explicitSkip = useCallback(() => {
    const active = listeningRef.current;
    if (active?.store === tasteStore && active.session.quickSkip())
      tasteStore.record(
        active.session.track,
        "skip",
        "explicit",
        active.session.seconds,
        active.session.id + ":skip"
      );
  }, [tasteStore]);
  const userIdRef = useRef<string | null>(null);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  const [hydrated, setHydrated] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const [activeTabState, setActiveTabState] = useState<NavTab>("home");
  const activeTab = pathname.startsWith("/profile")
    ? "profile"
    : pathname.startsWith("/blend") || pathname.startsWith("/playlist")
    ? "library"
    : activeTabState;
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);

  const [queueState, setQueueState] = useState<QueueState>(createQueueState);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const playbackTimeRef = useRef(0);
  useLayoutEffect(() => {
    playbackTimeRef.current = currentTime;
  }, [currentTime]);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(85);
  const [isMuted, setIsMuted] = useState(false);

  const [isNowPlayingOpen, setIsNowPlayingOpen] = useState(false);
  const [nowPlayingTab, setNowPlayingTab] = useState<NowPlayingTab>("player");
  const [showVideoStage, setShowVideoStage] = useState(false);

  const [sleepTimerMinutes, setSleepTimerMinutes] = useState<number | null>(
    null
  );
  const [sleepTimerEndOfTrack, setSleepTimerEndOfTrackState] = useState(false);
  const sleepDeadlineRef = useRef<number | null>(null);
  const sleepEndOfTrackRef = useRef(false);

  const [history, setHistory] = useState<PlayEvent[]>([]);
  const [likedTracks, setLikedTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const [savedCollection, setSavedCollection] = useState<SavedCollectionItem[]>(
    []
  );
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [settings, setSettings] = useState<PlayerSettings>(DEFAULT_SETTINGS);
  const [playlistPickerTrack, setPlaylistPickerTrack] = useState<Track | null>(
    null
  );

  const [lyrics, setLyrics] = useState<LyricsPayload | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [popupMode, setPopupMode] = useState<BackgroundPopupMode>("off");
  const popupHandlersRef = useRef<{ open: () => void; close: () => void }>({
    open: () => {},
    close: () => {},
  });

  const ytContainerRef = useRef<HTMLDivElement | null>(null);
  const [ytHostReady, setYtHostReady] = useState(false);
  const attachYouTubeHost = useCallback((node: HTMLDivElement | null) => {
    ytContainerRef.current = node;
    setYtHostReady(Boolean(node));
  }, []);
  const ytPlayerRef = useRef<YTPlayerInstance | null>(null);
  const ytReadyRef = useRef(false);
  const lastLoadedVideoIdRef = useRef<string | null>(null);
  const nextTrackRef = useRef<(manual?: boolean) => void>(() => {});
  const [upNextMode, setUpNextModeState] = useState<UpNextMode>("mixed");
  const [upNextRefreshing, setUpNextRefreshing] = useState(false);
  const upNextModeRef = useRef<UpNextMode>("mixed");
  const likedTracksRef = useRef<Track[]>([]);
  const playlistsRef = useRef<UserPlaylist[]>([]);
  const historyRef = useRef<PlayEvent[]>([]);

  // Background playback refs
  const userPausedRef = useRef(false);
  const intendedPlayingRef = useRef(false);
  const bgRecoveryCountRef = useRef(0);
  const bgRecoveryWindowStartRef = useRef(0);
  const lastAutoSkipAtRef = useRef(0);
  const settingsRef = useRef<PlayerSettings>(DEFAULT_SETTINGS);
  const popupModeRef = useRef<BackgroundPopupMode>("off");
  const volumeRef = useRef(85);
  const isMutedRef = useRef(false);
  const recoveryTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const lastTickMsRef = useRef<number>(0);

  // ---------------------------------------------------------------------------
  // Offline playback engine: downloaded songs play through a local <audio>
  // element instead of the YouTube IFrame. Exactly one engine is active.
  // ---------------------------------------------------------------------------
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const engineRef = useRef<"yt" | "local">("yt");
  const localVideoIdRef = useRef<string | null>(null);
  const engineLoadTokenRef = useRef(0);
  const [playbackSource, setPlaybackSource] =
    useState<PlaybackSource>("online");
  const eqGraphRef = useRef<{
    ctx: AudioContext;
    filters: BiquadFilterNode[];
    bass: BiquadFilterNode;
  } | null>(null);

  /** YT-compatible facade over the <audio> element (states: 0 ended, 1 playing, 2 paused, 3 buffering). */
  const localPlayer = useMemo<YTPlayerInstance>(
    () => ({
      loadVideoById: () => {},
      playVideo: () => {
        const a = audioElRef.current;
        if (!a || !a.src) return;
        const ctx = eqGraphRef.current?.ctx;
        if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
        void a.play().catch(() => {});
      },
      pauseVideo: () => {
        audioElRef.current?.pause();
      },
      seekTo: (seconds: number) => {
        const a = audioElRef.current;
        if (!a) return;
        try {
          a.currentTime = Math.max(0, seconds);
        } catch {
          // not seekable yet
        }
      },
      setVolume: (vol: number) => {
        if (audioElRef.current)
          audioElRef.current.volume = Math.max(0, Math.min(1, vol / 100));
      },
      mute: () => {
        if (audioElRef.current) audioElRef.current.muted = true;
      },
      unMute: () => {
        if (audioElRef.current) audioElRef.current.muted = false;
      },
      setPlaybackRate: (rate: number) => {
        if (audioElRef.current)
          audioElRef.current.playbackRate = rate > 0 ? rate : 1;
      },
      getCurrentTime: () => audioElRef.current?.currentTime ?? 0,
      getDuration: () => {
        const d = audioElRef.current?.duration ?? 0;
        return Number.isFinite(d) ? d : 0;
      },
      getPlayerState: () => {
        const a = audioElRef.current;
        if (!a || !a.src) return -1;
        if (a.ended) return 0;
        if (a.paused) return 2;
        return a.readyState < 3 ? 3 : 1;
      },
      getIframe: () => null,
      destroy: () => {},
    }),
    []
  );

  /** The engine that currently owns playback (null while YouTube is not ready). */
  const getActivePlayer = useCallback((): YTPlayerInstance | null => {
    if (engineRef.current === "local") return localPlayer;
    return ytReadyRef.current ? ytPlayerRef.current : null;
  }, [localPlayer]);

  const stopLocalAudio = useCallback(() => {
    const a = audioElRef.current;
    localVideoIdRef.current = null;
    if (!a) return;
    try {
      a.pause();
      if (a.getAttribute("src")) {
        a.removeAttribute("src");
        a.load();
      }
    } catch {
      // ignore
    }
  }, []);

  const pauseYouTube = useCallback(() => {
    if (!ytReadyRef.current || !ytPlayerRef.current) return;
    try {
      ytPlayerRef.current.pauseVideo();
    } catch {
      // ignore
    }
  }, []);

  const currentTrack = useMemo(() => getCurrentTrack(queueState), [queueState]);
  const queueStateRef = useRef<QueueState>(queueState);
  useEffect(() => {
    queueStateRef.current = queueState;
  }, [queueState]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    upNextModeRef.current = upNextMode;
  }, [upNextMode]);

  useEffect(() => {
    likedTracksRef.current = likedTracks;
  }, [likedTracks]);

  useEffect(() => {
    playlistsRef.current = playlists;
  }, [playlists]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    popupModeRef.current = popupMode;
  }, [popupMode]);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const clearRecoveryTimers = useCallback(() => {
    for (const id of recoveryTimersRef.current) {
      clearTimeout(id);
    }
    recoveryTimersRef.current = [];
  }, []);

  // Lightweight non-focus-stealing Web Audio keep-alive (keeps renderer audio thread alive without stealing Android HTMLMediaElement focus from YouTube IFrame)
  const ensureSilentAudioThread = useCallback(() => {
    if (typeof window === "undefined" || !settingsRef.current.backgroundPlay)
      return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtxRef.current) {
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.00001; // inaudible, keeps audio thread active
        osc.frequency.value = 20;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        audioCtxRef.current = ctx;
      } else if (audioCtxRef.current.state === "suspended") {
        void audioCtxRef.current.resume().catch(() => {});
      }
    } catch {
      // ignore autoplay-restricted contexts before gesture
    }
  }, []);

  // Staggered watchdog that keeps YouTube IFrame audio unmuted & playing across PiP and tab transitions
  const resumePlaybackKeepAlive = useCallback(() => {
    if (!intendedPlayingRef.current || userPausedRef.current) return;
    clearRecoveryTimers();
    ensureSilentAudioThread();

    const pulse = () => {
      if (!intendedPlayingRef.current || userPausedRef.current) return;
      const player = getActivePlayer();
      if (!player) return;
      try {
        const state = player.getPlayerState?.();
        if (!isMutedRef.current) {
          player.unMute();
          player.setVolume(volumeRef.current);
        }
        // Only force playVideo if not already actively playing (1) or buffering (3)
        if (state !== 1 && state !== 3) {
          player.playVideo();
        }
      } catch {
        // ignore player errors
      }
    };

    for (const delay of BACKGROUND_RECOVERY_DELAYS_MS) {
      if (delay === 0) {
        pulse();
      } else {
        const id = setTimeout(pulse, delay);
        recoveryTimersRef.current.push(id);
      }
    }
  }, [clearRecoveryTimers, ensureSilentAudioThread, getActivePlayer]);

  const registerPopupHandlers = useCallback(
    (handlers: { open: () => void; close: () => void }) => {
      popupHandlersRef.current = handlers;
    },
    []
  );

  const openBackgroundPopup = useCallback(() => {
    popupHandlersRef.current.open();
  }, []);

  const closeBackgroundPopup = useCallback(() => {
    popupHandlersRef.current.close();
  }, []);

  const toggleBackgroundPopup = useCallback(() => {
    if (popupMode === "off") {
      popupHandlersRef.current.open();
    } else {
      popupHandlersRef.current.close();
    }
  }, [popupMode]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2600);
  }, []);

  // Hydrate persisted library & settings on mount
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const loaded = loadLibraryState();

      setSettings(loaded.settings);
      setSearchHistory(loaded.searchHistory);
      setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // Cloud is authoritative. Never merge anonymous/global localStorage into an account.
  const [libraryOwner, setLibraryOwner] = useState<string | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [librarySaving, setLibrarySaving] = useState(false);
  const libraryBusyRef = useRef(false);
  const libraryRequestRef = useRef(0);
  const previousLibraryAccountRef = useRef<string | null>(null);
  const reloadLibrary = useCallback(async () => {
    const uid = userId;
    if (!uid || libraryBusyRef.current) return;
    const request = ++libraryRequestRef.current;
    setLibraryLoading(true);
    const cloud = await fetchOwnCloudLibrary(uid);
    if (userIdRef.current !== uid || request !== libraryRequestRef.current)
      return;
    setLibraryLoading(false);
    if (!cloud.ok) {
      setLibraryError(
        "Library belum tersinkron. Periksa koneksi dan coba lagi."
      );
      return;
    }
    setLibraryError(null);
    setPlaylists(cloud.playlists);
    setLikedTracks(cloud.likedTracks);
    setLibraryOwner(uid);
  }, [userId]);
  useEffect(() => {
    let active = true;
    const previousAccount = previousLibraryAccountRef.current;
    previousLibraryAccountRef.current = userId;
    queueMicrotask(() => {
      if (!active) return;
      if (previousAccount && previousAccount !== userId) {
        intendedPlayingRef.current = false;
        userPausedRef.current = true;
        audioElRef.current?.pause();
        try {
          ytPlayerRef.current?.pauseVideo();
        } catch {
          /* player may not be ready */
        }
        popupHandlersRef.current.close();
        lastLoadedVideoIdRef.current = null;
        setQueueState(createQueueState());
        setIsPlaying(false);
        setIsNowPlayingOpen(false);
        setLyrics(null);
      }
      libraryRequestRef.current++;
      setLibraryLoading(false);
      const device = loadAccountDeviceState(userId);
      setPlaylists([]);
      setLikedTracks([]);
      setHistory(device.history);
      setSavedCollection(device.savedCollection);
      setLibraryOwner(null);
      setLibraryError(null);
      setDetailTarget(null);
      setPlaylistPickerTrack(null);
      void reloadLibrary();
    });
    const refresh = () => {
      if (document.visibilityState === "visible") void reloadLibrary();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    const timer = window.setInterval(refresh, 30000);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      clearInterval(timer);
    };
  }, [reloadLibrary, userId]);

  // Sync Metrolist dark/light, Pure Black AMOLED class & Material 3 dynamic CSS variables on <html>
  useEffect(() => {
    if (!hydrated) return;
    const root = document.documentElement;
    if (settings.theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    if (settings.theme === "dark" && settings.pureBlack) {
      root.classList.add("pure-black");
    } else {
      root.classList.remove("pure-black");
    }

    const { tokens } = resolveMetrolistTheme(
      {
        theme: settings.theme,
        pureBlack: settings.pureBlack,
        dynamicColor: settings.dynamicColor,
        accentPreset: settings.accentPreset,
      },
      currentTrack
    );
    root.style.setProperty("--m3-bg", tokens.bg);
    root.style.setProperty("--m3-surface", tokens.surface);
    root.style.setProperty("--m3-surface-high", tokens.surfaceHigh);
    root.style.setProperty("--m3-border", tokens.border);
    root.style.setProperty("--m3-primary", tokens.primary);
    root.style.setProperty("--m3-on-primary", tokens.onPrimary);
    root.style.setProperty("--m3-primary-container", tokens.primaryContainer);
    root.style.setProperty(
      "--m3-on-primary-container",
      tokens.onPrimaryContainer
    );
    root.style.setProperty("--m3-primary-soft", tokens.primarySoft);
    root.style.setProperty("--m3-ring", tokens.ring);
  }, [
    settings.theme,
    settings.pureBlack,
    settings.dynamicColor,
    settings.accentPreset,
    currentTrack,
    hydrated,
  ]);

  // Initialize YouTube IFrame Player API lazily
  useEffect(() => {
    if (typeof window === "undefined" || !hydrated || !ytHostReady) return;

    const initPlayer = () => {
      if (!ytContainerRef.current || ytPlayerRef.current || !window.YT?.Player)
        return;
      try {
        ytPlayerRef.current = new window.YT.Player(ytContainerRef.current, {
          height: "100%",
          width: "100%",
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            iv_load_policy: 3,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
            origin: window.location.origin,
          },
          events: {
            onReady: (ev) => {
              ytReadyRef.current = true;
              try {
                const iframe = ev.target.getIframe?.();
                if (iframe) {
                  iframe.setAttribute(
                    "allow",
                    "autoplay; encrypted-media; picture-in-picture; fullscreen"
                  );
                }
              } catch {
                // ignore
              }
              ev.target.setVolume(volumeRef.current);
              if (!isMutedRef.current) ev.target.unMute();
              if (lastLoadedVideoIdRef.current && engineRef.current === "yt") {
                ev.target.loadVideoById(lastLoadedVideoIdRef.current);
              }
            },
            onStateChange: (ev) => {
              const PS = window.YT?.PlayerState;
              if (!PS) return;
              // A downloaded song is playing through <audio>: never let the
              // IFrame play at the same time, and ignore its events.
              if (engineRef.current === "local") {
                if (ev.data === PS.PLAYING || ev.data === PS.BUFFERING) {
                  try {
                    ev.target.pauseVideo();
                  } catch {
                    // ignore
                  }
                }
                return;
              }
              if (ev.data === PS.PLAYING) {
                intendedPlayingRef.current = true;
                userPausedRef.current = false;
                bgRecoveryCountRef.current = 0;
                setIsPlaying(true);
                setIsBuffering(false);
                if (!isMutedRef.current) {
                  try {
                    ev.target.unMute();
                    ev.target.setVolume(volumeRef.current);
                  } catch {
                    // ignore
                  }
                }
                const d = ev.target.getDuration();
                if (d && d > 0) setDuration(d);
              } else if (ev.data === PS.PAUSED) {
                const now = Date.now();
                if (now - bgRecoveryWindowStartRef.current > 6000) {
                  bgRecoveryWindowStartRef.current = now;
                  bgRecoveryCountRef.current = 0;
                }
                const shouldRecover = shouldAutoRecoverBackgroundPlayback({
                  backgroundPlayEnabled: settingsRef.current.backgroundPlay,
                  intendedPlaying: intendedPlayingRef.current,
                  userPaused: userPausedRef.current,
                  visibilityHidden:
                    typeof document !== "undefined" &&
                    document.visibilityState === "hidden",
                  popupActive: popupModeRef.current !== "off",
                  ytState: "paused",
                });
                if (shouldRecover && bgRecoveryCountRef.current < 6) {
                  bgRecoveryCountRef.current += 1;
                  try {
                    if (!isMutedRef.current) {
                      ev.target.unMute();
                      ev.target.setVolume(volumeRef.current);
                    }
                    ev.target.playVideo();
                  } catch {
                    // ignore
                  }
                  resumePlaybackKeepAlive();
                  return;
                }
                setIsPlaying(false);
                setIsBuffering(false);
              } else if (ev.data === PS.BUFFERING) {
                setIsBuffering(true);
              } else if (ev.data === PS.ENDED) {
                setIsBuffering(false);
                if (sleepEndOfTrackRef.current) {
                  sleepEndOfTrackRef.current = false;
                  setSleepTimerEndOfTrackState(false);
                  userPausedRef.current = true;
                  intendedPlayingRef.current = false;
                  setIsPlaying(false);
                  showToast("Sleep timer paused at end of track");
                  return;
                }
                nextTrackRef.current(false);
              }
            },
            onError: () => {
              if (engineRef.current === "local") return;
              setIsBuffering(false);
              if (settingsRef.current.autoSkipOnError) {
                const now = Date.now();
                if (now - lastAutoSkipAtRef.current > 2500) {
                  lastAutoSkipAtRef.current = now;
                  showToast("Track unavailable — skipping to next");
                  nextTrackRef.current(false);
                }
              }
            },
          },
        });
      } catch {
        // Headless/offline environments may block iframe script
      }
    };

    if (window.YT?.Player) {
      initPlayer();
      return;
    }

    const existingScript = document.querySelector(
      'script[src="https://www.youtube.com/iframe_api"]'
    );
    window.onYouTubeIframeAPIReady = () => initPlayer();
    if (!existingScript) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      tag.async = true;
      document.head.appendChild(tag);
    }
  }, [resumePlaybackKeepAlive, showToast, hydrated, ytHostReady]);

  const buildUpNextCandidates = useCallback(
    async (seedTrack: Track, mode: UpNextMode): Promise<Track[]> => {
      const region = settingsRef.current.region,
        cookie = settingsRef.current.ytCookie.trim();
      const tasteSeed =
        mode === "mixed"
          ? tasteSeeds(tasteStore.state, [seedTrack], 1)[0]
          : undefined;
      const responses = await Promise.all([
        recommendationClient.collect(seedTrack, region, cookie, mode, true),
        ...(tasteSeed
          ? [recommendationClient.collect(tasteSeed, region, cookie)]
          : []),
        ...(mode === "mixed"
          ? [recommendationClient.collect(undefined, region, cookie)]
          : []),
      ]);
      const pool: Candidate[] = responses.flatMap((r) => r.candidates);
      if (
        tasteStore.state.enabled &&
        mode !== "related" &&
        mode !== "discover"
      ) {
        // Only the currently scoped library, never load-count history.
        if (
          libraryOwner === tasteStore.owner &&
          userIdRef.current === tasteStore.owner
        ) {
          const library = [
            ...likedTracksRef.current,
            ...playlistsRef.current.flatMap((p) => p.tracks),
          ];
          library
            .slice(0, 200)
            .forEach((track, order) =>
              pool.push({ track, source: "library", order })
            );
        }
      }
      const options = {
        seed: seedTrack,
        exclude: queueStateRef.current.queue,
        surface: "queue" as const,
        hideVideoSongs: settingsRef.current.hideVideoSongs,
        limit: 24,
      };
      let recommendations = rankCandidates(
        mode === "library" && pool.some((c) => c.source === "library")
          ? pool.filter((c) => c.source === "library")
          : pool,
        tasteStore.state,
        options
      );
      if (recommendations.length < 8 && mode !== "related") {
        const fallback = await recommendationClient.collect(
          seedTrack,
          settingsRef.current.region,
          settingsRef.current.ytCookie.trim(),
          "expanded"
        );
        pool.push(...fallback.candidates);
        recommendations = rankCandidates(pool, tasteStore.state, options);
      }
      return recommendations.map((r) => r.track);
    },
    [recommendationClient, tasteStore, libraryOwner]
  );

  const loadTrackIntoEngine = useCallback(
    async (track: Track) => {
      const token = ++engineLoadTokenRef.current;
      const shouldCuePaused =
        !intendedPlayingRef.current &&
        settingsRef.current.keepPausedOnSongChange;

      if (!getOfflineSnapshot().ready) {
        try {
          await ensureOfflineLibraryLoaded();
        } catch {
          showToast(
            "Daftar unduhan tidak dapat dibaca. Penyimpanan offline tidak tersedia."
          );
        }
        if (token !== engineLoadTokenRef.current) return;
      }

      const record = getDownloadedTrackSync(track);
      if (record) {
        const url = await resolveOfflinePlaybackUrl(record);
        if (token !== engineLoadTokenRef.current) return;
        const audio = audioElRef.current;
        if (url && audio) {
          engineRef.current = "local";
          setPlaybackSource("offline");
          pauseYouTube();
          if (localVideoIdRef.current !== track.videoId || audio.src !== url) {
            audio.src = url;
            localVideoIdRef.current = track.videoId;
          }
          audio.playbackRate =
            settingsRef.current.playbackRate > 0
              ? settingsRef.current.playbackRate
              : 1;
          audio.volume = Math.max(0, Math.min(1, volumeRef.current / 100));
          audio.muted = isMutedRef.current;
          if (!shouldCuePaused && intendedPlayingRef.current) {
            localPlayer.playVideo();
          }
          return;
        }
        stopLocalAudio();
        intendedPlayingRef.current = false;
        setIsPlaying(false);
        setIsBuffering(false);
        showToast(
          "File offline hilang atau rusak. Unduh ulang, atau hapus unduhan lalu pilih putar online."
        );
        return;
      }

      // ---- Online (YouTube IFrame) ----
      engineRef.current = "yt";
      setPlaybackSource("online");
      stopLocalAudio();

      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        userPausedRef.current = true;
        intendedPlayingRef.current = false;
        setIsPlaying(false);
        setIsBuffering(false);
        showToast("Kamu sedang offline. Lagu ini belum diunduh.");
        return;
      }

      if (ytReadyRef.current && ytPlayerRef.current) {
        try {
          if (shouldCuePaused && ytPlayerRef.current.cueVideoById) {
            ytPlayerRef.current.cueVideoById(track.videoId);
          } else {
            ytPlayerRef.current.loadVideoById(track.videoId);
            if (shouldCuePaused) {
              ytPlayerRef.current.pauseVideo();
            } else if (intendedPlayingRef.current) {
              ytPlayerRef.current.playVideo();
            }
          }
          ytPlayerRef.current.setPlaybackRate(settingsRef.current.playbackRate);
        } catch {
          // ignore if player not attached
        }
      }
    },
    [localPlayer, pauseYouTube, showToast, stopLocalAudio]
  );

  // Load new track into the active engine + fetch synced lyrics + auto-radio prefetch
  useEffect(() => {
    if (!currentTrack) return;

    let cancelled = false;
    lastLoadedVideoIdRef.current = currentTrack.videoId;
    queueMicrotask(() => {
      if (!cancelled) void loadTrackIntoEngine(currentTrack);
    });

    const syncTrackData = async () => {
      setCurrentTime(0);
      setDuration(currentTrack.duration ?? 210);

      // Fetch Lyrics (downloaded songs carry their own copy for offline use)
      setLyricsLoading(true);
      const params = new URLSearchParams({
        videoId: currentTrack.videoId,
        title: currentTrack.title,
        artist: currentTrack.artist,
        duration: String(currentTrack.duration ?? 0),
      });
      await ensureOfflineLibraryLoaded().catch(() => {});
      const offlineLyrics =
        getDownloadedTrackSync(currentTrack)?.lyrics ?? null;
      const isOffline =
        typeof navigator !== "undefined" && navigator.onLine === false;

      if (isOffline) {
        if (!cancelled) {
          setLyrics(
            offlineLyrics ?? {
              synced: false,
              lines: [],
              plainText: null,
              source: "none",
            }
          );
          setLyricsLoading(false);
        }
      } else {
        try {
          const res = await fetch(
            apiUrl(`/api/music/lyrics?${params.toString()}`)
          );
          const data = (await res.json()) as LyricsPayload;
          if (!cancelled) {
            setLyrics(
              offlineLyrics && !data?.lines?.length && !data?.plainText
                ? offlineLyrics
                : data
            );
          }
        } catch {
          if (!cancelled) {
            setLyrics(
              offlineLyrics ?? {
                synced: false,
                lines: [],
                plainText: null,
                source: "none",
              }
            );
          }
        } finally {
          if (!cancelled) setLyricsLoading(false);
        }
      }
    };

    void syncTrackData();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.videoId]);

  useEffect(() => {
    queueMicrotask(() => {
      setQueueState(removeAutomaticUpcoming);
      setUpNextRefreshing(false);
    });
    return () => recommendationGate.cancel();
  }, [tasteStore, recommendationGate]);

  // Recommendations never wait on lyrics, authentication sync or audio loading.
  useEffect(() => {
    const seed = currentTrack;
    const ticket = recommendationGate.next();
    if (!settings.autoContinueRadio || navigator.onLine === false) return;
    if (!seed || queueState.queue.length - 1 - queueState.currentIndex > 2)
      return;
    let cancelled = false;
    void buildUpNextCandidates(seed, upNextModeRef.current).then(
      (candidates) => {
        if (
          cancelled ||
          !recommendationGate.valid(ticket) ||
          !settingsRef.current.autoContinueRadio
        )
          return;
        setQueueState((prev) =>
          getCurrentTrack(prev)?.videoId === seed.videoId
            ? appendRadioContinuation(prev, candidates, settingsRef.current, 16)
            : prev
        );
      }
    );
    return () => {
      cancelled = true;
    };
  }, [
    currentTrack,
    settings.autoContinueRadio,
    buildUpNextCandidates,
    recommendationGate,
    queueState.currentIndex,
    queueState.queue.length,
  ]);

  // Real playback sampling. Position changes caused by seek, buffering, errors
  // or timer suspension earn no listening time; nothing is sent per second.
  useEffect(() => {
    if (!currentTrack) return;
    const active = listeningRef.current;
    if (
      !active ||
      active.store !== tasteStore ||
      trackKey(active.session.track) !== trackKey(currentTrack)
    ) {
      beginListening(currentTrack, "auto");
    }
    const timer = setInterval(() => {
      const entry = listeningRef.current;
      if (!entry || entry.store !== tasteStore) return;
      if (entry.epoch !== tasteStore.state.epoch) {
        beginListening(currentTrack, "auto");
        return;
      }
      const session = entry.session,
        player = getActivePlayer();
      if (!tasteStore.ready || !tasteStore.state.enabled) {
        session.invalidate();
        return;
      }
      try {
        const playing =
          isPlaying && !isBuffering && player?.getPlayerState?.() === 1;
        session.sample(
          Date.now(),
          player?.getCurrentTime() ?? 0,
          playing,
          settingsRef.current.playbackRate
        );
        const reportedDuration = player?.getDuration();
        const actualDuration =
          currentTrack.duration ??
          (typeof reportedDuration === "number" &&
          Number.isFinite(reportedDuration) &&
          reportedDuration > 0
            ? reportedDuration
            : null);
        const majority = session.majority(actualDuration);
        if (!entry.credited && (session.seconds >= 30 || majority)) {
          entry.credited = true;
          tasteStore.record(
            currentTrack,
            "listen",
            session.origin,
            session.seconds,
            session.id + ":listen"
          );
          setHistory((prev) => {
            const next = recordTrackPlay(prev, currentTrack);
            saveHistory(next, tasteStore.owner);
            return next;
          });
          if (tasteStore.owner) void recordMonthlyPlay(currentTrack);
          if (
            tasteStore.state.events.some(
              (e) =>
                e.id !== session.id + ":listen" &&
                trackKey(e.track) === trackKey(currentTrack) &&
                ["listen", "complete"].includes(e.kind)
            )
          ) {
            tasteStore.record(
              currentTrack,
              "replay",
              session.origin,
              session.seconds,
              session.id + ":replay"
            );
          }
        }
        if (!entry.longListen && session.seconds >= 120) {
          entry.longListen = true;
          tasteStore.record(
            currentTrack,
            "listen",
            session.origin,
            90,
            session.id + ":long"
          );
        }
        if (!session.completed && majority) {
          session.completed = true;
          tasteStore.record(
            currentTrack,
            "complete",
            session.origin,
            session.seconds,
            session.id + ":complete"
          );
        }
      } catch {
        session.invalidate();
      }
    }, 1000);
    return () => {
      clearInterval(timer);
      listeningRef.current?.session.invalidate();
    };
  }, [
    currentTrack,
    tasteStore,
    beginListening,
    getActivePlayer,
    isPlaying,
    isBuffering,
  ]);

  // ---------------------------------------------------------------------------
  // Offline <audio> engine events (mirror of the YouTube onStateChange logic)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const audio = audioElRef.current;
    if (!audio) return;
    const active = () =>
      engineRef.current === "local" && Boolean(audio.getAttribute("src"));

    const syncDuration = () => {
      if (!active()) return;
      const d = audio.duration;
      if (Number.isFinite(d) && d > 0) setDuration(d);
    };
    const onPlaying = () => {
      if (!active()) return;
      pauseYouTube();
      intendedPlayingRef.current = true;
      userPausedRef.current = false;
      bgRecoveryCountRef.current = 0;
      setIsPlaying(true);
      setIsBuffering(false);
      syncDuration();
    };
    const onWaiting = () => {
      if (active()) setIsBuffering(true);
    };
    const onPause = () => {
      if (!active() || audio.ended) return;
      const now = Date.now();
      if (now - bgRecoveryWindowStartRef.current > 6000) {
        bgRecoveryWindowStartRef.current = now;
        bgRecoveryCountRef.current = 0;
      }
      const shouldRecover = shouldAutoRecoverBackgroundPlayback({
        backgroundPlayEnabled: settingsRef.current.backgroundPlay,
        intendedPlaying: intendedPlayingRef.current,
        userPaused: userPausedRef.current,
        visibilityHidden: document.visibilityState === "hidden",
        popupActive: popupModeRef.current !== "off",
        ytState: "paused",
      });
      if (shouldRecover && bgRecoveryCountRef.current < 6) {
        bgRecoveryCountRef.current += 1;
        void audio.play().catch(() => {});
        return;
      }
      if (!userPausedRef.current) {
        // Paused by the system (headphones unplugged, audio focus loss).
        intendedPlayingRef.current = false;
      }
      setIsPlaying(false);
      setIsBuffering(false);
    };
    const onEnded = () => {
      if (!active()) return;
      setIsBuffering(false);
      if (sleepEndOfTrackRef.current) {
        sleepEndOfTrackRef.current = false;
        setSleepTimerEndOfTrackState(false);
        userPausedRef.current = true;
        intendedPlayingRef.current = false;
        setIsPlaying(false);
        showToast("Sleep timer paused at end of track");
        return;
      }
      nextTrackRef.current(false);
    };
    const onError = () => {
      if (!active()) return;
      // Never silently stream on local failure (data charges / user intent).
      const failedTrack = getCurrentTrack(queueStateRef.current);
      if (failedTrack)
        void removeDownloadedTrack(
          `${failedTrack.provider || "youtube"}:${failedTrack.videoId}`
        ).catch(() =>
          showToast(
            "File bermasalah tidak dapat dihapus. Hapus melalui daftar Unduhan."
          )
        );
      stopLocalAudio();
      setIsBuffering(false);
      intendedPlayingRef.current = false;
      setIsPlaying(false);
      showToast(
        "File offline gagal diputar. Hapus unduhan lalu unduh ulang; untuk streaming pilih putar lagi setelah dihapus."
      );
    };

    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("loadedmetadata", syncDuration);
    audio.addEventListener("durationchange", syncDuration);
    return () => {
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("loadedmetadata", syncDuration);
      audio.removeEventListener("durationchange", syncDuration);
    };
  }, [pauseYouTube, showToast, stopLocalAudio]);

  // Device-local index: stop without automatic streaming when a download vanishes.
  useEffect(() => {
    void ensureOfflineLibraryLoaded().catch(() =>
      showToast(
        "Daftar unduhan tidak dapat dibuka. Periksa penyimpanan lalu buka ulang aplikasi."
      )
    );
    return subscribeOffline(() => {
      const localId = localVideoIdRef.current;
      if (engineRef.current !== "local" || !localId) return;
      const activeTrack = getCurrentTrack(queueStateRef.current);
      if (
        activeTrack?.videoId === localId &&
        getDownloadedTrackSync(activeTrack)
      )
        return;
      stopLocalAudio();
      intendedPlayingRef.current = false;
      setIsPlaying(false);
      setIsBuffering(false);
      showToast(
        "File offline tidak tersedia. Unduh ulang atau pilih putar lagi saat online."
      );
    });
  }, [loadTrackIntoEngine, stopLocalAudio, showToast]);

  // Opened without internet: go straight to the Library (offline downloads).
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      queueMicrotask(() => setActiveTabState("library"));
    }
  }, []);

  // Real equalizer for downloaded songs (Web Audio on the <audio> element).
  // The YouTube IFrame cannot be processed, so this only affects offline playback.
  useEffect(() => {
    const audio = audioElRef.current;
    if (!audio || typeof window === "undefined") return;
    const bands =
      Array.isArray(settings.equalizerBands) &&
      settings.equalizerBands.length === 5
        ? settings.equalizerBands
        : [0, 0, 0, 0, 0];
    const eqActive = settings.bassBoostEnabled || bands.some((b) => b !== 0);
    let graph = eqGraphRef.current;
    if (!graph) {
      if (!eqActive || playbackSource !== "offline") return;
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const source = ctx.createMediaElementSource(audio);
        const freqs = [60, 230, 910, 3600, 14000];
        const filters = freqs.map((f, i) => {
          const node = ctx.createBiquadFilter();
          node.type =
            i === 0
              ? "lowshelf"
              : i === freqs.length - 1
              ? "highshelf"
              : "peaking";
          node.frequency.value = f;
          node.Q.value = 1;
          return node;
        });
        const bass = ctx.createBiquadFilter();
        bass.type = "lowshelf";
        bass.frequency.value = 100;
        let node: AudioNode = source;
        for (const f of [...filters, bass]) {
          node.connect(f);
          node = f;
        }
        node.connect(ctx.destination);
        graph = { ctx, filters, bass };
        eqGraphRef.current = graph;
        if (!audio.paused) void ctx.resume().catch(() => {});
      } catch {
        return;
      }
    }
    graph.filters.forEach((f, i) => {
      f.gain.value = Math.max(-12, Math.min(12, Number(bands[i]) || 0));
    });
    graph.bass.gain.value = settings.bassBoostEnabled ? 6 : 0;
  }, [settings.equalizerBands, settings.bassBoostEnabled, playbackSource]);

  // Non-focus-stealing Web Audio Thread Keep-Alive + Browser Tab Title Sync
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (currentTrack && isPlaying) {
      document.title = `▶ ${currentTrack.title} · ${currentTrack.artist} — Easvarafy`;
    } else if (currentTrack) {
      document.title = `${currentTrack.title} — Easvarafy`;
    } else {
      document.title = "Easvarafy — Dengerin Musik Tanpa Batas";
    }

    if (isPlaying && settings.backgroundPlay && currentTrack) {
      ensureSilentAudioThread();
    } else if (audioCtxRef.current && audioCtxRef.current.state === "running") {
      void audioCtxRef.current.suspend().catch(() => {});
    }
  }, [
    isPlaying,
    settings.backgroundPlay,
    currentTrack,
    ensureSilentAudioThread,
  ]);

  // Cleanup keep-alive AudioContext & recovery timers on unmount
  useEffect(() => {
    return () => {
      clearRecoveryTimers();
      if (audioCtxRef.current) {
        void audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, [clearRecoveryTimers]);

  // Page Visibility & Window Blur Guard: keep playback alive across tab/app transitions + optional auto pop-out
  useEffect(() => {
    if (typeof document === "undefined") return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (
          settingsRef.current.backgroundPlay &&
          intendedPlayingRef.current &&
          !userPausedRef.current
        ) {
          resumePlaybackKeepAlive();
          if (
            settingsRef.current.autoPopoutIsland &&
            popupModeRef.current === "off" &&
            // The Android system Dynamic Island already shows outside the app.
            !isNativeIslandActive()
          ) {
            popupHandlersRef.current.open();
          }
        }
      } else {
        bgRecoveryCountRef.current = 0;
        lastTickMsRef.current = Date.now();
        if (intendedPlayingRef.current && !userPausedRef.current) {
          resumePlaybackKeepAlive();
        }
        const player = getActivePlayer();
        if (player) {
          try {
            const ytTime = player.getCurrentTime();
            if (
              typeof ytTime === "number" &&
              !Number.isNaN(ytTime) &&
              ytTime > 0
            ) {
              setCurrentTime(ytTime);
            }
          } catch {
            // ignore
          }
        }
      }
    };

    const handleWindowBlur = () => {
      if (
        settingsRef.current.backgroundPlay &&
        intendedPlayingRef.current &&
        !userPausedRef.current
      ) {
        resumePlaybackKeepAlive();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("pageshow", handleWindowBlur);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("pageshow", handleWindowBlur);
    };
  }, [resumePlaybackKeepAlive, getActivePlayer]);

  // Playback progress ticker (Wall-clock drift-corrected + involuntary-pause watchdog) + Sleep timer monitor
  useEffect(() => {
    if (!isPlaying || !currentTrack) return;
    lastTickMsRef.current = Date.now();

    const timer = setInterval(() => {
      const now = Date.now();
      const lastTick = lastTickMsRef.current;
      lastTickMsRef.current = now;

      // Check sleep timer
      if (sleepDeadlineRef.current && now >= sleepDeadlineRef.current) {
        sleepDeadlineRef.current = null;
        setSleepTimerMinutes(null);
        userPausedRef.current = true;
        intendedPlayingRef.current = false;
        clearRecoveryTimers();
        setIsPlaying(false);
        getActivePlayer()?.pauseVideo();
        showToast("Sleep timer paused playback");
        return;
      }

      const player = getActivePlayer();
      if (player) {
        try {
          const ytState = player.getPlayerState?.();
          // Watchdog: if YouTube paused involuntarily while popup/background is active, pulse resume
          if (
            intendedPlayingRef.current &&
            !userPausedRef.current &&
            settingsRef.current.backgroundPlay &&
            (popupModeRef.current !== "off" ||
              document.visibilityState === "hidden") &&
            (ytState === 2 || ytState === 5)
          ) {
            if (!isMutedRef.current) {
              player.unMute();
              player.setVolume(volumeRef.current);
            }
            player.playVideo();
          }

          const ytTime = player.getCurrentTime();
          const ytDur = player.getDuration();
          if (ytDur && ytDur > 0) setDuration(ytDur);
          if (
            typeof ytTime === "number" &&
            !Number.isNaN(ytTime) &&
            ytTime > 0
          ) {
            setCurrentTime(ytTime);
            return;
          }
          // The local <audio> engine reports its own end via the 'ended' event.
          if (engineRef.current === "local") return;
        } catch {
          // fallback timer increment
        }
      }

      setCurrentTime((prev) => {
        const maxDur = duration || currentTrack.duration || 210;
        const { nextTime, reachedEnd } = computeElapsedWithDrift(
          prev,
          lastTick,
          now,
          settings.playbackRate,
          maxDur
        );
        if (reachedEnd) {
          nextTrackRef.current(false);
          return 0;
        }
        return nextTime;
      });
    }, 250);

    return () => clearInterval(timer);
  }, [
    isPlaying,
    currentTrack,
    duration,
    settings.playbackRate,
    showToast,
    clearRecoveryTimers,
    getActivePlayer,
  ]);

  const setActiveTab = useCallback(
    (tab: NavTab) => {
      if (tab === "profile") {
        if (!requireAuth("Masuk untuk membuka profil kamu.")) return;
        router.push(
          isNativeApp() ? `/profile/?id=${userId}` : `/profile/${userId}`
        );
      } else {
        setActiveTabState(tab);
        if (
          pathname.startsWith("/profile") ||
          pathname.startsWith("/blend") ||
          pathname.startsWith("/playlist")
        )
          router.push("/");
      }
      setDetailTarget(null);
    },
    [pathname, requireAuth, router, userId]
  );

  const openDetail = useCallback(
    (target: DetailTarget | null) => {
      if (target?.kind === "user-playlist") {
        router.push(playlistPath(target.id, isNativeApp()));
        setDetailTarget(null);
      } else if (target?.kind === "user-profile") {
        router.push(
          isNativeApp() ? `/profile/?id=${target.id}` : `/profile/${target.id}`
        );
        setDetailTarget(null);
      } else if (target?.kind === "blend") {
        router.push(`/blend?id=${target.id}`);
        setDetailTarget(null);
      } else if (!target && pathname.startsWith("/playlist")) {
        setActiveTabState("library");
        router.push("/");
        setDetailTarget(null);
      } else if (!target && pathname.startsWith("/blend")) {
        router.push("/blend");
        setDetailTarget(null);
      } else setDetailTarget(target);
    },
    [router, pathname]
  );

  // Android back at page level: detail page -> its tab -> Home tab. Sheets and
  // the full player register their own (higher) handlers.
  useBackHandler(
    true,
    () => {
      if (detailTarget) {
        setDetailTarget(null);
        return true;
      }
      if (
        pathname.startsWith("/blend") ||
        pathname.startsWith("/profile") ||
        pathname.startsWith("/playlist")
      ) {
        setActiveTabState("home");
        router.push("/");
        return true;
      }
      if (activeTab !== "home") {
        setActiveTabState("home");
        return true;
      }
      return false;
    },
    BACK_PRIORITY_PAGE
  );

  const playTrack = useCallback(
    (track: Track, contextQueue?: Track[]) => {
      if (
        navigator.onLine === false &&
        getOfflineSnapshot().ready &&
        !getDownloadedTrackSync(track)
      ) {
        showToast(
          "Lagu ini belum diunduh. Antrean tidak diubah; pilih lagu tersimpan atau sambungkan internet."
        );
        return;
      }
      explicitSkip();
      beginListening(track, "explicit");
      recommendationGate.cancel();
      userPausedRef.current = false;
      intendedPlayingRef.current = true;
      bgRecoveryCountRef.current = 0;
      setQueueState((prev) => playTrackInQueue(prev, track, contextQueue));
      setIsPlaying(true);
      if (getDownloadedTrackSync(track)) {
        // Downloaded: play the local file (the track effect loads it). Stop the
        // IFrame right away so the two engines never overlap.
        pauseYouTube();
        if (
          engineRef.current === "local" &&
          localVideoIdRef.current === track.videoId
        ) {
          localPlayer.seekTo(0);
          localPlayer.playVideo();
        }
        return;
      }
      engineRef.current = "yt";
      setPlaybackSource("online");
      stopLocalAudio();
      if (typeof navigator !== "undefined" && navigator.onLine === false)
        return;
      if (ytReadyRef.current && ytPlayerRef.current) {
        try {
          ytPlayerRef.current.loadVideoById(track.videoId);
          ytPlayerRef.current.playVideo();
        } catch {
          // ignore
        }
      }
    },
    [
      localPlayer,
      pauseYouTube,
      stopLocalAudio,
      beginListening,
      explicitSkip,
      recommendationGate,
      showToast,
    ]
  );

  const play = useCallback(() => {
    if (!currentTrack) return;
    userPausedRef.current = false;
    intendedPlayingRef.current = true;
    bgRecoveryCountRef.current = 0;
    setIsPlaying(true);
    ensureSilentAudioThread();
    const player = getActivePlayer();
    if (player) {
      try {
        if (!isMutedRef.current) {
          player.unMute();
          player.setVolume(volumeRef.current);
        }
        player.playVideo();
      } catch {
        // ignore
      }
    }
  }, [currentTrack, ensureSilentAudioThread, getActivePlayer]);

  const pause = useCallback(() => {
    if (!currentTrack) return;
    userPausedRef.current = true;
    intendedPlayingRef.current = false;
    clearRecoveryTimers();
    setIsPlaying(false);
    try {
      getActivePlayer()?.pauseVideo();
    } catch {
      // ignore
    }
  }, [currentTrack, clearRecoveryTimers, getActivePlayer]);

  const togglePlayPause = useCallback(() => {
    if (!currentTrack) return;
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [currentTrack, isPlaying, pause, play]);

  const nextTrack = useCallback(
    (manual = true) => {
      if (manual) explicitSkip();
      listeningRef.current?.session.invalidate();
      if (!manual && queueStateRef.current.repeat === "one") {
        const repeated = getCurrentTrack(queueStateRef.current);
        if (repeated) beginListening(repeated, "auto");
      }
      const stayPaused =
        manual &&
        settingsRef.current.keepPausedOnSongChange &&
        !intendedPlayingRef.current;
      setQueueState((prev) => {
        const res = advanceQueue(prev, "next", { manual });
        if (res.ended || stayPaused) {
          userPausedRef.current = true;
          intendedPlayingRef.current = false;
          setIsPlaying(false);
        } else {
          userPausedRef.current = false;
          intendedPlayingRef.current = true;
          setIsPlaying(true);
        }
        return res.state;
      });
    },
    [explicitSkip, beginListening]
  );

  useEffect(() => {
    nextTrackRef.current = nextTrack;
  }, [nextTrack]);

  const prevTrack = useCallback(() => {
    if (playbackTimeRef.current > 4) {
      setCurrentTime(0);
      getActivePlayer()?.seekTo(0, true);
      return;
    }
    const stayPaused =
      settingsRef.current.keepPausedOnSongChange && !intendedPlayingRef.current;
    userPausedRef.current = stayPaused;
    intendedPlayingRef.current = !stayPaused;
    setQueueState((prev) => {
      const res = advanceQueue(prev, "prev");
      setIsPlaying(!stayPaused);
      return res.state;
    });
  }, [getActivePlayer]);

  const seekTo = useCallback(
    (seconds: number) => {
      listeningRef.current?.session.invalidate();
      const clamped = Math.max(0, seconds);
      setCurrentTime(clamped);
      const player = getActivePlayer();
      if (player) {
        try {
          player.seekTo(clamped, true);
        } catch {
          // ignore
        }
      }
    },
    [getActivePlayer]
  );

  // Full Media Session API for native iOS / Android / macOS / Windows background & lockscreen controls
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator))
      return;
    if (!currentTrack) {
      try {
        navigator.mediaSession.playbackState = "none";
      } catch {
        // ignore
      }
      return;
    }

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        album: currentTrack.album?.name || "Easvarafy Music",
        artwork:
          currentTrack.thumbnail && navigator.onLine !== false
            ? [
                {
                  src: currentTrack.thumbnail,
                  sizes: "256x256",
                  type: "image/jpeg",
                },
                {
                  src: currentTrack.thumbnail,
                  sizes: "544x544",
                  type: "image/jpeg",
                },
              ]
            : [],
      });
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
      navigator.mediaSession.setActionHandler("play", () => {
        play();
        resumePlaybackKeepAlive();
      });
      navigator.mediaSession.setActionHandler("pause", () => pause());
      navigator.mediaSession.setActionHandler("stop", () => pause());
      navigator.mediaSession.setActionHandler("nexttrack", () =>
        nextTrack(true)
      );
      navigator.mediaSession.setActionHandler("previoustrack", () =>
        prevTrack()
      );
      navigator.mediaSession.setActionHandler("seekbackward", (details) => {
        const offset = details.seekOffset ?? 10;
        seekTo(Math.max(0, playbackTimeRef.current - offset));
      });
      navigator.mediaSession.setActionHandler("seekforward", (details) => {
        const offset = details.seekOffset ?? 10;
        seekTo(Math.min(duration || 210, playbackTimeRef.current + offset));
      });
      navigator.mediaSession.setActionHandler("seekto", (details) => {
        if (typeof details.seekTime === "number") {
          seekTo(details.seekTime);
        }
      });
    } catch {
      // ignore unsupported MediaSession environments
    }
  }, [
    currentTrack,
    isPlaying,
    play,
    pause,
    resumePlaybackKeepAlive,
    nextTrack,
    prevTrack,
    seekTo,
    duration,
  ]);

  // Sync Media Session position state smoothly
  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      !("mediaSession" in navigator) ||
      typeof navigator.mediaSession.setPositionState !== "function" ||
      !currentTrack
    ) {
      return;
    }
    const pos = buildMediaSessionPosition(
      currentTime,
      duration,
      settings.playbackRate
    );
    if (!pos) return;
    try {
      navigator.mediaSession.setPositionState(pos);
    } catch {
      // ignore
    }
  }, [currentTrack, currentTime, duration, settings.playbackRate]);

  // ---------------------------------------------------------------------------
  // Android APK: native media notification + lock-screen player (Spotify-style).
  // WebView does not forward navigator.mediaSession to Android, so we drive a
  // native MediaSession through the EasvarafyMedia Capacitor plugin instead.
  // ---------------------------------------------------------------------------
  const nativeMediaHandlersRef = useRef({
    play,
    pause,
    nextTrack,
    prevTrack,
    seekTo,
    resumePlaybackKeepAlive,
  });
  useEffect(() => {
    nativeMediaHandlersRef.current = {
      play,
      pause,
      nextTrack,
      prevTrack,
      seekTo,
      resumePlaybackKeepAlive,
    };
  }, [play, pause, nextTrack, prevTrack, seekTo, resumePlaybackKeepAlive]);

  useEffect(() => {
    return onNativeMediaAction((event) => {
      const h = nativeMediaHandlersRef.current;
      switch (event.action) {
        case "play":
          h.play();
          h.resumePlaybackKeepAlive();
          break;
        case "pause":
          h.pause();
          break;
        case "next":
          h.nextTrack(true);
          break;
        case "previous":
          h.prevTrack();
          break;
        case "seekto":
          if (
            typeof event.position === "number" &&
            Number.isFinite(event.position)
          ) {
            h.seekTo(event.position);
          }
          break;
        case "open":
          // Opened from the system Dynamic Island -> show the full player.
          setNowPlayingTab("player");
          setIsNowPlayingOpen(true);
          break;
      }
    });
  }, []);

  const nativeCurrentTimeRef = useRef(0);
  useEffect(() => {
    nativeCurrentTimeRef.current = currentTime;
  }, [currentTime]);
  // Last position we told Android about, used to detect seeks / drift without
  // rebuilding the notification on every 250 ms progress tick.
  const nativeLastSyncRef = useRef<{
    position: number;
    at: number;
    playing: boolean;
    rate: number;
  } | null>(null);

  const pushNativeMedia = useCallback(() => {
    if (!currentTrack) return;
    const effectiveDuration = duration || currentTrack.duration || 0;
    const position = nativeCurrentTimeRef.current;
    const rate = settings.playbackRate > 0 ? settings.playbackRate : 1;
    nativeLastSyncRef.current = {
      position,
      at: Date.now(),
      playing: isPlaying,
      rate,
    };
    const offlineRecord = getDownloadedTrackSync(currentTrack);
    const localArtwork =
      offlineRecord?.localThumbUri?.startsWith("file://") &&
      typeof navigator !== "undefined" &&
      navigator.onLine === false
        ? offlineRecord.localThumbUri
        : null;
    void updateNativeMedia({
      title: currentTrack.title,
      artist: currentTrack.artist,
      album: currentTrack.album?.name || "",
      artworkUrl:
        navigator.onLine === false
          ? localArtwork
          : upgradeArtworkUrl(currentTrack.thumbnail),
      playing: isPlaying,
      position,
      duration: effectiveDuration,
      playbackRate: rate,
    });
  }, [currentTrack, duration, isPlaying, settings.playbackRate]);

  // Track / play-state / duration changes -> full update
  useEffect(() => {
    if (!hasNativeMediaControls()) return;
    if (!currentTrack) {
      nativeLastSyncRef.current = null;
      void clearNativeMedia();
      return;
    }
    pushNativeMedia();
  }, [currentTrack, pushNativeMedia]);

  // Progress ticks -> only resync when the real position drifts from what
  // Android is extrapolating (seek, buffering stall, track restart).
  useEffect(() => {
    if (!currentTrack || !hasNativeMediaControls()) return;
    const last = nativeLastSyncRef.current;
    if (!last) return;
    const expected = last.playing
      ? last.position + ((Date.now() - last.at) / 1000) * last.rate
      : last.position;
    if (Math.abs(currentTime - expected) > 2.5) {
      pushNativeMedia();
    }
  }, [currentTime, currentTrack, pushNativeMedia]);

  const setVolume = useCallback(
    (vol: number) => {
      const clamped = Math.max(0, Math.min(100, vol));
      setVolumeState(clamped);
      setIsMuted(clamped === 0);
      localPlayer.setVolume(clamped);
      if (clamped > 0) localPlayer.unMute();
      if (ytReadyRef.current && ytPlayerRef.current) {
        try {
          ytPlayerRef.current.setVolume(clamped);
          if (clamped > 0) ytPlayerRef.current.unMute();
        } catch {
          // ignore
        }
      }
    },
    [localPlayer]
  );

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      if (next) localPlayer.mute();
      else localPlayer.unMute();
      if (ytReadyRef.current && ytPlayerRef.current) {
        try {
          if (next) ytPlayerRef.current.mute();
          else ytPlayerRef.current.unMute();
        } catch {
          // ignore
        }
      }
      return next;
    });
  }, [localPlayer]);

  const playNextInQueue = useCallback(
    (track: Track) => {
      const wasEmpty = queueState.queue.length === 0;
      setQueueState((prev) => insertPlayNext(prev, track));
      if (wasEmpty) setIsPlaying(true);
      showToast(`Playing "${track.title}" next`);
    },
    [queueState.queue.length, showToast]
  );

  const addTrackToQueue = useCallback(
    (track: Track) => {
      const wasEmpty = queueState.queue.length === 0;
      setQueueState((prev) => appendToQueue(prev, track));
      if (wasEmpty) setIsPlaying(true);
      showToast(`Added "${track.title}" to queue`);
    },
    [queueState.queue.length, showToast]
  );

  const removeQueueIndex = useCallback((idx: number) => {
    setQueueState((prev) => removeFromQueue(prev, idx));
  }, []);

  const moveQueueItem = useCallback((from: number, to: number) => {
    setQueueState((prev) => reorderQueue(prev, from, to));
  }, []);

  const toggleShuffle = useCallback(() => {
    setQueueState((prev) => toggleShuffleQueue(prev));
  }, []);

  const cycleRepeat = useCallback(() => {
    setQueueState((prev) => ({
      ...prev,
      repeat: cycleRepeatMode(prev.repeat),
    }));
  }, []);

  const jumpToQueueIndex = useCallback(
    (idx: number) => {
      const track = queueStateRef.current.queue[idx];
      if (!track) return;
      explicitSkip();
      beginListening(track, "explicit");
      recommendationGate.cancel();
      setQueueState((prev) => {
        if (idx < 0 || idx >= prev.queue.length) return prev;
        return { ...prev, currentIndex: idx };
      });
      setIsPlaying(true);
    },
    [explicitSkip, beginListening, recommendationGate]
  );

  const startRadio = useCallback(
    async (track: Track, mode?: UpNextMode) => {
      if (mode) {
        upNextModeRef.current = mode;
        setUpNextModeState(mode);
      }
      playTrack(track, [track]);
      showToast(
        settingsRef.current.autoContinueRadio
          ? `Memulai radio dari “${track.title}”`
          : "Autoplay nonaktif. Hanya lagu pilihan yang diputar."
      );
    },
    [playTrack, showToast]
  );

  const refreshUpNext = useCallback(
    async (mode?: UpNextMode) => {
      const seed = getCurrentTrack(queueState);
      if (!seed || !settingsRef.current.autoContinueRadio) return;
      const ticket = recommendationGate.next();
      const targetMode = mode ?? upNextModeRef.current;
      setUpNextRefreshing(true);
      try {
        const candidates = await buildUpNextCandidates(seed, targetMode);
        if (
          recommendationGate.valid(ticket) &&
          settingsRef.current.autoContinueRadio &&
          candidates.length > 0
        ) {
          setQueueState((prev) =>
            getCurrentTrack(prev)?.videoId === seed.videoId
              ? replaceUpcomingQueue(prev, candidates, settingsRef.current, 20)
              : prev
          );
        }
        if (recommendationGate.valid(ticket) && !candidates.length)
          showToast(
            "Belum ada kandidat baru yang sesuai. Coba lagi nanti atau ubah filter."
          );
      } catch {
        if (recommendationGate.valid(ticket))
          showToast("Rekomendasi belum dapat dimuat. Coba lagi.");
      } finally {
        if (recommendationGate.valid(ticket)) setUpNextRefreshing(false);
      }
    },
    [buildUpNextCandidates, queueState, recommendationGate, showToast]
  );

  const preferenceRefreshKey = personalization.state.events
    .filter((e) =>
      [
        "listen",
        "complete",
        "replay",
        "like",
        "playlist",
        "not_interested",
        "block_artist",
        "import",
      ].includes(e.kind)
    )
    .map((e) => e.id)
    .join("|");
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!settingsRef.current.autoContinueRadio || navigator.onLine === false)
        return;
      // Explicit safety choices may remove even the pinned automatic next.
      setQueueState((prev) => {
        const safe = new Set(
          safeTracks(
            prev.queue,
            tasteStore.state,
            settingsRef.current.hideVideoSongs
          ).map(trackKey)
        );
        const auto = new Set(prev.automaticIds || []);
        const queue = prev.queue.filter(
          (t, i) =>
            i <= prev.currentIndex ||
            !auto.has(trackKey(t)) ||
            safe.has(trackKey(t))
        );
        const ids = new Set(queue.map(trackKey));
        return {
          ...prev,
          queue,
          originalQueue: prev.originalQueue.filter((t) => ids.has(trackKey(t))),
          automaticIds: (prev.automaticIds || []).filter((id) => ids.has(id)),
        };
      });
      const seed = getCurrentTrack(queueStateRef.current);
      if (!seed) return;
      const ticket = recommendationGate.next();
      void buildUpNextCandidates(seed, upNextModeRef.current).then(
        (candidates) => {
          if (
            !recommendationGate.valid(ticket) ||
            !settingsRef.current.autoContinueRadio
          )
            return;
          setQueueState((prev) =>
            getCurrentTrack(prev)?.videoId === seed.videoId
              ? graduallyRefreshAutomaticQueue(
                  prev,
                  candidates,
                  settingsRef.current,
                  4
                )
              : prev
          );
        }
      );
    }, 8000);
    return () => clearTimeout(timer);
  }, [
    preferenceRefreshKey,
    tasteStore,
    buildUpNextCandidates,
    recommendationGate,
  ]);

  const setUpNextMode = useCallback(
    (mode: UpNextMode) => {
      upNextModeRef.current = mode;
      setUpNextModeState(mode);
      void refreshUpNext(mode);
    },
    [refreshUpNext]
  );

  const setSleepTimer = useCallback(
    (minutes: number | null) => {
      setSleepTimerMinutes(minutes);
      if (minutes === null) {
        sleepDeadlineRef.current = null;
        if (!sleepEndOfTrackRef.current) {
          showToast("Sleep timer cancelled");
        }
      } else {
        sleepEndOfTrackRef.current = false;
        setSleepTimerEndOfTrackState(false);
        sleepDeadlineRef.current = Date.now() + minutes * 60_000;
        showToast(`Sleep timer set for ${minutes} min`);
      }
    },
    [showToast]
  );

  const setSleepTimerEndOfTrack = useCallback(
    (enabled: boolean) => {
      sleepEndOfTrackRef.current = enabled;
      setSleepTimerEndOfTrackState(enabled);
      if (enabled) {
        setSleepTimerMinutes(null);
        sleepDeadlineRef.current = null;
        showToast("Will pause at end of current track");
      } else {
        showToast("End-of-track sleep timer cancelled");
      }
    },
    [showToast]
  );

  const isLiked = useCallback(
    (videoId: string) =>
      libraryOwner === userId && likedTracks.some((t) => t.videoId === videoId),
    [likedTracks, libraryOwner, userId]
  );

  const toggleLike = useCallback(
    async (track: Track) => {
      if (
        !requireAuth(
          "Login dulu yuk biar lagu ini tersimpan di Liked Songs kamu."
        ) ||
        !userId ||
        libraryOwner !== userId ||
        libraryBusyRef.current
      )
        return;
      const exists = likedTracks.some((t) => t.videoId === track.videoId);
      libraryBusyRef.current = true;
      libraryRequestRef.current++;
      setLibraryLoading(false);
      setLibrarySaving(true);
      try {
        if (!navigator.onLine)
          throw new Error("Offline. Lagu disukai belum tersimpan.");
        await setOwnLikedTrackInCloud(userId, track, !exists);
        if (userIdRef.current !== userId) return;
        setLikedTracks((previous) =>
          exists
            ? previous.filter((t) => t.videoId !== track.videoId)
            : [track, ...previous]
        );
        if (!exists) tasteStore.record(track, "like");
        showToast(
          exists ? "Dihapus dari Lagu Disukai" : "Tersimpan di Lagu Disukai"
        );
      } catch (error) {
        if (userIdRef.current === userId)
          setLibraryError(
            error instanceof Error
              ? error.message
              : "Gagal menyimpan lagu disukai."
          );
      } finally {
        libraryBusyRef.current = false;
        setLibrarySaving(false);
        if (userIdRef.current !== userId)
          window.dispatchEvent(new Event("focus"));
      }
    },
    [requireAuth, userId, libraryOwner, likedTracks, showToast, tasteStore]
  );

  const persistPlaylist = useCallback(
    async (playlist: UserPlaylist): Promise<UserPlaylist | null> => {
      if (
        !requireAuth() ||
        !userId ||
        libraryOwner !== userId ||
        userIdRef.current !== userId
      )
        return null;
      if (libraryBusyRef.current) {
        showToast("Tunggu penyimpanan sebelumnya selesai.");
        return null;
      }
      libraryBusyRef.current = true;
      libraryRequestRef.current++;
      setLibraryLoading(false);
      setLibrarySaving(true);
      setLibraryError(null);
      try {
        if (!navigator.onLine)
          throw new Error("Offline. Perubahan belum disimpan.");
        const saved = await upsertOwnPlaylistToCloud(userId, playlist);
        if (userIdRef.current !== userId) return null;
        setPlaylists((prev) => [
          saved,
          ...prev.filter((p) => p.id !== saved.id),
        ]);
        const before = playlistsRef.current.find((p) => p.id === saved.id);
        if (
          before?.isPublic !== saved.isPublic ||
          before?.coverUrl !== saved.coverUrl
        )
          window.dispatchEvent(new Event("easvarafy:privacy"));
        for (const track of saved.tracks)
          if (!before?.tracks.some((t) => t.videoId === track.videoId))
            tasteStore.record(track, "playlist");
        showToast("Playlist tersimpan");
        return saved;
      } catch (error) {
        if (userIdRef.current === userId) {
          setLibraryError(
            error instanceof Error ? error.message : "Playlist belum tersimpan."
          );
          showToast("Gagal menyimpan playlist. Muat ulang lalu coba lagi.");
        }
        return null;
      } finally {
        libraryBusyRef.current = false;
        setLibrarySaving(false);
        if (userIdRef.current !== userId)
          window.dispatchEvent(new Event("focus"));
      }
    },
    [libraryOwner, requireAuth, showToast, userId, tasteStore]
  );
  const createPlaylist = useCallback(
    async (name: string, description = "", initialTracks: Track[] = []) => {
      const now = Date.now();
      return persistPlaylist({
        id: crypto.randomUUID(),
        name: name.trim() || "Playlist baru",
        description,
        tracks: initialTracks,
        createdAt: now,
        updatedAt: now,
        isPublic: false,
      });
    },
    [persistPlaylist]
  );
  const editPlaylist = useCallback(
    (id: string, patch: Partial<UserPlaylist>) => {
      const playlist = playlists.find((p) => p.id === id);
      return playlist
        ? persistPlaylist({ ...playlist, ...patch, id: playlist.id })
        : Promise.resolve(null);
    },
    [persistPlaylist, playlists]
  );
  const renamePlaylist = useCallback(
    (id: string, name: string) => editPlaylist(id, { name }),
    [editPlaylist]
  );
  const updatePlaylistTags = useCallback(
    (id: string, tags: string[]) =>
      editPlaylist(id, {
        tags: [...new Set(tags.map((t) => t.trim()).filter(Boolean))].slice(
          0,
          8
        ),
      }),
    [editPlaylist]
  );
  const deletePlaylist = useCallback(
    async (id: string) => {
      if (!userId || libraryOwner !== userId || libraryBusyRef.current) return;
      libraryBusyRef.current = true;
      libraryRequestRef.current++;
      setLibraryLoading(false);
      setLibrarySaving(true);
      try {
        if (!navigator.onLine)
          throw new Error("Offline. Playlist belum dihapus.");
        await deleteOwnPlaylistFromCloud(userId, id);
        if (userIdRef.current !== userId) return;
        setPlaylists((prev) => prev.filter((p) => p.id !== id));
        setDetailTarget(null);
        showToast("Playlist dihapus");
      } catch (error) {
        if (userIdRef.current === userId)
          setLibraryError(
            error instanceof Error ? error.message : "Gagal menghapus playlist."
          );
      } finally {
        libraryBusyRef.current = false;
        setLibrarySaving(false);
        if (userIdRef.current !== userId)
          window.dispatchEvent(new Event("focus"));
      }
    },
    [libraryOwner, showToast, userId]
  );
  const addTrackToPlaylist = useCallback(
    (id: string, track: Track) => {
      const p = playlists.find((p) => p.id === id);
      if (p && !p.tracks.some((t) => t.videoId === track.videoId))
        editPlaylist(id, { tracks: [...p.tracks, track] });
    },
    [editPlaylist, playlists]
  );
  const removeTrackFromPlaylist = useCallback(
    (id: string, videoId: string) => {
      const p = playlists.find((p) => p.id === id);
      if (p)
        editPlaylist(id, {
          tracks: p.tracks.filter((t) => t.videoId !== videoId),
        });
    },
    [editPlaylist, playlists]
  );

  const isSavedInCollection = useCallback(
    (kind: SavedCollectionItem["kind"], id: string) =>
      savedCollection.some((item) => item.kind === kind && item.id === id),
    [savedCollection]
  );

  const toggleSaveCollection = useCallback(
    (item: Omit<SavedCollectionItem, "savedAt">) => {
      if (
        !requireAuth("Login dulu yuk buat simpan album & playlist ke Library.")
      )
        return;
      setSavedCollection((prev) => {
        const exists = prev.some(
          (i) => i.kind === item.kind && i.id === item.id
        );
        const next = exists
          ? prev.filter((i) => !(i.kind === item.kind && i.id === item.id))
          : [{ ...item, savedAt: Date.now() }, ...prev];
        saveCollection(next, userIdRef.current);
        showToast(exists ? "Removed from Library" : "Saved to Library");
        return next;
      });
    },
    [requireAuth, showToast]
  );

  const addSearchHistory = useCallback((query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearchHistory((prev) => {
      const next = [
        trimmed,
        ...prev.filter((q) => q.toLowerCase() !== trimmed.toLowerCase()),
      ].slice(0, 15);
      saveSearchHistory(next);
      return next;
    });
  }, []);

  const removeSearchHistoryItem = useCallback((query: string) => {
    const target = query.trim().toLowerCase();
    setSearchHistory((prev) => {
      const next = prev.filter((q) => q.trim().toLowerCase() !== target);
      saveSearchHistory(next);
      return next;
    });
  }, []);

  const clearSearchHistory = useCallback(() => {
    setSearchHistory([]);
    saveSearchHistory([]);
    showToast("History pencarian dihapus");
  }, [showToast]);

  const clearPlayHistory = useCallback(() => {
    setHistory([]);
    saveHistory([], userIdRef.current);
    showToast("Listening history cleared");
  }, [showToast]);

  const updateSettings = useCallback(
    (patch: Partial<PlayerSettings>) => {
      if (patch.autoContinueRadio === false) {
        recommendationGate.cancel();
        setQueueState(removeAutomaticUpcoming);
        setUpNextRefreshing(false);
      }
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        saveSettings(next);
        if (patch.playbackRate) {
          localPlayer.setPlaybackRate(patch.playbackRate);
          if (ytReadyRef.current && ytPlayerRef.current) {
            try {
              ytPlayerRef.current.setPlaybackRate(patch.playbackRate);
            } catch {
              // ignore
            }
          }
        }
        return next;
      });
    },
    [localPlayer, recommendationGate]
  );

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    saveSettings(DEFAULT_SETTINGS);
    localPlayer.setPlaybackRate(DEFAULT_SETTINGS.playbackRate);
    if (ytReadyRef.current && ytPlayerRef.current) {
      try {
        ytPlayerRef.current.setPlaybackRate(DEFAULT_SETTINGS.playbackRate);
      } catch {
        // ignore
      }
    }
    showToast("Preferences reset to Easvarafy defaults");
  }, [showToast, localPlayer]);

  const exportLibraryBackup = useCallback(() => {
    const payload = {
      app: "Easvarafy",
      version: 1,
      exportedAt: new Date().toISOString(),
      history,
      likedTracks,
      playlists,
      savedCollection,
      searchHistory,
      settings,
    };
    return JSON.stringify(payload, null, 2);
  }, [
    history,
    likedTracks,
    playlists,
    savedCollection,
    searchHistory,
    settings,
  ]);

  const importLibraryBackup = useCallback(
    async (rawJson: string): Promise<{ ok: boolean; message: string }> => {
      let savedCount = 0;
      try {
        const parsed = JSON.parse(rawJson) as Record<string, unknown>;
        if (!parsed || typeof parsed !== "object") {
          return { ok: false, message: "Invalid backup JSON file" };
        }
        if (
          (Array.isArray(parsed.playlists) && parsed.playlists.length) ||
          (Array.isArray(parsed.likedTracks) && parsed.likedTracks.length)
        ) {
          if (!requireAuth() || !userId || libraryOwner !== userId)
            return {
              ok: false,
              message: "Masuk dan sinkronkan library dahulu.",
            };
          if (Array.isArray(parsed.playlists))
            for (const value of parsed.playlists) {
              const playlist = value as UserPlaylist;
              const saved = await persistPlaylist({
                ...playlist,
                id: crypto.randomUUID(),
                version: 0,
                isPublic: false,
              });
              if (!saved)
                return {
                  ok: false,
                  message: `Impor terhenti. ${savedCount} playlist sudah tersimpan; sisanya belum diimpor.`,
                };
              savedCount++;
            }
          if (Array.isArray(parsed.likedTracks))
            await syncOwnAllLikedTracksToCloud(
              userId,
              parsed.likedTracks as Track[]
            );
          if (userIdRef.current !== userId)
            return { ok: false, message: "Akun berubah. Impor dihentikan." };
          await reloadLibrary();
        }
        let importedCount = savedCount;

        if (Array.isArray(parsed.history)) {
          const validHistory = parsed.history as PlayEvent[];
          setHistory(validHistory);
          saveHistory(validHistory, userIdRef.current);
          importedCount += validHistory.length;
        }
        if (Array.isArray(parsed.savedCollection)) {
          const validSaved = parsed.savedCollection as SavedCollectionItem[];
          setSavedCollection(validSaved);
          saveCollection(validSaved, userIdRef.current);
        }
        if (Array.isArray(parsed.searchHistory)) {
          const validSearch = parsed.searchHistory.filter(
            (q): q is string => typeof q === "string"
          );
          setSearchHistory(validSearch);
          saveSearchHistory(validSearch);
        }
        if (parsed.settings && typeof parsed.settings === "object") {
          const merged: PlayerSettings = {
            ...DEFAULT_SETTINGS,
            ...(parsed.settings as Partial<PlayerSettings>),
          };
          setSettings(merged);
          saveSettings(merged);
        }

        const msg =
          importedCount > 0
            ? `Backup restored (${importedCount} items)`
            : "Backup settings restored";
        showToast(msg);
        return { ok: true, message: msg };
      } catch (error) {
        return {
          ok: false,
          message: `Impor gagal (${savedCount} playlist tersimpan): ${
            error instanceof Error ? error.message : "Format tidak valid"
          }`,
        };
      }
    },
    [
      showToast,
      userId,
      libraryOwner,
      persistPlaylist,
      reloadLibrary,
      requireAuth,
    ]
  );

  const value: MusicState = {
    personalization,
    activeTab,
    setActiveTab,
    detailTarget,
    openDetail,
    queueState,
    currentTrack,
    isPlaying,
    isBuffering,
    duration,
    volume,
    isMuted,
    isNowPlayingOpen,
    setIsNowPlayingOpen,
    nowPlayingTab,
    setNowPlayingTab,
    showVideoStage,
    setShowVideoStage,
    sleepTimerMinutes,
    setSleepTimer,
    sleepTimerEndOfTrack,
    setSleepTimerEndOfTrack,
    popupMode,
    setPopupMode,
    openBackgroundPopup,
    closeBackgroundPopup,
    toggleBackgroundPopup,
    resumePlaybackKeepAlive,
    registerPopupHandlers,
    playTrack,
    play,
    pause,
    togglePlayPause,
    nextTrack,
    prevTrack,
    seekTo,
    setVolume,
    toggleMute,
    playNextInQueue,
    addTrackToQueue,
    removeQueueIndex,
    moveQueueItem,
    toggleShuffle,
    cycleRepeat,
    startRadio,
    refreshUpNext,
    upNextMode,
    setUpNextMode,
    upNextRefreshing,
    jumpToQueueIndex,
    lyrics,
    lyricsLoading,
    history: libraryOwner === userId ? history : EMPTY_LIBRARY,
    likedTracks: libraryOwner === userId ? likedTracks : EMPTY_LIBRARY,
    isLiked,
    toggleLike,
    playlists: libraryOwner === userId ? playlists : EMPTY_LIBRARY,
    libraryLoading,
    libraryError,
    librarySaving,
    reloadLibrary,
    editPlaylist,
    createPlaylist,
    renamePlaylist,
    updatePlaylistTags,
    deletePlaylist,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    playlistPickerTrack,
    openPlaylistPicker: setPlaylistPickerTrack,
    savedCollection: libraryOwner === userId ? savedCollection : EMPTY_LIBRARY,
    isSavedInCollection,
    toggleSaveCollection,
    searchHistory,
    addSearchHistory,
    removeSearchHistoryItem,
    clearSearchHistory,
    clearPlayHistory,
    settings,
    updateSettings,
    resetSettings,
    exportLibraryBackup,
    importLibraryBackup,
    toastMessage,
    showToast,
    ytContainerRef,
    attachYouTubeHost,
    playbackSource,
  };

  // Snapshot storage retains ytContainerRef as an opaque object; it never reads
  // .current during render (all player DOM access remains in effects/handlers).
  // eslint-disable-next-line react-hooks/refs
  const [musicStore] = useState(() => createSnapshotStore(value));
  const [progressStore] = useState(() => createSnapshotStore(currentTime));
  useLayoutEffect(() => {
    if (process.env.NODE_ENV === "development") {
      const previous = musicStore.getSnapshot();
      const changed = (Object.keys(value) as Array<keyof MusicState>).filter(
        (key) => !Object.is(previous[key], value[key])
      );
      if (changed.length) {
        performance.clearMarks("easvarafy:music-change");
        performance.mark("easvarafy:music-change", { detail: changed });
      }
    }
    musicStore.publish(value);
    progressStore.publish(currentTime);
  });

  return (
    <MusicContext.Provider value={musicStore}>
      <ProgressContext.Provider value={progressStore}>
        {children}
        {/* Offline engine: plays downloaded songs (local file / blob URL). */}
        <audio
          ref={audioElRef}
          preload="auto"
          playsInline
          aria-hidden="true"
          className="hidden"
          data-testid="offline-audio"
        />
      </ProgressContext.Provider>
    </MusicContext.Provider>
  );
}
