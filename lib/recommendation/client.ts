import { apiUrl } from "@/lib/api/base";
import type { Track } from "@/lib/metrolist/types";
import {
  cleanTrack,
  RECOMMENDATION_CONFIG as C,
  trackKey,
  type Candidate,
} from "./engine";

export class RequestGate {
  private revision = 0;
  next() {
    return ++this.revision;
  }
  valid(ticket: number) {
    return ticket === this.revision;
  }
  cancel() {
    this.revision++;
  }
}
interface PoolResult {
  candidates: Candidate[];
  degraded: boolean;
}
/** Per-identity, bounded cache; cookies and personal signals never become URLs.
 * Queue and Home share in-flight public catalogue requests. */
export class CandidateClient {
  private cache = new Map<string, { at: number; result: PoolResult }>();
  private pending = new Map<string, Promise<PoolResult>>();
  private controllers = new Map<string, AbortController>();
  constructor(
    private transport: typeof fetch = (input, init) => fetch(input, init)
  ) {}
  async collect(
    seed: Track | undefined,
    region: string,
    cookie = "",
    mode = "mixed",
    priority = false
  ): Promise<PoolResult> {
    const key = `${
      seed ? trackKey(seed) : "catalog"
    }:${region}:${mode}:${cookie}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < C.cacheMs) return cached.result;
    const pending = this.pending.get(key);
    if (pending) return pending;
    // At most three concurrent provider requests per identity.
    if (this.pending.size >= 3) {
      if (!priority) return { candidates: [], degraded: true };
      const oldest = this.controllers.entries().next().value;
      if (oldest) {
        oldest[1].abort();
        this.controllers.delete(oldest[0]);
        this.pending.delete(oldest[0]);
      }
    }
    const controller = new AbortController();
    this.controllers.set(key, controller);
    const timer = setTimeout(() => controller.abort(), 20000);
    const promise = (async () => {
      try {
        const params = new URLSearchParams({
          gl: region,
          mode: mode === "discover" ? "discover" : "mixed",
        });
        if (seed) {
          params.set("videoId", seed.videoId);
          const artist = seed.artists?.find((a) => a.artistId)?.artistId;
          if (artist) params.set("artistId", artist);
        }
        if (mode === "expanded") params.set("expand", "true");
        if (mode === "related") {
          params.set("mode", "related");
          params.set("strict", "true");
        }
        const res = await this.transport(
          apiUrl(`/api/music/up-next?${params}`),
          {
            headers: cookie ? { "x-yt-cookie": cookie } : {},
            signal: controller.signal,
          }
        );
        if (!res.ok) throw new Error("Provider unavailable");
        const data = await res.json();
        const candidates: Candidate[] = (
          Array.isArray(data.candidates) ? data.candidates : []
        )
          .slice(0, 70)
          .flatMap((c: Candidate) => {
            const track = cleanTrack(c?.track);
            return track && ["related", "artist", "catalog"].includes(c.source)
              ? [
                  {
                    track,
                    source: c.source,
                    seed: c.source === "catalog" ? undefined : seed,
                    order: Math.max(0, Number(c.order) || 0),
                  },
                ]
              : [];
          });
        const result = { candidates, degraded: !!data.degraded };
        this.cache.set(key, { at: Date.now(), result });
        while (this.cache.size > 24)
          this.cache.delete(this.cache.keys().next().value!);
        return result;
      } catch {
        return {
          candidates:
            cached && Date.now() - cached.at < C.cacheMs * 3
              ? cached.result.candidates
              : [],
          degraded: true,
        };
      } finally {
        clearTimeout(timer);
        if (this.controllers.get(key) === controller) {
          this.pending.delete(key);
          this.controllers.delete(key);
        }
      }
    })();
    this.pending.set(key, promise);
    return promise;
  }
  dispose() {
    for (const c of this.controllers.values()) c.abort();
    this.pending.clear();
    this.cache.clear();
  }
}
