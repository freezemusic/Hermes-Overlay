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
  MIN_PANEL_H,
  CRON_MIN_H,
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
  clampDroppedBox,
  fitPlanBox,
  planHostBox,
  PLAN_EDGE_OUT,
  settledPlanReach,
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
  pinnedScrollTop,
  hostOpenPlan,
  releasePlanDock,
  planControlUnder,
  panelDragHost,
  closeYieldsToOpen,
  chromeToggleAction,
  headerCloseBox,
  planActionRow,
  closeNudge,
  rectsOverlap,
  restoreHostedPlan,
  sameChatSnapshot,
  separateStackedPanels,
  screenEdge,
  slotPoint,
  orbCoveredBy,
  orbHaloInsets,
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
  const classic = [
    { edge: "top", t: 0.21 },
    { edge: "right", t: 0.5 },
    { edge: "bottom", t: 0.5 },
    { edge: "left", t: 0.5 },
  ];
  assert.deepEqual(distributeEdges(1), classic.slice(0, 1));
  assert.deepEqual(distributeEdges(2), classic.slice(0, 2));
  assert.deepEqual(distributeEdges(3), classic.slice(0, 3));
  assert.deepEqual(distributeEdges(4), classic);
  const five = distributeEdges(5);
  const six = distributeEdges(6);
  const eight = distributeEdges(8);
  assert.deepEqual(five.slice(0, 4), classic);
  assert.deepEqual(six.slice(0, 5), five);
  assert.deepEqual(eight.slice(0, 6), six);
  const fadeGap = ORB + 144;
  const chrome = ["kanban", "cron", "settings"].map((id) => fixedOrbPoint(id, screen.w, screen.h));
  for (const count of [1, 3, 4, 6, 8]) {
    const slots = distributeEdges(count, screen);
    assert.equal(slots.length, count);
    const points = slots.map((slot) => slotPoint(slot.edge, slot.t, screen.w, screen.h, 42, ORB));
    for (const point of points) {
      for (const other of chrome) {
        const dist = Math.hypot(point.x - other.x, point.y - other.y);
        assert.ok(dist > ORB, `${count} ${point.x},${point.y} vs ${other.x},${other.y} ${dist}`);
      }
    }
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        if (i < 4 && j < 4) continue;
        const dist = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
        assert.ok(dist > fadeGap, `${count} ${i}-${j} ${dist}`);
      }
    }
  }
  for (const size of [screen, { w: 1920, h: 1080 }, { w: 1024, h: 768 }]) {
    const anchor = fixedOrbPoint("kanban", size.w, size.h);
    const panel = placeShell(
      anchor.x,
      anchor.y,
      Math.min(960, size.w * 0.8),
      Math.min(size.h * 0.8, 760),
      size.w,
      size.h,
    );
    const slots = distributeEdges(8, size);
    assert.ok(slots.length >= 6, `${size.w}x${size.h} ${slots.length}`);
    if (size.w >= 1280) assert.equal(slots.length, 8, `${size.w}x${size.h}`);
    assert.deepEqual(slots.slice(0, 4), classic);
    slots.slice(4).forEach((slot, index) => {
      const point = slotPoint(slot.edge, slot.t, size.w, size.h, 42, ORB);
      const dx = point.x < panel.left ? panel.left - point.x
        : point.x > panel.left + panel.width ? point.x - (panel.left + panel.width) : 0;
      const dy = point.y < panel.top ? panel.top - point.y
        : point.y > panel.top + panel.height ? point.y - (panel.top + panel.height) : 0;
      const dist = Math.hypot(dx, dy);
      assert.ok(dist > ORB / 2, `${size.w} extra ${index} ${dist}`);
    });
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

test("a plan stays inside a 1024px viewport", () => {
  const narrow = fitPlanBox({
    shellLeft: 241,
    shellTop: 42,
    shellW: 420,
    shellH: 560,
    planW: 420,
    screenW: 1024,
    screenH: 768,
  });
  assert.equal(narrow.side, "right");
  assert.ok(narrow.x >= 0);
  assert.ok(narrow.y >= 0);
  assert.ok(narrow.x + narrow.w <= 1024);
  assert.ok(narrow.y + narrow.h <= 768);
  assert.equal(narrow.w, 420);
  assert.equal(narrow.x, 1024 - 420);
  const right = fitPlanBox({
    shellLeft: 40,
    shellTop: 40,
    shellW: 420,
    shellH: 560,
    planW: 420,
    screenW: 1920,
    screenH: 1080,
  });
  assert.equal(right.side, "right");
  assert.equal(right.x, 460);
  const left = fitPlanBox({
    shellLeft: 1400,
    shellTop: 40,
    shellW: 420,
    shellH: 560,
    planW: 420,
    screenW: 1920,
    screenH: 1080,
  });
  assert.equal(left.side, "left");
  assert.equal(left.x, 980);
});

test("settings drag waits until the panel is inside its shell", () => {
  const dom = new JSDOM("<!doctype html><body><aside id='settings'></aside></body>");
  const { document } = dom.window;
  const panel = document.getElementById("settings");
  assert.equal(panelDragHost(panel), null);
  const shell = document.createElement("div");
  shell.className = "morph";
  shell.append(panel);
  assert.equal(panelDragHost(panel), shell);
  assert.equal(panelDragHost(shell), null);
});

test("kanban open wins while the startup pill is retracting", () => {
  assert.equal(closeYieldsToOpen("panel", "close"), true);
  assert.equal(closeYieldsToOpen("pill", "close"), true);
  assert.equal(closeYieldsToOpen("orb", "close"), false);
  assert.equal(closeYieldsToOpen("panel", "open"), false);
  assert.equal(chromeToggleAction({
    open: true,
    state: "orb",
    collapsing: false,
  }), "open");
  assert.equal(chromeToggleAction({
    open: true,
    state: "pill",
    collapsing: true,
  }), "open");
  assert.equal(chromeToggleAction({
    open: true,
    state: "panel",
    collapsing: false,
  }), "raise");
  assert.equal(chromeToggleAction({
    open: false,
    state: "pill",
    collapsing: false,
  }), "open");
});

test("a settings drop inside the left 300px stays where it was released", () => {
  const width = 680;
  const height = 760;
  const screenW = 1920;
  const screenH = 1080;
  const left = 200;
  const top = 200;
  const ax = width - ORB / 2;
  const orbX = left + ax;
  const orbY = top + height - ORB / 2;
  const flipped = placeShell(orbX, orbY, width, height, screenW, screenH);
  assert.equal(flipped.left, 836);
  const kept = clampDroppedBox(left, top, width, height, screenW, screenH);
  assert.equal(kept.left, 200);
  assert.equal(kept.top, 200);
  const off = clampDroppedBox(-40, -10, width, height, screenW, screenH);
  assert.equal(off.left, 0);
  assert.equal(off.top, 0);
  const hung = clampDroppedBox(1800, 900, width, height, screenW, screenH);
  assert.equal(hung.left, screenW - width);
  assert.equal(hung.top, screenH - height);
});

test("kanban close moves clear of the plan action row at 1024px", () => {
  const screenW = 1024;
  const screenH = 768;
  const pad = 42;
  const point = fixedOrbPoint("kanban", screenW, screenH, pad, ORB);
  const shell = placeShell(
    point.x,
    point.y,
    Math.min(960, screenW * 0.8),
    Math.min(screenH * 0.8, 760),
    screenW,
    screenH,
  );
  const plan = fitPlanBox({
    shellLeft: 241,
    shellTop: 42,
    shellW: 420,
    shellH: 560,
    planW: 420,
    screenW,
    screenH,
  });
  const actions = planActionRow(plan, { rowH: 36, width: 180 });
  const button = headerCloseBox(shell, { side: "end", pad: 16, insetY: 16 });
  assert.equal(rectsOverlap(button, actions), true);
  const nudge = closeNudge(button, [actions]);
  const moved = { x: button.x + nudge.dx, y: button.y + nudge.dy, w: button.w, h: button.h };
  assert.equal(rectsOverlap(moved, actions), false);
  const cx = moved.x + moved.w / 2;
  const cy = moved.y + moved.h / 2;
  const centreCovered = cx >= actions.x && cx < actions.x + actions.w
    && cy >= actions.y && cy < actions.y + actions.h;
  assert.equal(centreCovered, false);
  const clear = { ...button, y: actions.y + actions.h + 4 };
  assert.deepEqual(closeNudge(clear, [actions]), { dx: 0, dy: 0 });
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
  const grown = { scrollHeight: 800, clientHeight: 400, scrollTop: 400 };
  assert.equal(pinnedScrollTop(grown, true), null);
  grown.scrollHeight = 860;
  assert.equal(pinnedScrollTop(grown, true), 460);
  assert.equal(pinnedScrollTop(grown, false), null);
  assert.equal(pinnedScrollTop({ scrollHeight: 200, clientHeight: 400, scrollTop: 12 }, false), null);
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
  // The top header stays on its orb. The old push moved it to y=0.
  assert.equal(upper.top, 42);
  assert.equal(lower.top + lower.height, 298 + 560);
  assert.ok(upper.top + upper.height <= screenH);
  assert.ok(lower.top >= 0);
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
  const four = separateStackedPanels([
    includePlan({ top: 8, height: 520, left: 80, width: 420, edge: "top" }, { side: "right", width: 420 }),
    { top: 180, height: 480, left: 860, width: 420, edge: "right" },
    includePlan({ top: 620, height: 520, left: 160, width: 420, edge: "bottom" }, { side: "right", width: 420 }),
    { top: 360, height: 480, left: 20, width: 420, edge: "left" },
  ], 1200, 18);
  for (let i = 0; i < four.length; i += 1) {
    assert.ok(four[i].height >= MIN_PANEL_H, `height ${i} ${four[i].height}`);
    assert.ok(four[i].top >= -0.5, `top ${i}`);
    assert.ok(four[i].top + four[i].height <= 1200.5, `bottom ${i}`);
  }
});

test("a crowded stack stays on screen and keeps each orb anchor", () => {
  const screenH = 1200;
  const boxes = [
    { top: 42, height: 560, left: 80, width: 420, edge: "top" },
    { top: 180, height: 560, left: 200, width: 420, edge: "right" },
    { top: 360, height: 560, left: 40, width: 420, edge: "left" },
    { top: 640, height: 560, left: 160, width: 420, edge: "bottom" },
    { top: 80, height: 560, left: 500, width: 420, edge: "top" },
    { top: 500, height: 560, left: 480, width: 420, edge: "bottom" },
  ];
  const out = separateStackedPanels(boxes, screenH, 18);
  assert.equal(out.length, 6);
  for (const box of out) {
    assert.ok(box.top >= -0.5);
    assert.ok(box.top + box.height <= screenH + 0.5);
    assert.ok(box.height >= MIN_PANEL_H, `height ${box.height}`);
  }
  assert.equal(out[0].top, 42);
  assert.equal(out[1].top, 180);
  assert.equal(out[2].top, 360);
  assert.equal(out[4].top, 80);
  assert.equal(out[3].top + out[3].height, 640 + 560);
  assert.equal(out[5].top + out[5].height, 500 + 560);
});

test("six open panels stay at least the minimum height and fully on screen", () => {
  const screenH = 1200;
  const boxes = [
    { top: 42, height: 560, left: 80, width: 420, edge: "top" },
    { top: 180, height: 560, left: 200, width: 420, edge: "right" },
    { top: 360, height: 560, left: 40, width: 420, edge: "left" },
    { top: 640, height: 560, left: 160, width: 420, edge: "bottom" },
    { top: 80, height: 560, left: 500, width: 420, edge: "top" },
    { top: 500, height: 560, left: 480, width: 420, edge: "bottom" },
  ];
  const out = separateStackedPanels(boxes, screenH, 18);
  assert.equal(out.length, 6);
  for (const box of out) {
    assert.ok(box.height >= MIN_PANEL_H);
    assert.ok(box.top >= -0.5);
    assert.ok(box.top + box.height <= screenH + 0.5);
    assert.ok(box.left >= -0.5);
    assert.ok(box.width >= 40);
  }
  const tight = separateStackedPanels([
    { top: 0, height: 560, left: 0, width: 400, edge: "top" },
    { top: 10, height: 560, left: 10, width: 400, edge: "top" },
    { top: 20, height: 560, left: 20, width: 400, edge: "right" },
    { top: 30, height: 560, left: 0, width: 400, edge: "left" },
    { top: 200, height: 180, left: 30, width: 320, edge: "right", minHeight: CRON_MIN_H },
    { top: 400, height: 560, left: 0, width: 400, edge: "bottom" },
  ], 800, 12);
  assert.equal(tight.length, 6);
  tight.forEach((box, index) => {
    const floor = index === 4 ? CRON_MIN_H : MIN_PANEL_H;
    assert.ok(box.height >= Math.min(floor, 800), `${index} ${box.height}`);
    assert.ok(box.top >= -0.5, `top ${index}`);
    assert.ok(box.top + box.height <= 800.5, `bottom ${index} ${box.top}+${box.height}`);
  });
  assert.ok(tight[4].height <= 180.5);
});

test("planControlUnder uses the button box when the hit target is the body", () => {
  const dom = new JSDOM(`<!doctype html><body>
    <button type="button" data-role="plan-preview-mode">預覽</button>
    <button type="button" data-role="plan-source-mode">原文</button>
    <button type="button" data-role="plan-close">×</button>
  </body>`);
  const { document } = dom.window;
  const preview = document.querySelector("[data-role='plan-preview-mode']");
  const source = document.querySelector("[data-role='plan-source-mode']");
  const close = document.querySelector("[data-role='plan-close']");
  const stub = (el, left) => {
    el.getBoundingClientRect = () => ({ left, top: 20, right: left + 40, bottom: 42, width: 40, height: 22 });
  };
  stub(preview, 10);
  stub(source, 60);
  stub(close, 110);
  assert.equal(planControlUnder(document, 20, 30), preview);
  assert.equal(planControlUnder(document, 70, 30), source);
  assert.equal(planControlUnder(document, 120, 30), close);
  assert.equal(planControlUnder(document, 0, 0), null);
  close.hidden = true;
  assert.equal(planControlUnder(document, 120, 30), null);
});

test("sameChatSnapshot ignores an unchanged poll", () => {
  const current = {
    sessionId: "bot-chat",
    sessionExplicit: false,
    messages: [{ role: "user", text: "你好", live: false }],
    sessions: [{ id: "bot-chat", title: "Bot Chat" }],
  };
  assert.equal(sameChatSnapshot(current, {
    sessionId: "bot-chat",
    sessionExplicit: false,
    messages: [{ role: "user", text: "你好", live: false }],
    sessions: [{ id: "bot-chat", title: "Bot Chat" }],
  }), true);
  assert.equal(sameChatSnapshot(current, {
    sessionId: "bot-chat",
    sessionExplicit: false,
    messages: [{ role: "user", text: "你好", live: true }],
    sessions: [{ id: "bot-chat", title: "Bot Chat" }],
  }), false);
  assert.equal(sameChatSnapshot(current, {
    sessionId: "other",
    sessionExplicit: false,
    messages: current.messages,
    sessions: current.sessions,
  }), false);
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
  const halo = orbHaloInsets(outer);
  assert.equal(halo.radius, 999);
  assert.equal(halo.top, outer.top - 34);
  assert.equal(halo.right, outer.right - 34);
  assert.equal(halo.bottom, outer.bottom - 34);
  assert.equal(halo.left, outer.left - 34);
  assert.match(clipPath(halo), /round 999px/);
  const disc = visibleSize(outer, PANEL_W, PANEL_H);
  const glow = visibleSize(halo, PANEL_W, PANEL_H);
  assert.equal(disc.w, ORB);
  assert.equal(disc.h, ORB);
  assert.equal(glow.w, ORB + 68);
  assert.equal(glow.h, ORB + 68);
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

test("a 2256px settings card on 1920×1080 stays on screen and keeps the orb", () => {
  const fitted = placeShell(1704, 1016, 680, 760, 1920, 1080);
  assert.equal(fitted.height, 760);
  assert.equal(fitted.top, 1016 - (760 - ORB / 2));
  assert.equal(fitted.top + fitted.anchor.y, 1016);
  assert.ok(fitted.top >= 0 && fitted.top + fitted.height <= 1080);

  const placed = placeShell(1704, 1016, 680, 2256, 1920, 1080);
  assert.equal(placed.header, "bottom");
  assert.equal(placed.top, 0);
  assert.equal(placed.height, 1016 + ORB / 2);
  assert.ok(placed.height <= 1080);
  assert.ok(placed.height >= 240);
  assert.ok(placed.left >= 0);
  assert.ok(placed.left + placed.width <= 1920);
  assert.ok(placed.top + placed.height <= 1080);
  assert.equal(placed.left + placed.anchor.x, 1704);
  assert.equal(placed.top + placed.anchor.y, 1016);
  const closeTop = placed.top + placed.height - 44;
  assert.ok(closeTop >= 0 && closeTop + 44 <= 1080);
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
  const taskbar = { bottom: 48 };
  const parked = slotPoint("bottom", 0.5, 1280, 800, 42, ORB, taskbar);
  assert.equal(parked.y, 800 - 48 - 12 - ORB / 2);
  assert.equal(fixedOrbPoint("settings", 1280, 800, 42, ORB, taskbar).y, 800 - 48 - 12 - ORB / 2);
  assert.equal(slotPoint("bottom", 0.5, 1280, 800).y, 800 - 12 - ORB / 2);
  const stillTop = slotPoint("top", 0.21, 1280, 800, 42, ORB, taskbar);
  assert.equal(stillTop.y, 42 + ORB / 2);
  const probe = readFileSync(new URL("../scripts/windows-clickthrough.ps1", import.meta.url), "utf8");
  assert.equal(
    probe.includes("$field = @{ x = [int][Math]::Round($w * 0.08 + $w * 0.84 * 0.21); y = [int]($pad + $orb / 2) }"),
    true,
  );
  assert.equal(probe.includes("$frameTop + $frameH - 12 - $orb / 2"), true);
  assert.equal(probe.includes("$frameTop + $frameH - $pad - $orb / 2"), false);
  const covered = orbCoveredBy({ x: 500, y: 8, w: 44, h: 44 }, [{ x: 200, y: 40, w: 420, h: 80 }]);
  assert.equal(covered, true);
  assert.equal(orbCoveredBy({ x: 20, y: 700, w: 44, h: 44 }, [{ x: 200, y: 40, w: 420, h: 80 }]), false);
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

test("open plan controls are the hit target outside the shell clip", () => {
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
  const openClip = "inset(-4px -428px -4px -4px round 3px)";
  const closedClip = "inset(-4px 0px -4px -4px round 3px)";
  shell.style.left = "100px";
  shell.style.top = "40px";
  shell.style.width = "420px";
  shell.style.height = "560px";
  shell.dataset.ax = "22";
  shell.dataset.ay = "22";
  shell.dataset.planWidth = "420";
  shell.style.clipPath = openClip;
  plan.style.width = "420px";
  plan._seamPhase = "grown";
  const anim = {
    playState: "finished",
    currentTime: 280,
    effect: {
      getKeyframes: () => [{ clipPath: closedClip }, { clipPath: openClip }],
      getTiming: () => ({ duration: 280, easing: "cubic-bezier(.3,.6,.2,1)", fill: "both" }),
    },
  };
  shell.getAnimations = () => [anim];
  const num = (value) => Number.parseFloat(value) || 0;
  const boxOf = (el) => {
    if (!el) return null;
    if (el === shell) {
      return { x: num(shell.style.left), y: num(shell.style.top), w: num(shell.style.width), h: num(shell.style.height) };
    }
    if (el.classList?.contains("plan-hit-host")) {
      return { x: num(el.style.left), y: num(el.style.top), w: num(el.style.width), h: num(el.style.height) };
    }
    if (el === plan || el.classList?.contains("plan-window")) {
      const host = plan.parentElement?.classList?.contains("plan-hit-host") ? plan.parentElement : null;
      if (host) return boxOf(host);
      const shellBox = boxOf(shell);
      const planW = num(plan.style.width) || 420;
      const x = shell.dataset.planSide === "left" ? shellBox.x - planW : shellBox.x + shellBox.w;
      return { x, y: shellBox.y, w: planW, h: shellBox.h };
    }
    if (el.dataset?.role) {
      const planBox = boxOf(plan);
      const closeBox = { x: planBox.x + planBox.w - 30, y: planBox.y + 8, w: 22, h: 22 };
      const sourceBox = { x: closeBox.x - 48, y: planBox.y + 8, w: 40, h: 22 };
      const previewBox = { x: sourceBox.x - 40, y: planBox.y + 8, w: 40, h: 22 };
      if (el === close) return closeBox;
      if (el === source) return sourceBox;
      if (el === preview) return previewBox;
    }
    return null;
  };
  const contains = (box, x, y) => !!box && x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
  const parseInset = (value) => {
    const match = String(value || "").match(/inset\(\s*([-\d.]+)px\s+([-\d.]+)px\s+([-\d.]+)px\s+([-\d.]+)px/i);
    if (!match) return null;
    return { top: Number(match[1]), right: Number(match[2]), bottom: Number(match[3]), left: Number(match[4]) };
  };
  // WebKitGTK honours clip-path, and the hit region is the clip intersected
  // with the border box. A fill:both negative inset paints the plan but does
  // not make that outside area a hit target.
  const usedClip = (el) => {
    const anims = el.getAnimations?.() || [];
    for (const item of anims) {
      if (!item || item.playState === "idle") continue;
      const frames = item.effect?.getKeyframes?.() || [];
      const clips = frames.map((frame) => frame?.clipPath).filter(Boolean);
      if (!clips.length) continue;
      const duration = Number(item.effect?.getTiming?.().duration) || 0;
      const now = Number(item.currentTime) || 0;
      if (item.playState === "finished" || (duration > 0 && now >= duration - 16)) return parseInset(clips.at(-1));
      return parseInset(clips[0]);
    }
    return parseInset(el.style?.clipPath || "");
  };
  const clippedOut = (el, x, y) => {
    let node = el;
    while (node && node !== document.body) {
      const clip = usedClip(node);
      const box = boxOf(node);
      if (clip && box) {
        const left = box.x + Math.max(0, clip.left);
        const top = box.y + Math.max(0, clip.top);
        const right = box.x + box.w - Math.max(0, clip.right);
        const bottom = box.y + box.h - Math.max(0, clip.bottom);
        if (x < left || y < top || x > right || y > bottom) return true;
      }
      node = node.parentElement;
    }
    return false;
  };
  document.elementFromPoint = (x, y) => {
    let found = null;
    const visit = (el) => {
      for (const child of el.children) {
        visit(child);
        if (found) return;
      }
      if (getComputedStyle(el).pointerEvents === "none") return;
      const box = boxOf(el);
      if (!contains(box, x, y)) return;
      if (clippedOut(el, x, y)) return;
      found = el;
    };
    visit(document.body);
    return found || document.body;
  };
  const center = (el) => {
    const box = boxOf(el);
    return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  };
  for (const control of [preview, source, close]) {
    assert.equal(getComputedStyle(control).pointerEvents, "auto", control.dataset.role);
  }
  assert.equal(usedClip(shell).right, -428);
  assert.equal(document.elementFromPoint(center(close).x, center(close).y).tagName, "BODY");
  const before = boxOf(plan);
  const shellLeft = shell.style.left;
  const shellWidth = shell.style.width;
  const shellClip = shell.style.clipPath;
  anim.playState = "running";
  anim.currentTime = 12;
  assert.equal(hostOpenPlan(shell), true);
  assert.equal(plan.style.left, "0px");
  assert.equal(plan.parentElement.className, "plan-hit-host");
  assert.equal(plan.style.clipPath, "none");
  assert.equal(plan.style.height, "560px");
  anim.playState = "finished";
  anim.currentTime = 280;
  assert.equal(shell.style.left, shellLeft);
  assert.equal(shell.style.width, shellWidth);
  assert.equal(shell.style.clipPath, shellClip);
  assert.equal(shell.querySelector(".center-panel").style.width, "");
  assert.equal(anim.effect.getKeyframes()[1].clipPath, openClip);
  const after = boxOf(plan);
  assert.equal(after.x, before.x);
  assert.equal(after.y, before.y);
  assert.equal(after.w, before.w + PLAN_EDGE_OUT);
  assert.equal(after.h, before.h);
  for (const control of [preview, source, close]) {
    assert.equal(getComputedStyle(control).pointerEvents, "auto", control.dataset.role);
    assert.equal(document.elementFromPoint(center(control).x, center(control).y), control, control.dataset.role);
    assert.equal(control.closest(".morph"), null, control.dataset.role);
  }
  shell.style.left = "140px";
  assert.equal(hostOpenPlan(shell), true);
  assert.equal(shell.style.width, "420px");
  assert.equal(shell.style.clipPath, openClip);
  assert.equal(boxOf(plan).x, 140 + 420);
  assert.equal(document.elementFromPoint(center(close).x, center(close).y), close);
  assert.equal(restoreHostedPlan(shell), true);
  assert.equal(plan.parentElement, shell);
  assert.equal(plan.style.left, "");
  assert.equal(plan.style.right, "");
  shell.dataset.intent = "close";
  shell.dataset.planOpen = "1";
  plan.hidden = false;
  plan._seamPhase = "grown";
  assert.equal(hostOpenPlan(shell), false);
  assert.equal(plan.parentElement, shell);
  assert.equal(shell.querySelector(".plan-hit-host"), null);
  delete shell.dataset.intent;
  assert.equal(shell.style.left, "140px");
  assert.equal(shell.style.width, "420px");
  assert.equal(shell.style.clipPath, openClip);
  assert.equal(document.elementFromPoint(center(close).x, center(close).y).tagName, "BODY");

  shell.style.left = "500px";
  shell.style.width = "420px";
  shell.dataset.planSide = "left";
  shell.dataset.planOpen = "1";
  shell.style.clipPath = "inset(-4px -4px -4px -428px round 3px)";
  plan.hidden = false;
  plan._seamPhase = "grown";
  const leftBefore = boxOf(plan).x;
  assert.equal(hostOpenPlan(shell), true);
  assert.equal(plan.style.left, `${PLAN_EDGE_OUT}px`);
  assert.equal(boxOf(plan).x, leftBefore - PLAN_EDGE_OUT);
  assert.equal(boxOf(plan).w, 420 + PLAN_EDGE_OUT);
  assert.equal(shell.style.left, "500px");
  assert.equal(shell.style.width, "420px");
  assert.equal(shell.dataset.ax, "22");
  assert.equal(document.elementFromPoint(center(close).x, center(close).y), close);
  assert.equal(restoreHostedPlan(shell), true);
  assert.equal(shell.style.left, "500px");
  assert.equal(shell.style.width, "420px");
  assert.equal(plan.parentElement, shell);
  assert.equal(plan.style.left, "");
  assert.equal(plan.style.right, "");
  plan.style.left = "0px";
  releasePlanDock(plan);
  assert.equal(plan.style.left, "");
  const host = document.createElement("div");
  host.className = "plan-hit-host";
  shell.parentElement.append(host);
  host.append(plan);
  plan.style.left = "0px";
  releasePlanDock(plan);
  assert.equal(plan.style.left, "0px");
  plan.style.left = "";
  plan.style.right = "";
  releasePlanDock(plan);
  assert.equal(plan.style.left, "");
  assert.equal(plan.style.right, "");
  shell.append(plan);
  plan.style.transform = "translateZ(0)";
  shell.dataset.state = "panel";
  shell.dataset.visual = "panel";
  shell.dataset.planOpen = "1";
  shell.dataset.planSide = "right";
  plan.hidden = false;
  plan._seamPhase = "grown";
  delete shell.dataset.intent;
  assert.equal(hostOpenPlan(shell), true);
  assert.equal(plan.style.transform, "translateZ(0)");
  assert.equal(plan.parentElement.classList.contains("plan-hit-host"), true);
  const parked = plan.style.transform;
  const docked = plan.style.left;
  const width = plan.style.width;
  assert.equal(hostOpenPlan(shell), true);
  assert.equal(plan.style.transform, parked);
  assert.equal(plan.style.left, docked);
  assert.equal(plan.style.width, width);
  plan.style.transform = "translate3d(-100%,0,0)";
  assert.equal(hostOpenPlan(shell), true);
  assert.equal(plan.style.transform, "none");
});

test("the settled plan host includes the outward edge in the same frame", () => {
  const fitted = fitPlanBox({
    shellLeft: 100,
    shellTop: 40,
    shellW: 420,
    shellH: 560,
    planW: 420,
    screenW: 1400,
    screenH: 900,
  });
  const hosted = planHostBox(fitted);
  assert.equal(fitted.side, "right");
  assert.equal(hosted.x, fitted.x);
  assert.equal(hosted.w, fitted.w + PLAN_EDGE_OUT);
  assert.ok(hosted.w >= fitted.w + 2);
  const left = fitPlanBox({
    shellLeft: 500,
    shellTop: 40,
    shellW: 420,
    shellH: 560,
    planW: 420,
    screenW: 800,
    screenH: 900,
  });
  assert.equal(left.side, "left");
  const hostedLeft = planHostBox(left);
  assert.equal(hostedLeft.x, left.x - PLAN_EDGE_OUT);
  assert.equal(hostedLeft.w, left.w + PLAN_EDGE_OUT);
  assert.equal(settledPlanReach(420), 420 + PLAN_EDGE_OUT + 1);
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const present = main.slice(main.indexOf("function presentSeamFinal"), main.indexOf("function alignSeamClock"));
  assert.match(present, /exactOpenClip/);
  assert.match(present, /hostOpenPlan\(shell\)/);
  assert.doesNotMatch(present, /translate3d/);
  assert.doesNotMatch(present, /waitPresentedFrames/);
  assert.match(main, /PLAN_GROW_MS = 280|PLAN_GROW_MS/);
  const morph = readFileSync(new URL("./morph.js", import.meta.url), "utf8");
  assert.match(morph, /PLAN_GROW_MS = 280/);
  assert.match(morph, /cubic-bezier\(\.3,\.6,\.2,1\)/);
  const hostFn = morph.slice(morph.indexOf("export function hostOpenPlan"), morph.indexOf("export function releasePlanDock"));
  assert.match(hostFn, /translateZ\(0\)/);
  assert.match(hostFn, /translate\(\?:X\|Y\|3d\)/);
  const parked = main.slice(main.indexOf("function applyParkedPlan"), main.indexOf("function lockPlanBox"));
  assert.match(parked, /releasePlanDock\(plan\)/);
  const grow = main.slice(main.indexOf("function growPlan"), main.indexOf("function visualQuiet"));
  assert.match(grow, /releasePlanDock\(plan\)/);
  assert.ok(grow.indexOf("releasePlanDock(plan)") < grow.indexOf('plan.style.transform = "none"'));
  assert.doesNotMatch(present, /translate3d/);
});
