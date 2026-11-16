import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  clampPanelSize,
  coversView,
  dragCaptureRects,
  freeEdges,
  normalizePanelSizes,
  PANEL_MIN,
  panelResizeKind,
  panelSizeKey,
  physicalPixelsOutside,
  RESIZE_CORNER_PX,
  RESIZE_EDGE_INSET_PX,
  RESIZE_EDGE_PX,
  resizeHandleBoxes,
  resizedSize,
  settledDragRects,
  SUBORB_PANEL_KEY,
  validPanelId,
} from "./resize.js";
const interactionRs = readFileSync(new URL("../src-tauri/src/interaction.rs", import.meta.url), "utf8");
const clickthrough = readFileSync(new URL("../scripts/windows-clickthrough.ps1", import.meta.url), "utf8");

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
const morph = readFileSync(new URL("./morph.js", import.meta.url), "utf8");
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
  // An open panel resizes while is-morphing is still held for a docked plan.
  // Collapse does not.
  const guard = bind.slice(bind.indexOf("pointerdown"), bind.indexOf("const id = shell.dataset.botId"));
  assert.match(guard, /shell\.dataset\.state !== "panel"[\s\S]*is-collapsing/);
  assert.doesNotMatch(guard, /is-morphing/);
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
  assert.match(css, /\.morph\[data-state="panel"\]:not\(\.is-collapsing\) > \.panel-resize \{[^}]*display: block;[^}]*pointer-events: auto;/s);
  assert.match(css, /html\.overlay-passthrough:not\(\[data-pass="1"\]\) \.morph\[data-state="panel"\]:not\(\.is-collapsing\) > \.panel-resize \{\s*pointer-events: auto !important;/);
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

// ---- R-PN-09 Windows fix (Devon 2026-11-10: no double-arrow cursor) ----

const COMBOS = [
  ["start", "top"],
  ["end", "top"],
  ["start", "bottom"],
  ["end", "bottom"],
];

test("R-PN-09 Windows: grab zones are 10px deep (12px corner) and the stylesheet uses the same numbers", () => {
  assert.ok(RESIZE_EDGE_PX >= 10, "the old 6px strip was 7.5 physical px at 125%");
  assert.ok(RESIZE_CORNER_PX >= RESIZE_EDGE_PX);
  const vars = /\.morph \{\s*--resize-edge: (\d+)px;\s*--resize-corner: (\d+)px;\s*--resize-inset: (\d+)px;\s*\}/.exec(css);
  assert.ok(vars, "--resize-edge / --resize-corner / --resize-inset on .morph");
  assert.equal(Number(vars[1]), RESIZE_EDGE_PX);
  assert.equal(Number(vars[2]), RESIZE_CORNER_PX);
  assert.equal(Number(vars[3]), RESIZE_EDGE_INSET_PX);
  assert.match(css, /\.morph > \.panel-resize\[data-dir="x"\] \{[^}]*width: var\(--resize-edge\);/);
  assert.match(css, /\.morph > \.panel-resize\[data-dir="y"\] \{[^}]*height: var\(--resize-edge\);/);
  assert.match(css, /\.morph > \.panel-resize\[data-dir="xy"\] \{[^}]*width: var\(--resize-corner\); height: var\(--resize-corner\);/);
  // Never outside the shell box: a negative offset is clipped by the shell
  // clip-path and is outside the Rust panel rect (click-through on Windows).
  const rules = css.slice(css.indexOf("R-PN-09: resize handles"), css.indexOf(".morph.is-resizing,"));
  assert.doesNotMatch(rules, /(?:top|right|bottom|left):\s*-\d/);
  // Above the HUD corner brackets (z-index 8) that sit on the free corner.
  const z = /\.morph > \.panel-resize \{[^}]*z-index: (\d+);/s.exec(css);
  const hud = /\.morph \.center-panel > \.hud-corner,\s*\.morph \.plan-window > \.hud-corner \{\s*z-index: (\d+);/.exec(css);
  assert.ok(z && hud && Number(z[1]) > Number(hud[1]));
});

test("R-PN-09 Windows: every handle box is inside the panel box, on the free sides, for every anchor", () => {
  for (const [anchor, header] of COMBOS) {
    for (const [w, h] of [[420, 560], [960, 760], [320, 240], [680, 760]]) {
      const boxes = resizeHandleBoxes({ w, h, anchor, header });
      const edges = freeEdges(anchor, header);
      for (const [dir, b] of Object.entries(boxes)) {
        assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= w && b.y + b.h <= h, `${anchor}/${header} ${dir} inside`);
        assert.ok(b.w >= RESIZE_EDGE_PX && b.h >= RESIZE_EDGE_PX, `${dir} deep enough`);
      }
      assert.equal(boxes.x.x === 0, edges.x === "left");
      assert.equal(boxes.y.y === 0, edges.y === "top");
      // The vertical strip never covers the header row (close button, orb slot).
      if (header === "top") assert.ok(boxes.x.y >= RESIZE_EDGE_INSET_PX);
      else assert.ok(boxes.x.y + boxes.x.h <= h - RESIZE_EDGE_INSET_PX);
    }
  }
});

test("R-PN-09 Windows: at 100–200% scaling every physical pixel of a handle is inside the published panel rect", () => {
  // Same mapping as interaction.rs css_point_from_screen + windows_cursor_ignored
  // (panel pad 0): integer GetCursorPos px, minus the window origin, over scale.
  for (const scale of [1, 1.25, 1.5, 1.75, 2]) {
    for (const [anchor, header] of COMBOS) {
      for (const left of [0, 503.09375, 1174, 1586.4]) {
        const top = 42.6;
        const w = 420;
        const h = 560;
        const rect = { x: left, y: top, w, h };
        const boxes = resizeHandleBoxes({ w, h, anchor, header });
        for (const [dir, b] of Object.entries(boxes)) {
          const view = { x: left + b.x, y: top + b.y, w: b.w, h: b.h };
          const { total, outside } = physicalPixelsOutside(view, rect, scale, { x: 0, y: 0 });
          assert.equal(outside, 0, `${scale} ${anchor}/${header} ${dir} at ${left}`);
          assert.ok(total > 0);
        }
        // Landing depth across the free vertical edge, in physical px.
        assert.ok(Math.floor(RESIZE_EDGE_PX * scale) >= 10);
      }
    }
  }
  // The check does catch a handle that pokes past the edge.
  const rect = { x: 100, y: 100, w: 420, h: 560 };
  const poking = { x: 100 + 420 - 6, y: 150, w: 10, h: 100 };
  assert.ok(physicalPixelsOutside(poking, rect, 1.25).outside > 0);
});

test("R-PN-09 Windows: the corner stays clear of the 特細 send button (12.8px from the corner)", () => {
  // The composer sits 16px in at the standard size; 特細 zooms the body by 0.8.
  assert.ok(RESIZE_CORNER_PX < 16 * 0.8);
  assert.ok(RESIZE_EDGE_PX < 16 * 0.8);
});

test("R-PN-09 Windows: the grip is visible at rest and the edge shows a hairline on hover", () => {
  assert.match(css, /\.morph > \.panel-resize\[data-dir="xy"\]::after \{[^}]*opacity: \.7;[^}]*linear-gradient\(135deg/s);
  assert.match(css, /\.morph > \.panel-resize:hover::before,\s*\.morph\.is-resizing > \.panel-resize::before \{ opacity: \.55; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.morph > \.panel-resize::before,\s*\.morph > \.panel-resize::after \{ transition: none; \}/);
  // No idle loop animation (R-PN-08).
  const rules = css.slice(css.indexOf("R-PN-09: resize handles"), css.indexOf(".morph.is-resizing,"));
  assert.doesNotMatch(rules, /animation:/);
});

test("R-PN-09 Windows: Ctrl still passes through, and the Rust panel rule has no outside pad", () => {
  // Handles never opt into data-hit-capture; while Ctrl is held the Rust poll
  // drops panel capture, so the whole window, handles included, passes through.
  const ensure = main.slice(main.indexOf("function ensureResizeHandles("), main.indexOf("function applyPanelResize("));
  assert.doesNotMatch(ensure, /hitCapture|data-hit-capture/);
  const ignored = interactionRs.slice(interactionRs.indexOf("pub fn windows_cursor_ignored("), interactionRs.indexOf("fn sync_os_hit_region("));
  assert.match(ignored, /let pad = if is_panel_hit\(rect\) \{\s*0\.0/);
  assert.match(interactionRs, /fn resize_strip_inside_panel_captures_at_125_percent\(/);
});

test("R-PN-09 Windows: the debug log names handle boxes, and the Windows CI checks the real cursor", () => {
  const log = main.slice(main.indexOf("function logResizeHandles("), main.indexOf("function bindResizeHandle("));
  assert.match(log, /if \(!debugFile\.enabled/);
  assert.match(log, /classList\.contains\("is-collapsing"\)\) return;/);
  assert.doesNotMatch(log, /contains\("is-morphing"\)/);
  assert.match(log, /debugLog\("resize-at"/);
  assert.match(main, /logResizeHandles\(shell\);/);
  assert.match(main, /function logPlanHitBox\(shell\) \{\s*armResizeLog\(shell\);/);
  assert.match(clickthrough, /GetCursorInfo/);
  assert.match(clickthrough, /resize-at id=panel:field/);
  assert.match(clickthrough, /"resize-cursor-x"/);
  assert.match(clickthrough, /\$handles\.xy\.x \+ 1/);
  assert.match(clickthrough, /after-nudge=\$got/);
  assert.match(clickthrough, /Dodge-Point "kanban"/);
  assert.match(clickthrough, /Assert-ThroughHeld "resize-ctrl-through"/);
  const hostZ = morph.slice(morph.indexOf("export function placePlanHost"), morph.indexOf("const PLAN_CONTROL_ROLES"));
  assert.match(hostZ, /const under = String\(Math\.max\(0, Number\.parseInt\(z, 10\) - 1\)\);/);
});

test("R-PN-09 grow: drag start swaps this panel's rects for one full-view rect and keeps the rest", () => {
  const previous = [
    { id: "bot:kanban", x: 490, y: 42, w: 44, h: 44, z: 0, round: true },
    { id: "panel:field", x: 120, y: 42, w: 740, h: 560, z: 1, round: false },
    { id: "close:field", x: 500, y: 50, w: 24, h: 24, z: 2, round: false },
    { id: "settings", x: 300, y: 100, w: 400, h: 400, z: 1, round: false },
  ];
  const out = dragCaptureRects({
    previous,
    ids: ["panel:field", "panel:field", "close:field"],
    id: "panel:field",
    vw: 1024,
    vh: 768,
  });
  assert.deepEqual(out.map((r) => r.id), ["bot:kanban", "settings", "panel:field"]);
  assert.deepEqual(out.at(-1), { id: "panel:field", x: 0, y: 0, w: 1024, h: 768, z: 1000, round: false });
  assert.ok(coversView(out.at(-1), 1024, 768));
  // The frozen list itself is not changed.
  assert.equal(previous.length, 4);
  assert.equal(previous[1].w, 740);
});

test("R-PN-09 grow: drag end puts the panel back at its new size, never the full-view rect", () => {
  const previous = [
    { id: "bot:kanban", x: 490, y: 42, w: 44, h: 44, z: 0, round: true },
    { id: "panel:field", x: 0, y: 0, w: 1024, h: 768, z: 1000, round: false },
  ];
  const grown = { id: "panel:field", x: 120, y: 42, w: 890, h: 690, z: 1, round: false };
  const out = settledDragRects({ previous, ids: ["panel:field", "close:field"], rect: grown, vw: 1024, vh: 768 });
  assert.deepEqual(out, [previous[0], grown]);
  assert.ok(!out.some((r) => coversView(r, 1024, 768)));
  // A point in the strip the grow added (old right edge 860, new 1010) is inside.
  const strip = { x: 930, y: 300 };
  const panel = out.find((r) => r.id === "panel:field");
  assert.ok(strip.x >= panel.x && strip.x < panel.x + panel.w && strip.y >= panel.y && strip.y < panel.y + panel.h);
  // An empty rect only drops the drag rect.
  assert.deepEqual(settledDragRects({ previous, ids: ["panel:field"], rect: { id: "panel:field", x: 0, y: 0, w: 0, h: 0 }, vw: 1024, vh: 768 }), [previous[0]]);
  assert.ok(!coversView({ x: 150, y: 66, w: 680, h: 660 }, 1024, 768));
});

test("R-PN-09 grow: resize and header drags capture and settle even while hits are frozen", () => {
  const bind = main.slice(main.indexOf("function bindResizeHandle("), main.indexOf("function bindPanelDrag("));
  assert.match(bind, /captureDragHits\(shell, "resize-start"\)/);
  assert.match(bind, /settleDragHits\(shell, "resize-end"\)/);
  assert.match(bind, /settleDragHits\(shell, "resize-reset"\)/);
  assert.match(bind, /debugLog\("panel-resized"/);
  const drag = main.slice(main.indexOf("function bindPanelDrag("), main.indexOf("function removeBotPanels("));
  assert.match(drag, /captureDragHits\(shell, "header-drag-start"\)/);
  assert.match(drag, /settleDragHits\(shell, "header-drag-end"\)/);
  assert.doesNotMatch(drag, /flushHits\(\)/);
  const capture = main.slice(main.indexOf("function captureDragHits("), main.indexOf("function settleDragHits("));
  // Blocked or not, the full-view rect is sent; blocked goes straight to sendHitRects with force.
  assert.match(capture, /const blocked = hitBlockReason\(\);/);
  assert.match(capture, /dragCaptureRects\(/);
  assert.match(capture, /sendHitRects\(rects, "drag-capture", true\)/);
  const settle = main.slice(main.indexOf("function settleDragHits("), main.indexOf("function flushHits("));
  assert.match(settle, /panelHitRect\(shell\)/);
  assert.match(settle, /settledDragRects\(/);
  assert.match(settle, /sendHitRects\(rects, "drag-settle", true\)/);
  // The full-view capture never becomes the stable panel list a plan-open dodge reuses.
  assert.match(main, /tag !== "orb-dodge-return" && tag !== "drag-capture"/);
  assert.match(main, /debugLog\("panel-size-saved"/);
});

test("R-PN-09 grow: Rust keeps the window while a press that began on a panel is held", () => {
  assert.match(interactionRs, /pub fn panel_press_latch\(/);
  assert.match(interactionRs, /pub fn cursor_on_captured_panel\(/);
  assert.match(interactionRs, /let ignore = windows_cursor_ignored_latched\(\s*\*ignoring == Some\(false\)/);
  assert.match(interactionRs, /ignore && !latched/);
});

test("R-PN-09 grow: the Windows CI drags a free corner 150px out, with a plan open and with none", () => {
  assert.match(clickthrough, /function Assert-GrowDrag\(/);
  assert.match(clickthrough, /Assert-GrowDrag "grow-with-plan"/);
  assert.match(clickthrough, /Assert-GrowDrag "grow-no-plan"/);
  assert.match(clickthrough, /panel_sizes/);
  assert.match(clickthrough, /\[ClickProbe\]::MoveTo\(/);
});

test("R-PN-09 sub-orb session panels resize and share one valid panel_sizes key", () => {
  assert.equal(panelResizeKind("suborb:field:side-task", "suborb"), "chat");
  assert.equal(panelSizeKey("suborb:field:side-task", "suborb"), SUBORB_PANEL_KEY);
  assert.equal(panelSizeKey("suborb:researcher:api_123", "suborb"), SUBORB_PANEL_KEY);
  assert.ok(validPanelId(SUBORB_PANEL_KEY));
  // The +N chip has no panel.
  assert.equal(panelResizeKind("suborb-more:field", "suborb"), "");
  assert.equal(panelSizeKey("suborb-more:field", "suborb"), "");
  // Main panels keep their own key; the schedule column still does not resize.
  assert.equal(panelSizeKey("field"), "field");
  assert.equal(panelSizeKey("kanban"), "kanban");
  assert.equal(panelSizeKey("cron"), "");
  // The raw sub-orb id is not a panel id, so it can never reach set_panel_size.
  assert.ok(!validPanelId("suborb:field:side-task"));
  // Sub-orb placement reads the shared size for the cascade and the box.
  const place = main.slice(main.indexOf("function placeSuborbShell"), main.indexOf("function wireSuborbPanel"));
  assert.match(place, /ensureResizeHandles\(shell\)/);
  assert.match(place, /const panelBox = suborbPanelSize\(vw, vh\)/);
  assert.match(place, /placeShell\(cx, cy, panelBox\.w, panelBox\.h, vw, vh\)/);
  assert.match(place, /panelW: panelBox\.w,\s*panelH: panelBox\.h,/);
  assert.match(main, /function suborbPanelSize\(vw, vh\) \{\s*return savedPanelSize\(SUBORB_PANEL_KEY, vw, vh\)/);
  const bind = main.slice(main.indexOf("function bindResizeHandle("), main.indexOf("function bindPanelDrag("));
  assert.match(bind, /const id = panelSizeKey\(bot, shell\.dataset\.kind\)/);
  assert.match(main, /function ensureResizeHandles\(shell\) \{[^}]*panelSizeKey\(/s);
});

test("R-PN-09 the Windows CI grows a pinned fake sub-orb panel too", () => {
  assert.match(clickthrough, /"suborb_pins": \{ "field": \["side-task"\] \}/);
  assert.match(clickthrough, /Assert-GrowDrag "grow-suborb-no-plan" \$subBot "_suborb"/);
  assert.match(clickthrough, /Assert-GrowDrag "grow-suborb-with-plan" \$subBot "_suborb"/);
  const dash = readFileSync(new URL("../scripts/ci-fake-dashboard.mjs", import.meta.url), "utf8");
  assert.match(dash, /id: "side-task"/);
});

test("R-PN-08 an instant (reduced-motion) collapse still commits the closed orb state", () => {
  const instant = main.slice(main.indexOf("if (reducedMotion() || !(duration > 0)) {"), main.indexOf("if (armedDone) {"));
  assert.match(instant, /if \(toState === "orb"\) commitClosedShell\(shell\);/);
});
