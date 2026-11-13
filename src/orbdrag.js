/**
 * R-OB-08 (Devon 2026-11-10: 「是時候把球都可以隨意移動了, 我就說了要跟 Rainmeter
 * 的效果」「而被框碰到時, 球應該自動偏移到框外, 而不是消失, 直到原本位置沒框」).
 *
 * Free orb positions, Rainmeter-skin style: modifier+drag an orb anywhere in
 * the work area and it stays there. The spot is saved per orb in config.json
 * `orb_positions` through the app's own `set_orb_position` command. A drop
 * stays exactly where it lands (Devon: 「我就是要到處拖」); Settings 「所有光球
 * 返原位」 (`reset_orb_positions`) is the only way back to the design spots.
 *
 * Dodge: when an open panel (or plan) covers an orb's home, the orb moves to
 * the nearest free spot outside every panel, clear of the other orbs, and
 * comes back once its home is clear again. Pure geometry lives here; main.js
 * owns the DOM.
 */

import { ORB, ORB_HALO_PX, ORB_WORK_CLEAR_PX, workFrame } from "./morph.js";

/** Pointer travel before a modifier press becomes a drag instead of a click. */
export const ORB_DRAG_THRESHOLD_PX = 5;
/** Disc edge to work-area edge. */
export const ORB_EDGE_GAP_PX = 4;
/** Disc-to-disc clearance between two main orbs (R-SO-02 uses 12 for discs). */
export const ORB_DISC_GAP_PX = 12;
/** Extra air between the halo box and a panel when dodging. */
export const ORB_DODGE_GAP_PX = 6;
/** Slide out / back. Same curve and length class as the fan (R-SO-02 #10). */
export const ORB_DODGE_MS = 220;
export const ORB_DODGE_EASE = "cubic-bezier(.2,.8,.2,1)";
/** A parked dodge stays put unless a new spot is this much nearer home. */
export const ORB_DODGE_KEEP_PX = 40;
/** Largest stored coordinate. The live clamp is the monitor work area. */
export const ORB_MAX_COORD = 10000;

const PROFILE_ID = /^[A-Za-z0-9_.\-]+$/;
const SESSION_ID = /^[A-Za-z0-9_\-]+$/;

/**
 * R-OB-08 (Devon 2026-11-13): a sub-orb id is `suborb:<profile>:<session>`.
 * Same charset as a profile (1–64) and a pinned session (1–128). The `+N`
 * badge (`suborb-more:…`) is not a session and has no saved spot.
 */
export function validSuborbOrbId(id) {
  const text = String(id ?? "");
  if (!text.startsWith("suborb:")) return false;
  const rest = text.slice("suborb:".length);
  const cut = rest.indexOf(":");
  if (cut <= 0 || cut >= rest.length - 1) return false;
  const profile = rest.slice(0, cut);
  const session = rest.slice(cut + 1);
  if (profile.length > 64 || session.length > 128 || session.includes(":")) return false;
  if (profile === "." || profile === "..") return false;
  return PROFILE_ID.test(profile) && SESSION_ID.test(session);
}

/** `orb_positions` key: a profile / chrome orb, or one dragged sub-orb. */
export function validOrbId(id) {
  const text = String(id ?? "");
  if (text.startsWith("suborb:")) return validSuborbOrbId(text);
  return text.length > 0 && text.length <= 128 && PROFILE_ID.test(text);
}

/**
 * Resting orbs drag. A sub-orb drags like a main orb (Devon 2026-11-13);
 * one that has never been dragged still follows the fan until that drop.
 * An open panel moves by its header, not by this gesture.
 */
export function orbDraggable(kind, id, visual) {
  if (visual !== "orb") return false;
  if (kind === "suborb") return validSuborbOrbId(id);
  return validOrbId(id);
}

/**
 * Where a sub-orb centre sits. No saved drop → the fan slot (it follows the
 * parent). A drop stays put when the fan moves. A live drag or a dodge wins.
 */
export function suborbRestCentre({ fan = null, saved = null, drag = null, dodge = null } = {}) {
  const point = (value) => {
    const x = Number(value?.x);
    const y = Number(value?.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  };
  return point(drag) || point(dodge) || point(saved) || point(fan);
}

/** Hairline from a profile orb centre to a sub-orb centre. No hit of its own. */
export function suborbTether(parent, child) {
  const x1 = Number(parent?.x);
  const y1 = Number(parent?.y);
  const x2 = Number(child?.x);
  const y2 = Number(child?.y);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  return { x1, y1, x2, y2 };
}

/** `orb_positions` from settings: only valid ids with whole, in-range coordinates. */
export function normalizeOrbPositions(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, value] of Object.entries(raw)) {
    if (!validOrbId(id) || !value || typeof value !== "object") continue;
    if (typeof value.x !== "number" || typeof value.y !== "number") continue;
    const x = Math.round(value.x);
    const y = Math.round(value.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < 0 || y < 0 || x > ORB_MAX_COORD || y > ORB_MAX_COORD) continue;
    out[id] = { x, y };
  }
  return out;
}

/** Bounds for an orb centre: the disc stays inside the work area (screen minus taskbar). */
export function orbBounds({ vw = 1280, vh = 800, insets = null, orb = ORB } = {}) {
  const frame = workFrame(vw, vh, insets);
  const r = orb / 2;
  const minX = frame.left + r + ORB_EDGE_GAP_PX;
  const maxX = frame.left + frame.width - r - ORB_EDGE_GAP_PX;
  const minY = frame.top + r + ORB_EDGE_GAP_PX;
  const maxY = frame.top + frame.height - r - ORB_WORK_CLEAR_PX;
  return {
    minX,
    maxX: Math.max(minX, maxX),
    minY,
    maxY: Math.max(minY, maxY),
  };
}

export function clampOrbPoint(point, screen = {}) {
  const b = orbBounds(screen);
  const x = Number(point?.x);
  const y = Number(point?.y);
  return {
    x: Math.round(Math.min(b.maxX, Math.max(b.minX, Number.isFinite(x) ? x : b.minX))),
    y: Math.round(Math.min(b.maxY, Math.max(b.minY, Number.isFinite(y) ? y : b.minY))),
  };
}

/** A press becomes a drag once it travels the threshold. */
export function dragStarted(dx, dy, threshold = ORB_DRAG_THRESHOLD_PX) {
  return Math.hypot(Number(dx) || 0, Number(dy) || 0) >= threshold;
}

/**
 * Same rule as Ctrl+click (R-CT): the press must have begun with the modifier
 * down. Without OS hit testing (browser preview) the orb is clickable, so a
 * drag is allowed too.
 */
export function orbDragAllowed({ supported = true, ctrlAtDown = false, modifierNow = false, pressFrozen = false } = {}) {
  if (supported === false) return true;
  return ctrlAtDown === true || modifierNow === true || pressFrozen === true;
}

/** Disc plus halo around a centre, as a box (same box `orbCoveredBy` measures). */
export function haloBox(point, { orb = ORB, halo = ORB_HALO_PX } = {}) {
  const r = orb / 2 + halo;
  return { x: point.x - r, y: point.y - r, w: r * 2, h: r * 2 };
}

function intersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function validCover(box) {
  return box && box.w >= 1 && box.h >= 1;
}

/** True when an open panel meets this centre's disc + halo. */
export function pointCovered(point, covers, opts = {}) {
  const box = haloBox(point, opts);
  return (covers || []).some((cover) => validCover(cover) && intersects(box, cover));
}

function spotFree(point, covers, others, bounds, opts) {
  if (point.x < bounds.minX - 0.5 || point.x > bounds.maxX + 0.5) return false;
  if (point.y < bounds.minY - 0.5 || point.y > bounds.maxY + 0.5) return false;
  const gap = opts.gap ?? ORB_DODGE_GAP_PX;
  const box = haloBox(point, opts);
  const padded = { x: box.x - gap, y: box.y - gap, w: box.w + gap * 2, h: box.h + gap * 2 };
  if ((covers || []).some((cover) => validCover(cover) && intersects(padded, cover))) return false;
  const radius = (opts.orb ?? ORB) / 2;
  return !(others || []).some((other) => {
    if (!other) return false;
    const otherR = Number.isFinite(other.r) ? other.r : radius;
    return Math.hypot(other.x - point.x, other.y - point.y) < radius + otherR + ORB_DISC_GAP_PX;
  });
}

/**
 * Nearest free centre to `home` outside every cover (disc + halo + gap clear
 * of each panel), inside the work area, and at least a disc + 12px from every
 * point in `others`. Tries the four sides and corners of each cover first,
 * sliding along a side past neighbouring orbs, then a ring search. null when
 * nothing fits (the caller keeps the old fade-to-0 as a last resort).
 */
export function findDodgeSpot(home, { covers = [], others = [], screen = {}, orb = ORB, halo = ORB_HALO_PX, gap = ORB_DODGE_GAP_PX } = {}) {
  if (!home) return null;
  const opts = { orb, halo, gap };
  const bounds = orbBounds({ ...screen, orb });
  const reach = orb / 2 + halo + gap + 1;
  const step = orb + ORB_DISC_GAP_PX + 2;
  const candidates = [];
  const add = (x, y) => {
    candidates.push({
      x: Math.round(Math.min(bounds.maxX, Math.max(bounds.minX, x))),
      y: Math.round(Math.min(bounds.maxY, Math.max(bounds.minY, y))),
    });
  };
  for (const cover of covers) {
    if (!validCover(cover)) continue;
    const left = cover.x - reach;
    const right = cover.x + cover.w + reach;
    const top = cover.y - reach;
    const bottom = cover.y + cover.h + reach;
    for (let k = 0; k <= 8; k += 1) {
      const offsets = k === 0 ? [0] : [k * step, -k * step];
      for (const off of offsets) {
        add(left, home.y + off);
        add(right, home.y + off);
        add(home.x + off, top);
        add(home.x + off, bottom);
      }
    }
    add(left, top);
    add(right, top);
    add(left, bottom);
    add(right, bottom);
  }
  const dist = (p) => Math.hypot(p.x - home.x, p.y - home.y);
  let best = null;
  for (const p of candidates) {
    if (!spotFree(p, covers, others, bounds, opts)) continue;
    if (!best || dist(p) < dist(best) - 0.01) best = p;
  }
  if (best) return best;
  // Ring search: covers may chain into each other or meet the screen edge.
  const span = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  for (let radius = 16; radius <= span + 16; radius += 16) {
    const count = Math.max(12, Math.round((2 * Math.PI * radius) / 16));
    let ring = null;
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * Math.PI * 2;
      const p = { x: Math.round(home.x + Math.cos(a) * radius), y: Math.round(home.y + Math.sin(a) * radius) };
      if (!spotFree(p, covers, others, bounds, opts)) continue;
      if (!ring || dist(p) < dist(ring)) ring = p;
    }
    if (ring) return ring;
  }
  return null;
}

/**
 * Where every resting orb should sit right now. `orbs` is
 * `[{ id, home, current? }]` in a stable order; `covers` are the open panel
 * boxes. Uncovered orbs stay home. Covered orbs get a dodge spot that keeps
 * clear of every other orb's spot (earlier dodges included). A covered orb
 * that is already parked on a still-valid spot keeps it, so a panel that
 * grows by a pixel does not make the orbs hop. `null` spot = no room (fade).
 */
function dodgeMeasure(item, opts) {
  const orb = Number(item?.orb) > 0 ? item.orb : (opts.orb ?? ORB);
  const halo = item && Object.prototype.hasOwnProperty.call(item, "halo") ? item.halo : (opts.halo ?? ORB_HALO_PX);
  return { orb, halo, gap: opts.gap ?? ORB_DODGE_GAP_PX };
}

export function planOrbDodges(orbs, covers, screen = {}, opts = {}) {
  const list = (orbs || []).filter((item) => item && item.id && item.home);
  const out = new Map();
  const taken = [];
  const covered = [];
  for (const item of list) {
    const own = dodgeMeasure(item, opts);
    if (pointCovered(item.home, covers, own)) covered.push(item);
    else {
      out.set(item.id, { spot: item.home, dodged: false });
      taken.push({ x: item.home.x, y: item.home.y, r: own.orb / 2 });
    }
  }
  for (const item of covered) {
    const own = dodgeMeasure(item, opts);
    const bounds = orbBounds({ ...screen, orb: own.orb });
    const fresh = findDodgeSpot(item.home, { covers, others: taken, screen, ...own });
    const parked = item.current
      && !(Math.abs(item.current.x - item.home.x) < 0.5 && Math.abs(item.current.y - item.home.y) < 0.5)
      && spotFree(item.current, covers, taken, bounds, { orb: own.orb, halo: own.halo, gap: 0 });
    const far = (p) => Math.hypot(p.x - item.home.x, p.y - item.home.y);
    // Hysteresis: a parked orb stays unless the new spot is clearly nearer home.
    const spot = parked && (!fresh || far(item.current) <= far(fresh) + ORB_DODGE_KEEP_PX) ? item.current : fresh;
    out.set(item.id, { spot, dodged: true });
    if (spot) taken.push({ x: spot.x, y: spot.y, r: own.orb / 2 });
  }
  return out;
}
