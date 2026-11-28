export interface SnapshotStore<T> {
  getSnapshot: () => T;
  getServerSnapshot: () => T;
  subscribe: (listener: () => void) => () => void;
  publish: (next: T) => void;
}

/** Stable external-store snapshots. Equal fields never fan out to consumers. */
export function createSnapshotStore<T>(initial: T): SnapshotStore<T> {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    publish: (next) => {
      if (Object.is(snapshot, next)) return;
      if (snapshot && next && typeof snapshot === 'object' && typeof next === 'object') {
        const keys = Object.keys(next) as Array<keyof T>;
        if (keys.length === Object.keys(snapshot).length && keys.every(key => Object.is(snapshot[key], next[key]))) return;
      }
      snapshot = next;
      listeners.forEach(listener => listener());
    },
  };
}
