import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  planOrbDodges,
  createDodgeSettle,
  dodgeCoverKey,
  ORB_DODGE_MAX_RETURNS,
  ORB_DODGE_SETTLE_MS,
} from "./orbdrag.js";
import { ORB, ORB_HALO_PX, orbCoveredBy } from "./morph.js";
import { suborbSizePx } from "./suborb.js";

const SUB = suborbSizePx(ORB);

// Devon's laptop, 2026-11-16 14:31 London (capture /workspace/hermes-test/laptop-jump).
// mt-orch home 486,986; a pinned sub-orb panel x127–545, bottom 947; the fan
// follower 「提」 sits +40,-13 from the parent; work area 1920×1032.
const LAPTOP = { vw: 1920, vh: 1080, insets: { top: 0, right: 0, bottom: 48, left: 0 } };
const LAPTOP_PANEL = { x: 127, y: 387, w: 418, h: 560 };
const MT_HOME = { x: 486, y: 986 };
const FAN = { dx: 40, dy: -13 };

/**
 * One reconcile pass the way main.js runs it: the follower's home is the fan
 * slot next to wherever the parent sits now (anchorPoint = dodge spot or home).
 */
function replay({ follows, steps = 8, covers = [LAPTOP_PANEL], screen = LAPTOP, home = MT_HOME, fan = FAN }) {
  let parentDodge = null;
  let subDodge = null;
  const trace = [];
  for (let i = 0; i < steps; i += 1) {
    const at = parentDodge || home;
    const subHome = { x: at.x + fan.dx, y: at.y + fan.dy };
    const items = [
      { id: "mt-orch", home, current: parentDodge },
      {
        id: "suborb:mt-orch:20261110_221455_d3abe7",
        home: subHome,
        current: subDodge,
        disc: SUB,
        ...(follows === undefined ? {} : { parent: "mt-orch", follows }),
      },
    ];
    const plan = planOrbDodges(items, covers, screen);
    const p = plan.get("mt-orch");
    const s = plan.get("suborb:mt-orch:20261110_221455_d3abe7");
    parentDodge = p.dodged ? p.spot : null;
    subDodge = s.dodged ? s.spot : null;
    trace.push({ parent: parentDodge || home, sub: subDodge || subHome });
  }
  return trace;
}

const same = (a, b) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;

test("R-OB-08 laptop replay: the old plan hops 986 <-> 928 forever (the bug)", () => {
  const trace = replay({ follows: undefined });
  const ys = trace.map((t) => t.parent.y);
  assert.ok(ys.includes(986) && ys.includes(928), `hops between both spots: ${ys.join(",")}`);
  for (let i = 2; i < trace.length; i += 1) {
    assert.ok(!same(trace[i].parent, trace[i - 1].parent), "without the follower flag the parent never settles");
  }
});

test("R-OB-08 laptop replay: with its fan follower ignored the parent settles at once and stays", () => {
  const trace = replay({ follows: true, steps: 12 });
  const first = trace[0].parent;
  assert.deepEqual(first, { x: 608, y: 986 }, "right of the panel on the home row");
  for (const step of trace) assert.ok(same(step.parent, first), `parent stays put: ${JSON.stringify(step.parent)}`);
  // Pass 0 still had the fan at the old home; from pass 1 it rides the settled parent.
  for (const step of trace.slice(1)) assert.ok(same(step.sub, { x: 648, y: 973 }), `follower stays put: ${JSON.stringify(step.sub)}`);
  // Still clear of the panel with the full 34px halo.
  assert.ok(!orbCoveredBy({ x: first.x - ORB / 2, y: first.y - ORB / 2, w: ORB, h: ORB }, [LAPTOP_PANEL], ORB_HALO_PX));
});

test("R-OB-08 a dropped sub-orb still blocks its parent (only fan followers are ignored)", () => {
  // Dropped right where the parent would like to dodge to.
  const items = [
    { id: "mt-orch", home: MT_HOME, current: null },
    { id: "suborb:mt-orch:s1", home: { x: 608, y: 986 }, disc: SUB, parent: "mt-orch", follows: false },
  ];
  const spot = planOrbDodges(items, [LAPTOP_PANEL], LAPTOP).get("mt-orch").spot;
  assert.ok(Math.hypot(spot.x - 608, spot.y - 986) >= ORB / 2 + SUB / 2 + 12 - 0.5, `kept clear of the drop: ${JSON.stringify(spot)}`);
});

test("R-OB-08 a follower only skips its own parent, not other orbs", () => {
  const items = [
    { id: "alpha", home: MT_HOME, current: null },
    { id: "suborb:beta:s1", home: { x: 608, y: 986 }, disc: SUB, parent: "beta", follows: true },
  ];
  const spot = planOrbDodges(items, [LAPTOP_PANEL], LAPTOP).get("alpha").spot;
  assert.ok(Math.hypot(spot.x - 608, spot.y - 986) >= ORB / 2 + SUB / 2 + 12 - 0.5, "someone else's fan still blocks");
});

test("R-OB-08 general convergence: parents with fans next to panels settle in a few passes", () => {
  let seed = 84;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let round = 0; round < 200; round += 1) {
    const covers = [{ x: 60 + rand() * 1200, y: 40 + rand() * 500, w: 320 + rand() * 300, h: 240 + rand() * 300 }];
    if (rand() < 0.5) covers.push({ x: rand() * 1400, y: rand() * 600, w: 320 + rand() * 200, h: 240 + rand() * 200 });
    const parents = [0, 1, 2].map((k) => ({ id: `p${k}`, home: { x: 40 + rand() * 1840, y: 40 + rand() * 950 } }));
    const fans = parents.map(() => ({ dx: rand() < 0.5 ? 40 : -40, dy: -13 + rand() * 26 }));
    const dodge = new Map();
    let last = "";
    let stableAt = -1;
    for (let pass = 0; pass < 10; pass += 1) {
      const items = [];
      parents.forEach((p, k) => {
        items.push({ id: p.id, home: p.home, current: dodge.get(p.id) || null });
        const at = dodge.get(p.id) || p.home;
        const sid = `suborb:${p.id}:s`;
        items.push({ id: sid, home: { x: at.x + fans[k].dx, y: at.y + fans[k].dy }, current: dodge.get(sid) || null, disc: SUB, parent: p.id, follows: true });
      });
      const plan = planOrbDodges(items, covers, LAPTOP);
      for (const [id, entry] of plan) {
        if (entry.dodged && entry.spot) dodge.set(id, entry.spot);
        else dodge.delete(id);
      }
      const key = JSON.stringify([...dodge.entries()].sort());
      if (key === last) {
        if (stableAt < 0) stableAt = pass;
      } else {
        assert.equal(stableAt, -1, `round ${round}: settled at ${stableAt} then moved again at ${pass}`);
      }
      last = key;
    }
    assert.ok(stableAt >= 0 && stableAt <= 3, `round ${round}: settles within 3 passes (got ${stableAt})`);
  }
});

test("R-OB-08 a sub-orb's drawn disc sets the disc gap, the cover check stays 44px + halo", () => {
  // Cover check: a 20px sub-orb whose 44px+34px box meets the panel still dodges.
  const near = { x: 545 + 50, y: 700 };
  const plan = planOrbDodges([{ id: "suborb:p:s", home: near, disc: SUB }], [LAPTOP_PANEL], LAPTOP);
  assert.equal(plan.get("suborb:p:s").dodged, true, "50px from the panel edge is inside 22+34");
  // Disc gap: a main orb may park 22+10+12 from a small disc, not 22+22+12.
  const items = [
    { id: "a", home: { x: 545 - 10, y: 700 }, current: null },
    { id: "suborb:z:s", home: { x: 545 + 63 + 22 + SUB / 2 + 12 + 1, y: 700 }, disc: SUB },
  ];
  const spot = planOrbDodges(items, [LAPTOP_PANEL], LAPTOP).get("a").spot;
  assert.deepEqual(spot, { x: 608, y: 700 }, "fits beside a small disc");
});

test("R-OB-08 settle guard holds an orb that keeps going back to the same spot", () => {
  const gate = createDodgeSettle();
  const a = { x: 608, y: 986 };
  const b = { x: 608, y: 928 };
  let t = 0;
  const seen = [];
  for (let i = 0; i < 8; i += 1) {
    seen.push(gate.allow("mt-orch", i % 2 ? b : a, { now: t, coverKey: "k" }));
    t += 250;
  }
  assert.deepEqual(seen.slice(0, ORB_DODGE_MAX_RETURNS * 2), Array(ORB_DODGE_MAX_RETURNS * 2).fill(true));
  assert.ok(seen.slice(ORB_DODGE_MAX_RETURNS * 2).every((ok) => !ok), "held once it loops");
  // A panel that moves, opens or closes resets the guard.
  assert.equal(gate.allow("mt-orch", a, { now: t, coverKey: "k2" }), true);
  // Ordinary moves spread out in time are never held.
  const slow = createDodgeSettle();
  for (let i = 0; i < 6; i += 1) assert.equal(slow.allow("x", i % 2 ? b : null, { now: i * (ORB_DODGE_SETTLE_MS + 1), coverKey: "k" }), true);
  assert.equal(dodgeCoverKey([{ x: 1.2, y: 2, w: 3, h: 4 }, { x: 0, y: 0, w: 0, h: 9 }]), "1,2,3,4");
});

test("R-OB-08 reconcile passes the real sub-orb size and the follower flag, and gates on settle", () => {
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const body = main.slice(main.indexOf("function reconcileOrbDodges()"), main.indexOf("let orbPositionWrite"));
  assert.match(body, /item\.disc = suborbSizePx\(ORB\)/);
  assert.match(body, /item\.follows = !suborbPlacedFree\(id\)/);
  assert.match(body, /orbDodgeSettle\.allow\(id, target/);
});
