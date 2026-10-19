import assert from "node:assert/strict";
import test from "node:test";
import {
  COLLAPSE_EASE,
  COLLAPSE_MS,
  collapseMs,
  CONTENT_IN_DELAY_MS,
  CONTENT_IN_MS,
  CONTENT_OUT_MS,
  EASE,
  PLAN_GROW_MS,
  ICON,
  ORB,
  ORB_PILL_MS,
  PANEL_H,
  PANEL_RADIUS,
  PANEL_W,
  PILL_PANEL_MS,
  PILL_W,
  anchorInBox,
  clipPath,
  collapsePhases,
  containsPoint,
  distributeEdges,
  insetsFor,
  openPhases,
  phaseList,
  dropParkedAnchor,
  fixedOrbPoint,
  headerSide,
  iconShift,
  placeShell,
  previewBlocked,
  FRAME_BLEED,
  includePlan,
  revealClip,
  seamInsets,
  seamEase,
  seamScaleFrames,
  SEAM_MIN,
  cronShellHeight,
  chatTailAction,
  separateStackedPanels,
  screenEdge,
  slotPoint,
  tighten,
  visibleSize,
} from "./morph.js";

const screen = { w: 1280, h: 800 };

test("kanban sits on the top edge and cron on the right", () => {
  const kanban = fixedOrbPoint("kanban", screen.w, screen.h);
  assert.equal(kanban.edge, "top");
  assert.equal(kanban.x, screen.w / 2);
  assert.equal(kanban.y, 42 + ORB / 2);
  const cron = fixedOrbPoint("cron", screen.w, screen.h);
  assert.equal(cron.edge, "right");
  assert.equal(cron.x, screen.w - 42 - ORB / 2);
  assert.equal(cron.y, Math.round(screen.h * 0.38));
  assert.equal(fixedOrbPoint("settings", screen.w, screen.h).edge, "bottom");
  for (const count of [1, 3, 8]) {
    for (const slot of distributeEdges(count)) {
      const point = slotPoint(slot.edge, slot.t, screen.w, screen.h, 42, ORB);
      const dist = Math.hypot(point.x - kanban.x, point.y - kanban.y);
      assert.ok(dist > ORB, `${count} ${slot.edge} ${dist}`);
    }
  }
});

function geom(edge, orbX, orbY, boxW = PANEL_W, boxH = PANEL_H) {
  const anchor = anchorInBox({
    edge,
    orbX,
    orbY,
    boxW,
    boxH,
    screenW: screen.w,
    screenH: screen.h,
  });
  return { boxW, boxH, ax: anchor.x, ay: anchor.y, edge };
}

test("orb, pill, and panel sizes and timings stay fixed", () => {
  assert.equal(ORB, 44);
  assert.equal(PILL_W, 320);
  assert.equal(PANEL_W, 420);
  assert.equal(PANEL_H, 560);
  assert.equal(ICON, 28);
  assert.equal(PANEL_RADIUS, 3);
  assert.equal(ORB_PILL_MS, 200);
  assert.equal(PILL_PANEL_MS, 480);
  assert.equal(COLLAPSE_MS, 300);
  assert.equal(CONTENT_OUT_MS, 80);
  assert.equal(CONTENT_IN_MS, 160);
  assert.equal(CONTENT_IN_DELAY_MS, 0);
  assert.ok(CONTENT_IN_MS < PILL_PANEL_MS);
  assert.equal(PLAN_GROW_MS, 240);
  assert.equal(SEAM_MIN, 0.001);
  const seam = seamScaleFrames(12);
  assert.equal(seam.outer.length, 13);
  assert.equal(seam.inner.length, 13);
  assert.equal(seam.outer[0].transform, "scaleX(0.001)");
  assert.equal(seam.inner[0].transform, "scaleX(1000)");
  assert.equal(seam.outer.at(-1).transform, "scaleX(1)");
  assert.equal(seam.inner.at(-1).transform, "scaleX(1)");
  seam.outer.forEach((frame, index) => {
    const outer = Number(frame.transform.slice(7, -1));
    const inner = Number(seam.inner[index].transform.slice(7, -1));
    assert.ok(Math.abs(outer * inner - 1) < 1e-9, frame.transform);
    assert.equal(frame.offset, index / 12);
    if (index > 0) {
      const prev = Number(seam.outer[index - 1].transform.slice(7, -1));
      assert.ok(outer > prev);
    }
  });
  assert.ok(seamEase(0.208) > 0.6 && seamEase(0.208) < 0.85);
  assert.ok(seamEase(0.417) > 0.85);
  assert.equal(EASE, "cubic-bezier(.2,.8,.2,1)");
  assert.equal(COLLAPSE_EASE, "cubic-bezier(.4,0,1,1)");
  assert.doesNotMatch(EASE, /spring/i);
  assert.doesNotMatch(COLLAPSE_EASE, /spring/i);
});

test("the anchor stays on the orb centre and the shell does not move between shapes", () => {
  const orb = { x: 1100, y: 736 };
  const placed = placeShell(orb.x, orb.y, PANEL_W, PANEL_H, screen.w, screen.h);
  assert.equal(placed.edge, "bottom");
  assert.equal(placed.left + placed.anchor.x, orb.x);
  assert.equal(placed.top + placed.anchor.y, orb.y);
  const g = { boxW: PANEL_W, boxH: PANEL_H, ax: placed.anchor.x, ay: placed.anchor.y };
  for (const state of ["orb", "pill", "wide", "tall", "panel"]) {
    const insets = insetsFor(state, g);
    assert.equal(containsPoint(insets, PANEL_W, PANEL_H, g.ax, g.ay), true, state);
  }
  const orbSize = visibleSize(insetsFor("orb", g), PANEL_W, PANEL_H);
  assert.deepEqual(orbSize, { w: ORB, h: ORB });
  const orbInsets = insetsFor("orb", g);
  assert.equal(placed.left + orbInsets.left + ORB / 2, orb.x);
  assert.equal(placed.top + orbInsets.top + ORB / 2, orb.y);
});

test("orb to pill extends horizontally toward the screen centre", () => {
  const right = geom("right", 1200, 200);
  const pill = insetsFor("pill", right);
  const size = visibleSize(pill, PANEL_W, PANEL_H);
  assert.deepEqual(size, { w: PILL_W, h: ORB });
  assert.equal(pill.radius, ORB / 2);
  assert.equal(pill.right, 0);
  assert.ok(pill.left < insetsFor("orb", right).left);

  const left = geom("left", 64, 600);
  const leftPill = insetsFor("pill", left);
  assert.equal(leftPill.left, 0);
  assert.equal(leftPill.right, PANEL_W - PILL_W);
  assert.ok(leftPill.right < insetsFor("orb", left).right);
  assert.equal(visibleSize(leftPill, PANEL_W, PANEL_H).w, PILL_W);
});

test("pill to panel grows out of the orb corner on every edge", () => {
  for (const edge of ["left", "right", "top", "bottom"]) {
    assert.deepEqual(openPhases(edge).map((step) => step.state), ["pill", "panel"]);
    assert.equal(openPhases(edge)[1].ms, PILL_PANEL_MS);
  }
  const bottom = geom("bottom", 1100, 736);
  const pill = insetsFor("pill", bottom);
  const panel = insetsFor("panel", bottom);
  assert.equal(pill.bottom, 0);
  assert.equal(pill.right, 0);
  assert.ok(pill.top > panel.top);
  assert.deepEqual(visibleSize(panel, PANEL_W, PANEL_H), { w: PANEL_W, h: PANEL_H });
  assert.equal(panel.radius, PANEL_RADIUS);
  assert.ok(panel.radius <= 3);
  assert.equal(containsPoint(pill, PANEL_W, PANEL_H, bottom.ax, bottom.ay), true);
  assert.equal(containsPoint(panel, PANEL_W, PANEL_H, bottom.ax, bottom.ay), true);

  const top = geom("top", 200, 40);
  const topPill = insetsFor("pill", top);
  assert.equal(topPill.top, 0);
  assert.equal(topPill.left, 0);
  const left = geom("left", 64, 200);
  assert.equal(insetsFor("pill", left).left, 0);
  const right = geom("right", 1200, 200);
  assert.equal(insetsFor("pill", right).right, 0);

  const bottomLeft = geom("bottom", 80, 736);
  assert.equal(
    revealClip("pill", bottomLeft),
    "inset(calc(100% - var(--pill-h)) calc(100% - var(--pill-w)) 0 0 round 999px)",
  );
  assert.equal(revealClip("panel", bottomLeft), "inset(0 round 3px)");
  assert.equal(
    revealClip("pill", geom("bottom", 1100, 736)),
    "inset(calc(100% - var(--pill-h)) 0 0 calc(100% - var(--pill-w)) round 999px)",
  );
  assert.equal(
    revealClip("pill", geom("top", 80, 40)),
    "inset(0 calc(100% - var(--pill-w)) calc(100% - var(--pill-h)) 0 round 999px)",
  );
  assert.equal(
    revealClip("orb", bottomLeft),
    "inset(calc(100% - var(--pill-h)) calc(100% - var(--pill-h)) 0 0 round 999px)",
  );
  const grown = insetsFor("pill", bottomLeft);
  const full = insetsFor("panel", bottomLeft);
  assert.equal(grown.radius, ORB / 2);
  assert.equal(full.radius, PANEL_RADIUS);
  assert.equal(clipPath(grown).includes("round 999px"), false);
  assert.match(clipPath(grown), /round 22px/);
  assert.match(clipPath(full), /round 3px/);
  assert.equal(grown.left, 0);
  assert.equal(grown.bottom, 0);
  assert.ok(grown.top > 0 && grown.right > 0);
});

test("plan seam and cron height and chat tail use explicit pixels", () => {
  assert.equal(seamInsets(420, "right", false).right, 420);
  assert.equal(seamInsets(420, "right", true).right, 0);
  assert.equal(seamInsets(380, "left", false).left, 380);
  assert.equal(seamInsets(380, "left", true).left, 0);
  assert.equal(seamInsets(420, "right", false).radius, PANEL_RADIUS);
  assert.equal(cronShellHeight(0, 900), 140);
  assert.equal(cronShellHeight(400, 900), 400);
  assert.equal(cronShellHeight(800, 900), 630);
  assert.equal(chatTailAction({ followTail: true, userGesture: false, nearTail: false }), "pin");
  assert.equal(chatTailAction({ followTail: false, userGesture: false, nearTail: false }), "restore");
  assert.equal(chatTailAction({ followTail: true, userGesture: true, nearTail: false }), "remember");
  assert.equal(chatTailAction({ followTail: false, userGesture: true, nearTail: true }), "pin");
});

test("collapse is one ease-in and the clock is pinned per edge", () => {
  assert.equal(collapseMs("right"), 233);
  assert.equal(collapseMs("left"), 266);
  assert.equal(collapseMs("bottom"), 266);
  assert.equal(collapseMs("top"), 299);
  for (const edge of ["left", "right", "top", "bottom"]) {
    const steps = collapsePhases(edge, "panel");
    assert.deepEqual(steps.map((step) => step.state), ["orb"]);
    assert.equal(steps[0].ms, collapseMs(edge));
    assert.equal(steps[0].ease, COLLAPSE_EASE);
    assert.ok(steps[0].ms <= COLLAPSE_MS);
    assert.ok(CONTENT_OUT_MS < steps[0].ms);
  }
  assert.equal(collapsePhases("bottom", "pill").reduce((sum, step) => sum + step.ms, 0), ORB_PILL_MS);
  assert.equal(openPhases("top").reduce((sum, step) => sum + step.ms, 0), ORB_PILL_MS + PILL_PANEL_MS);
  assert.deepEqual(phaseList("left", "pill", "panel").map((step) => step.state), ["panel"]);
  assert.equal(phaseList("bottom", "pill", "panel")[0].ms, PILL_PANEL_MS);
});

test("open top and bottom panels keep a 12px gap", () => {
  const screenH = 900;
  const separated = separateStackedPanels([
    { top: 42, height: 560, left: 400, width: 420, edge: "top" },
    { top: 298, height: 560, left: 430, width: 420, edge: "bottom" },
  ], screenH, 12);
  const upper = separated[0];
  const lower = separated[1];
  assert.ok(lower.top - (upper.top + upper.height) >= 12);
  assert.equal(upper.top, 0);
  assert.equal(lower.top + lower.height, 900);
  const clear = separateStackedPanels([
    { top: 40, height: 200, left: 10, width: 100, edge: "top" },
    { top: 400, height: 200, left: 10, width: 100, edge: "bottom" },
  ], screenH, 12);
  assert.equal(clear[0].top, 40);
  assert.equal(clear[1].top, 400);
  const side = separateStackedPanels([
    { top: 40, height: 500, left: 0, width: 100, edge: "left" },
    { top: 40, height: 500, left: 400, width: 100, edge: "right" },
  ], screenH, 12);
  assert.equal(side[0].top, 40);
  assert.equal(side[1].height, 500);
  const withPlan = includePlan(
    { top: 40, height: 400, left: 40, width: 420, edge: "top" },
    { side: "right", width: 420 },
  );
  assert.equal(FRAME_BLEED, 3);
  assert.equal(withPlan.left, 40);
  assert.equal(withPlan.width, 840);
  assert.equal(withPlan.height, 400);
  const docked = separateStackedPanels([
    withPlan,
    { top: 440, height: 400, left: 500, width: 420, edge: "bottom" },
  ], screenH, 12);
  assert.ok(docked[1].top - (docked[0].top + docked[0].height) >= 12);
  assert.ok(docked[0].height >= 160);
  assert.ok(docked[1].height >= 160);
});

test("clip-path is inset() round and the hairline sits one pixel inside", () => {
  const g = geom("bottom", 1100, 736);
  const outer = insetsFor("orb", g);
  const path = clipPath(outer);
  assert.match(path, /^inset\(-?\d+(\.\d+)?px -?\d+(\.\d+)?px -?\d+(\.\d+)?px -?\d+(\.\d+)?px round -?\d+(\.\d+)?px\)$/);
  const inner = tighten(outer, 1);
  assert.equal(inner.top, outer.top + 1);
  assert.equal(inner.radius, outer.radius - 1);
  assert.equal(containsPoint(inner, PANEL_W, PANEL_H, g.ax, g.ay), true);
  assert.equal(clipPath(insetsFor("panel", g)), "inset(0px 0px 0px 0px round 3px)");
});

test("the header slot is the orb centre and the orb does not fly", () => {
  assert.deepEqual(iconShift(), { x: 0, y: 0 });
  assert.deepEqual(iconShift(10, 500, PANEL_W, PANEL_H), { x: 0, y: 0 });

  const topLeft = placeShell(200, 40, PANEL_W, PANEL_H, screen.w, screen.h);
  assert.equal(topLeft.edge, "top");
  assert.equal(topLeft.header, "top");
  assert.equal(topLeft.anchor.y, ORB / 2);
  assert.equal(topLeft.anchor.x, ORB / 2);
  assert.equal(topLeft.top + topLeft.anchor.y, 40);

  const topRight = placeShell(1100, 40, PANEL_W, PANEL_H, screen.w, screen.h);
  assert.equal(topRight.header, "top");
  assert.equal(topRight.anchor.x, PANEL_W - ORB / 2);
  assert.equal(topRight.anchor.y, ORB / 2);

  const side = placeShell(64, 180, PANEL_W, PANEL_H, screen.w, screen.h);
  assert.equal(side.edge, "left");
  assert.equal(side.header, "top");
  assert.equal(side.anchor.x, ORB / 2);
  assert.equal(side.anchor.y, ORB / 2);
  assert.ok(side.top + PANEL_H <= screen.h + 0.5);

  const lowSide = placeShell(64, 700, PANEL_W, PANEL_H, screen.w, screen.h);
  assert.equal(lowSide.edge, "left");
  assert.equal(lowSide.header, "bottom");
  assert.equal(lowSide.anchor.x, ORB / 2);
  assert.equal(lowSide.anchor.y, PANEL_H - ORB / 2);
  assert.equal(lowSide.top + lowSide.anchor.y, 700);
  assert.ok(lowSide.top >= -0.5);

  const lowRight = placeShell(1240, 700, PANEL_W, PANEL_H, screen.w, screen.h);
  assert.equal(lowRight.edge, "right");
  assert.equal(lowRight.header, "bottom");
  assert.equal(lowRight.anchor.x, PANEL_W - ORB / 2);

  const bottom = placeShell(1100, 736, PANEL_W, PANEL_H, screen.w, screen.h);
  assert.equal(bottom.edge, "bottom");
  assert.equal(bottom.header, "bottom");
  assert.equal(bottom.anchor.y, PANEL_H - ORB / 2);
  assert.equal(bottom.anchor.x, PANEL_W - ORB / 2);
  assert.equal(bottom.top + bottom.anchor.y, 736);

  assert.equal(headerSide({ edge: "bottom", orbY: 100, boxH: PANEL_H, screenH: screen.h }), "bottom");
  assert.equal(headerSide({ edge: "top", orbY: 700, boxH: PANEL_H, screenH: screen.h }), "top");
  assert.equal(headerSide({ edge: "right", orbY: 180, boxH: PANEL_H, screenH: screen.h }), "top");
  assert.equal(headerSide({ edge: "right", orbY: 700, boxH: PANEL_H, screenH: screen.h }), "bottom");
});

test("a preview cannot cancel a close or replace an open panel", () => {
  assert.equal(previewBlocked({ intent: "close" }), true);
  assert.equal(previewBlocked({ collapsing: true, state: "panel" }), true);
  assert.equal(previewBlocked({ opening: "panel", visual: "pill" }), true);
  assert.equal(previewBlocked({ state: "panel", visual: "tall" }), true);
  assert.equal(previewBlocked({ visual: "wide" }), true);
  assert.equal(previewBlocked({ state: "orb", visual: "orb" }), false);
  assert.equal(previewBlocked({ state: "pill", visual: "pill" }), false);
});

test("screen edge and slot centres keep the orb on that edge", () => {
  assert.equal(screenEdge(20, 400, 1280, 800), "left");
  assert.equal(screenEdge(640, 10, 1280, 800), "top");
  assert.equal(screenEdge(1270, 400, 1280, 800), "right");
  assert.equal(screenEdge(640, 790, 1280, 800), "bottom");
  const top = slotPoint("top", 0.5, 1280, 800, 42, ORB);
  assert.equal(top.y, 42 + ORB / 2);
  assert.equal(screenEdge(top.x, top.y, 1280, 800), "top");
});

test("collapse drops a dragged park so the orb can return to its edge", () => {
  const anchors = { planner: { x: 400, y: 300, placed: true }, kanban: { x: 10, y: 10, placed: true } };
  assert.equal(dropParkedAnchor(anchors, "planner"), true);
  assert.equal(anchors.planner, undefined);
  assert.equal(anchors.kanban.placed, true);
  assert.equal(dropParkedAnchor(anchors, "planner"), false);
  assert.equal(dropParkedAnchor(null, "planner"), false);
});
