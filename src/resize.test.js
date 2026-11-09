import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  clampPanelSize,
  freeEdges,
  normalizePanelSizes,
  PANEL_MIN,
  panelResizeKind,
  resizedSize,
  validPanelId,
} from "./resize.js";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const perms = readFileSync(new URL("../src-tauri/permissions/hermes.toml", import.meta.url), "utf8");
const cap = JSON.parse(readFileSync(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8"));

test("R-PN-09 resizable panels: chat, kanban, settings; never sub-orbs or the schedule column", () => {
  assert.equal(panelResizeKind("researcher"), "chat");
  assert.equal(panelResizeKind("kanban"), "kanban");
  assert.equal(panelResizeKind("settings"), "settings");
  assert.equal(panelResizeKind("cron"), "");
  assert.equal(panelResizeKind("researcher", "suborb"), "");
  assert.equal(panelResizeKind("bad id"), "");
  assert.ok(validPanelId("code-pal_2.x"));
  assert.ok(!validPanelId("bot:x") && !validPanelId("") && !validPanelId("a".repeat(129)));
});

test("R-PN-09 the free edges are the sides away from the orb, and the delta grows the box there", () => {
  assert.deepEqual(freeEdges("start", "top"), { x: "right", y: "bottom" });
  assert.deepEqual(freeEdges("end", "bottom"), { x: "left", y: "top" });
  const start = { w: 420, h: 560 };
  assert.deepEqual(resizedSize({ dir: "xy", anchor: "start", header: "top", dx: 30, dy: 40, start }), { w: 450, h: 600 });
  // An end anchor grows to the left: dragging left (negative dx) widens.
  assert.deepEqual(resizedSize({ dir: "xy", anchor: "end", header: "bottom", dx: -30, dy: -40, start }), { w: 450, h: 600 });
  assert.deepEqual(resizedSize({ dir: "x", anchor: "start", header: "top", dx: 30, dy: 40, start }), { w: 450, h: 560 });
  assert.deepEqual(resizedSize({ dir: "y", anchor: "start", header: "top", dx: 30, dy: 40, start }), { w: 420, h: 600 });
});

test("R-PN-09 sizes clamp to the per-kind minimum and to the monitor work area", () => {
  assert.deepEqual(clampPanelSize({ w: 10, h: 10 }, { kind: "chat", vw: 1920, vh: 1080 }), PANEL_MIN.chat);
  assert.deepEqual(clampPanelSize({ w: 5000, h: 5000 }, {
    kind: "chat", vw: 1920, vh: 1080, insets: { top: 0, right: 0, bottom: 48, left: 0 },
  }), { w: 1920, h: 1032 });
  assert.deepEqual(clampPanelSize({ w: 600.4, h: 700.6 }, { kind: "kanban", vw: 1920, vh: 1080 }), { w: 600, h: 701 });
  // A work area under the minimum wins: nothing hangs off screen.
  assert.deepEqual(clampPanelSize({ w: 900, h: 900 }, { kind: "kanban", vw: 400, vh: 300 }), { w: 400, h: 300 });
});

test("R-PN-09 saved sizes: only valid ids with positive whole sides survive", () => {
  assert.deepEqual(normalizePanelSizes({
    researcher: { w: 560, h: 720 },
    "bad id": { w: 1, h: 1 },
    zero: { w: 0, h: 5 },
    huge: { w: 20000, h: 10 },
    junk: "x",
  }), { researcher: { w: 560, h: 720 } });
  assert.deepEqual(normalizePanelSizes(null), {});
  assert.deepEqual(normalizePanelSizes([1, 2]), {});
});

test("R-PN-09 main.js: boxSize honours the saved size, handles persist through set_panel_size, double-click resets", () => {
  const box = main.slice(main.indexOf("function boxSize(id)"), main.indexOf("function anchorPoint("));
  assert.match(box, /const custom = savedPanelSize\(id, vw, vh\);\s*if \(custom\) return custom;/);
  assert.match(main, /function placeShellElement\(shell\) \{\s*ensureResizeHandles\(shell\);/);
  const bind = main.slice(main.indexOf("function bindResizeHandle("), main.indexOf("function bindPanelDrag("));
  // While a drag runs the shell publishes the full-screen drag rect, like a header drag.
  assert.match(bind, /state\.dragHitId = shell\.dataset\.hitId/);
  assert.match(bind, /state\.dragHitId = "";/);
  assert.match(bind, /persistPanelSize\(id, last\)/);
  assert.match(bind, /"dblclick"/);
  assert.match(bind, /persistPanelSize\(id, null\)/);
  // Only an open, settled panel resizes.
  assert.match(bind, /shell\.dataset\.state !== "panel"[\s\S]*is-morphing[\s\S]*is-collapsing/);
  assert.match(main, /invoke\("set_panel_size", \{\s*panel: id,\s*width: size \? size\.w : 0,\s*height: size \? size\.h : 0,/);
  // The docked plan follows the resized panel.
  const apply = main.slice(main.indexOf("function applyPanelResize("), main.indexOf("let panelSizeWrite"));
  assert.match(apply, /if \(shell\.dataset\.planOpen === "1"\) hostOpenPlan\(shell\);/);
  assert.match(apply, /scheduleHitSync\(\)/);
});

test("R-PN-09 Rust: set_panel_size is registered, allowed, and save_settings keeps panel_sizes", () => {
  assert.match(lib, /async fn set_panel_size\(/);
  assert.match(lib, /config::store_panel_size\(&path, panel\.trim\(\), size\)\?/);
  assert.match(lib, /generate_handler!\[[\s\S]*\bset_panel_size,/);
  assert.match(lib, /panel_sizes: previous\.panel_sizes\.clone\(\),/);
  assert.match(lib, /panel_sizes: cfg\.panel_sizes\.clone\(\),/);
  assert.match(perms, /identifier = "allow-set-panel-size"[\s\S]*?commands\.allow = \["set_panel_size"\]/);
  assert.ok(cap.permissions.includes("allow-set-panel-size"));
});

test("R-PN-09 handles: free side only, inside the shell box, click-through with Ctrl like the panel body", () => {
  assert.match(css, /\.morph > \.panel-resize \{[^}]*position: absolute;[^}]*display: none;[^}]*pointer-events: none;/s);
  assert.match(css, /\.morph\[data-state="panel"\]:not\(\.is-morphing\):not\(\.is-collapsing\) > \.panel-resize \{[^}]*display: block;[^}]*pointer-events: auto;/s);
  assert.match(css, /html\.overlay-passthrough:not\(\[data-pass="1"\]\) \.morph\[data-state="panel"\]:not\(\.is-morphing\):not\(\.is-collapsing\) > \.panel-resize \{\s*pointer-events: auto !important;/);
  assert.match(css, /\.morph\[data-anchor="end"\] > \.panel-resize\[data-dir="x"\] \{ right: auto; left: 0; \}/);
  assert.match(css, /\.morph\[data-header="bottom"\] > \.panel-resize\[data-dir="y"\] \{ bottom: auto; top: 0; \}/);
  // No handle carries data-hit-capture (that would beat Ctrl pass-through).
  const ensure = main.slice(main.indexOf("function ensureResizeHandles("), main.indexOf("function applyPanelResize("));
  assert.doesNotMatch(ensure, /hitCapture|data-hit-capture/);
});

test("R-LK-04 text size zooms the whole panel body, keeps the orb slot, and never scales twice", () => {
  const rule = /html\[data-text-size\] \.morph \.center-panel \{([^}]*)\}/s.exec(css)?.[1] || "";
  assert.match(rule, /zoom: var\(--ui-scale, 1\);/);
  assert.match(rule, /--text-scale: 1;/);
  for (const [name, px] of [["micro", 10], ["meta", 11], ["ui", 13], ["body", 14], ["title", 22], ["hero", 40]]) {
    assert.match(rule, new RegExp(`--fs-${name}: ${px}px;`));
  }
  assert.match(css, /html\[data-text-size\] \.morph\[data-anchor="start"\] \.center-panel > \.panel-header,\s*html\[data-text-size\] \.morph\[data-anchor="start"\] \.settings-head \{ padding-left: calc\(40px \/ var\(--ui-scale, 1\)\); \}/);
  assert.match(css, /html\[data-text-size\] \.morph\[data-header="bottom"\] \.center-panel > \.panel-header,\s*html\[data-text-size\] \.morph\[data-header="bottom"\] \.settings-head \{ min-height: calc\(44px \/ var\(--ui-scale, 1\)\); \}/);
  // The shell, orb and pill are not zoomed (hit rects and morph geometry stay).
  assert.doesNotMatch(css, /\.morph \{[^}]*zoom/s);
  assert.doesNotMatch(css, /\.morph-orb[^{]*\{[^}]*zoom/s);
  // The kanban ghost lives in <body>: transform-scaled, with the same font reset.
  assert.match(main, /ghost\.style\.transform = `scale\(\$\{zoom\}\)`/);
  assert.match(css, /html\[data-text-size\] \.kanban-ghost \{[^}]*--text-scale: 1;/s);
});
