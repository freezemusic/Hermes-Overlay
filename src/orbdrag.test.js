import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ORB_DRAG_THRESHOLD_PX,
  clampOrbPoint,
  dragStarted,
  findDodgeSpot,
  haloBox,
  normalizeOrbPositions,
  orbBounds,
  orbDragAllowed,
  orbDraggable,
  planOrbDodges,
  pointCovered,
  suborbRestCentre,
  suborbTether,
  validOrbId,
  validSuborbOrbId,
} from "./orbdrag.js";
import { ORB, ORB_HALO_PX, orbCoveredBy } from "./morph.js";

const SCREEN = { vw: 1440, vh: 900, insets: { top: 0, right: 0, bottom: 48, left: 0 } };
const PANEL = { x: 60, y: 60, w: 420, h: 560 };
const discAt = (p) => ({ x: p.x - ORB / 2, y: p.y - ORB / 2, w: ORB, h: ORB });

test("R-OB-08 ids, draggable kinds and saved spots", () => {
  assert.ok(validOrbId("researcher") && validOrbId("kanban") && validOrbId("code-pal_2.x"));
  assert.ok(!validOrbId("") && !validOrbId("bot:x") && !validOrbId("a b") && !validOrbId("a".repeat(129)));
  assert.ok(orbDraggable("bot", "researcher", "orb"));
  assert.ok(orbDraggable("bot", "kanban", "orb"));
  assert.ok(!orbDraggable("bot", "researcher", "panel"), "an open panel moves by its header (R-PN-03)");
  assert.ok(!orbDraggable("bot", "researcher", "pill"));
  assert.ok(orbDraggable("suborb", "suborb:researcher:job1", "orb"), "a sub-orb drags like a main orb (Devon 2026-11-13)");
  assert.ok(!orbDraggable("suborb", "suborb:researcher:job1", "panel"), "an open sub-orb panel moves by its header");
  assert.ok(!orbDraggable("suborb", "researcher::s1", "orb"), "only a real sub-orb id drags");
  assert.ok(!orbDraggable("suborb", "suborb-more:researcher", "orb"), "the +N badge stays on the fan");
  assert.deepEqual(normalizeOrbPositions({
    ok: { x: 640.4, y: 300.6 },
    neg: { x: -1, y: 2 },
    big: { x: 20000, y: 1 },
    str: { x: "1", y: 2 },
    "bad id": { x: 1, y: 1 },
  }), { ok: { x: 640, y: 301 } });
  assert.deepEqual(normalizeOrbPositions(null), {});
  assert.deepEqual(normalizeOrbPositions([1]), {});
});

test("R-OB-08 clamp keeps the disc inside the work area (screen minus taskbar)", () => {
  const b = orbBounds({ ...SCREEN, orb: ORB });
  assert.equal(b.minX, ORB / 2 + 4);
  assert.equal(b.maxX, 1440 - ORB / 2 - 4);
  assert.equal(b.minY, ORB / 2 + 4);
  // 900 - 48 taskbar - 12 clear - 22 radius
  assert.equal(b.maxY, 900 - 48 - 12 - ORB / 2);
  assert.deepEqual(clampOrbPoint({ x: -50, y: 5000 }, SCREEN), { x: b.minX, y: b.maxY });
  assert.deepEqual(clampOrbPoint({ x: 700.4, y: 400.6 }, SCREEN), { x: 700, y: 401 });
  // A left taskbar moves the floor.
  assert.equal(clampOrbPoint({ x: 0, y: 400 }, { vw: 1440, vh: 900, insets: { left: 60 } }).x, 60 + ORB / 2 + 4);
});

test("R-OB-08 the drag starts after a few px and follows the Ctrl+click rule", () => {
  assert.ok(!dragStarted(2, 2));
  assert.ok(dragStarted(ORB_DRAG_THRESHOLD_PX, 0));
  assert.ok(dragStarted(4, 4));
  assert.ok(orbDragAllowed({ supported: false }), "no OS hit test: the orb is clickable, so draggable");
  assert.ok(!orbDragAllowed({ supported: true }), "a press without the modifier never drags");
  assert.ok(orbDragAllowed({ supported: true, ctrlAtDown: true }));
  assert.ok(orbDragAllowed({ supported: true, modifierNow: true }));
  assert.ok(orbDragAllowed({ supported: true, pressFrozen: true }));
});

test("R-OB-08 coverage uses the same disc + halo box as R-OB-05", () => {
  const home = { x: 120, y: 200 };
  assert.equal(pointCovered(home, [PANEL]), orbCoveredBy(discAt(home), [PANEL]));
  const clear = { x: 60 + 420 + ORB / 2 + ORB_HALO_PX + 1, y: 200 };
  assert.equal(pointCovered(clear, [PANEL]), false);
  assert.equal(orbCoveredBy(discAt(clear), [PANEL]), false);
  assert.deepEqual(haloBox({ x: 0, y: 0 }), { x: -56, y: -56, w: 112, h: 112 });
});

test("R-OB-08 a covered orb moves to the nearest free spot outside the panel", () => {
  // Home near the panel's right edge: the right side is nearest.
  const home = { x: 440, y: 300 };
  const spot = findDodgeSpot(home, { covers: [PANEL], screen: SCREEN });
  assert.ok(spot);
  assert.equal(spot.y, 300, "slides straight out, same row");
  assert.ok(spot.x > PANEL.x + PANEL.w, "to the right of the panel");
  assert.equal(orbCoveredBy(discAt(spot), [PANEL]), false, "no longer covered, so it does not fade");
  // Home near the left screen edge with a panel at x=60: left has no room for disc + halo... but
  // the disc may sit at the screen edge while the halo leaves the screen.
  const edge = findDodgeSpot({ x: 80, y: 300 }, { covers: [PANEL], screen: SCREEN });
  assert.ok(edge);
  assert.equal(orbCoveredBy(discAt(edge), [PANEL]), false);
  const b = orbBounds(SCREEN);
  assert.ok(edge.x >= b.minX && edge.x <= b.maxX && edge.y >= b.minY && edge.y <= b.maxY, "inside the work area");
});

test("R-OB-08 dodged orbs do not stack on each other or on resting orbs", () => {
  const orbs = [
    { id: "a", home: { x: 440, y: 300 } },
    { id: "b", home: { x: 440, y: 310 } },
    { id: "c", home: { x: 560, y: 300 } }, // resting, not covered
  ];
  const plan = planOrbDodges(orbs, [PANEL], SCREEN);
  assert.equal(plan.get("c").dodged, false);
  assert.deepEqual(plan.get("c").spot, { x: 560, y: 300 });
  const a = plan.get("a").spot;
  const b = plan.get("b").spot;
  assert.ok(a && b);
  const apart = ORB + 12;
  for (const [p, q] of [[a, b], [a, orbs[2].home], [b, orbs[2].home]]) {
    assert.ok(Math.hypot(p.x - q.x, p.y - q.y) >= apart - 0.01, `${JSON.stringify(p)} vs ${JSON.stringify(q)}`);
  }
  for (const p of [a, b]) assert.equal(orbCoveredBy(discAt(p), [PANEL]), false);
});

test("R-OB-08 a parked dodge holds while still valid (no hopping), and home wins once clear", () => {
  const home = { x: 440, y: 300 };
  const first = planOrbDodges([{ id: "a", home }], [PANEL], SCREEN).get("a").spot;
  // The panel grows by 1px: the orb keeps its spot.
  const grown = { ...PANEL, w: PANEL.w + 1 };
  const kept = planOrbDodges([{ id: "a", home, current: first }], [grown], SCREEN).get("a");
  assert.deepEqual(kept.spot, first);
  // Panel closed: home again.
  const back = planOrbDodges([{ id: "a", home, current: first }], [], SCREEN).get("a");
  assert.equal(back.dodged, false);
  assert.deepEqual(back.spot, home);
});

test("R-OB-08 two panels side by side: the spot clears both", () => {
  const right = { x: 480, y: 60, w: 420, h: 560 };
  const home = { x: 470, y: 300 };
  const spot = findDodgeSpot(home, { covers: [PANEL, right], screen: SCREEN });
  assert.ok(spot);
  assert.equal(orbCoveredBy(discAt(spot), [PANEL, right]), false);
});

test("R-OB-08 no room at all: null, so the old fade stays the fallback", () => {
  const full = { x: 0, y: 0, w: 1440, h: 900 };
  assert.equal(findDodgeSpot({ x: 700, y: 400 }, { covers: [full], screen: SCREEN }), null);
  const plan = planOrbDodges([{ id: "a", home: { x: 700, y: 400 } }], [full], SCREEN);
  assert.equal(plan.get("a").spot, null);
});

test("R-OB-08 main.js: anchor order, drag rule, persistence through set_orb_position, dodge hook", () => {
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const anchor = main.slice(main.indexOf("function anchorPoint(id)"), main.indexOf("function defaultOrbPoint(id)"));
  assert.match(anchor, /state\.anchors\[id\][\s\S]*state\.orbDrag[\s\S]*state\.orbDodge[\s\S]*homeOrbPoint\(id\)/);
  assert.match(main, /invoke\("set_orb_position", \{\s*orb: id,/);
  assert.match(main, /const open = !droppedOrb && orbOpenFromPress\(/, "a drag never opens the panel");
  assert.match(main, /function noteOrbCover\(\) \{\s*reconcileOrbDodges\(\);/);
  assert.match(main, /is-collapsing"\) \|\| shell\.dataset\.intent === "close"\) return;/);
  assert.match(main, /sendHitRects\(collectHits\(\), "orb-dodge-return", true\);/);
  assert.match(main, /state\.orbDodge\[shell\.dataset\.botId\]/);
  assert.match(main, /tag === "orb-dodge-return" && hitBlockReason\(\) === "plan-open"/);
  assert.match(main, /if \(target === "orb"\) reconcileOrbDodges\(\);/);
  const closed = main.slice(main.indexOf("function commitClosedShell(shell)"), main.indexOf("function restingTransform("));
  assert.match(closed, /noteOrbCover\(\);\s*sendHitRects\(collectHits\(\), "orb-dodge-return", true\);/);
  assert.match(main, /const parked = shell\._orbGlide \? coverDisc\(shell\) : null;/);
  const move = main.slice(main.indexOf("function moveOrbDrag(event)"), main.indexOf("function endOrbDrag(event)"));
  assert.match(move, /orbDragAllowed\(\{[\s\S]*ctrlAtDown: orbGesture\.ctrlAtDown === true/);
  assert.match(move, /state\.dragHitId = shell\.dataset\.hitId/, "full-view capture rect while dragging, like a header drag");
  assert.match(move, /scheduleHitSync\("orb-drag"\)/);
  const relayout = main.slice(main.indexOf("function relayoutOrb(shell)"), main.indexOf("function glideOrb(shell, from)"));
  assert.match(relayout, /point\.x - ax/);
  assert.doesNotMatch(relayout, /placeShellElement/, "a panel-sized refit clamps the disc off the dodge spot");
  const glide = main.slice(main.indexOf("function glideOrb(shell, from)"), main.indexOf("function restingMainOrb(shell)"));
  assert.match(glide, /translate:/);
  assert.doesNotMatch(glide, /transform:/, "the morph owns transform");
  assert.match(glide, /flushHits\("orb-glide"\)/, "hit rects follow the glide every frame");
  assert.ok(glide.indexOf("_orbGlide?.cancel") < glide.indexOf("const to = orbCentre(shell)"), "a retarget measures the new layout without the old glide");
});

test("R-OB-08 Rust: set_orb_position is registered, allowed, and save_settings keeps orb_positions", () => {
  const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const cfg = readFileSync(new URL("../src-tauri/src/config.rs", import.meta.url), "utf8");
  const perms = readFileSync(new URL("../src-tauri/permissions/hermes.toml", import.meta.url), "utf8");
  const caps = readFileSync(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8");
  assert.match(lib, /async fn set_orb_position\(/);
  assert.match(lib, /generate_handler!\[[\s\S]*\bset_orb_position,/);
  assert.match(lib, /orb_positions: previous\.orb_positions\.clone\(\),/);
  assert.match(lib, /orb_positions: cfg\.orb_positions\.clone\(\),/);
  assert.match(perms, /identifier = "allow-set-orb-position"[\s\S]*?commands\.allow = \["set_orb_position"\]/);
  assert.match(caps, /"allow-set-orb-position"/);
  assert.match(cfg, /skip_serializing_if = "BTreeMap::is_empty",\s*deserialize_with = "lenient_orb_positions"\s*\)\]\s*pub orb_positions/);
});

test("R-OB-08 a drop stays exactly where it lands: no home ring, no snap (Devon 「我就是要到處拖」)", () => {
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const mod = readFileSync(new URL("./orbdrag.js", import.meta.url), "utf8");
  assert.doesNotMatch(main, /snapsHome|orb-home-ghost|HomeGhost/);
  assert.doesNotMatch(css, /orb-home-ghost/);
  assert.doesNotMatch(mod, /export function snapsHome|ORB_SNAP_HOME_PX/);
  const end = main.slice(main.indexOf("function endOrbDrag(event)"), main.indexOf("let hitDeferLogged"));
  assert.match(end, /state\.orbPositions\[drag\.id\] = \{ x: point\.x, y: point\.y \};\s*void persistOrbPosition\(drag\.id, point\);/);
  assert.doesNotMatch(end, /persistOrbPosition\(drag\.id, null\)/);
});

test("R-OB-08 Settings 「所有光球返原位」: both languages, disabled until an orb moved, one reset command", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const look = readFileSync(new URL("./look.js", import.meta.url), "utf8");
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const perms = readFileSync(new URL("../src-tauri/permissions/hermes.toml", import.meta.url), "utf8");
  const caps = readFileSync(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8");
  assert.match(html, /<button type="button" id="btn-reset-orbs" class="icon-btn" title="所有光球返原位" disabled>所有光球返原位<\/button>/);
  assert.match(look, /"所有光球返原位": "Reset all orb positions",/);
  assert.match(look, /"揸住 Ctrl 拖光球可以擺去任何位置。": "Hold Ctrl and drag an orb to put it anywhere\.",/);
  const sync = main.slice(main.indexOf("function syncOrbResetButton()"), main.indexOf("async function resetAllOrbPositions()"));
  assert.match(sync, /movedOrbIds\(\)\.length === 0/);
  const reset = main.slice(main.indexOf("async function resetAllOrbPositions()"), main.indexOf("/** pointerdown on a resting main orb"));
  assert.match(reset, /state\.orbPositions\[id\] = null/);
  assert.match(reset, /glideOrb\(shell, from\)/, "slides home");
  assert.match(reset, /invoke\("reset_orb_positions"\)/);
  assert.match(main, /\$\("#btn-reset-orbs"\)\?\.addEventListener\("click"/);
  assert.match(main, /function fillSettings\(settings\) \{[\s\S]*?syncOrbResetButton\(\);/);
  assert.match(lib, /async fn reset_orb_positions\(/);
  assert.match(lib, /config::clear_orb_positions\(&path\)\?;/);
  assert.match(lib, /generate_handler!\[[\s\S]*\breset_orb_positions,/);
  assert.match(perms, /identifier = "allow-reset-orb-positions"[\s\S]*?commands\.allow = \["reset_orb_positions"\]/);
  assert.match(caps, /"allow-reset-orb-positions"/);
});

test("R-OB-08 a sub-orb uses the same 5px drag and the Ctrl-at-down rule", () => {
  assert.equal(ORB_DRAG_THRESHOLD_PX, 5);
  assert.ok(validSuborbOrbId("suborb:researcher:job1"));
  assert.ok(!validSuborbOrbId("suborb-more:researcher"));
  assert.ok(!validSuborbOrbId("suborb:researcher:"));
  assert.ok(!validOrbId("bot:x"));
  assert.ok(!dragStarted(3, 3), "under 5px is still a click");
  assert.ok(dragStarted(5, 0));
  assert.ok(dragStarted(4, 3));
  assert.ok(!orbDragAllowed({ supported: true }), "no modifier: click-through, no drag");
  assert.ok(!orbDragAllowed({ supported: true, ctrlAtDown: false, modifierNow: false }));
  assert.ok(orbDragAllowed({ supported: true, ctrlAtDown: true }));
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const move = main.slice(main.indexOf("function moveOrbDrag(event)"), main.indexOf("function endOrbDrag(event)"));
  assert.match(move, /dragStarted\(dx, dy\)/);
  assert.match(move, /ctrlAtDown: orbGesture\.ctrlAtDown === true/);
  assert.match(move, /state\.dragHitId = shell\.dataset\.hitId/);
  assert.match(move, /clampOrbPoint\(/);
});

test("R-OB-08 a dropped sub-orb is kept by profile+session and a reset returns it to the fan", () => {
  const id = "suborb:researcher:job1";
  const fan = { x: 80, y: 200 };
  const movedFan = { x: 140, y: 260 };
  const dropped = { x: 480, y: 220 };
  assert.deepEqual(suborbRestCentre({ fan }), fan, "never dragged: the fan slot");
  assert.deepEqual(suborbRestCentre({ fan: movedFan }), movedFan, "the fan follows the parent");
  const stored = normalizeOrbPositions({
    [id]: { x: dropped.x + 0.4, y: dropped.y + 0.2 },
    "bot:x": { x: 1, y: 1 },
  });
  assert.deepEqual(stored[id], { x: 480, y: 220 });
  assert.equal(stored["bot:x"], undefined);
  assert.deepEqual(suborbRestCentre({ fan: movedFan, saved: stored[id] }), stored[id], "a drop stays put");
  assert.deepEqual(suborbRestCentre({ fan, saved: null }), fan, "reset clears the drop");
  assert.deepEqual(suborbRestCentre({ fan: movedFan, saved: stored[id], drag: { x: 12, y: 16 } }), { x: 12, y: 16 });
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const reset = main.slice(main.indexOf("async function resetAllOrbPositions()"), main.indexOf("/** pointerdown on a resting main orb"));
  assert.match(reset, /layoutSuborbOrbs\(\)/);
  assert.match(reset, /state\.orbPositions\[id\] = null/);
  const cfg = readFileSync(new URL("../src-tauri/src/config.rs", import.meta.url), "utf8");
  assert.match(cfg, /fn valid_orb_id\(id: &str\)/);
  assert.match(cfg, /strip_prefix\("suborb:"\)/);
  assert.match(cfg, /if !valid_orb_id\(id\)/);
});

test("R-OB-08 tether ends follow the parent and the sub-orb and never take a hit", () => {
  const parent = { x: 200, y: 300 };
  const child = { x: 260, y: 340 };
  assert.deepEqual(suborbTether(parent, child), { x1: 200, y1: 300, x2: 260, y2: 340 });
  assert.deepEqual(suborbTether({ x: 210, y: 280 }, child), { x1: 210, y1: 280, x2: 260, y2: 340 });
  assert.deepEqual(suborbTether(parent, { x: 10, y: 20 }), { x1: 200, y1: 300, x2: 10, y2: 20 });
  assert.equal(suborbTether(null, child), null);
  assert.equal(suborbTether(parent, null), null);
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const paint = main.slice(main.indexOf("function paintSuborbTethers()"), main.indexOf("function paintFanParent("));
  assert.match(paint, /suborbTether\(parentOrbBox/);
  assert.match(paint, /class", "suborb-tether"/);
  assert.doesNotMatch(paint, /data-hit-id|dataset\.hitId|hitId =/);
  assert.match(main, /paintSuborbTethers\(\)/);
  const glide = main.slice(main.indexOf("function glideOrb(shell, from)"), main.indexOf("function restingSuborb(shell)"));
  assert.match(glide, /paintSuborbTethers\(\)/);
  assert.match(css, /\.suborb-tether \{[^}]*pointer-events:\s*none;/);
  assert.match(css, /\.suborb-tether-core \{[^}]*stroke-width:\s*1;/);
  assert.match(css, /\.suborb-tether-halo \{[^}]*rgba\(248,\s*248,\s*252/);
  const hits = main.slice(main.indexOf("function collectHits()"), main.indexOf("function orbShellAtPoint"));
  assert.doesNotMatch(hits, /suborb-tether/);
});
