import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSupabaseTasteRemote,
  TasteStore,
  safeRead,
  safeWrite,
  type TasteRemote,
} from "./store";
import { emptyTaste, type TasteSignal, type TasteState } from "./engine";
import type { Track } from "@/lib/metrolist/types";
const track: Track = {
  videoId: "real-track",
  title: "Real track",
  artist: "Artist",
  artists: [],
  duration: 100,
  thumbnail: "",
  type: "SONG",
};
function remote(initial: TasteState = emptyTaste()) {
  let state = initial;
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const transport: TasteRemote = {
    async call(name, args) {
      calls.push({ name, args });
      if (name === "set_recommendation_preferences")
        state = {
          enabled: !!args?.p_enabled,
          epoch: state.epoch + 1,
          events: args?.p_reset ? [] : state.events,
        };
      if (
        name === "ingest_recommendation_signals" &&
        args?.p_epoch === state.epoch &&
        state.enabled
      )
        state = {
          ...state,
          events: [...state.events, ...(args.p_events as TasteSignal[])],
        };
      return structuredClone(state);
    },
  };
  return { transport, calls, get: () => state };
}
test("guest records locally without network; no automatic merge when logging in", async () => {
  const r = remote();
  safeWrite("easvarafy:taste:v1:guest", JSON.stringify(emptyTaste()));
  const guest = new TasteStore(null, r.transport);
  await guest.load();
  guest.record(track, "listen", "explicit", 40);
  assert.equal(r.calls.length, 0);
  assert.equal(guest.state.events.length, 1);
  const account = new TasteStore("guest-consent-owner", r.transport);
  await account.load();
  assert.equal(account.state.events.length, 0);
  assert.equal(account.guestAvailable(), true);
  assert.deepEqual(
    r.calls.map((c) => c.name),
    ["get_recommendation_taste"]
  );
  await account.mergeGuest();
  assert.equal(account.state.events.length, 1);
  assert.equal(account.state.events[0].kind, "import");
  assert.equal(account.state.events[0].seconds, 0);
  assert.equal(account.guestAvailable(), false);
  account.dispose();
  guest.dispose();
});
test("cross-device history loads; batch deduped; disable stops all recording; confirmed reset empties history", async () => {
  const event: TasteSignal = {
    id: "device-2-event",
    track,
    kind: "like",
    origin: "explicit",
    seconds: 0,
    at: Date.now(),
  };
  const r = remote({ ...emptyTaste(), events: [event] });
  const store = new TasteStore("cross-device-owner", r.transport);
  await store.load();
  assert.equal(store.state.events[0].id, event.id);
  store.record(track, "complete", "explicit", 80, "complete-once");
  store.record(track, "complete", "explicit", 80, "complete-once");
  await store.flush();
  assert.equal(r.get().events.length, 2);
  await store.control(false);
  store.record({ ...track, videoId: "other" }, "select");
  assert.equal(store.state.events.length, 2);
  await store.control(false, true);
  assert.deepEqual(store.state.events, []);
  store.dispose();
});
test("logout/account switch ignores late response and never transfers pending data to another owner", async () => {
  let resolve!: (state: TasteState) => void;
  const a = new TasteStore("late-owner-A", {
    call: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  const request = a.load();
  a.dispose();
  const r = remote(),
    b = new TasteStore("isolated-owner-B", r.transport);
  await b.load();
  resolve({
    ...emptyTaste(),
    events: [
      {
        id: "secret",
        track,
        kind: "like",
        origin: "explicit",
        seconds: 0,
        at: Date.now(),
      },
    ],
  });
  await request;
  assert.deepEqual(b.state.events, []);
  assert.deepEqual(a.state.events, []);
  assert.equal(
    r.calls.some((c) => c.name === "ingest_recommendation_signals"),
    false
  );
  b.dispose();
});
test("failed cloud controls never claim successful reset; queued prior epoch cannot revive deleted history", async () => {
  const owner = "epoch-owner";
  safeWrite(
    `easvarafy:taste:v1:${owner}`,
    JSON.stringify({
      ...emptyTaste(),
      events: [],
      pending: [
        {
          id: "old-offline",
          track,
          kind: "like",
          origin: "explicit",
          seconds: 0,
          at: Date.now(),
        },
      ],
    })
  );
  const r = remote({ ...emptyTaste(), epoch: 3 });
  const store = new TasteStore(owner, r.transport);
  await store.load();
  await store.flush();
  assert.deepEqual(store.state.events, []);
  assert.equal(r.calls.length, 1);
  store.dispose();
  const failed = new TasteStore("offline-owner", {
    async call() {
      throw new Error("offline");
    },
  });
  await failed.load();
  failed.record(track, "like");
  await assert.rejects(() => failed.control(false, true), /offline/);
  assert.equal(failed.state.events.length, 1);
  failed.dispose();
});
test("storage unavailable/full uses bounded memory without throwing", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("denied");
    },
  });
  try {
    safeWrite("taste-memory-test", "saved");
    assert.equal(safeRead("taste-memory-test"), "saved");
    const store = new TasteStore(null);
    await store.load();
    store.record(track, "select");
    assert.ok(store.state.events.length <= 300);
    store.dispose();
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("consented merge rejected by a newer reset epoch preserves guest data and reports no success", async () => {
  safeWrite(
    "easvarafy:taste:v1:guest",
    JSON.stringify({
      ...emptyTaste(),
      events: [
        {
          id: "guest-consent-stale",
          track,
          kind: "listen",
          origin: "explicit",
          seconds: 40,
          at: Date.now(),
        },
      ],
    })
  );
  const store = new TasteStore("merge-stale-epoch", {
    async call(name) {
      return name === "get_recommendation_taste"
        ? emptyTaste()
        : { ...emptyTaste(), epoch: 4 };
    },
  });
  await store.load();
  await assert.rejects(() => store.mergeGuest(), /perangkat lain/);
  assert.equal(store.guestAvailable(), true);
  store.dispose();
});

test("RPC transport pins owner token and rejects sending one identity under another session", async () => {
  let user = "A",
    calls = 0,
    header = "";
  const fake = {
    auth: {
      async getSession() {
        const session = { user: { id: user }, access_token: `token-${user}` };
        user = "B";
        return { data: { session }, error: null };
      },
    },
    rpc() {
      calls++;
      return {
        setHeader(name: string, value: string) {
          assert.equal(name, "Authorization");
          header = value;
          return Promise.resolve({ data: emptyTaste(), error: null });
        },
      };
    },
  };
  const getClient = () =>
    fake as unknown as ReturnType<typeof import("@/lib/supabase").getSupabase>;
  const a = createSupabaseTasteRemote("A", getClient);
  await a.call("ingest_recommendation_signals");
  assert.equal(header, "Bearer token-A");
  await assert.rejects(
    () => a.call("ingest_recommendation_signals"),
    /Sesi akun berubah/
  );
  assert.equal(calls, 1);
});
