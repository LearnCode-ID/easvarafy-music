import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBlendMix,
  calculateTasteMatch,
  cleanTasteTracks,
  interleaveBlendTracks,
  normalizeTasteText,
  type TasteTrack,
} from "./blend";
const track = (id: string, artist = "Artist", genre?: string): TasteTrack => ({
  videoId: id,
  title: `Song ${id}`,
  artist,
  artists: [{ artistId: artist, name: artist }],
  thumbnail: "",
  duration: 180,
  type: "SONG",
  genre,
});
const list = (prefix: string, n: number, artist = prefix) =>
  Array.from({ length: n }, (_, i) => track(`${prefix}-${i}`, artist));
test("match is 100 for identical taste and 0 for disjoint song+artist+genre", () => {
  const a = [track("one", "Satu", "rock"), track("two", "Dua", "pop")];
  assert.equal(calculateTasteMatch(a, a).percent, 100);
  assert.equal(
    calculateTasteMatch(a, [track("three", "Tiga", "classical")]).percent,
    0
  );
});
test("match is symmetric, bounded, normalized, duplicate invariant", () => {
  const a = [track("one", "Beyoncé"), track("two", "Other")],
    b = [track("one", "Beyonce"), track("three", "Third")];
  assert.equal(normalizeTasteText("Beyoncé"), "beyonce");
  assert.equal(
    calculateTasteMatch(a, b).percent,
    calculateTasteMatch(b, a).percent
  );
  assert.equal(
    calculateTasteMatch(a, b).percent,
    calculateTasteMatch([...a, ...a], b).percent
  );
  assert.deepEqual(calculateTasteMatch(a, b).sharedTrackIds, ["one"]);
  assert.deepEqual(calculateTasteMatch(a, b).sharedArtists, ["Beyoncé"]);
});
test("unknown genres do not become fake genre similarity and empty tastes are not 100%", () => {
  assert.equal(
    calculateTasteMatch([track("a")], [track("b")]).signals.vibe,
    null
  );
  for (const [a, b] of [
    [[], []],
    [[track("a")], []],
    [null, undefined],
  ]) {
    const m = calculateTasteMatch(a, b);
    assert.equal(m.percent, 0);
    assert.equal(m.hasEnoughData, false);
  }
});
test("vibe contributes only when both users have metadata or conservative cues", () => {
  const a = [track("a", "A", "jazz")],
    b = [track("b", "B", "jazz")];
  assert.equal(calculateTasteMatch(a, b).percent, 15);
  assert.equal(
    calculateTasteMatch([track("a", "A")], [track("b", "B")]).percent,
    0
  );
});
test("balanced mix alternates and dedupes shared + related with correct attribution", () => {
  const a = [track("shared"), ...list("a", 20)],
    b = [track("shared"), ...list("b", 20)];
  const mix = buildBlendMix(
    a,
    b,
    "A",
    "B",
    [track("shared"), ...list("ra", 10)],
    [...list("rb", 10)]
  );
  assert.equal(mix.tracks.length, 32);
  assert.equal(new Set(mix.tracks.map((t) => t.videoId)).size, 32);
  assert.equal(mix.tracks[0].addedByUserId, "A");
  assert.equal(mix.tracks[1].addedByUserId, "B");
  const shared = mix.tracks.find((t) => t.videoId === "shared")!;
  assert.equal(shared.addedByUserId, null);
  assert.deepEqual(shared.tasteOwnerIds, ["A", "B"]);
  assert.equal(shared.source, "shared");
  for (const t of mix.tracks.filter((t) => t.source === "related"))
    assert.equal(t.addedByUserId, t.videoId.startsWith("ra") ? "A" : "B");
});
test("24–40 quota is bounded, no placeholder tracks if samples too short", () => {
  assert.equal(
    interleaveBlendTracks(list("a", 100), list("b", 100), "A", "B", [], [], 999)
      .length,
    40
  );
  assert.equal(
    interleaveBlendTracks(list("a", 100), list("b", 100), "A", "B", [], [], 1)
      .length,
    24
  );
  assert.equal(interleaveBlendTracks([track("one")], [], "A", "B").length, 1);
  assert.equal(interleaveBlendTracks([], [], "A", "B").length, 0);
  assert.throws(() => interleaveBlendTracks([], [], "A", "A"));
});
test("bad catalog inputs are rejected and optional metadata normalized", () => {
  const good = track("ok");
  assert.equal(
    cleanTasteTracks([
      null,
      {},
      { videoId: "", title: "x" },
      good,
      good,
      { ...good, videoId: "no-artist", artist: "" },
    ]).length,
    1
  );
  assert.deepEqual(cleanTasteTracks(null), []);
  const t = cleanTasteTracks([
    { ...good, artists: null, duration: -1, thumbnail: null },
  ])[0];
  assert.deepEqual(t.artists, []);
  assert.equal(t.duration, 0);
  assert.equal(t.thumbnail, "");
});
test("related fallback cannot duplicate favorites or lose ownership with highly unequal libraries", () => {
  const mix = interleaveBlendTracks(
    list("a", 100),
    list("b", 1),
    "A",
    "B",
    list("ra", 30),
    [track("b-0", "b"), ...list("rb", 30)]
  );
  assert.equal(mix.length, 32);
  assert.ok(mix.some((t) => t.videoId.startsWith("rb")));
  assert.equal(mix.find((t) => t.videoId === "b-0")!.source, "favorite");
  assert.ok(
    mix.every((t) => t.tasteOwnerIds.every((id) => id === "A" || id === "B"))
  );
});
