import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ListeningSession,
  cleanTrack,
  compactSignals,
  emptyTaste,
  rankCandidates,
  tasteSeeds,
  safeTracks,
  trackKey,
  type Candidate,
  type TasteSignal,
} from "./engine";
import { CandidateClient, RequestGate } from "./client";
import {
  appendRadioContinuation,
  appendToQueue,
  createQueueState,
  insertPlayNext,
  graduallyRefreshAutomaticQueue,
  playTrackInQueue,
  removeAutomaticUpcoming,
  reorderQueue,
  replaceUpcomingQueue,
} from "@/lib/metrolist/queue";
import type { Track } from "@/lib/metrolist/types";
const track = (id: string, artist = id, title = id): Track => ({
  videoId: id,
  title,
  artist,
  artists: [{ artistId: null, name: artist }],
  duration: 100,
  thumbnail: "",
  type: "SONG",
});
const candidate = (
  t: Track,
  order = 0,
  source: Candidate["source"] = "related"
): Candidate => ({ track: t, source, order });
const signal = (
  t: Track,
  kind: TasteSignal["kind"],
  at = Date.now(),
  origin: TasteSignal["origin"] = "explicit"
): TasteSignal => ({
  id: `${t.videoId}-${kind}-${at}`,
  track: t,
  kind,
  at,
  seconds: 80,
  origin,
});

test("cold guest uses only supplied real catalogue and returns honest empty", () => {
  assert.deepEqual(rankCandidates([], emptyTaste()), []);
  const pool = [
    candidate(track("one"), 0, "catalog"),
    candidate(track("two"), 1, "catalog"),
  ];
  const rows = rankCandidates(pool, emptyTaste());
  assert.equal(rows.length, 2);
  assert.match(rows[0].reason, /katalog YouTube Music/);
  assert.deepEqual(rows, rankCandidates(pool, emptyTaste()));
});
test("provider IDs, incomplete metadata, unavailable, videos and fully filtered candidates", () => {
  assert.equal(trackKey(track("one")), "youtube:one");
  assert.equal(cleanTrack({ videoId: "one" }), null);
  assert.equal(cleanTrack({ ...track("x"), provider: "spotify" }), null);
  assert.equal(cleanTrack({ ...track("x"), available: false }), null);
  const pool = [
    candidate({ ...track("a"), artists: [], duration: null }),
    candidate({ ...track("b"), type: "VIDEO" }),
    candidate({ ...track("c"), available: false }),
  ];
  assert.equal(
    rankCandidates(pool, emptyTaste(), { hideVideoSongs: true }).length,
    1
  );
  assert.deepEqual(
    rankCandidates(pool, emptyTaste(), {
      exclude: [track("a"), track("b")],
      hideVideoSongs: true,
    }),
    []
  );
});
test("completion/replay/like raise affinity; explicit skip lowers, automatic evidence weaker", () => {
  const a = track("a", "Artist A"),
    b = track("b", "Artist B");
  const pool = [candidate(a), candidate(b)];
  const taste = {
    ...emptyTaste(),
    events: [
      signal(track("older", "Artist B"), "complete", Date.now() - 7200000),
      signal(track("older", "Artist B"), "replay", Date.now() - 7100000),
      signal(track("older", "Artist B"), "like", Date.now() - 7000000),
    ],
  };
  assert.equal(rankCandidates(pool, taste)[0].track.videoId, "b");
  const negative = { ...emptyTaste(), events: [signal(a, "skip")] };
  assert.equal(rankCandidates(pool, negative)[0].track.videoId, "b");
  const explicit = rankCandidates([candidate(b)], {
    ...emptyTaste(),
    events: [signal(track("older", "Artist B"), "like")],
  })[0].score;
  const auto = rankCandidates([candidate(b)], {
    ...emptyTaste(),
    events: [signal(track("older", "Artist B"), "like", Date.now(), "auto")],
  })[0].score;
  assert.ok(explicit > auto);
});
test("hard track/artist blocks, recent playback and duplicates excluded; live/remix preserved", () => {
  const base = track("a", "A", "Song"),
    copy = { ...track("b", "A", "Song (Official Audio)"), duration: 102 },
    live = track("c", "A", "Song Live"),
    remix = track("d", "A", "Song Remix");
  assert.equal(
    rankCandidates(
      [base, copy, live, remix].map((t) => candidate(t)),
      emptyTaste()
    ).length,
    3
  );
  const taste = {
    ...emptyTaste(),
    events: [
      signal(base, "not_interested"),
      signal(track("x", "B"), "block_artist"),
      signal(track("recent", "C"), "listen"),
    ],
  };
  assert.deepEqual(
    rankCandidates(
      [base, track("other", "B"), track("recent", "C")].map((t) =>
        candidate(t)
      ),
      taste
    ),
    []
  );
  assert.deepEqual(
    safeTracks([base, track("other", "B")], { ...taste, enabled: false }),
    []
  );
});
test("diversification avoids dominance without inventing metadata", () => {
  const pool = Array.from({ length: 20 }, (_, i) =>
    candidate(track(`a${i}`, i < 14 ? "A" : `Artist ${i}`), i)
  );
  const rows = rankCandidates(pool, emptyTaste(), { limit: 8 });
  assert.ok(new Set(rows.map((r) => r.track.artist)).size >= 4);
  assert.ok(rows.every((r) => r.score >= 0 && r.score <= 1));
});
test("verified listening excludes seek, pause, buffering, errors and timer gaps", () => {
  const s = new ListeningSession(track("a"), "explicit", "session");
  s.sample(0, 0, true);
  for (let i = 1; i <= 5; i++) s.sample(i * 1000, i, true);
  assert.equal(s.seconds, 5);
  assert.equal(s.quickSkip(), true);
  s.sample(6000, 80, true);
  assert.equal(s.seconds, 5, "seek gives zero credit");
  s.sample(7000, 81, false);
  s.sample(8000, 82, true);
  assert.equal(s.seconds, 5, "pause transition gives zero credit");
  s.sample(20000, 94, true);
  assert.equal(s.seconds, 5, "background gap gives zero credit");
  s.invalidate();
  s.sample(21000, 0, true);
  for (let i = 1; i <= 96; i++) s.sample(21000 + i * 1000, i, true);
  assert.equal(s.majority(100), true);
  assert.equal(s.majority(null), false);
  assert.equal(s.quickSkip(), false);
});
test("signal history bounded, expires, deduplicates, rejects unknown/prototype kinds", () => {
  const now = Date.now();
  const events = Array.from({ length: 700 }, (_, i) => ({
    ...signal(track(`t${i}`), "select", now - i * 6000),
    id: String(i),
  }));
  assert.equal(compactSignals(events, now, true).length, 300);
  assert.equal(compactSignals(events, now).length, 600);
  assert.deepEqual(
    compactSignals([signal(track("old"), "like", now - 181 * 86400000)]),
    []
  );
  assert.equal(compactSignals([events[0], events[0]]).length, 1);
  assert.deepEqual(compactSignals([{ ...events[0], kind: "toString" }]), []);
});
test("manual and context order survive refresh; automatic immediate next pinned; autoplay off removes generated only", () => {
  let q = playTrackInQueue(createQueueState(), track("album1"), [
    track("album1"),
    track("album2"),
    track("album3"),
  ]);
  q = appendRadioContinuation(q, [track("auto1"), track("auto2")], {
    hideVideoSongs: false,
  });
  q = appendToQueue(q, track("manual"));
  assert.deepEqual(
    q.queue.map((t) => t.videoId),
    ["album1", "album2", "album3", "manual", "auto1", "auto2"]
  );
  q = insertPlayNext(q, track("next"));
  q = replaceUpcomingQueue(q, [track("new")], { hideVideoSongs: false });
  assert.deepEqual(
    q.queue.map((t) => t.videoId),
    ["album1", "next", "album2", "album3", "manual", "new"]
  );
  assert.deepEqual(
    removeAutomaticUpcoming(q).queue.map((t) => t.videoId),
    ["album1", "next", "album2", "album3", "manual"]
  );
  const single = appendRadioContinuation(
    playTrackInQueue(createQueueState(), track("single")),
    [track("pinned"), track("replace")],
    { hideVideoSongs: false }
  );
  assert.deepEqual(
    replaceUpcomingQueue(single, [track("fresh")], {
      hideVideoSongs: false,
    }).queue.map((t) => t.videoId),
    ["single", "pinned", "fresh"]
  );
});
test("manual promotion and drag protect formerly generated entries", () => {
  let q = appendRadioContinuation(
    playTrackInQueue(createQueueState(), track("single")),
    [track("a"), track("b")],
    { hideVideoSongs: false }
  );
  q = appendToQueue(q, track("b"));
  assert.ok(!q.automaticIds?.includes("youtube:b"));
  q = reorderQueue(q, 2, 1);
  assert.ok(!q.automaticIds?.includes("youtube:a"));
  assert.equal(removeAutomaticUpcoming(q).queue.length, 3);
});
test("rapid switches and out-of-order work cannot pass a request gate", () => {
  const gate = new RequestGate(),
    a = gate.next(),
    b = gate.next();
  assert.equal(gate.valid(a), false);
  assert.equal(gate.valid(b), true);
  gate.cancel();
  assert.equal(gate.valid(b), false);
});
test("provider failure is honest empty; successful public pools cached/inflight deduped; dispose aborts", async () => {
  let calls = 0;
  const client = new CandidateClient((async () => {
    calls++;
    return new Response(
      JSON.stringify({ candidates: [candidate(track("real"), 0, "catalog")] })
    );
  }) as typeof fetch);
  const [a, b] = await Promise.all([
    client.collect(undefined, "ID"),
    client.collect(undefined, "ID"),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  await client.collect(undefined, "ID");
  assert.equal(calls, 1);
  client.dispose();
  const failed = new CandidateClient((async () => {
    throw new Error("offline");
  }) as typeof fetch);
  assert.deepEqual(await failed.collect(track("seed"), "ID"), {
    candidates: [],
    degraded: true,
  });
  failed.dispose();
});

test("passive updates rotate only distant automatic entries and taste seeds use recent plus longer-term positives", () => {
  let q = appendRadioContinuation(
    playTrackInQueue(createQueueState(), track("seed")),
    Array.from({ length: 10 }, (_, i) => track(`auto${i}`)),
    { hideVideoSongs: false }
  );
  q = graduallyRefreshAutomaticQueue(
    q,
    Array.from({ length: 10 }, (_, i) => track(`fresh${i}`)),
    { hideVideoSongs: false }
  );
  assert.deepEqual(
    q.queue.slice(0, 7).map((t) => t.videoId),
    ["seed", "auto0", "auto1", "auto2", "auto3", "auto4", "auto5"]
  );
  assert.equal(q.queue.filter((t) => t.videoId.startsWith("fresh")).length, 4);
  const recent = track("recent"),
    older = track("older");
  const state = {
    ...emptyTaste(),
    events: [
      signal(older, "like", Date.now() - 40 * 86400000),
      signal(recent, "listen", Date.now()),
    ],
  };
  assert.deepEqual(
    tasteSeeds(state).map((t) => t.videoId),
    ["recent", "older"]
  );
  assert.deepEqual(tasteSeeds({ ...state, enabled: false }), []);
});

test("completion uses unique verified content coverage and supports playback speed without crediting repeated seek fragments", () => {
  const fast = new ListeningSession(track("fast"), "explicit", "fast");
  fast.majority(100);
  fast.sample(0, 0, true, 2);
  for (let i = 1; i <= 45; i++) fast.sample(i * 1000, i * 2, true, 2);
  assert.equal(fast.seconds, 45);
  assert.equal(fast.majority(100), true);
  const loop = new ListeningSession(track("loop"), "explicit", "loop");
  let now = 0;
  for (let repeat = 0; repeat < 10; repeat++) {
    loop.invalidate();
    loop.sample(now, 0, true);
    for (let i = 1; i <= 10; i++) {
      now += 1000;
      loop.sample(now, i, true);
    }
  }
  assert.equal(loop.seconds, 100);
  assert.equal(loop.majority(100), false);
});
