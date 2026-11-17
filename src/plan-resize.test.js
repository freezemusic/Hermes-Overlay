import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  clampPlanWidth,
  defaultPlanWidth,
  normalizePanelSizes,
  planHandleBox,
  PLAN_MIN_W,
  PLAN_PANEL_KEY,
  planResizedWidth,
  planRoom,
  RESIZE_EDGE_PX,
  savedPlanWidth,
  SUBORB_PANEL_KEY,
  validPanelId,
} from "./resize.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const main = read("./main.js");
const css = read("./styles.css");
const html = read("../index.html");
const config = read("../src-tauri/src/config.rs");
const interaction = read("../src-tauri/src/interaction.rs");
const clickthrough = read("../scripts/windows-clickthrough.ps1");
const dash = read("../scripts/ci-fake-dashboard.mjs");

test("R-PL-09 the plan width is one shared panel_sizes key next to _suborb", () => {
  assert.equal(PLAN_PANEL_KEY, "_plan");
  assert.ok(validPanelId(PLAN_PANEL_KEY));
  assert.notEqual(PLAN_PANEL_KEY, SUBORB_PANEL_KEY);
  assert.deepEqual(normalizePanelSizes({ _plan: { w: 560, h: 560 } }), { _plan: { w: 560, h: 560 } });
  assert.match(config, /pub const PLAN_PANEL_KEY: &str = "_plan";/);
  assert.match(config, /let h = if id == PLAN_PANEL_KEY \{ w \}/);
  assert.match(config, /fn plan_width_is_stored_as_panel_sizes_plan_with_h_mirroring_w/);
});

test("R-PL-09 the outer edge drag widens or narrows, away from the seam", () => {
  // Right of the panel: the outer edge is the right edge, so +dx widens.
  assert.equal(planResizedWidth({ side: "right", dx: 80, start: 420 }), 500);
  assert.equal(planResizedWidth({ side: "right", dx: -100, start: 420 }), 320);
  // Left of the panel: the outer edge is the left edge, so -dx widens.
  assert.equal(planResizedWidth({ side: "left", dx: -80, start: 420 }), 500);
  assert.equal(planResizedWidth({ side: "left", dx: 100, start: 420 }), 320);
  const right = planHandleBox({ side: "right", w: 420, h: 560 });
  assert.deepEqual(right, { x: 420 - RESIZE_EDGE_PX, y: 0, w: RESIZE_EDGE_PX, h: 560 });
  assert.equal(planHandleBox({ side: "left", w: 420, h: 560 }).x, 0);
});

test("R-PL-09 the width clamps between about 240px and the work area left on its side", () => {
  assert.equal(PLAN_MIN_W, 240);
  assert.equal(clampPlanWidth(100, { room: 900 }), 240);
  assert.equal(clampPlanWidth(700, { room: 500 }), 500);
  assert.equal(clampPlanWidth(455.6, { room: 900 }), 456);
  // A runner with less than 240 left: the work area wins, nothing hangs off.
  assert.equal(clampPlanWidth(400, { room: 180 }), 180);
  // Room on each side of a 420px panel at x=300 on a 1280 screen, 40px taskbar right.
  assert.equal(planRoom({ side: "right", shellLeft: 300, shellW: 420, vw: 1280, insets: { right: 40 } }), 520);
  assert.equal(planRoom({ side: "left", shellLeft: 300, shellW: 420, vw: 1280, insets: { left: 20 } }), 280);
  // Opening: saved width, else min(420, 42vw); never past the work area less a chat panel.
  assert.equal(defaultPlanWidth(1280), 420);
  assert.equal(Math.round(defaultPlanWidth(800)), 336);
  assert.equal(savedPlanWidth(null, { vw: 1280 }), 420);
  assert.equal(savedPlanWidth({ w: 600 }, { vw: 1280 }), 600);
  assert.equal(savedPlanWidth({ w: 5000 }, { vw: 1280 }), 1280 - 320);
  assert.equal(savedPlanWidth({ w: 50 }, { vw: 1280 }), 240);
});

test("R-PL-09 the handle sits on the plan's outer edge, docked or hosted, under the header", () => {
  assert.match(html, /<aside class="plan-window plan-preview" data-role="plan" hidden>[\s\S]*<span class="plan-resize" data-role="plan-resize"/);
  const rule = css.slice(css.indexOf(".plan-window > .plan-resize {"));
  assert.match(rule, /right: 0;/);
  assert.match(rule, /top: 48px;/);
  assert.match(rule, /cursor: ew-resize;/);
  assert.match(rule, /width: var\(--resize-edge, 10px\);/);
  assert.match(css, /\.morph\[data-plan-side="left"\] > \.plan-window > \.plan-resize,\s*\.plan-hit-host\[data-plan-side="left"\] > \.plan-window > \.plan-resize \{\s*right: auto;\s*left: 0;/);
  assert.match(css, /html\[data-pass="1"\] \.plan-window > \.plan-resize \{\s*pointer-events: none !important;/);
  // The design width still feeds the first layout through --plan-w.
  assert.match(css, /width: var\(--plan-w, min\(420px, 42vw\)\);/);
});

test("R-PL-09 the drag uses the panel grow capture, saves _plan, and never touches the 280ms open", () => {
  const bind = main.slice(main.indexOf("function bindPlanResize("), main.indexOf("/** R-SO-03/R-SO-05"));
  assert.match(bind, /if \(!planResizable\(shell, section\)\) return;/);
  assert.match(bind, /captureDragHits\(shell, "plan-resize-start"\)/);
  assert.match(bind, /settleDragHits\(shell, "plan-resize-end"\)/);
  assert.match(bind, /state\.dragHitId = shell\.dataset\.hitId/);
  assert.match(bind, /clampPlanWidth\(planResizedWidth\(\{ side, dx, start \}\), \{ room \}\)/);
  assert.match(bind, /persistPanelSize\(PLAN_PANEL_KEY, \{ w: last, h: last \}\)/);
  assert.match(bind, /persistPanelSize\(PLAN_PANEL_KEY, null\)/);
  assert.match(bind, /debugLog\("plan-resized"/);
  // Capture happens on the first move, before the width changes.
  assert.ok(bind.indexOf("captureDragHits") < bind.indexOf("applyPlanWidth(shell, last)"));
  const resizable = main.slice(main.indexOf("function planResizable("), main.indexOf("function applyPlanWidth("));
  assert.match(resizable, /seamPhase\(section\) === "growing"/);
  assert.match(resizable, /is-collapsing/);
  assert.match(resizable, /is-plan-arming/);
  // Height stays the chat panel's: the width path writes width only.
  const apply = main.slice(main.indexOf("function applyPlanWidth("), main.indexOf("function planRoomFor("));
  assert.doesNotMatch(apply, /style\.height|maxHeight/);
  assert.match(apply, /placePlanHost\(shell\)/);
  assert.match(apply, /holdPlanClip\(shell, 1\)/);
  // Opening reads the saved width; the hit union reads dataset.planWidth.
  assert.match(main, /function planWidthPx\(\) \{\s*return savedPlanWidth\(savedPlanSize\(\)/);
  const hit = main.slice(main.indexOf("function panelHitRect("), main.indexOf("function announceOrbHits("));
  assert.match(hit, /Number\(shell\.dataset\.planWidth\) \|\| planWidthPx\(\)/);
  // Wired for the main and every sub-orb plan through wirePlanWindow.
  assert.match(main, /dismissPlan\(threadFor\(id\)\);\s*paintPlan\(id, \{ force: true \}\);\s*\}\);\s*bindPlanResize\(section, id\);/);
  // R-PL-04 stays 280ms cubic-bezier(.3,.6,.2,1).
  const morph = read("./morph.js");
  assert.match(morph, /PLAN_GROW_MS = 280/);
});

test("R-PL-09 Rust latches a press on the docked plan like the panel grip", () => {
  assert.match(interaction, /fn a_plan_width_drag_latches_on_the_docked_plan_and_keeps_the_window\(\)/);
});

test("R-PL-09 / R-PL-01 the Windows CI opens the history plan from 睇計劃 and drags its edge", () => {
  assert.match(dash, /name: "write_file", arguments: JSON\.stringify\(\{ path: "\.hermes\/plans\/ship\.md", content: PLAN_FILE \}\)/);
  assert.match(clickthrough, /Note-Fail "plan-not-auto" "the history plan opened by itself"/);
  assert.match(clickthrough, /Assert-Captured "plan-chip-open" \$chip0\.x \$chip0\.y/);
  assert.match(clickthrough, /Assert-Captured "suborb-plan-chip-open"/);
  assert.match(clickthrough, /function Assert-PlanWidthDrag\(/);
  assert.match(clickthrough, /Assert-PlanWidthDrag "plan-width" "field"/);
  assert.match(clickthrough, /Read-SavedPanelSize "_plan"/);
  assert.match(clickthrough, /does not cover the wider plan/);
  assert.match(main, /debugLog\("plan-resize-at", line\)/);
});
