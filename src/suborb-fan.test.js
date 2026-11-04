import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SUBORB_CAP,
  SUBORB_FAN_CAP,
  SUBORB_FAN_EASE,
  SUBORB_FAN_GAP_PX,
  SUBORB_FAN_MAX_SPAN_DEG,
  SUBORB_FAN_MS,
  SUBORB_HIT_PX,
  suborbFanDirection,
  suborbFanLayout,
  suborbFanOrbit,
  suborbFanState,
  suborbHitCircle,
  suborbSizePx,
} from "./suborb.js";

const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const size = suborbSizePx(44);
const W1920 = { left: 0, top: 0, width: 1920, height: 1080 };
const deg = (rad) => (rad * 180) / Math.PI;
const dist = (a, b) => Math.hypot(a.cx - b.cx, a.cy - b.cy);

test("fan draft: cap 4 plus 「+N」, 24px hits, 200ms ease", () => {
  assert.equal(SUBORB_FAN_CAP, 4);
  assert.equal(SUBORB_CAP, SUBORB_FAN_CAP);
  assert.equal(SUBORB_HIT_PX, 24);
  assert.equal(SUBORB_FAN_MS, 200);
  assert.equal(SUBORB_FAN_EASE, "cubic-bezier(.2,.8,.2,1)");
});

test("the arc faces the work-area centre on every edge", () => {
  assert.equal(Math.round(deg(suborbFanDirection(1854, 540, W1920))), 180);
  assert.equal(Math.round(deg(suborbFanDirection(66, 540, W1920))), 0);
  assert.equal(Math.round(deg(suborbFanDirection(960, 66, W1920))), 90);
  assert.equal(Math.round(deg(suborbFanDirection(960, 1046, W1920))), -90);
  // A work area with a 48px taskbar moves the centre up.
  const bar = { left: 0, top: 0, width: 1920, height: 1032 };
  assert.ok(deg(suborbFanDirection(1854, 540, bar)) < 180 + 1e-9);
});

test("orbit = parent radius + 10px gap + sub radius; hits never overlap", () => {
  const base = 22 + SUBORB_FAN_GAP_PX + size / 2;
  for (const count of [1, 2, 3, 4, 5]) {
    const orbit = suborbFanOrbit(count, { parent: 44, size });
    assert.ok(orbit.radius >= base - 1e-9, `count ${count} radius ${orbit.radius}`);
    assert.ok(deg(orbit.step * (count - 1)) <= SUBORB_FAN_MAX_SPAN_DEG + 1e-6, `span count ${count}`);
    const fan = suborbFanLayout({ x: 1854, y: 540, parent: 44, count, size, work: W1920 });
    assert.equal(fan.mode, "fan");
    assert.equal(fan.slots.length, count);
    for (let i = 1; i < fan.slots.length; i += 1) {
      assert.ok(dist(fan.slots[i], fan.slots[i - 1]) >= SUBORB_HIT_PX, `adjacent hits overlap at ${count}`);
    }
    // The 24px hit stays off the 44px parent disc.
    for (const slot of fan.slots) assert.ok(Math.hypot(slot.cx - 1854, slot.cy - 540) - SUBORB_HIT_PX / 2 >= 22);
  }
  assert.equal(Math.round(suborbFanOrbit(4, { parent: 44, size }).radius * 10) / 10, Math.round(base * 10) / 10);
  assert.ok(suborbFanOrbit(5, { parent: 44, size }).radius > base);
});

test("slots run clockwise from the counter-clockwise end (right edge: bottom first)", () => {
  const fan = suborbFanLayout({ x: 1854, y: 540, parent: 44, count: 5, size, work: W1920 });
  const angles = fan.slots.map((slot) => slot.angle);
  for (let i = 1; i < angles.length; i += 1) assert.ok(angles[i] > angles[i - 1]);
  assert.ok(fan.slots[0].cy > 540, "first slot below the orb on the right edge");
  assert.ok(fan.slots[4].cy < 540, "「+N」 slot above it");
  assert.ok(fan.slots.every((slot) => slot.cx < 1854), "all on the inward side");
  const left = suborbFanLayout({ x: 66, y: 540, parent: 44, count: 3, size, work: W1920 });
  assert.ok(left.slots[0].cy < 540 && left.slots[2].cy > 540, "left edge: top first");
  assert.ok(left.slots.every((slot) => slot.cx > 66));
});

test("a fan that would leave the work area, or crowd a neighbour halo, collapses", () => {
  const near = [{ x: 1854, y: 465, r: 22 }]; // 75px above: the AD's eyeballed gap
  const crowded = suborbFanLayout({ x: 1854, y: 540, parent: 44, count: 5, size, work: W1920, neighbours: near });
  assert.equal(crowded.mode, "badge");
  assert.equal(crowded.reason, "neighbour");
  assert.equal(crowded.slots.length, 5, "slots are kept so Ctrl can expand them");
  assert.ok(crowded.badge && Math.hypot(crowded.badge.cx - 1854, crowded.badge.cy - 540) > 22);
  // 130px (1920×1080 default cron↔bot gap) leaves room.
  const room = suborbFanLayout({ x: 1854, y: 540, parent: 44, count: 5, size, work: W1920, neighbours: [{ x: 1854, y: 410, r: 22 }] });
  assert.equal(room.mode, "fan");
  for (const slot of room.slots) assert.ok(Math.hypot(slot.cx - 1854, slot.cy - 410) >= 22 + 34 + 8 + size / 2 - 1e-9);
  // A tiny work area: every turn leaves it.
  const tight = suborbFanLayout({ x: 30, y: 30, parent: 44, count: 4, size, work: { left: 0, top: 0, width: 60, height: 60 } });
  assert.equal(tight.mode, "badge");
  assert.equal(tight.reason, "work");
});

test("the arc may turn up to 30° away from a crowded side before it collapses", () => {
  const cron = [{ x: 1216, y: 304, r: 22 }]; // 1280×800 default: cron 96px above coder
  const strict = suborbFanLayout({ x: 1216, y: 400, parent: 44, count: 5, size, screenW: 1280, screenH: 800, neighbours: cron, nudges: [0] });
  assert.equal(strict.mode, "badge");
  const nudged = suborbFanLayout({ x: 1216, y: 400, parent: 44, count: 5, size, screenW: 1280, screenH: 800, neighbours: cron });
  assert.equal(nudged.mode, "fan");
  assert.ok(Math.abs(nudged.turn) <= 30 && nudged.turn !== 0);
});

test("look: tucked while the parent panel is open, a badge expands only with Ctrl", () => {
  assert.equal(suborbFanState({ mode: "fan" }), "fan");
  assert.equal(suborbFanState({ mode: "badge" }), "collapsed");
  assert.equal(suborbFanState({ mode: "badge", held: true }), "expanded");
  assert.equal(suborbFanState({ mode: "fan", held: true, parentOpen: true }), "tucked");
});

test("hit circle is 24px on the disc centre and never smaller than the disc", () => {
  assert.deepEqual(suborbHitCircle({ x: 100, y: 100, w: 20, h: 20 }), { x: 98, y: 98, w: 24, h: 24 });
  assert.deepEqual(suborbHitCircle({ x: 0, y: 0, w: 30, h: 30 }), { x: 0, y: 0, w: 30, h: 30 });
});

test("main.js: hidden fan shells publish no hit and no plate; Ctrl edge re-renders", () => {
  const hits = main.slice(main.indexOf("function collectHits()"), main.indexOf("function collectHits()") + 1200);
  assert.match(hits, /suborbFanHidden\(shell\)\) return;/);
  assert.match(main, /suborbHitCircle\(orbDiscHit\(box, disc\)\)/);
  const names = main.slice(main.indexOf("function paintOrbNames()"), main.indexOf("function paintOrbNames()") + 1400);
  assert.match(names, /suborbFanHidden\(shell\)/);
  const accept = main.slice(main.indexOf("function acceptModifier("), main.indexOf("const orbFadeClocks"));
  assert.match(accept, /syncSuborbFanHeld\(\)/);
  assert.match(main, /paintSuborbTabs\(bot, view\)/);
});

test("css: fan motion is opacity + transform, 200ms, and hidden looks take no pointer", () => {
  assert.match(css, /transition: opacity 200ms cubic-bezier\(\.2, \.8, \.2, 1\), transform 200ms cubic-bezier\(\.2, \.8, \.2, 1\)/);
  assert.match(css, /\[data-fan="collapsed"\] \.suborb-disc,[\s\S]*?pointer-events: none;/);
  assert.match(css, /\.suborb-tab\[data-pinned="1"\] \.suborb-tab-dot \{ border-style: solid; \}/);
});
