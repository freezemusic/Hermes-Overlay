import assert from "node:assert/strict";
import test from "node:test";
import {
  colorForIndex,
  distanceToRect,
  elementOpacity,
  inkFor,
  interactionLatched,
  modifierMatches,
} from "./proximity.js";

test("new bot colours walk the palette", () => {
  assert.notEqual(colorForIndex(0), colorForIndex(1));
  assert.equal(colorForIndex(10), colorForIndex(0));
});

test("modifier hold is solid regardless of cursor distance", () => {
  const fade = { fadeDistance: 120, minOpacity: 0.18, fadeEnabled: true };
  assert.equal(elementOpacity({ solid: true, distance: 0, ...fade }), 1);
  assert.equal(elementOpacity({ solid: true, distance: 5000, ...fade }), 1);
  assert.equal(elementOpacity({ solid: false, distance: 0, ...fade }), 0.18);
  assert.equal(elementOpacity({ solid: false, distance: 120, ...fade }), 1);
  const mid = elementOpacity({ solid: false, distance: 60, ...fade });
  assert.ok(mid > 0.18 && mid < 1);
});

test("distance is zero inside a rect", () => {
  const rect = { x: 10, y: 10, w: 20, h: 20 };
  assert.equal(distanceToRect(15, 15, rect), 0);
  assert.equal(distanceToRect(10, 0, rect), 10);
});

test("light swatches use dark ink", () => {
  assert.equal(inkFor("#edff45"), "#1a1a1a");
  assert.equal(inkFor("#0000f2"), "#f5f5f5");
});

test("modifier keys", () => {
  assert.equal(modifierMatches("ctrl", "Control"), true);
  assert.equal(modifierMatches("ctrl", "Shift"), false);
  assert.equal(modifierMatches("shift", "Shift"), true);
  assert.equal(modifierMatches("alt", "Alt"), true);
});

test("interactive lock follows window focus", () => {
  assert.equal(interactionLatched({ textFocused: true }), true);
  assert.equal(interactionLatched({ settingsOpen: true }), true);
  assert.equal(interactionLatched({ pointerInside: true }), true);
  assert.equal(interactionLatched({ textFocused: true, windowFocused: false }), false);
  assert.equal(interactionLatched({ settingsOpen: true, windowFocused: false }), false);
  assert.equal(interactionLatched({}), false);
});
