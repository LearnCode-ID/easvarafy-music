import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  LibrarySkeleton,
  LibrarySyncIndicator,
} from "../../components/LibrarySkeleton";

test("Library placeholders expose one accessible loading status, no fake controls", () => {
  for (const layout of ["grid", "list", "blend"] as const) {
    const html = renderToStaticMarkup(
      createElement(LibrarySkeleton, { layout })
    );
    assert.match(html, /role="status"/);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /class="sr-only"/);
    assert.doesNotMatch(html, /<(button|input|img)\b/);
    assert.ok((html.match(/skeleton-block/g) || []).length > 10);
  }
});

test("Blend loading reuses card placeholders without an extra filter toolbar", () => {
  const html = renderToStaticMarkup(
    createElement(LibrarySkeleton, {
      layout: "blend",
      toolbar: false,
      label: "Memuat Blend",
    })
  );
  assert.match(html, /aria-label="Memuat Blend"/);
  assert.doesNotMatch(html, /max-w-md/);
  assert.match(html, /rounded-full/);
});

test("Background synchronization remains compact and non-interactive", () => {
  const html = renderToStaticMarkup(
    createElement(LibrarySyncIndicator, { className: "mb-3" })
  );
  assert.match(html, /role="status"/);
  assert.match(html, /mb-3/);
  assert.match(html, /class="sr-only"/);
  assert.doesNotMatch(html, /aria-busy="true"/);
  assert.doesNotMatch(html, /<(button|input)\b/);
});
