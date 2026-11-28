import type { Track } from "@/lib/metrolist/types";

/** A musical sample is not an authoritative genre catalogue. Only explicit
 * genre/vibe metadata or conservative title cues contribute that score signal. */
export type TasteTrack = Track & {
  genres?: string[];
  genre?: string;
  vibe?: string;
  tags?: string[];
};
export type BlendTrack = TasteTrack & {
  addedByUserId: string | null;
  tasteOwnerIds: string[];
  source: "favorite" | "shared" | "related";
};
export interface TasteMatch {
  percent: number;
  sharedArtists: string[];
  sharedTrackIds: string[];
  signals: { songs: number; artists: number; vibe: number | null };
  hasEnoughData: boolean;
}
export const normalizeTasteText = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export function cleanTasteTracks(input: unknown): TasteTrack[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  return input
    .filter((value): value is TasteTrack => {
      if (!value || typeof value !== "object") return false;
      const t = value as Record<string, unknown>;
      if (
        typeof t.videoId !== "string" ||
        !t.videoId.trim() ||
        t.videoId.length > 128 ||
        typeof t.title !== "string" ||
        !t.title.trim() ||
        t.title.length > 500 ||
        typeof t.artist !== "string" ||
        !t.artist.trim() ||
        seen.has(t.videoId)
      )
        return false;
      seen.add(t.videoId);
      return true;
    })
    .map((t) => ({
      ...t,
      artists: Array.isArray(t.artists)
        ? t.artists.filter((a) => a && typeof a.name === "string")
        : [],
      thumbnail: typeof t.thumbnail === "string" ? t.thumbnail : "",
      duration:
        typeof t.duration === "number" && Number.isFinite(t.duration)
          ? Math.max(0, t.duration)
          : null,
      type: t.type === "VIDEO" ? "VIDEO" : "SONG",
    }));
}
function artistLabels(tracks: TasteTrack[]) {
  const result = new Map<string, string>();
  for (const t of tracks)
    for (const artist of t.artists?.length
      ? t.artists.map((a) => a.name)
      : [t.artist]) {
      const normalized = normalizeTasteText(artist);
      if (normalized) result.set(normalized, artist.trim());
    }
  return result;
}
function vibeSet(tracks: TasteTrack[]) {
  const result = new Set<string>();
  for (const t of tracks) {
    const explicit = [
      ...(Array.isArray(t.genres) ? t.genres : []),
      ...(Array.isArray(t.tags) ? t.tags : []),
      t.genre,
      t.vibe,
    ].filter((v): v is string => typeof v === "string");
    for (const value of explicit) {
      const tag = normalizeTasteText(value);
      if (tag) result.add(tag);
    }
    const title = normalizeTasteText(t.title);
    for (const cue of [
      "acoustic",
      "instrumental",
      "lofi",
      "jazz",
      "ambient",
      "classical",
      "rock",
      "remix",
    ])
      if (new RegExp(`\\b${cue}\\b`).test(title)) result.add(cue);
  }
  return result;
}
function jaccard(a: Set<string>, b: Set<string>) {
  const union = new Set([...a, ...b]);
  return union.size ? [...a].filter((x) => b.has(x)).length / union.size : 0;
}
export function calculateTasteMatch(
  inputA: unknown,
  inputB: unknown
): TasteMatch {
  const a = cleanTasteTracks(inputA),
    b = cleanTasteTracks(inputB);
  const idsA = new Set(a.map((t) => t.videoId)),
    idsB = new Set(b.map((t) => t.videoId));
  const artistsA = artistLabels(a),
    artistsB = artistLabels(b),
    vibesA = vibeSet(a),
    vibesB = vibeSet(b);
  const songs = jaccard(idsA, idsB),
    artists = jaccard(new Set(artistsA.keys()), new Set(artistsB.keys()));
  const vibe = vibesA.size && vibesB.size ? jaccard(vibesA, vibesB) : null;
  const enough = a.length > 0 && b.length > 0;
  const weighted =
    vibe === null
      ? (songs * 0.5 + artists * 0.35) / 0.85
      : songs * 0.5 + artists * 0.35 + vibe * 0.15;
  return {
    percent: enough
      ? Math.max(0, Math.min(100, Math.round(weighted * 100)))
      : 0,
    sharedArtists: [...artistsA.keys()]
      .filter((k) => artistsB.has(k))
      .sort()
      .map((k) => artistsA.get(k)!)
      .slice(0, 20),
    sharedTrackIds: [...idsA].filter((k) => idsB.has(k)).sort(),
    signals: { songs, artists, vibe },
    hasEnoughData: enough,
  };
}
/** Interleave unique A / B / shared, with a small recommendation slot every
 * second cycle. Missing catalog data never fabricates tracks to reach a quota. */
export function interleaveBlendTracks(
  inputA: unknown,
  inputB: unknown,
  userA: string,
  userB: string,
  relatedA: unknown = [],
  relatedB: unknown = [],
  limit = 32
): BlendTrack[] {
  if (!userA || !userB || userA === userB)
    throw new Error("Blend memerlukan dua pengguna berbeda.");
  const max = Math.max(
    24,
    Math.min(40, Math.floor(Number.isFinite(limit) ? limit : 32))
  );
  const a = cleanTasteTracks(inputA),
    b = cleanTasteTracks(inputB);
  const idsA = new Set(a.map((t) => t.videoId)),
    idsB = new Set(b.map((t) => t.videoId));
  const shared = a.filter((t) => idsB.has(t.videoId));
  const pools = [
    a.filter((t) => !idsB.has(t.videoId)),
    b.filter((t) => !idsA.has(t.videoId)),
    shared,
    cleanTasteTracks(relatedA),
    cleanTasteTracks(relatedB),
  ];
  const pointers = [0, 0, 0, 0, 0],
    seen = new Set<string>(),
    out: BlendTrack[] = [];
  const take = (pool: number) => {
    while (pointers[pool] < pools[pool].length && out.length < max) {
      const track = pools[pool][pointers[pool]++];
      if (seen.has(track.videoId)) continue;
      seen.add(track.videoId);
      const common = idsA.has(track.videoId) && idsB.has(track.videoId);
      const owners = common
        ? [userA, userB]
        : idsA.has(track.videoId)
        ? [userA]
        : idsB.has(track.videoId)
        ? [userB]
        : [pool === 4 ? userB : userA];
      out.push({
        ...track,
        addedByUserId: common ? null : owners[0],
        tasteOwnerIds: owners,
        source: common
          ? "shared"
          : idsA.has(track.videoId) || idsB.has(track.videoId)
          ? "favorite"
          : "related",
      });
      return;
    }
  };
  let cycle = 0;
  while (out.length < max) {
    const before = out.length;
    take(0);
    take(1);
    take(2);
    // Do not let one friend's very large library crowd out the other's related songs.
    if (cycle++ % 2 === 0 || !pools[0].length || !pools[1].length) {
      take(3);
      take(4);
    }
    if (out.length === before) {
      take(3);
      take(4);
      if (out.length === before) break;
    }
  }
  return out;
}
export function buildBlendMix(
  a: unknown,
  b: unknown,
  userA: string,
  userB: string,
  relatedA: unknown = [],
  relatedB: unknown = []
) {
  return {
    ...calculateTasteMatch(a, b),
    tracks: interleaveBlendTracks(a, b, userA, userB, relatedA, relatedB),
  };
}
