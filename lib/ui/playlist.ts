import type { Track } from "@/lib/metrolist/types";
export type PlaylistSort = "custom" | "title" | "artist" | "duration";
/** View-only sorting must never mutate the persisted playlist order. */
export function sortPlaylistTracks(
  tracks: Track[],
  sort: PlaylistSort
): Track[] {
  if (sort === "custom") return tracks;
  return [...tracks].sort((a, b) =>
    sort === "duration"
      ? (a.duration ?? Number.MAX_SAFE_INTEGER) -
        (b.duration ?? Number.MAX_SAFE_INTEGER)
      : (sort === "artist" ? a.artist : a.title).localeCompare(
          sort === "artist" ? b.artist : b.title,
          "id",
          { sensitivity: "base", numeric: true }
        )
  );
}
