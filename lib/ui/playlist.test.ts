import { test } from "node:test";
import assert from "node:assert/strict";
import { sortPlaylistTracks } from "./playlist";
import type { Track } from "@/lib/metrolist/types";

const tracks: Track[] = [
  {
    videoId: "b",
    title: "Song 10",
    artist: "Zeta",
    duration: 90,
    thumbnail: "",
    artists: [],
    type: "SONG",
  },
  {
    videoId: "a",
    title: "Song 2",
    artist: "Alpha",
    duration: null,
    thumbnail: "",
    artists: [],
    type: "SONG",
  },
  {
    videoId: "c",
    title: "Another",
    artist: "Beta",
    duration: 180,
    thumbnail: "",
    artists: [],
    type: "SONG",
  },
];

test("playlist view sorting preserves persisted custom order and track identity", () => {
  const before = [...tracks];
  assert.equal(sortPlaylistTracks(tracks, "custom"), tracks);
  assert.deepEqual(
    sortPlaylistTracks(tracks, "title").map((t) => t.videoId),
    ["c", "a", "b"]
  );
  assert.deepEqual(
    sortPlaylistTracks(tracks, "artist").map((t) => t.videoId),
    ["a", "c", "b"]
  );
  assert.deepEqual(
    sortPlaylistTracks(tracks, "duration").map((t) => t.videoId),
    ["b", "c", "a"]
  );
  assert.deepEqual(tracks, before);
  assert.equal(sortPlaylistTracks(tracks, "artist")[0], tracks[1]);
  assert.deepEqual(sortPlaylistTracks([], "duration"), []);
});
