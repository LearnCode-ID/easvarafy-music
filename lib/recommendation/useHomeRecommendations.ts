"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Track } from "@/lib/metrolist/types";
import type { Personalization } from "./usePersonalization";
import {
  rankCandidates,
  tasteSeeds,
  trackKey,
  type Candidate,
  type Recommendation,
} from "./engine";

export function useHomeRecommendations(
  personalization: Personalization,
  region: string,
  cookie: string,
  hideVideoSongs: boolean,
  queue: Track[],
  current: Track | null,
  reserved: Track[] = []
) {
  const { store, client, revision, ready } = personalization;
  // Rebuild after three meaningful listens, or immediately after an explicit
  // preference/block. Mere playback ticks/selects never reshuffle Home.
  const meaningful = store.state.events.filter((e) =>
    ["listen", "complete", "replay"].includes(e.kind)
  ).length;
  const explicit = store.state.events
    .filter((e) =>
      ["like", "playlist", "not_interested", "block_artist", "import"].includes(
        e.kind
      )
    )
    .map((e) => e.id)
    .join("|");
  const tasteKey = `${store.state.enabled}:${store.state.epoch}:${Math.floor(
    meaningful / 3
  )}:${explicit}`;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    owner: typeof store;
    key: string;
    rows: Recommendation[];
    because: Recommendation[];
    seed?: Track;
    loading: boolean;
    error: boolean;
  } | null>(null);
  const reservedRef = useRef(reserved);
  useEffect(() => {
    reservedRef.current = reserved;
  }, [reserved]);
  const queueRef = useRef(queue);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);
  const scope = `${region}:${hideVideoSongs}:${cookie}:${tasteKey}:${attempt}`;
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const timer = setTimeout(
      () => {
        void (async () => {
          const unique = tasteSeeds(store.state, [], 2);
          const seed = unique[0];
          setResult({
            owner: store,
            key: scope,
            rows: [],
            because: [],
            seed,
            loading: true,
            error: false,
          });
          const responses = await Promise.all([
            client.collect(seed, region, cookie),
            ...(unique[1] ? [client.collect(unique[1], region, cookie)] : []),
            ...(seed ? [client.collect(undefined, region, cookie)] : []),
          ]);
          if (cancelled) return;
          const pool = responses.flatMap((r) => r.candidates);
          // The queue is an exclusion, not the source of a copied Home feed.
          const excluded = [
            ...reservedRef.current,
            ...queueRef.current,
            ...(currentRef.current ? [currentRef.current] : []),
          ];
          const relatedPool = seed
            ? pool.filter(
                (c) =>
                  c.source === "related" &&
                  c.seed &&
                  trackKey(c.seed) === trackKey(seed)
              )
            : [];
          const because = rankCandidates(relatedPool, store.state, {
            seed,
            exclude: excluded,
            hideVideoSongs,
            surface: "home",
            limit: 6,
          });
          const rows = rankCandidates(pool, store.state, {
            exclude: [...excluded, ...because.map((r) => r.track)],
            hideVideoSongs,
            surface: "home",
            limit: 24,
          });
          setResult({
            owner: store,
            key: scope,
            rows,
            because,
            seed,
            loading: false,
            error: responses.some((r) => r.degraded),
          });
        })();
      },
      attempt ? 0 : 500
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [store, client, scope, ready, region, cookie, hideVideoSongs, attempt]);
  // Immediately filter blocks even during debounce/network requests, without
  // reranking old sections or allowing duplicates between them.
  const valid = result?.owner === store && result.key === scope ? result : null;
  const filter = useCallback(
    (rows: Recommendation[]) => {
      void revision;
      const pool: Candidate[] = rows.map((r, order) => ({
        track: r.track,
        source: r.source,
        order,
      }));
      const allowed = new Set(
        rankCandidates(pool, store.state, {
          exclude: current ? [current] : [],
          hideVideoSongs,
          limit: 100,
        }).map((r) => trackKey(r.track))
      );
      return rows.filter((r) => allowed.has(trackKey(r.track)));
    },
    [store, revision, hideVideoSongs, current]
  );
  return useMemo(
    () => ({
      rows: filter(valid?.rows || []),
      because: filter(valid?.because || []),
      seed: valid?.seed,
      loading: !ready || !valid || valid.loading,
      error: valid?.error || false,
      retry: () => setAttempt((n) => n + 1),
      personal:
        store.state.enabled &&
        store.state.events.some((e) =>
          ["listen", "complete", "like", "playlist", "import"].includes(e.kind)
        ),
      seedWasListened:
        !!valid?.seed &&
        store.state.events.some(
          (e) =>
            e.kind === "listen" && trackKey(e.track) === trackKey(valid.seed!)
        ),
    }),
    [valid, ready, filter, store]
  );
}
