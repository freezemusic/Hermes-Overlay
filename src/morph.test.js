import assert from "node:assert/strict";
import test from "node:test";
import {
  COLLAPSE_MS,
  CONTENT_IN_MS,
  CONTENT_OUT_MS,
  EASE,
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
  insetsFor,
  openPhases,
  phaseList,
  iconShift,
  placeShell,
  previewBlocked,
  screenEdge,
  slotPoint,
  tighten,
  visibleSize,
} from "./morph.js";

const screen = { w: 1280, h: 800 };

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
  assert.equal(COLLAPSE_MS, 360);
  assert.equal(CONTENT_OUT_MS, 100);
  assert.equal(CONTENT_IN_MS, 120);
  assert.equal(EASE, "cubic-bezier(.2,.8,.2,1)");
  assert.doesNotMatch(EASE, /spring/i);
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

test("pill to panel grows perpendicular to the edge", () => {
  const side = geom("left", 64, 200);
  assert.deepEqual(openPhases("left").map((step) => step.state), ["pill", "wide", "panel"]);
  assert.deepEqual(openPhases("right").map((step) => step.state), ["pill", "wide", "panel"]);
  const wide = insetsFor("wide", side);
  assert.deepEqual(visibleSize(wide, PANEL_W, PANEL_H), { w: PANEL_W, h: ORB });
  assert.equal(wide.radius, ORB / 2);

  const vertical = geom("bottom", 1100, 736);
  assert.deepEqual(openPhases("bottom").map((step) => step.state), ["pill", "tall", "panel"]);
  assert.deepEqual(openPhases("top").map((step) => step.state), ["pill", "tall", "panel"]);
  const tall = insetsFor("tall", vertical);
  assert.deepEqual(visibleSize(tall, PANEL_W, PANEL_H), { w: PILL_W, h: PANEL_H });
  const panel = insetsFor("panel", vertical);
  assert.deepEqual(visibleSize(panel, PANEL_W, PANEL_H), { w: PANEL_W, h: PANEL_H });
  assert.equal(panel.radius, PANEL_RADIUS);
  assert.ok(panel.radius <= 3);
});

test("collapse reverses and stays within 360ms with content fading first", () => {
  for (const edge of ["left", "right", "top", "bottom"]) {
    const steps = collapsePhases(edge, "panel");
    const mid = edge === "left" || edge === "right" ? "wide" : "tall";
    assert.deepEqual(steps.map((step) => step.state), [mid, "pill", "orb"]);
    const shape = steps.reduce((sum, step) => sum + step.ms, 0);
    assert.equal(shape + CONTENT_OUT_MS, COLLAPSE_MS);
    assert.ok(shape + CONTENT_OUT_MS <= 360);
  }
  assert.equal(collapsePhases("bottom", "pill").reduce((sum, step) => sum + step.ms, 0), ORB_PILL_MS);
  assert.equal(openPhases("top").reduce((sum, step) => sum + step.ms, 0), ORB_PILL_MS + PILL_PANEL_MS);
  assert.deepEqual(phaseList("left", "pill", "panel").map((step) => step.state), ["wide", "panel"]);
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

test("the panel icon sits in the header corner on the edge side", () => {
  const bottomLeft = geom("bottom", 200, 760);
  const shift = iconShift(bottomLeft.ax, bottomLeft.ay, PANEL_W, PANEL_H);
  assert.equal(shift.x, 0);
  assert.equal(bottomLeft.ay + shift.y, ORB / 2);
  assert.ok(shift.y < 0);

  const bottomRight = geom("bottom", 1100, 736);
  const rightShift = iconShift(bottomRight.ax, bottomRight.ay, PANEL_W, PANEL_H);
  assert.equal(bottomRight.ax + rightShift.x, PANEL_W - ORB / 2);
  assert.equal(bottomRight.ay + rightShift.y, ORB / 2);

  const lowerLeft = geom("left", 40, 640);
  const leftShift = iconShift(lowerLeft.ax, lowerLeft.ay, PANEL_W, PANEL_H);
  assert.equal(leftShift.x, 0);
  assert.equal(lowerLeft.ay + leftShift.y, ORB / 2);

  const top = geom("top", 200, 30);
  assert.deepEqual(iconShift(top.ax, top.ay, PANEL_W, PANEL_H), { x: 0, y: 0 });
  const clip = insetsFor("panel", top);
  assert.equal(containsPoint(clip, PANEL_W, PANEL_H, top.ax, top.ay), true);
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
