import type { Track } from "@/lib/metrolist/types";
import { cleanTrack, trackKey } from "./engine";

/** Presentation-only partition of already ranked tracks. Preserve rank and
 * provider identity; do not infer similar artists or manufacture a chart. */
export function buildEditorialCards(tracks: Track[], maxCards = 4) {
  const seen = new Set<string>();
  const unique = tracks
    .filter((track) => {
      if (!cleanTrack(track) || seen.has(trackKey(track))) return false;
      seen.add(trackKey(track));
      return true;
    })
    .slice(0, Math.max(0, maxCards) * 3);
  const cards = [];
  for (let start = 0; start < unique.length; start += 3) {
    const queue = unique.slice(start, start + 3);
    const lead = queue[0];
    const artistName = lead.artists?.[0]?.name || lead.artist || lead.title;
    const otherArtists = queue.some(
      (track) => (track.artists?.[0]?.name || track.artist) !== artistName
    );
    cards.push({
      id: `editorial:${trackKey(lead)}`,
      lead,
      queue,
      artistName,
      title:
        queue.length === 1
          ? lead.title
          : otherArtists
          ? `${artistName} & lainnya`
          : `Pilihan ${artistName}`,
      thumbs: queue.map((track) => track.thumbnail),
    });
  }
  return cards;
}
