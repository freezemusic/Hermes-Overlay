import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  COLLAPSE_EASE,
  COLLAPSE_MS,
  collapseMs,
  CONTENT_IN_DELAY_MS,
  CONTENT_IN_MS,
  CONTENT_OUT_MS,
  EASE,
  PLAN_COLLAPSE_HANDOFF_MS,
  PLAN_COLLAPSE_MS,
  PLAN_EASE,
  PLAN_GROW_MS,
  collapseEase,
  overlappedCollapseInsets,
  planEase,
  seamAdvanceMs,
  seamFrameStep,
  seamVisibleMs,
  seamClipOutset,
  seamClipStillClosed,
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
  seamScaleAt,
  seamScaleFrames,
  SEAM_MIN,
  seamClip,
  seamWidthPx,
  cronShellHeight,
  chatTailAction,
  seatOpenPlan,
  unseatOpenPlan,
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
  assert.equal(COLLAPSE_MS, 316);
  assert.equal(CONTENT_OUT_MS, 80);
  assert.equal(CONTENT_IN_MS, 160);
  assert.equal(CONTENT_IN_DELAY_MS, 0);
  assert.ok(CONTENT_IN_MS < PILL_PANEL_MS);
  assert.equal(PLAN_GROW_MS, 280);
  assert.ok(PLAN_GROW_MS <= 300);
  assert.equal(PLAN_COLLAPSE_MS, 200);
  assert.equal(PLAN_COLLAPSE_HANDOFF_MS, 160);
  assert.equal(collapseEase(0), 0);
  assert.equal(collapseEase(1), 1);
  assert.equal(PLAN_EASE, "cubic-bezier(.3,.6,.2,1)");
  assert.equal(planEase(0), 0);
  assert.equal(planEase(1), 1);
  assert.ok(planEase(16 / 280) <= 0.15);
  assert.ok(planEase(20 / 280) <= 0.20);
  assert.ok(planEase(45 / 280) < 0.45);
  assert.ok(planEase(100 / 280) > 0.55 && planEase(100 / 280) < 0.80);
  assert.ok(planEase(200 / 280) >= 0.90);
  assert.equal(seamFrameStep(0, { first: true }).restart, false);
  assert.equal(seamFrameStep(16, { first: true }).restart, false);
  assert.ok(planEase(seamFrameStep(16, { first: true }).t) <= 0.45);
  assert.equal(seamFrameStep(64, { first: true }).restart, true);
  assert.equal(seamFrameStep(64, { first: false }).restart, false);
  assert.ok(planEase(seamFrameStep(64, { first: false }).t) > 0.45);
  assert.equal(seamFrameStep(280, { first: false }).t, 1);
  assert.equal(seamVisibleMs(16), 16);
  assert.equal(seamVisibleMs(20), 20);
  assert.equal(seamVisibleMs(45), 20);
  assert.equal(seamVisibleMs(58), 20);
  assert.equal(seamVisibleMs(121), 20);
  assert.equal(seamVisibleMs(45, 1), 45);
  assert.equal(seamVisibleMs(58, 1), 45);
  assert.equal(seamVisibleMs(121, 1), 45);
  assert.equal(seamVisibleMs(80, 2), 80);
  assert.equal(seamAdvanceMs(16, { shownMs: 0 }), 16);
  assert.equal(seamAdvanceMs(54, { shownMs: 0 }), 20);
  assert.equal(seamAdvanceMs(90, { shownMs: 20, gapMs: 33, frameMs: 33 }), 45);
  assert.equal(seamAdvanceMs(17, { shownMs: 17, gapMs: 16, frameMs: 16 }), 33);
  assert.equal(seamAdvanceMs(50, { shownMs: 34, gapMs: 16, frameMs: 16 }), 50);
  assert.equal(seamAdvanceMs(177, { shownMs: 30, gapMs: 147, frameMs: 16 }), 46);
  assert.equal(seamAdvanceMs(80, { shownMs: 30, gapMs: 48, frameMs: 16 }), 46);
  assert.equal(seamAdvanceMs(600, { shownMs: 30, gapMs: 147, frameMs: 16, duration: 280 }), 280);
  assert.equal(seamAdvanceMs(40, { shownMs: 16, gapMs: 33, frameMs: 33 }), 40);
  const sameCap = seamAdvanceMs(20, { shownMs: 20, gapMs: 35, frameMs: 16 });
  assert.ok(sameCap > 20 && sameCap <= 45);
  assert.equal(seamAdvanceMs(22, { shownMs: 20, gapMs: 16, frameMs: 16 }), 36);
  assert.equal(seamAdvanceMs(110, { shownMs: 110, gapMs: 16, frameMs: 16 }), 126);
  assert.equal(seamAdvanceMs(112, { shownMs: 112, gapMs: 16, frameMs: 16 }), 128);
  const openClip = "inset(-4px -428px -4px -4px round 3px)";
  const closedClip = "inset(-4px -4px -4px -4px round 3px)";
  assert.ok(seamClipOutset(openClip) > 400);
  assert.ok(seamClipOutset(closedClip) < 20);
  assert.equal(seamClipStillClosed(closedClip, openClip), true);
  assert.equal(seamClipStillClosed(openClip, openClip), false);
  assert.equal(seamClipStillClosed("inset(-4px -200px -4px -4px round 3px)", openClip), true);
  assert.equal(SEAM_MIN, 0.001);
  const seam = seamScaleFrames(12);
  assert.equal(seam.outer.length, 13);
  assert.equal(seam.inner.length, 13);
  assert.equal(seam.outer[0].transform, "scaleX(0.001)");
  assert.equal(seam.inner[0].transform, "scaleX(1000)");
  assert.equal(seam.outer.at(-1).transform, "scaleX(1)");
  assert.equal(seam.inner.at(-1).transform, "scaleX(1)");
  assert.equal(seamScaleAt(0), SEAM_MIN);
  assert.equal(seamScaleAt(1), 1);
  assert.equal(seamClip("right", 0), "inset(0px 100% 0px 0px)");
  assert.equal(seamClip("left", 0), "inset(0px 0px 0px 100%)");
  assert.equal(seamClip("right", 1), "inset(0px 0% 0px 0px)");
  assert.equal(seamClip("left", 1), "inset(0px 0px 0px 0%)");
  assert.equal(seamWidthPx(420, 0), 0);
  assert.equal(seamWidthPx(420, 1), 420);
  assert.ok(seamWidthPx(420, 12 / 240) > 0);
  assert.ok(seamWidthPx(420, 12 / 240) < 420 * 0.35);
  assert.ok(seamClip("right", 0.05).includes("%"));
  assert.ok(seamScaleAt(0.05) > SEAM_MIN && seamScaleAt(0.05) < 1);
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
  assert.equal(collapseMs("right"), 300);
  assert.equal(collapseMs("left"), 316);
  assert.equal(collapseMs("bottom"), 266);
  assert.equal(collapseMs("top"), 300);
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

test("panel collapse starts while the plan clip is still closing", () => {
  const planOpen = { top: 0, right: -420, bottom: 0, left: 0, radius: 3 };
  const planClosed = { top: -4, right: 0, bottom: -4, left: -4, radius: 12 };
  const panelFrom = { top: 0, right: 0, bottom: 0, left: 0, radius: 12 };
  const panelTo = { top: 80, right: 80, bottom: 80, left: 80, radius: 22 };
  const panelMs = 300;
  const at = (elapsedMs) => overlappedCollapseInsets({
    planOpen,
    planClosed,
    panelFrom,
    panelTo,
    planSide: "right",
    elapsedMs,
    panelMs,
  });
  const mid = at(160);
  const along = planOpen.right + (planClosed.right - planOpen.right) * collapseEase(0.8);
  assert.ok(Math.abs(mid.right - along) < 1e-6);
  assert.ok(1 - collapseEase(0.8) > 0.2);
  assert.ok(Math.abs(at(200).right - planClosed.right) < 1e-6);
  const done = at(160 + panelMs);
  assert.ok(Math.abs(done.right - panelTo.right) < 1e-4);
  assert.ok(Math.abs(done.top - panelTo.top) < 1e-4);
  assert.ok(at(180).right > mid.right);
});

test("open plan controls are the hit target inside the shell border box", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const dom = new JSDOM(`<!doctype html><html class="overlay-passthrough"><head><style>${css}</style></head><body>
    <div class="overlay-root">
      <div class="morph" data-state="panel" data-plan-open="1" data-plan-side="right" data-visual="panel">
        <div class="center-panel"></div>
        <aside class="plan-window" data-role="plan">
          <div class="plan-fit">
            <header class="plan-head">
              <button type="button" data-role="plan-preview-mode">預覽</button>
              <button type="button" data-role="plan-source-mode">原文</button>
              <button type="button" data-role="plan-close" aria-label="關閉計劃視窗">✕</button>
            </header>
          </div>
        </aside>
      </div>
    </div>
  </body></html>`);
  const { document, getComputedStyle } = dom.window;
  const shell = document.querySelector(".morph");
  const plan = shell.querySelector(".plan-window");
  const preview = plan.querySelector("[data-role='plan-preview-mode']");
  const source = plan.querySelector("[data-role='plan-source-mode']");
  const close = plan.querySelector("[data-role='plan-close']");
  shell.style.left = "100px";
  shell.style.top = "40px";
  shell.style.width = "420px";
  shell.style.height = "560px";
  shell.dataset.ax = "22";
  shell.dataset.ay = "22";
  shell.dataset.planWidth = "420";
  shell.style.clipPath = "inset(-4px -428px -4px -4px round 3px)";
  plan.style.width = "420px";
  plan._seamPhase = "grown";
  for (const control of [preview, source, close]) {
    assert.equal(getComputedStyle(control).pointerEvents, "auto", control.dataset.role);
  }
  const layout = () => {
    const shellLeft = Number.parseFloat(shell.style.left) || 0;
    const shellTop = Number.parseFloat(shell.style.top) || 0;
    const shellW = Number.parseFloat(shell.style.width) || 0;
    const shellH = Number.parseFloat(shell.style.height) || 0;
    const planW = Number.parseFloat(plan.style.width) || 420;
    const inlineLeft = plan.style.left;
    let planLeft = shellLeft + shellW;
    if (inlineLeft.endsWith("px")) planLeft = shellLeft + Number.parseFloat(inlineLeft);
    else if (shell.dataset.planSide === "left") planLeft = shellLeft - planW;
    const planBox = { x: planLeft, y: shellTop, w: planW, h: shellH };
    const closeBox = { x: planBox.x + planBox.w - 30, y: planBox.y + 8, w: 22, h: 22 };
    const sourceBox = { x: closeBox.x - 48, y: planBox.y + 8, w: 40, h: 22 };
    const previewBox = { x: sourceBox.x - 40, y: planBox.y + 8, w: 40, h: 22 };
    return {
      shell: { x: shellLeft, y: shellTop, w: shellW, h: shellH },
      plan: planBox,
      [preview.dataset.role]: previewBox,
      [source.dataset.role]: sourceBox,
      [close.dataset.role]: closeBox,
    };
  };
  const contains = (box, x, y) => !!box && x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
  const rectFor = (el) => {
    const boxes = layout();
    if (el === shell) return boxes.shell;
    if (el === plan) return boxes.plan;
    if (el?.dataset?.role && boxes[el.dataset.role]) return boxes[el.dataset.role];
    return null;
  };
  // jsdom has no elementFromPoint. This walker skips pointer-events:none and,
  // like WebKitGTK after a fill:both clip, only hits children inside the
  // morph border box.
  document.elementFromPoint = (x, y) => {
    let found = null;
    const visit = (el) => {
      for (const child of el.children) {
        visit(child);
        if (found) return;
      }
      if (getComputedStyle(el).pointerEvents === "none") return;
      const box = rectFor(el);
      if (!contains(box, x, y)) return;
      const morph = el.closest(".morph");
      if (morph && !contains(rectFor(morph), x, y)) return;
      found = el;
    };
    visit(document.body);
    return found || document.body;
  };
  const center = (el) => {
    const box = rectFor(el);
    return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  };
  const closeAt = center(close);
  assert.equal(document.elementFromPoint(closeAt.x, closeAt.y).tagName, "BODY");
  const before = layout().plan;
  assert.equal(seatOpenPlan(shell), true);
  const after = layout().plan;
  assert.equal(after.x, before.x);
  assert.equal(after.y, before.y);
  assert.equal(shell.style.width, "840px");
  assert.equal(plan.style.left, "420px");
  assert.match(shell.style.clipPath, /inset\(-4px -8px -4px -4px round 3px\)/);
  for (const control of [preview, source, close]) {
    const at = center(control);
    const shellBox = layout().shell;
    assert.ok(at.x >= shellBox.x && at.x <= shellBox.x + shellBox.w, control.dataset.role);
    assert.equal(document.elementFromPoint(at.x, at.y), control, control.dataset.role);
  }
  assert.equal(seatOpenPlan(shell), true);
  assert.equal(shell.style.width, "840px");
  shell.style.width = shell.dataset.planSeatW;
  shell.style.left = shell.dataset.planSeatLeft;
  assert.equal(seatOpenPlan(shell), true);
  assert.equal(shell.style.width, "840px");
  assert.match(shell.style.clipPath, /inset\(-4px -8px -4px -4px round 3px\)/);
  assert.equal(unseatOpenPlan(shell), true);
  assert.equal(shell.style.width, "420px");
  assert.equal(plan.style.left, "");
  assert.match(shell.style.clipPath, /inset\(-4px -428px -4px -4px round 3px\)/);
  assert.equal(document.elementFromPoint(center(close).x, center(close).y).tagName, "BODY");

  shell.style.left = "500px";
  shell.style.width = "420px";
  shell.dataset.planSide = "left";
  shell.dataset.planOpen = "1";
  shell.style.clipPath = "inset(-4px -4px -4px -428px round 3px)";
  plan.hidden = false;
  plan._seamPhase = "grown";
  const leftBefore = layout().plan.x;
  assert.equal(seatOpenPlan(shell), true);
  assert.equal(layout().plan.x, leftBefore);
  assert.equal(shell.style.left, "80px");
  assert.equal(shell.style.width, "840px");
  assert.equal(plan.style.left, "0px");
  assert.equal(shell.dataset.ax, String(22 + 420));
  const leftClose = center(close);
  assert.equal(document.elementFromPoint(leftClose.x, leftClose.y), close);
  assert.equal(unseatOpenPlan(shell), true);
  assert.equal(shell.style.width, "420px");
  assert.equal(shell.style.left, "500px");
  assert.equal(shell.dataset.ax, "22");
});
