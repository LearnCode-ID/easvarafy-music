import { test } from "node:test";
import assert from "node:assert/strict";
import { positionTrackMenu } from "./overlayPosition";

const viewport = { left: 0, top: 0, width: 390, height: 844 };
test("track menu sits below a trigger when space permits and flips up near the bottom", () => {
  const lower = positionTrackMenu(
    { left: 330, right: 374, top: 50, bottom: 94 },
    { width: 240, height: 350 },
    viewport
  );
  assert.equal(lower.top, 100);
  assert.equal(lower.left, 134);
  const upper = positionTrackMenu(
    { left: 330, right: 374, top: 750, bottom: 794 },
    { width: 240, height: 350 },
    viewport
  );
  assert.equal(upper.top, 394);
});
test("menu stays within small, resized and offset visual viewports", () => {
  for (const view of [
    viewport,
    { left: 20, top: 120, width: 280, height: 320 },
    { left: 0, top: 0, width: 200, height: 150 },
  ]) {
    for (const anchor of [
      { left: -10, right: 5, top: 10, bottom: 54 },
      { left: 380, right: 424, top: 700, bottom: 744 },
    ]) {
      const menu = positionTrackMenu(anchor, { width: 240, height: 500 }, view);
      assert.ok(menu.left >= view.left + 12);
      assert.ok(menu.top >= view.top + 12);
      assert.ok(menu.left + menu.width <= view.left + view.width - 12);
      assert.ok(
        menu.top + Math.min(500, menu.maxHeight) <= view.top + view.height - 12
      );
    }
  }
});
