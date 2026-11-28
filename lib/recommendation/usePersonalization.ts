"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { TasteStore } from "./store";
import { CandidateClient } from "./client";

export function usePersonalization(owner: string | null) {
  const store = useMemo(() => new TasteStore(owner), [owner]);
  const client = useMemo(() => {
    void store;
    return new CandidateClient();
  }, [store]);
  const revision = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    () => 0
  );
  useEffect(() => {
    void store.load();
    const flush = () => {
      void store.flush();
    };
    const reload = () => {
      void store.load();
    };
    let lastRefresh = Date.now();
    const refreshVisible = () => {
      if (store.owner && !document.hidden && Date.now() - lastRefresh > 60000) {
        lastRefresh = Date.now();
        reload();
      }
    };
    const timer = setInterval(refreshVisible, 120000);
    window.addEventListener("focus", refreshVisible);
    window.addEventListener("online", reload);
    window.addEventListener("pagehide", flush);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      window.removeEventListener("online", reload);
      window.removeEventListener("pagehide", flush);
      store.dispose();
      client.dispose();
    };
  }, [store, client]);
  return useMemo(
    () => ({
      store,
      client,
      revision,
      state: store.state,
      ready: store.ready,
      error: store.error,
    }),
    [store, client, revision]
  );
}
export type Personalization = ReturnType<typeof usePersonalization>;
