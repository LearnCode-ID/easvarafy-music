import { getSupabase } from "@/lib/supabase";
import {
  cleanTrack,
  compactSignals,
  emptyTaste,
  RECOMMENDATION_CONFIG as C,
  type SignalKind,
  type TasteSignal,
  type TasteState,
} from "./engine";
import type { Track } from "@/lib/metrolist/types";

const PREFIX = "easvarafy:taste:v1:";
const memory = new Map<string, string>();
export function safeRead(key: string): string | null {
  try {
    return memory.get(key) ?? localStorage.getItem(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}
export function safeWrite(key: string, value: string) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    /* bounded memory fallback; never imply cloud persistence */
  }
}
export const newSignalId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export interface TasteRemote {
  call(name: string, args?: Record<string, unknown>): Promise<TasteState>;
}
export function createSupabaseTasteRemote(
  owner: string | null,
  getClient = getSupabase
): TasteRemote {
  return {
    async call(name, args) {
      const client = getClient();
      const {
        data: { session },
        error: authError,
      } = await client.auth.getSession();
      if (authError || !owner || !session || session.user.id !== owner)
        throw new Error(
          "Sesi akun berubah. Muat ulang preferensi akun yang aktif."
        );
      // Pin this request to the verified session snapshot. The shared client's
      // default token may change during account switching; never send A's batch
      // under B's token. The server still verifies JWT and derives auth.uid().
      const { data, error } = await client
        .rpc(name, args)
        .setHeader("Authorization", `Bearer ${session.access_token}`);
      if (error) throw error;
      return data as TasteState;
    },
  };
}

/** One instance per identity. A response can only mutate its own instance; a
 * logout never flushes guest data into an authenticated account. */
export class TasteStore {
  state: TasteState = emptyTaste();
  ready = false;
  error: string | null = null;
  revision = 0;
  private pending: TasteSignal[] = [];
  private listeners = new Set<() => void>();
  private active = true;
  private busy = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private loadRequest = 0;
  readonly key: string;
  private remote: TasteRemote;
  constructor(readonly owner: string | null, remote?: TasteRemote) {
    this.key = PREFIX + (owner || "guest");
    this.remote = remote ?? createSupabaseTasteRemote(owner);
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.revision;
  private publish() {
    if (!this.active) return;
    this.revision++;
    for (const l of this.listeners) l();
  }
  private persist() {
    safeWrite(
      this.key,
      JSON.stringify({
        ...this.state,
        events: compactSignals(this.state.events, Date.now(), !this.owner),
        pending: this.pending,
      })
    );
  }
  async load() {
    this.active = true;
    try {
      const raw = JSON.parse(safeRead(this.key) || "null");
      if (raw) {
        this.state = {
          enabled: raw.enabled !== false,
          epoch: Number(raw.epoch) || 0,
          events: compactSignals(raw.events, Date.now(), !this.owner),
        };
        this.pending = this.owner
          ? compactSignals(raw.pending).slice(-C.accountLimit)
          : [];
      }
    } catch {
      /* corrupt local cache */
    }
    if (!this.owner) {
      if (!safeRead(PREFIX + "guest-id"))
        safeWrite(PREFIX + "guest-id", newSignalId());
      this.ready = true;
      this.persist();
      this.publish();
      return;
    }
    const generation = this.generation;
    const request = ++this.loadRequest;
    try {
      const cloud = await this.remote.call("get_recommendation_taste");
      if (
        !this.active ||
        generation !== this.generation ||
        request !== this.loadRequest
      )
        return;
      // A server reset invalidates queued events from another device.
      if (cloud.epoch !== this.state.epoch) this.pending = [];
      this.state = {
        enabled: cloud.enabled,
        epoch: cloud.epoch,
        events: compactSignals([...cloud.events, ...this.pending]),
      };
      if (!cloud.enabled) this.pending = [];
      this.error = null;
      this.ready = true;
      this.persist();
      this.publish();
      this.schedule();
    } catch {
      if (
        this.active &&
        generation === this.generation &&
        request === this.loadRequest
      ) {
        this.error = "Preferensi cloud belum tersambung. Coba lagi.";
        this.ready = true;
        this.publish();
      }
    }
  }
  record(
    track: Track,
    kind: SignalKind,
    origin: "explicit" | "auto" = "explicit",
    seconds = 0,
    id = newSignalId()
  ) {
    if (!this.active || !this.ready || !this.state.enabled) return;
    const clean = cleanTrack(track);
    if (!clean || this.state.events.some((e) => e.id === id)) return;
    // Repeated taps do not overwhelm real listening.
    if (
      this.state.events.some(
        (e) =>
          e.kind === kind &&
          e.track.videoId === track.videoId &&
          Date.now() - e.at < 5000
      )
    )
      return;
    const event: TasteSignal = {
      id,
      track: clean,
      kind,
      origin,
      seconds,
      at: Date.now(),
    };
    this.state = {
      ...this.state,
      events: compactSignals(
        [...this.state.events, event],
        Date.now(),
        !this.owner
      ),
    };
    if (this.owner)
      this.pending = [...this.pending, event].slice(-C.accountLimit);
    this.persist();
    this.publish();
    this.schedule();
  }
  private schedule() {
    if (this.owner && this.pending.length && !this.timer && this.active)
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, C.batchMs);
  }
  async flush() {
    if (!this.owner || this.busy || !this.pending.length || !this.active)
      return;
    const generation = this.generation,
      batch = this.pending.slice(0, C.maxBatch);
    this.busy = true;
    try {
      const cloud = await this.remote.call("ingest_recommendation_signals", {
        p_events: batch,
        p_epoch: this.state.epoch,
      });
      if (!this.active || generation !== this.generation) return;
      this.loadRequest++;
      const ids = new Set(batch.map((e) => e.id));
      this.pending = this.pending.filter((e) => !ids.has(e.id));
      if (cloud.epoch !== this.state.epoch || !cloud.enabled) this.pending = [];
      this.state = {
        ...cloud,
        events: compactSignals([...cloud.events, ...this.pending]),
      };
      this.error = null;
      this.persist();
      this.publish();
    } catch {
      if (this.active) {
        this.error = "Preferensi belum tersinkron. Tersimpan di perangkat ini.";
        this.publish();
      }
    } finally {
      this.busy = false;
      this.schedule();
    }
  }
  async control(enabled: boolean, reset = false) {
    if (this.busy)
      throw new Error("Tunggu sinkronisasi selesai, lalu coba lagi.");
    this.generation++;
    this.busy = true;
    try {
      if (this.owner) {
        const cloud = await this.remote.call("set_recommendation_preferences", {
          p_enabled: enabled,
          p_reset: reset,
        });
        if (!this.active)
          throw new Error(
            "Akun berubah. Buka kembali pengaturan akun yang aktif."
          );
        this.state = { ...cloud, events: compactSignals(cloud.events) };
      } else
        this.state = {
          enabled,
          epoch: this.state.epoch + 1,
          events: reset ? [] : this.state.events,
        };
      this.pending = [];
      this.error = null;
      this.persist();
      this.publish();
    } finally {
      this.busy = false;
      this.schedule();
    }
  }
  guestAvailable() {
    if (!this.owner) return false;
    try {
      const raw = JSON.parse(safeRead(PREFIX + "guest") || "null");
      return compactSignals(raw?.events, Date.now(), true).some((e) =>
        ["listen", "complete", "replay", "like", "playlist"].includes(e.kind)
      );
    } catch {
      return false;
    }
  }
  async mergeGuest() {
    if (this.busy) throw new Error("Tunggu sinkronisasi selesai.");
    if (!this.owner || !this.ready || !this.state.enabled)
      throw new Error("Aktifkan personalisasi sebelum menggabungkan.");
    const guest = JSON.parse(safeRead(PREFIX + "guest") || "null");
    const events = compactSignals(guest?.events, Date.now(), true).filter((e) =>
      ["listen", "complete", "replay", "like", "playlist"].includes(e.kind)
    );
    const seen = new Set<string>();
    // Explicit consent imports a small preference summary, never raw guest timestamps/history.
    const summary = events
      .slice()
      .reverse()
      .filter((e) => {
        if (seen.has(e.track.videoId)) return false;
        seen.add(e.track.videoId);
        return true;
      })
      .slice(0, 30)
      .map((e) => ({
        id: newSignalId(),
        track: e.track,
        kind: "import",
        origin: "explicit",
        seconds: 0,
        at: Date.now(),
      }));
    this.busy = true;
    try {
      const cloud = await this.remote.call("ingest_recommendation_signals", {
        p_events: summary,
        p_epoch: this.state.epoch,
      });
      if (!this.active)
        throw new Error("Akun berubah. Preferensi guest belum dihapus.");
      const accepted = new Set(cloud.events.map((e) => e.id));
      if (
        !cloud.enabled ||
        cloud.epoch !== this.state.epoch ||
        summary.some((e) => !accepted.has(e.id))
      )
        throw new Error(
          "Preferensi akun berubah di perangkat lain. Sinkronkan lalu coba gabungkan lagi."
        );
      this.state = {
        ...cloud,
        events: compactSignals([...cloud.events, ...this.pending]),
      };
      safeWrite(PREFIX + "guest", JSON.stringify(emptyTaste()));
      this.persist();
      this.publish();
    } finally {
      this.busy = false;
    }
  }
  dispose() {
    this.active = false;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
}
