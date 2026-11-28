import { trackKey } from "@/lib/recommendation/engine";
import { filterTracksByPreferences } from "./recommendations";
import type { PlayerSettings, RepeatMode, Track } from "./types";

export interface QueueState {
  queue: Track[];
  originalQueue: Track[];
  currentIndex: number;
  shuffle: boolean;
  repeat: RepeatMode;
  /** Only these entries may be replaced by recommendation refreshes. */
  automaticIds?: string[];
}

export function createQueueState(): QueueState {
  return {
    queue: [],
    originalQueue: [],
    currentIndex: -1,
    shuffle: false,
    repeat: "off",
  };
}

export function getCurrentTrack(state: QueueState): Track | null {
  if (state.currentIndex < 0 || state.currentIndex >= state.queue.length) {
    return null;
  }
  return state.queue[state.currentIndex];
}

function fisherYatesShuffle<T>(items: T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function playTrackInQueue(
  state: QueueState,
  track: Track,
  contextTracks?: Track[],
  rng: () => number = Math.random
): QueueState {
  const baseList =
    contextTracks && contextTracks.length > 0 ? contextTracks : [track];

  // Ensure the selected track exists in baseList
  const existingIdx = baseList.findIndex((t) => t.videoId === track.videoId);
  const normalizedList =
    existingIdx >= 0 ? [...baseList] : [track, ...baseList];

  if (state.shuffle) {
    const others = normalizedList.filter((t) => t.videoId !== track.videoId);
    const shuffled = [track, ...fisherYatesShuffle(others, rng)];
    return {
      ...state,
      automaticIds: [],
      originalQueue: normalizedList,
      queue: shuffled,
      currentIndex: 0,
    };
  }

  const targetIndex = normalizedList.findIndex(
    (t) => t.videoId === track.videoId
  );
  return {
    ...state,
    automaticIds: [],
    originalQueue: normalizedList,
    queue: normalizedList,
    currentIndex: Math.max(0, targetIndex),
  };
}

export function insertPlayNext(state: QueueState, track: Track): QueueState {
  if (state.queue.length === 0 || state.currentIndex < 0) {
    return playTrackInQueue(state, track, [track]);
  }

  const current = getCurrentTrack(state);
  if (current && current.videoId === track.videoId) {
    return state;
  }

  // Remove any existing occurrence outside current index so we don't duplicate
  const filtered: Track[] = [];
  let newCurrentIndex = state.currentIndex;

  state.queue.forEach((item, idx) => {
    if (item.videoId === track.videoId && idx !== state.currentIndex) {
      if (idx < state.currentIndex) {
        newCurrentIndex -= 1;
      }
      return;
    }
    filtered.push(item);
  });

  const insertAt = Math.min(filtered.length, newCurrentIndex + 1);
  filtered.splice(insertAt, 0, track);

  const originalExists = state.originalQueue.some(
    (t) => t.videoId === track.videoId
  );
  const nextOriginal = originalExists
    ? state.originalQueue
    : [...state.originalQueue, track];

  return {
    ...state,
    automaticIds: (state.automaticIds || []).filter(
      (id) => id !== trackKey(track)
    ),
    queue: filtered,
    originalQueue: nextOriginal,
    currentIndex: newCurrentIndex,
  };
}

export function appendToQueue(state: QueueState, track: Track): QueueState {
  if (state.queue.length === 0 || state.currentIndex < 0) {
    return playTrackInQueue(state, track, [track]);
  }

  const automaticIds = (state.automaticIds || []).filter(
    (id) => id !== trackKey(track)
  );
  const existing = state.queue.findIndex(
    (t) => trackKey(t) === trackKey(track)
  );
  if (existing >= 0 && !(state.automaticIds || []).includes(trackKey(track)))
    return state;
  const queue = state.queue.filter((_, i) => i !== existing);
  const firstAuto = queue.findIndex(
    (t, i) => i > state.currentIndex && automaticIds.includes(trackKey(t))
  );
  queue.splice(firstAuto < 0 ? queue.length : firstAuto, 0, track);
  return {
    ...state,
    queue,
    automaticIds,
    originalQueue:
      existing >= 0 ? state.originalQueue : [...state.originalQueue, track],
  };
}

export function removeFromQueue(state: QueueState, index: number): QueueState {
  if (index < 0 || index >= state.queue.length) return state;

  const removed = state.queue[index];
  const nextQueue = state.queue.filter((_, idx) => idx !== index);
  const nextOriginal = state.originalQueue.filter(
    (t) => t.videoId !== removed.videoId
  );

  if (nextQueue.length === 0) {
    return {
      ...state,
      queue: [],
      originalQueue: [],
      currentIndex: -1,
    };
  }

  let nextIndex = state.currentIndex;
  if (index < state.currentIndex) {
    nextIndex -= 1;
  } else if (index === state.currentIndex) {
    nextIndex = Math.min(state.currentIndex, nextQueue.length - 1);
  }

  return {
    ...state,
    queue: nextQueue,
    originalQueue: nextOriginal,
    currentIndex: nextIndex,
  };
}

export function reorderQueue(
  state: QueueState,
  fromIndex: number,
  toIndex: number
): QueueState {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= state.queue.length ||
    toIndex >= state.queue.length ||
    fromIndex === toIndex
  ) {
    return state;
  }

  const activeTrack = getCurrentTrack(state);
  const nextQueue = [...state.queue];
  const [moved] = nextQueue.splice(fromIndex, 1);
  nextQueue.splice(toIndex, 0, moved);

  const nextIndex = activeTrack
    ? nextQueue.findIndex((t) => t.videoId === activeTrack.videoId)
    : state.currentIndex;

  return {
    ...state,
    queue: nextQueue,
    automaticIds: (state.automaticIds || []).filter(
      (id) => id !== trackKey(moved)
    ),
    currentIndex: nextIndex,
  };
}

/**
 * Metrolist Shuffle Logic:
 * Enabling shuffle keeps the currently playing track pinned at index 0
 * and shuffles the remaining tracks. Disabling restores originalQueue and
 * updates currentIndex to match the playing track.
 */
export function toggleShuffleQueue(
  state: QueueState,
  rng: () => number = Math.random
): QueueState {
  const activeTrack = getCurrentTrack(state);

  if (!state.shuffle) {
    if (!activeTrack) {
      return {
        ...state,
        shuffle: true,
        queue: fisherYatesShuffle(state.queue, rng),
      };
    }
    const others = state.originalQueue.filter(
      (t) => t.videoId !== activeTrack.videoId
    );
    return {
      ...state,
      shuffle: true,
      queue: [activeTrack, ...fisherYatesShuffle(others, rng)],
      currentIndex: 0,
    };
  }

  if (!activeTrack) {
    return {
      ...state,
      shuffle: false,
      queue: [...state.originalQueue],
      currentIndex: state.originalQueue.length > 0 ? 0 : -1,
    };
  }

  const restoredIndex = state.originalQueue.findIndex(
    (t) => t.videoId === activeTrack.videoId
  );

  return {
    ...state,
    shuffle: false,
    queue: [...state.originalQueue],
    currentIndex: restoredIndex >= 0 ? restoredIndex : 0,
  };
}

export function cycleRepeatMode(mode: RepeatMode): RepeatMode {
  if (mode === "off") return "all";
  if (mode === "all") return "one";
  return "off";
}

export function advanceQueue(
  state: QueueState,
  direction: "next" | "prev",
  options?: { manual?: boolean }
): { state: QueueState; track: Track | null; ended: boolean } {
  if (state.queue.length === 0 || state.currentIndex < 0) {
    return { state, track: null, ended: true };
  }

  if (direction === "next") {
    if (state.repeat === "one" && !options?.manual) {
      return {
        state,
        track: state.queue[state.currentIndex],
        ended: false,
      };
    }

    if (state.currentIndex + 1 < state.queue.length) {
      const nextIndex = state.currentIndex + 1;
      return {
        state: { ...state, currentIndex: nextIndex },
        track: state.queue[nextIndex],
        ended: false,
      };
    }

    if (state.repeat === "all") {
      return {
        state: { ...state, currentIndex: 0 },
        track: state.queue[0],
        ended: false,
      };
    }

    return { state, track: null, ended: true };
  }

  // Previous
  if (state.currentIndex - 1 >= 0) {
    const prevIndex = state.currentIndex - 1;
    return {
      state: { ...state, currentIndex: prevIndex },
      track: state.queue[prevIndex],
      ended: false,
    };
  }

  if (state.repeat === "all") {
    const lastIndex = state.queue.length - 1;
    return {
      state: { ...state, currentIndex: lastIndex },
      track: state.queue[lastIndex],
      ended: false,
    };
  }

  return {
    state: { ...state, currentIndex: 0 },
    track: state.queue[0],
    ended: false,
  };
}

/**
 * Appends YouTube Music Up-Next radio continuation tracks while respecting
 * hideVideoSongs and deduplicating against tracks already in the queue.
 */
export function appendRadioContinuation(
  state: QueueState,
  candidates: Track[],
  settings: Pick<PlayerSettings, "hideVideoSongs">,
  limit = 15
): QueueState {
  const existingIds = new Set(state.queue.map((t) => t.videoId));
  const filtered = filterTracksByPreferences(candidates, settings)
    .filter((t) => !existingIds.has(t.videoId))
    .slice(0, limit);

  if (filtered.length === 0) return state;

  return {
    ...state,
    automaticIds: [...(state.automaticIds || []), ...filtered.map(trackKey)],
    queue: [...state.queue, ...filtered],
    originalQueue: [...state.originalQueue, ...filtered],
  };
}

/**
 * Replaces only the upcoming tracks after `currentIndex`, keeping the currently
 * playing track uninterrupted while refreshing the Up Next list.
 */
export function replaceUpcomingQueue(
  state: QueueState,
  candidates: Track[],
  settings: Pick<PlayerSettings, "hideVideoSongs">,
  limit = 20
): QueueState {
  if (state.queue.length === 0 || state.currentIndex < 0) {
    return appendRadioContinuation(state, candidates, settings, limit);
  }

  // Pin the immediate next entry and every explicit/context entry. Legacy
  // persisted queues have no automaticIds and are therefore protected.
  const auto = new Set(state.automaticIds || []);
  const kept = state.queue.filter(
    (t, i) => i <= state.currentIndex + 1 || !auto.has(trackKey(t))
  );
  const keptIds = new Set(kept.map((t) => t.videoId));
  const upcoming = filterTracksByPreferences(candidates, settings)
    .filter((t) => !keptIds.has(t.videoId))
    .slice(0, limit);

  const nextQueue = [...kept, ...upcoming];
  const keptOriginal = state.originalQueue.filter((t) =>
    keptIds.has(t.videoId)
  );
  const originalIds = new Set(keptOriginal.map((t) => t.videoId));
  const extraOriginal = upcoming.filter((t) => !originalIds.has(t.videoId));

  return {
    ...state,
    queue: nextQueue,
    automaticIds: [
      ...kept.filter((t) => auto.has(trackKey(t))).map(trackKey),
      ...upcoming.map(trackKey),
    ],
    originalQueue: [...keptOriginal, ...extraOriginal],
  };
}

/** Turning autoplay off removes only future generated entries. */
export function removeAutomaticUpcoming(state: QueueState): QueueState {
  const automatic = new Set(state.automaticIds || []);
  const queue = state.queue.filter(
    (t, i) => i <= state.currentIndex || !automatic.has(trackKey(t))
  );
  const kept = new Set(queue.map(trackKey));
  return {
    ...state,
    queue,
    originalQueue: state.originalQueue.filter((t) => kept.has(trackKey(t))),
    automaticIds: (state.automaticIds || []).filter((id) => kept.has(id)),
  };
}

/** Passive taste updates rotate at most four distant automatic entries.
 * Manual refresh can still explicitly replace the automatic tail. */
export function graduallyRefreshAutomaticQueue(
  state: QueueState,
  candidates: Track[],
  settings: Pick<PlayerSettings, "hideVideoSongs">,
  changes = 4
): QueueState {
  const automatic = new Set(state.automaticIds || []);
  const existing = new Set(state.queue.map(trackKey));
  const fresh = filterTracksByPreferences(candidates, settings).filter(
    (t) => !existing.has(trackKey(t))
  );
  if (!fresh.length) return state;
  const distant = state.queue.filter(
    (t, i) => i > state.currentIndex + 1 && automatic.has(trackKey(t))
  );
  if (!distant.length)
    return appendRadioContinuation(state, fresh, settings, changes);
  const removed = new Set(
    distant.slice(-Math.min(changes, fresh.length)).map(trackKey)
  );
  const kept = {
    ...state,
    queue: state.queue.filter((t) => !removed.has(trackKey(t))),
    originalQueue: state.originalQueue.filter((t) => !removed.has(trackKey(t))),
    automaticIds: (state.automaticIds || []).filter((id) => !removed.has(id)),
  };
  return appendRadioContinuation(kept, fresh, settings, changes);
}
