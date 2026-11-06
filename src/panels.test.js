import assert from "node:assert/strict";
import test from "node:test";
import { closePanel, fromOrbDelta, openPanel, panelStackOffset } from "./panels.js";

test("opening one orb does not close another", () => {
  const first = openPanel([], "planner");
  const both = openPanel(first, "coder");
  assert.deepEqual(both, ["planner", "coder"]);
  assert.deepEqual(openPanel(both, "planner"), ["planner", "coder"]);
  assert.deepEqual(closePanel(both, "planner"), ["coder"]);
  assert.deepEqual(closePanel(both, "missing"), ["planner", "coder"]);
});

test("panel motion delta points at the orb centre", () => {
  const delta = fromOrbDelta({ x: 10, y: 20, w: 40, h: 40 }, { x: 100, y: 80, w: 200, h: 100 });
  assert.equal(delta.x, 30 - 200);
  assert.equal(delta.y, 40 - 130);
  assert.deepEqual(panelStackOffset(0), { x: 0, y: 0 });
  assert.deepEqual(panelStackOffset(2), { x: 56, y: 56 });
});
