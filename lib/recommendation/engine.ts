import type { Track } from "@/lib/metrolist/types";

export const RECOMMENDATION_CONFIG = {
  weights: {
    select: 0.3,
    listen: 1.5,
    complete: 3,
    replay: 2,
    like: 4,
    playlist: 3,
    skip: -1.5,
    not_interested: -8,
    block_artist: -8,
    import: 0.6,
  },
  autoplayMultiplier: 0.25,
  halfLifeDays: 21,
  longTermFloor: 0.18,
  exploration: 0.12,
  artistPenalty: 0.23,
  recentMs: 60 * 60 * 1000,
  guestLimit: 300,
  accountLimit: 600,
  retentionDays: 180,
  guestRetentionDays: 90,
  cacheMs: 10 * 60 * 1000,
  batchMs: 15000,
  maxBatch: 30,
};
export type SignalKind = keyof typeof RECOMMENDATION_CONFIG.weights;
export interface TasteSignal {
  id: string;
  track: Track;
  kind: SignalKind;
  at: number;
  origin: "explicit" | "auto";
  seconds: number;
}
export interface TasteState {
  enabled: boolean;
  epoch: number;
  events: TasteSignal[];
}
export type CandidateSource = "related" | "artist" | "catalog" | "library";
export interface Candidate {
  track: Track;
  source: CandidateSource;
  seed?: Track;
  order: number;
}
export interface Recommendation {
  track: Track;
  score: number;
  reason: string;
  source: CandidateSource;
}
export const emptyTaste = (): TasteState => ({
  enabled: true,
  epoch: 0,
  events: [],
});
export const textKey = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export const trackKey = (t: Pick<Track, "videoId" | "provider">) =>
  `${t.provider || "youtube"}:${t.videoId}`;
export function artists(t: Track): string[] {
  return [
    ...new Set(
      (t.artists?.length ? t.artists.map((a) => a.name) : [t.artist])
        .filter((v) => typeof v === "string")
        .map(textKey)
        .filter(
          (name) =>
            Boolean(name) &&
            !/^(unknown( artist)?|various artists|artis tidak dikenal)$/.test(
              name
            )
        )
    ),
  ];
}
export function cleanTrack(value: unknown): Track | null {
  if (!value || typeof value !== "object") return null;
  const t = value as Track;
  if (
    (t.provider && t.provider !== "youtube") ||
    typeof t.videoId !== "string" ||
    !/^[\w-]{1,128}$/.test(t.videoId) ||
    typeof t.title !== "string" ||
    !t.title.trim() ||
    t.title.length > 500 ||
    typeof t.artist !== "string" ||
    t.artist.length > 300 ||
    t.available === false
  )
    return null;
  return {
    provider: "youtube",
    videoId: t.videoId,
    title: t.title,
    artist: t.artist,
    artists: Array.isArray(t.artists)
      ? t.artists
          .filter((a) => a && typeof a.name === "string")
          .slice(0, 10)
          .map((a) => ({
            name: a.name.slice(0, 200),
            artistId:
              typeof a.artistId === "string" ? a.artistId.slice(0, 128) : null,
          }))
      : [],
    duration:
      typeof t.duration === "number" &&
      Number.isFinite(t.duration) &&
      t.duration > 0
        ? Math.min(t.duration, 86400)
        : null,
    thumbnail:
      typeof t.thumbnail === "string" && /^https:\/\//.test(t.thumbnail)
        ? t.thumbnail.slice(0, 2000)
        : "",
    type: t.type === "VIDEO" ? "VIDEO" : "SONG",
    explicit: !!t.explicit,
  };
}
export function compactSignals(
  input: unknown,
  now = Date.now(),
  guest = false
): TasteSignal[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  return input
    .flatMap((s: TasteSignal) => {
      if (
        !s ||
        typeof s.id !== "string" ||
        seen.has(s.id) ||
        !Object.hasOwn(RECOMMENDATION_CONFIG.weights, s.kind) ||
        !Number.isFinite(s.at) ||
        s.at > now + 60000 ||
        now - s.at > (guest ? 90 : 180) * 86400000
      )
        return [];
      const track = cleanTrack(s.track);
      if (!track) return [];
      seen.add(s.id);
      return [
        {
          id: s.id,
          track,
          kind: s.kind,
          at: s.at,
          origin:
            s.origin === "auto" ? ("auto" as const) : ("explicit" as const),
          seconds: Math.max(0, Math.min(86400, Number(s.seconds) || 0)),
        },
      ];
    })
    .sort((a, b) => a.at - b.at)
    .slice(
      -(guest
        ? RECOMMENDATION_CONFIG.guestLimit
        : RECOMMENDATION_CONFIG.accountLimit)
    );
}
function versionKey(t: Track) {
  const title = textKey(
    t.title.replace(
      /\b(official\s*(music\s*)?(video|audio)|lyrics?\s*video)\b/gi,
      ""
    )
  );
  return `${t.provider || "youtube"}|${artists(t).sort().join(",")}|${title}`;
}
/** Explicit blocks are hard filters. Quick skips are soft negative evidence,
 * never permanent blocks. No inferred genre, mood, BPM or audio features. */
export function rankCandidates(
  candidates: Candidate[],
  taste: TasteState,
  options: {
    seed?: Track;
    exclude?: Track[];
    now?: number;
    limit?: number;
    surface?: "home" | "queue";
    hideVideoSongs?: boolean;
  } = {}
): Recommendation[] {
  const now = options.now ?? Date.now(),
    events = taste.enabled ? taste.events : [];
  // Blocks remain safety choices even when personalization is disabled.
  const blocked = new Set(
    taste.events
      .filter((e) => e.kind === "not_interested")
      .map((e) => trackKey(e.track))
  );
  const blockedArtists = new Set(
    taste.events
      .filter((e) => e.kind === "block_artist")
      .flatMap((e) => artists(e.track))
  );
  const excluded = new Set((options.exclude || []).map(trackKey));
  if (options.seed) excluded.add(trackKey(options.seed));
  const recent = new Set(
    events
      .filter(
        (e) =>
          ["listen", "complete", "replay"].includes(e.kind) &&
          now - e.at < RECOMMENDATION_CONFIG.recentMs
      )
      .map((e) => trackKey(e.track))
  );
  const affinity = new Map<string, number>(),
    trackAffinity = new Map<string, number>();
  for (const e of events) {
    const decay =
      RECOMMENDATION_CONFIG.longTermFloor +
      (1 - RECOMMENDATION_CONFIG.longTermFloor) *
        2 **
          (-Math.max(0, now - e.at) /
            (86400000 * RECOMMENDATION_CONFIG.halfLifeDays));
    let w =
      RECOMMENDATION_CONFIG.weights[e.kind] *
      decay *
      (e.origin === "auto" ? RECOMMENDATION_CONFIG.autoplayMultiplier : 1);
    if (e.kind === "listen") w *= Math.min(1, e.seconds / 120);
    trackAffinity.set(
      trackKey(e.track),
      (trackAffinity.get(trackKey(e.track)) || 0) + w
    );
    for (const a of artists(e.track))
      affinity.set(
        a,
        (affinity.get(a) || 0) + w / Math.max(1, artists(e.track).length)
      );
  }
  const seen = new Set<string>(),
    versions = new Map<string, Track[]>();
  const seedArtists = new Set(options.seed ? artists(options.seed) : []);
  const rows: Recommendation[] = [];
  for (const candidate of candidates) {
    const t = cleanTrack(candidate.track);
    if (!t) continue;
    const key = trackKey(t),
      aa = artists(t);
    if (
      seen.has(key) ||
      excluded.has(key) ||
      recent.has(key) ||
      blocked.has(key) ||
      aa.some((a) => blockedArtists.has(a)) ||
      (options.hideVideoSongs && t.type === "VIDEO")
    )
      continue;
    const vk = versionKey(t),
      same = versions.get(vk) || [];
    if (
      t.duration &&
      same.some((s) => s.duration && Math.abs(s.duration - t.duration!) <= 3)
    )
      continue;
    seen.add(key);
    versions.set(vk, [...same, t]);
    const related =
      candidate.source === "related"
        ? (options.seed &&
          candidate.seed &&
          trackKey(options.seed) !== trackKey(candidate.seed)
            ? 0.6
            : 0.8) /
          (1 + candidate.order * 0.025)
        : candidate.source === "artist"
        ? 0.5
        : candidate.source === "library"
        ? 0.3
        : 0.14 / (1 + candidate.order * 0.025);
    const overlap = aa.some((a) => seedArtists.has(a)) ? 0.16 : 0;
    const preference =
      (Math.tanh(aa.reduce((sum, a) => sum + (affinity.get(a) || 0), 0) / 12) +
        Math.tanh((trackAffinity.get(key) || 0) / 8)) *
      0.12;
    const novelty = trackAffinity.has(key) ? 0 : 0.06;
    const score = Math.max(
      0,
      Math.min(1, related + overlap + preference + novelty)
    );
    const reason =
      candidate.source === "related" && candidate.seed
        ? `Dari radio “${candidate.seed.title}”`
        : candidate.source === "artist" && candidate.seed
        ? `Artis yang sama dengan “${candidate.seed.title}”`
        : candidate.source === "library"
        ? "Dari koleksi musikmu"
        : "Pilihan katalog sesuai wilayah pilihanmu";
    rows.push({ track: t, score, reason, source: candidate.source });
  }
  rows.sort(
    (a, b) =>
      b.score - a.score || trackKey(a.track).localeCompare(trackKey(b.track))
  );
  const result: Recommendation[] = [],
    counts = new Map<string, number>();
  while (rows.length && result.length < (options.limit ?? 24)) {
    let best = 0,
      bestScore = -Infinity;
    const explore =
      (result.length + 1) %
        Math.max(2, Math.round(1 / RECOMMENDATION_CONFIG.exploration)) ===
      0;
    rows.forEach((r, i) => {
      const aa = artists(r.track),
        penalty =
          Math.max(0, ...aa.map((a) => counts.get(a) || 0)) *
          RECOMMENDATION_CONFIG.artistPenalty;
      const fresh = aa.every((a) => !affinity.has(a));
      // Home has a small deterministic novelty boost, not a copy of queue order.
      const score =
        r.score -
        penalty +
        (explore && fresh && r.source === "catalog" ? 1.2 : 0) +
        (options.surface === "home" && fresh ? 0.04 : 0);
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    });
    const [picked] = rows.splice(best, 1);
    result.push(picked);
    for (const a of artists(picked.track))
      counts.set(a, (counts.get(a) || 0) + 1);
  }
  return result;
}

/** Credit only short samples of verified playback advancement. Position jumps,
 * paused/buffering frames and background timer gaps never create listen time. */
export class ListeningSession {
  seconds = 0;
  completed = false;
  private covered = new Set<number>();
  private knownDuration: number | null = null;
  private last: { now: number; position: number; playing: boolean } | null =
    null;
  constructor(
    public track: Track,
    public origin: "explicit" | "auto",
    public id: string
  ) {}
  sample(now: number, position: number, playing: boolean, rate = 1) {
    const previous = this.last;
    this.last = { now, position, playing };
    if (!previous || !playing || !previous.playing) return 0;
    const elapsed = (now - previous.now) / 1000,
      delta = position - previous.position;
    if (
      elapsed <= 0 ||
      elapsed > 5 ||
      delta <= 0 ||
      Math.abs(delta - elapsed * rate) > Math.max(0.75, elapsed * rate * 0.5)
    )
      return 0;
    this.seconds += elapsed;
    // Unique content seconds prevent seeking/repeating a short fragment from
    // pretending the entire track was completed. Wall time remains separate.
    const end = Math.min(
      position,
      this.knownDuration ?? this.track.duration ?? 86400
    );
    for (
      let second = Math.max(0, Math.floor(previous.position));
      second < Math.floor(end);
      second++
    )
      this.covered.add(second);
    return elapsed;
  }
  invalidate() {
    this.last = null;
  }
  majority(duration: number | null) {
    this.knownDuration = duration;
    return (
      !!duration &&
      duration > 0 &&
      this.seconds >= 10 &&
      this.covered.size >= duration * 0.9
    );
  }
  quickSkip() {
    return this.seconds >= 1 && this.seconds < 10;
  }
}

/** Safety filters preserve input order and apply even without personalization. */
export function safeTracks(
  tracks: Track[],
  taste: TasteState,
  hideVideoSongs = false
): Track[] {
  const blocked = new Set(
    taste.events
      .filter((e) => e.kind === "not_interested")
      .map((e) => trackKey(e.track))
  );
  const blockedArtists = new Set(
    taste.events
      .filter((e) => e.kind === "block_artist")
      .flatMap((e) => artists(e.track))
  );
  const seen = new Set<string>();
  return tracks.filter((t) => {
    if (
      !cleanTrack(t) ||
      blocked.has(trackKey(t)) ||
      artists(t).some((a) => blockedArtists.has(a)) ||
      seen.has(trackKey(t)) ||
      (hideVideoSongs && t.type === "VIDEO")
    )
      return false;
    seen.add(trackKey(t));
    return true;
  });
}

/** Combine a recent substantial interest with decayed longer-term evidence. */
export function tasteSeeds(
  taste: TasteState,
  exclude: Track[] = [],
  limit = 2
): Track[] {
  if (!taste.enabled) return [];
  const scores = new Map<string, { track: Track; score: number; at: number }>();
  const safe = new Set(
    safeTracks(
      taste.events.map((e) => e.track),
      taste
    ).map(trackKey)
  );
  const excluded = new Set(exclude.map(trackKey));
  for (const e of taste.events) {
    const key = trackKey(e.track);
    if (
      !safe.has(key) ||
      excluded.has(key) ||
      !["listen", "complete", "replay", "like", "playlist", "import"].includes(
        e.kind
      )
    )
      continue;
    const age = Math.max(0, Date.now() - e.at) / 86400000;
    const score =
      RECOMMENDATION_CONFIG.weights[e.kind] *
      (e.origin === "auto" ? RECOMMENDATION_CONFIG.autoplayMultiplier : 1) *
      (RECOMMENDATION_CONFIG.longTermFloor +
        2 ** (-age / RECOMMENDATION_CONFIG.halfLifeDays));
    const previous = scores.get(key);
    scores.set(key, {
      track: e.track,
      score: score + (previous?.score || 0),
      at: Math.max(e.at, previous?.at || 0),
    });
  }
  const rows = [...scores.values()];
  const recent = rows.slice().sort((a, b) => b.at - a.at)[0];
  if (!recent) return [];
  const ranked = rows
    .filter((r) => trackKey(r.track) !== trackKey(recent.track))
    .sort((a, b) => b.score - a.score || b.at - a.at);
  return [recent.track, ...ranked.map((r) => r.track)].slice(0, limit);
}
