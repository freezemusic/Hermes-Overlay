import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SUBORB_ANIM_FLAG_MS,
  suborbCentreRejected,
  suborbPlaceCentre,
  suborbStuckAnim,
  suborbTetherWanted,
} from "./orbdrag.js";

const SCREEN = { vw: 1920, vh: 1080 };
const SIZE = 19.8;
const RADIUS = SIZE / 2;

function wanted(extra = {}) {
  return suborbTetherWanted({
    state: "orb",
    centre: { x: 520, y: 340 },
    radius: RADIUS,
    size: SIZE,
    ...SCREEN,
    ...extra,
  });
}

test("R-OB-08 a stuck-animation sub-orb gets no tether", () => {
  assert.equal(wanted({ morphing: true }), false);
  assert.equal(wanted({ collapsing: true }), false);
  assert.equal(wanted({ opening: "panel" }), false);
  assert.equal(wanted({ fan: "collapsed" }), false);
  assert.equal(wanted({ fan: "tucked" }), false);
  assert.equal(wanted({ fan: "hidden" }), false);
});

test("R-OB-08 a sub-orb at (0,0) or any unplaced centre gets no tether", () => {
  assert.equal(wanted({ centre: { x: 0, y: 0 } }), false);
  assert.equal(wanted({ centre: { x: -4, y: 200 } }), false);
  assert.equal(wanted({ centre: { x: 5, y: 400 } }), false, "within its radius of the screen edge");
  assert.equal(wanted({ centre: { x: RADIUS, y: RADIUS } }), false, "disc sitting on the screen corner");
  assert.equal(wanted({ centre: { x: 2000, y: 400 } }), false, "off the right edge");
  assert.equal(wanted({ centre: { x: 400, y: 2000 } }), false, "off the bottom edge");
  const fallback = { x: 8 + RADIUS, y: 8 + RADIUS };
  assert.equal(suborbCentreRejected(fallback, { radius: RADIUS, size: SIZE, ...SCREEN }), true);
  assert.equal(wanted({ centre: fallback }), false, "(8,8) fallback");
  assert.equal(wanted({ centre: { x: 22, y: 22 }, unset: { x: 22, y: 22 } }), false, "unplaced shell default");
  assert.equal(wanted({ opacity: 0 }), false);
  assert.equal(wanted({ opacity: 0.01 }), false);
  assert.equal(wanted({ hidden: true }), false);
  assert.equal(wanted({ state: "panel" }), false);
  assert.equal(wanted({ state: "pill" }), false, "a preview pill is not a resting disc");
});

test("R-OB-08 a resting on-screen sub-orb still gets a tether", () => {
  assert.equal(wanted(), true);
  assert.equal(wanted({ opacity: 0.18 }), true, "proximity floor is still visible");
  const inset = RADIUS + 4;
  assert.equal(wanted({ centre: { x: inset, y: 400 } }), true, "a clamped drop is not the corner");
  assert.equal(wanted({ centre: { x: 22, y: 22 } }), true, "a real slot at (22,22) is not the unset default");
});

test("R-PN-11 a stuck sub-orb is re-placed onto a valid slot, never the corner", () => {
  const now = 10_000;
  const since = now - SUBORB_ANIM_FLAG_MS;
  assert.equal(SUBORB_ANIM_FLAG_MS >= 1000, true);
  assert.equal(suborbStuckAnim({
    state: "orb",
    morphing: true,
    since,
    now,
  }), true);
  assert.equal(suborbStuckAnim({
    state: "orb",
    collapsing: true,
    opening: "panel",
    since,
    now,
  }), true);
  assert.equal(suborbStuckAnim({
    state: "orb",
    morphing: true,
    since: now - 200,
    now,
  }), false, "a live open is shorter than the safety timeout");
  assert.equal(suborbStuckAnim({
    state: "panel",
    morphing: true,
    since: 1,
    now,
  }), false, "an open panel keeps its seam flag");
  const slot = { x: 400, y: 280 };
  const centre = suborbPlaceCentre(slot, { size: SIZE, ...SCREEN });
  assert.deepEqual(centre, { x: 400 + RADIUS, y: 280 + RADIUS });
  assert.equal(suborbCentreRejected(centre, { radius: RADIUS, size: SIZE, ...SCREEN }), false);
  assert.equal(suborbPlaceCentre({ x: -RADIUS, y: -RADIUS }, { size: SIZE, ...SCREEN }), null, "(0,0) centre");
  assert.equal(suborbPlaceCentre({ x: 0, y: 0 }, { size: SIZE, ...SCREEN }), null, "top-left on the corner");
  assert.equal(suborbPlaceCentre({ x: 8, y: 8 }, { size: SIZE, ...SCREEN }), null, "(8,8) fallback");
  assert.equal(suborbPlaceCentre(null, { size: SIZE, ...SCREEN }), null);
});

test("R-OB-08 / R-PN-11 main.js skips the tether and puts a stuck disc back on its slot", () => {
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const paint = main.slice(main.indexOf("function paintSuborbTethers()"), main.indexOf("function paintFanParent("));
  assert.match(paint, /suborbTetherWanted/);
  assert.match(paint, /suborbTether\(parentOrbBox/);
  const place = main.slice(main.indexOf("function renderSuborbs()"), main.indexOf("/** Fan slot centre written by renderSuborbs"));
  assert.match(place, /suborbStuckAnim/);
  assert.match(place, /clearSuborbAnimFlags\(shell\)/);
  assert.match(place, /suborbPlaceCentre/);
  assert.match(place, /if \(placeSuborbShell\(shell\)\) glideSuborb/);
  const layout = main.slice(main.indexOf("function suborbLayoutCentre"), main.indexOf("function suborbPlacedFree"));
  assert.doesNotMatch(layout, /8 \+ suborbSizePx/);
  const shell = main.slice(main.indexOf("function placeSuborbShell"), main.indexOf("function wireSuborbPanel"));
  assert.match(shell, /suborbCentreRejected/);
  assert.doesNotMatch(shell, /: 8\)/);
  const origin = main.slice(main.indexOf("function cascadeOriginBox"), main.indexOf("function openSuborbPanel("));
  assert.doesNotMatch(origin, /: 8\)/);
});
