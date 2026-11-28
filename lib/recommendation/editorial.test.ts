import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildEditorialCards } from "./editorial";
import { TopPicksCollageSection } from "@/components/HomeEditorialSections";
import type { Track } from "@/lib/metrolist/types";

const track = (index: number): Track => ({
  videoId: `ranked-${index}`,
  title: `Song ${index}`,
  artist: `Artist ${index}`,
  artists: [{ artistId: null, name: `Artist ${index}` }],
  duration: 180,
  thumbnail: `https://images.example.invalid/${index}.jpg`,
  type: "SONG",
});

test("large editorial covers partition genuine ranked tracks without duplicates or invented relationships", () => {
  const tracks = Array.from({ length: 24 }, (_, i) => track(i));
  const cards = buildEditorialCards([...tracks, tracks[0]]);
  assert.equal(cards.length, 4);
  assert.deepEqual(
    cards.flatMap((c) => c.queue).map((t) => t.videoId),
    tracks.slice(0, 12).map((t) => t.videoId)
  );
  assert.equal(
    new Set(cards.flatMap((c) => c.queue).map((t) => t.videoId)).size,
    12
  );
  assert.ok(
    cards.every((c) => !c.title.includes("Serupa") && c.queue.length === 3)
  );
  assert.deepEqual(
    cards[0].thumbs,
    tracks.slice(0, 3).map((t) => t.thumbnail)
  );
});
test("short pools are not padded with duplicate songs or fake artwork", () => {
  assert.deepEqual(buildEditorialCards([]), []);
  const [card] = buildEditorialCards([track(0), track(0)]);
  assert.equal(card.queue.length, 1);
  assert.equal(card.thumbs.length, 1);
  assert.equal(card.title, "Song 0");
  const sameArtist = [
    track(1),
    { ...track(2), artist: "Artist 1", artists: track(1).artists },
  ];
  assert.equal(buildEditorialCards(sameArtist)[0].title, "Pilihan Artist 1");
});
test("Easvarafy editorial presentation restores large branded covers and accurate accessible play controls", () => {
  const html = renderToStaticMarkup(
    createElement(TopPicksCollageSection, {
      tracks: Array.from({ length: 12 }, (_, i) => track(i)),
      personal: true,
      onPlayMix: () => {},
    })
  );
  assert.match(html, /Pilihan Teratas untuk Anda/);
  assert.match(html, /Easvarafy/);
  assert.equal(
    (html.match(/data-testid="home-editorial-card"/g) || []).length,
    4
  );
  assert.match(html, /h-\[300px\]/);
  assert.match(html, /sm:h-\[318px\]/);
  assert.match(html, /Putar pilihan Song 0/);
  assert.match(html, /motion-reduce/);
  assert.doesNotMatch(html, /YouTube|Artis Serupa|Top 100/);
});
test("editorial loading reserves the large-cover layout without fake interactive tracks", () => {
  const html = renderToStaticMarkup(
    createElement(TopPicksCollageSection, {
      tracks: [],
      loading: true,
      onPlayMix: () => {},
    })
  );
  assert.match(html, /role="status"/);
  assert.match(html, /aria-busy="true"/);
  assert.doesNotMatch(html, /<button|<img/);
  assert.equal((html.match(/h-\[300px\]/g) || []).length, 4);
});
