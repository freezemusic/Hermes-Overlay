/**
 * One shell, three shapes. The orb centre is an anchor inside a pre-sized box.
 * Clip insets reveal the orb, the pill, or the panel. The box does not resize
 * during the animation, and the anchor's screen position does not move.
 */

export const ORB = 44;
export const PILL_W = 320;
export const PANEL_W = 420;
export const PANEL_H = 560;
export const ICON = 28;
export const PANEL_RADIUS = 3;
export const HAIRLINE = 1;
export const ORB_PILL_MS = 200;
export const PILL_PANEL_MS = 480;
/** Longest per-edge collapse clock (left). The top clock is 300. */
export const COLLAPSE_MS = 316;
export const CONTENT_OUT_MS = 80;
export const CONTENT_IN_MS = 160;
/** The fade starts with the clip. A delay makes WebKitGTK replay opacity from 0. */
export const CONTENT_IN_DELAY_MS = 0;
export const PLAN_GROW_MS = 280;
/** Plan clip stays 200ms. The panel clip starts at the handoff so the two
 *  overlap. Do not add the whole 200ms onto the per-edge clocks, and do not
 *  change either ease or duration. */
export const PLAN_COLLAPSE_MS = 200;
export const PLAN_COLLAPSE_HANDOFF_MS = 160;
/**
 * Plan growth only. Art direction kept this curve; do not swap it.
 * Box gate: first painted frame ≤30%, ~100ms ≤80%, ~200ms ≥90%,
 * and at least five visibly changing frames.
 */
export const PLAN_EASE = "cubic-bezier(.3,.6,.2,1)";
export const STACK_GAP = 12;
/** Open panels stay usable. Stacking may overlap; it may not squash. */
export const MIN_PANEL_H = 240;
/** Art-director floor for the cron column (`cronShellHeight`). */
export const CRON_MIN_H = 140;
/** HUD corner L sits this far outside the frame. Both sides count toward the visible gap. */
export const FRAME_BLEED = 3;
export const EASE = "cubic-bezier(.2,.8,.2,1)";
export const COLLAPSE_EASE = "cubic-bezier(.4,0,1,1)";
export const PREVIEW_MS = 5_000;

export function screenEdge(x, y, width, height) {
  const edges = [
    ["left", x],
    ["right", width - x],
    ["top", y],
    ["bottom", height - y],
  ];
  edges.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  return edges[0][0];
}

function panelOverflow(top, boxH, screenH) {
  const bottom = top + boxH;
  return Math.max(0, -top) + Math.max(0, bottom - screenH);
}

/**
 * Which edge of the panel holds the header orb slot.
 * Top orbs keep the header on top and grow down. Bottom orbs keep it on
 * the bottom and grow up. Side orbs grow down unless that would hang off
 * the screen more than growing up — then the header moves to the bottom.
 */
export function headerSide({
  edge = "bottom",
  orbY = 0,
  boxH = PANEL_H,
  screenH = 800,
  orb = ORB,
} = {}) {
  if (edge === "bottom") return "bottom";
  if (edge === "top") return "top";
  const down = panelOverflow(orbY - orb / 2, boxH, screenH);
  const up = panelOverflow(orbY + orb / 2 - boxH, boxH, screenH);
  if (down <= 0.5) return "top";
  if (up < down - 0.5) return "bottom";
  return "top";
}

/** Orb centre inside the pre-sized box. That centre is the header slot. */
export function anchorInBox({
  edge = "bottom",
  orbX = 0,
  orbY = 0,
  boxW = PANEL_W,
  boxH = PANEL_H,
  screenW = 1280,
  screenH = 800,
  orb = ORB,
} = {}) {
  const r = orb / 2;
  const ax = orbX > screenW / 2 ? boxW - r : r;
  const header = headerSide({ edge, orbY, boxH, screenH, orb });
  const ay = header === "bottom" ? boxH - r : r;
  return { x: ax, y: ay, header };
}

/**
 * A box that hangs off the viewport shrinks on the free edge and stays
 * pinned to the orb. Bottom headers keep the orb on the bottom of the card.
 * The card never grows, and it never leaves the screen (R-PN-01).
 */
function fitShellOnScreen(anchorX, anchorY, anchor, boxW, boxH, screenW, screenH) {
  const r = ORB / 2;
  let width = boxW;
  let height = boxH;
  let left = anchorX - anchor.x;
  let top = anchorY - anchor.y;
  const overflows = left < -0.5
    || top < -0.5
    || (screenW > 0 && (width > screenW + 0.5 || left + width > screenW + 0.5))
    || (screenH > 0 && (height > screenH + 0.5 || top + height > screenH + 0.5));
  if (!overflows) {
    return { left, top, width, height, ax: anchor.x, ay: anchor.y };
  }
  if (screenW > 0) width = Math.min(width, screenW);
  if (screenH > 0) height = Math.min(height, screenH);
  const pinEndX = anchor.x > boxW / 2;
  const pinEndY = anchor.header === "bottom";
  left = pinEndX ? anchorX - (width - r) : anchorX - r;
  top = pinEndY ? anchorY - (height - r) : anchorY - r;
  if (pinEndY && top < 0) {
    height = Math.min(height, Math.max(r * 2, anchorY + r));
    if (screenH > 0) height = Math.min(height, screenH);
    top = anchorY - (height - r);
  }
  if (!pinEndY && screenH > 0 && top + height > screenH) {
    height = Math.min(height, Math.max(r * 2, screenH - anchorY + r));
    top = anchorY - r;
  }
  if (left < 0) left = 0;
  if (top < 0) top = 0;
  if (screenW > 0 && left + width > screenW) left = Math.max(0, screenW - width);
  if (screenH > 0 && top + height > screenH) top = Math.max(0, screenH - height);
  return {
    left,
    top,
    width,
    height,
    ax: Math.min(width, Math.max(0, anchorX - left)),
    ay: Math.min(height, Math.max(0, anchorY - top)),
  };
}

/**
 * A dragged panel stays where it was released (R-PN-03).
 * Re-running placeShell from the orb centre flips the header slot once that
 * centre crosses the screen midpoint, and a 680px settings card jumps right
 * by width − orb (636px). Clamp the box that is already on screen instead.
 */
export function clampDroppedBox(left, top, width, height, screenW, screenH) {
  let x = Number.isFinite(left) ? left : 0;
  let y = Number.isFinite(top) ? top : 0;
  const w = Number.isFinite(width) ? width : 0;
  const h = Number.isFinite(height) ? height : 0;
  if (screenW > 0) {
    if (w >= screenW) x = 0;
    else x = Math.min(Math.max(0, x), screenW - w);
  }
  if (screenH > 0) {
    if (h >= screenH) y = 0;
    else y = Math.min(Math.max(0, y), screenH - h);
  }
  return { left: x, top: y, width: w, height: h };
}

export function placeShell(anchorX, anchorY, boxW, boxH, screenW, screenH) {
  const edge = screenEdge(anchorX, anchorY, screenW, screenH);
  const anchor = anchorInBox({
    edge,
    orbX: anchorX,
    orbY: anchorY,
    boxW,
    boxH,
    screenW,
    screenH,
  });
  const fitted = fitShellOnScreen(anchorX, anchorY, anchor, boxW, boxH, screenW, screenH);
  return {
    edge,
    header: anchor.header,
    anchor: { x: fitted.ax, y: fitted.ay, header: anchor.header },
    left: fitted.left,
    top: fitted.top,
    width: fitted.width,
    height: fitted.height,
  };
}

function band(anchor, box, size) {
  const start = Math.max(0, anchor - size / 2);
  const end = Math.max(0, box - start - size);
  return { start, end };
}

function horizontal(ax, boxW, width, orb = ORB) {
  const r = orb / 2;
  const span = Math.min(width, boxW);
  if (ax > boxW / 2) {
    const right = Math.max(0, boxW - (ax + r));
    const left = Math.max(0, boxW - right - span);
    return { left, right };
  }
  const left = Math.max(0, ax - r);
  const right = Math.max(0, boxW - left - span);
  return { left, right };
}

/**
 * CSS inset() edges for one shape. `wide` is the left/right panel's first
 * growth (full width, orb height). `tall` is the top/bottom panel's first
 * growth (pill width, full height).
 */
export function insetsFor(state, {
  boxW = PANEL_W,
  boxH = PANEL_H,
  ax = ORB / 2,
  ay = ORB / 2,
  orb = ORB,
  pillW = PILL_W,
} = {}) {
  const radius = state === "panel" || state === "tall" ? PANEL_RADIUS : orb / 2;
  if (state === "panel") {
    return { top: 0, right: 0, bottom: 0, left: 0, radius };
  }
  const across = horizontal(ax, boxW, state === "orb" ? orb : pillW, orb);
  const upright = band(ay, boxH, orb);
  if (state === "wide") {
    return { top: upright.start, right: 0, bottom: upright.end, left: 0, radius };
  }
  if (state === "tall") {
    return { top: 0, right: across.right, bottom: 0, left: across.left, radius };
  }
  return {
    top: upright.start,
    right: across.right,
    bottom: upright.end,
    left: across.left,
    radius,
  };
}

export function tighten(insets, px = HAIRLINE) {
  return {
    top: insets.top + px,
    right: insets.right + px,
    bottom: insets.bottom + px,
    left: insets.left + px,
    radius: Math.max(0, insets.radius - px),
  };
}

export function clipPath(insets) {
  const n = (value) => (Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100));
  return `inset(${n(insets.top)}px ${n(insets.right)}px ${n(insets.bottom)}px ${n(insets.left)}px round ${n(insets.radius)}px)`;
}

/**
 * Plan window clip in pixels. A right dock starts with the whole width
 * eaten on the right, so only the seam (left edge) is visible. A left dock
 * eats the left side. `revealed` is the open rect.
 */
export function seamInsets(width, side, revealed) {
  const hidden = revealed ? 0 : Math.max(0, width);
  if (side === "left") return { top: 0, right: 0, bottom: 0, left: hidden, radius: PANEL_RADIUS };
  return { top: 0, right: hidden, bottom: 0, left: 0, radius: PANEL_RADIUS };
}

/** Cron column height follows its content and never exceeds 70vh. */
export function cronShellHeight(contentHeight, viewportHeight, min = CRON_MIN_H) {
  const view = viewportHeight > 0 ? viewportHeight : 800;
  const max = view * 0.7;
  const content = Number.isFinite(contentHeight) && contentHeight > 0 ? contentHeight : min;
  return Math.min(max, Math.max(min, Math.ceil(content)));
}

/**
 * Opening another panel, or a later reflow, must not be stored as the user
 * leaving the tail. Only a real gesture may hold the list off the bottom.
 * `pin` sticks to the newest message, `remember` keeps a user offset,
 * `restore` puts back the offset already remembered.
 */
export function chatTailAction({ followTail = true, userGesture = false, nearTail = true } = {}) {
  if (userGesture) return nearTail ? "pin" : "remember";
  if (followTail === false) return "restore";
  return "pin";
}

/**
 * Clip that reveals one shape inside the final box. Pill and orb insets use
 * `--pill-h` / `--pill-w` so a bottom-left anchor starts at
 * `inset(calc(100% - var(--pill-h)) calc(100% - var(--pill-w)) 0 0 round 999px)`.
 * The other three corners swap the zero sides. The panel ends at `inset(0 round 3px)`.
 */
export function revealClip(state, geom) {
  const insets = insetsFor(state, geom);
  if (state === "panel") return "inset(0 round 3px)";
  const boxW = geom.boxW;
  const boxH = geom.boxH;
  const spanW = boxW - insets.left - insets.right;
  const spanH = boxH - insets.top - insets.bottom;
  const pillW = geom.pillW || PILL_W;
  const side = (px, span, axis) => {
    if (px <= 0.5) return "0";
    if (axis === "y" && Math.abs(span - ORB) < 0.6) return "calc(100% - var(--pill-h))";
    if (axis === "x" && Math.abs(span - ORB) < 0.6) return "calc(100% - var(--pill-h))";
    if (axis === "x" && Math.abs(span - pillW) < 0.6) return "calc(100% - var(--pill-w))";
    const n = Math.round(px * 100) / 100;
    return `${n}px`;
  };
  const round = state === "tall" ? "3px" : "999px";
  return `inset(${side(insets.top, spanH, "y")} ${side(insets.right, spanW, "x")} ${side(insets.bottom, spanH, "y")} ${side(insets.left, spanW, "x")} round ${round})`;
}

export function visibleSize(insets, boxW, boxH) {
  return {
    w: boxW - insets.left - insets.right,
    h: boxH - insets.top - insets.bottom,
  };
}

export function containsPoint(insets, boxW, boxH, x, y) {
  return x >= insets.left - 0.01
    && x <= boxW - insets.right + 0.01
    && y >= insets.top - 0.01
    && y <= boxH - insets.bottom + 0.01;
}

/**
 * Orb → pill (200ms), then one 480ms clip from that pill to the panel.
 * A click chains the two. Hover stops after the pill.
 */
export function openPhases() {
  return [
    { state: "pill", ms: ORB_PILL_MS, ease: EASE },
    { state: "panel", ms: PILL_PANEL_MS, ease: EASE },
  ];
}

/**
 * One clip back to the orb. Content fades in the first 80ms of the same
 * 300ms, so the fade does not add time and there is no pill rest on close.
 */
/**
 * WAAPI clock for one edge. v53 painted the clock itself: left 266→267,
 * right 233→267, top 299→267, bottom 266→300. The visible window is
 * 300–333ms, so the three short edges move up. Bottom already lands on
 * 300, and its clock stays. v62 painted the top panel segment at about
 * 267ms; a 2k px tail was what reached 300. The top clock is 300ms so
 * every edge stays within 333ms. The curve, the 80ms content fade, the
 * 200ms plan close, and the 160ms handoff stay. Refresh, hit flush, and
 * orb repaint wait more than a second after the collapse, and an unchanged
 * tick does not write the DOM.
 */
export function collapseMs(edge) {
  if (edge === "bottom") return 266;
  if (edge === "right") return 300;
  if (edge === "left") return 316;
  return 300;
}

export function collapsePhases(edge, from = "panel") {
  if (from === "orb") return [];
  if (from === "pill" || from === "wide" || from === "tall") {
    return [{ state: "orb", ms: ORB_PILL_MS, ease: COLLAPSE_EASE }];
  }
  return [{ state: "orb", ms: collapseMs(edge), ease: COLLAPSE_EASE }];
}

function rangesOverlap(a0, a1, b0, b1) {
  return Math.min(a1, b1) - Math.max(a0, b0) > 0;
}

/**
 * A docked plan window shares the panel's vertical span and sticks out
 * one side. Collision uses this wider box so the 12px gap includes the plan.
 */
export function includePlan(box, plan) {
  const next = {
    top: box.top,
    height: box.height,
    left: box.left,
    width: box.width,
    edge: box.edge || "",
  };
  if (!plan || !(plan.width > 0)) return next;
  const overlap = Number.isFinite(plan.overlap) ? plan.overlap : 0;
  const extra = Math.max(0, plan.width - overlap);
  if (plan.side === "left") next.left -= extra;
  next.width += extra;
  return next;
}

/**
 * Open top and bottom panels must keep at least `gap` pixels between their
 * boxes. Neither panel is closed. A top anchor stays on the top edge of its
 * box; a bottom anchor stays on the bottom edge.
 */
function panelPin(box) {
  if (box.pin === "end" || box.edge === "bottom") return "end";
  return "start";
}

/**
 * Lowest height stacking may leave. The design height is the floor when it
 * is already under the usable minimum (the cron column). A panel is never
 * grown, and never cut below this.
 */
function stackFloor(box, view) {
  const design = Math.max(0, box.design);
  const asked = box.minHeight > 0 ? box.minHeight : MIN_PANEL_H;
  let floor = Math.min(design, asked);
  if (view > 0) floor = Math.min(floor, view);
  return Math.max(0, floor);
}

/**
 * Keep every open panel fully on screen and pinned to its own orb.
 * A top header stays on `top`; a bottom header stays on `top + height`.
 * The free edge shortens to keep `gap`, and stops at the usable minimum.
 * Whatever still overlaps stays overlapped. Nothing is pushed off screen
 * and nothing is squashed to a line.
 */
export function separateStackedPanels(boxes, screenH, gap = STACK_GAP) {
  const view = screenH > 0 ? screenH : 0;
  const next = (boxes || []).map((box) => {
    const pin = panelPin(box);
    const height = Math.max(0, box.height);
    const anchor = pin === "end" ? box.top + height : box.top;
    return {
      top: box.top,
      height,
      left: box.left,
      width: box.width,
      edge: box.edge || "",
      pin,
      anchor,
      design: height,
      minHeight: box.minHeight > 0 ? box.minHeight : MIN_PANEL_H,
    };
  });
  const fit = (box) => {
    const floor = stackFloor(box, view);
    let height = Math.max(floor, box.height);
    if (view > 0 && height > view) height = view;
    let top = box.pin === "end" ? box.anchor - height : box.anchor;
    if (top < 0) top = 0;
    if (view > 0 && top + height > view) top = Math.max(0, view - height);
    box.top = top;
    box.height = height;
  };
  next.forEach(fit);
  const overlapsX = (a, b) => rangesOverlap(a.left, a.left + a.width, b.left, b.left + b.width);
  for (let pass = 0; pass < next.length + 1; pass += 1) {
    let changed = false;
    for (let i = 0; i < next.length; i += 1) {
      for (let j = i + 1; j < next.length; j += 1) {
        const upper = next[i].top <= next[j].top ? next[i] : next[j];
        const lower = upper === next[i] ? next[j] : next[i];
        if (!overlapsX(upper, lower)) continue;
        const space = lower.top - (upper.top + upper.height);
        if (space >= gap) continue;
        let deficit = gap - space;
        const upperRoom = Math.max(0, upper.height - stackFloor(upper, view));
        if (upper.pin !== "end" && upperRoom > 0 && deficit > 0) {
          const shrink = Math.min(upperRoom, deficit);
          upper.height -= shrink;
          deficit -= shrink;
          changed = true;
        }
        const lowerRoom = Math.max(0, lower.height - stackFloor(lower, view));
        if (lower.pin === "end" && lowerRoom > 0 && deficit > 0) {
          const shrink = Math.min(lowerRoom, deficit);
          lower.height -= shrink;
          lower.top += shrink;
          deficit -= shrink;
          changed = true;
        }
        next.forEach(fit);
      }
    }
    if (!changed) break;
  }
  next.forEach(fit);
  return next.map(({ top, height, left, width, edge }) => ({ top, height, left, width, edge }));
}

export function phaseList(edge, from, to) {
  if (to === "orb") return collapsePhases(edge, from);
  if (to === "pill") {
    if (from === "pill") return [];
    if (from === "orb") return [{ state: "pill", ms: ORB_PILL_MS, ease: EASE }];
    return [{ state: "pill", ms: ORB_PILL_MS, ease: COLLAPSE_EASE }];
  }
  if (from === "panel") return [];
  if (from === "wide" || from === "tall") return [{ state: "panel", ms: PILL_PANEL_MS / 2, ease: EASE }];
  if (from === "pill") return openPhases(edge).slice(1);
  return openPhases(edge);
}

const SLOT_EDGES = ["right", "bottom", "left", "top"];

/**
 * Slot i does not depend on how many bots there are. Adding a profile
 * keeps every earlier orb where it was. Candidates that land on the
 * kanban, cron, or settings orbs are skipped.
 */
export function distributeEdges(count, screen = {}) {
  const width = screen.width || screen.w || 1280;
  const height = screen.height || screen.h || 800;
  const pad = screen.pad ?? 42;
  const orb = screen.orb ?? ORB;
  const chromeGap = orb + 8;
  const chrome = ["kanban", "cron", "settings"].map((id) => fixedOrbPoint(id, width, height, pad, orb));
  const span = Math.max(1, Math.min(width, height) * 0.84);
  const step = Math.min(0.18, Math.max(0.07, (chromeGap + 4) / span));
  const ts = [];
  for (let t = step; t <= 1 - step * 0.5 + 1e-6; t += step) {
    ts.push(Math.round(t * 1000) / 1000);
  }
  const wanted = Math.max(0, count | 0);
  const accepted = [];
  const points = [];
  for (let index = 0; index < ts.length && accepted.length < wanted; index += 1) {
    for (const edge of SLOT_EDGES) {
      if (accepted.length >= wanted) break;
      const slot = { edge, t: ts[index] };
      const point = slotPoint(slot.edge, slot.t, width, height, pad, orb);
      const hitsChrome = chrome.some((item) => Math.hypot(point.x - item.x, point.y - item.y) <= chromeGap);
      const hitsBot = points.some((item) => Math.hypot(point.x - item.x, point.y - item.y) <= orb);
      if (hitsChrome || hitsBot) continue;
      accepted.push(slot);
      points.push(point);
    }
  }
  return accepted;
}

export function slotPoint(edge, t, width, height, pad = 42, orb = ORB) {
  const x0 = width * 0.08;
  const y0 = height * 0.08;
  const spanX = width * 0.84;
  const spanY = height * 0.84;
  if (edge === "top") return { x: x0 + spanX * t, y: pad + orb / 2, edge };
  if (edge === "bottom") return { x: x0 + spanX * t, y: height - pad - orb / 2, edge };
  if (edge === "left") return { x: pad + orb / 2, y: y0 + spanY * t, edge };
  return { x: width - pad - orb / 2, y: y0 + spanY * t, edge };
}

export function fixedOrbPoint(which, width, height, pad = 42, orb = ORB) {
  if (which === "kanban") {
    return { x: width / 2, y: pad + orb / 2, edge: "top" };
  }
  if (which === "cron") {
    return { x: width - pad - orb / 2, y: Math.round(height * 0.38), edge: "right" };
  }
  return {
    x: width - pad - 152 - orb / 2,
    y: height - pad - orb / 2,
    edge: "bottom",
  };
}

/**
 * The header slot is the orb centre. The orb does not fly, so the shift is
 * always zero. Scale, when it happens, stays on that centre.
 */
export function iconShift() {
  return { x: 0, y: 0 };
}

/** Collapse forgets a dragged park so the next layout uses the edge anchor. */
export function dropParkedAnchor(anchors, id) {
  if (!anchors || !id || !anchors[id]) return false;
  delete anchors[id];
  return true;
}

/** First seam scale. 0 is invisible to the compositor; this is about 0% of the plan. */
export const SEAM_MIN = 0.001;

/** y at time t for a cubic-bezier. Newton on x, then the bezier y. */
export function cubicBezierY(x1, y1, x2, y2, t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const xAt = (u) => {
    const a = 1 - u;
    return (3 * a * a * u * x1) + (3 * a * u * u * x2) + (u * u * u);
  };
  const yAt = (u) => {
    const a = 1 - u;
    return (3 * a * a * u * y1) + (3 * a * u * u * y2) + (u * u * u);
  };
  const dxAt = (u) => {
    const a = 1 - u;
    return (3 * a * a * x1) + (6 * a * u * (x2 - x1)) + (3 * u * u * (1 - x2));
  };
  let u = t;
  for (let i = 0; i < 8; i += 1) {
    const dx = dxAt(u);
    if (Math.abs(dx) < 1e-6) break;
    u = Math.min(1, Math.max(0, u - ((xAt(u) - t) / dx)));
  }
  return yAt(u);
}

/** y at time t for cubic-bezier(.2, .8, .2, 1). The panel clip uses this. */
export function seamEase(t) {
  return cubicBezierY(0.2, 0.8, 0.2, 1, t);
}

/** y at time t for COLLAPSE_EASE. Plan close and panel close share it. */
export function collapseEase(t) {
  return cubicBezierY(0.4, 0, 1, 1, t);
}

/**
 * Shell insets while a plan collapse and a panel collapse overlap.
 * Until `planMs` the plan edge follows the plan curve. Other edges follow
 * the panel curve from the handoff, keeping the bleed that is already on
 * screen. After the plan is shut, the plan edge joins the rest of the
 * panel curve. Neither duration nor ease changes.
 */
export function overlappedCollapseInsets({
  planOpen,
  planClosed,
  panelFrom,
  panelTo,
  planSide = "right",
  elapsedMs,
  planMs = PLAN_COLLAPSE_MS,
  handoffMs = PLAN_COLLAPSE_HANDOFF_MS,
  panelMs,
}) {
  const t = Math.max(0, Number(elapsedMs) || 0);
  const panelSpan = panelMs > 0 ? panelMs : 1;
  const pPlan = t >= planMs ? 1 : collapseEase(Math.min(1, t / planMs));
  const along = Math.max(0, t - handoffMs);
  const pPanel = collapseEase(Math.min(1, along / panelSpan));
  const joinAt = Math.max(0, planMs - handoffMs);
  const pJoin = collapseEase(Math.min(1, joinAt / panelSpan));
  const out = {};
  for (const key of ["top", "right", "bottom", "left", "radius"]) {
    const planV = planOpen[key] + (planClosed[key] - planOpen[key]) * pPlan;
    const panelV = panelFrom[key] + (panelTo[key] - panelFrom[key]) * pPanel;
    if (key === planSide) {
      if (t <= planMs) out[key] = planV;
      else {
        const span = 1 - pJoin;
        const local = span > 1e-6 ? Math.min(1, Math.max(0, (pPanel - pJoin) / span)) : 1;
        out[key] = planClosed[key] + (panelTo[key] - planClosed[key]) * local;
      }
    } else {
      const bleed = planClosed[key] - panelFrom[key];
      out[key] = panelV + bleed * (1 - pPanel);
    }
  }
  return out;
}

/** y at time t for PLAN_EASE. The string is the only growth curve to edit. */
export function planEase(t) {
  const parts = String(PLAN_EASE).match(/[\d.]+/g) || [];
  return cubicBezierY(Number(parts[0]), Number(parts[1]), Number(parts[2]), Number(parts[3]), t);
}

/**
 * One presented-frame sample of the 280ms seam. `elapsedMs` is the time
 * since the origin frame that actually reached the glass. The first sample
 * only restarts: planEase(64/280) is already ~56%, past the 45% gate, while
 * planEase(45/280) is still ~38%. Later samples are the curve itself.
 */
export function seamFrameStep(elapsedMs, { first = false, duration = PLAN_GROW_MS } = {}) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  if (first && elapsed > 45) return { restart: true, t: 0 };
  const t = duration > 0 ? Math.min(1, elapsed / duration) : 1;
  return { restart: false, t };
}

/** Committed reveal sample. Index 0 is at most 20ms (planEase ~16%,
 *  under 20%). Index 1 is at most 45ms (~38%), so a 30fps capture that
 *  misses the first rendered frame still stays under the 45% gate.
 *  Warm, cold, top, and bottom share these two caps. Later indexes
 *  are the elapsed time itself. */
export function seamVisibleMs(elapsedMs, index = 0) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  const cap = index <= 0 ? 20 : index === 1 ? 45 : elapsed;
  return elapsed > cap ? cap : elapsed;
}

/**
 * Timeline position for one presented seam frame.
 * The first sample (`shownMs` 0) is capped at 20ms.
 * The second sample (the first pin, still ≤20ms) is capped at 45ms.
 * Every later sample is strictly ahead of the previous one by at least
 * half a frame, otherwise a full frame of the curve (the 20ms pin and a
 * 22ms follow-up are the same reveal). A callback gap longer than one
 * frame advances at most one frame, unless elapsed is already past twice
 * the duration.
 */
export function seamAdvanceMs(elapsedMs, {
  shownMs = 0,
  gapMs = 0,
  frameMs = 16,
  duration = PLAN_GROW_MS,
} = {}) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  const shown = Math.max(0, Number(shownMs) || 0);
  const gap = Math.max(0, Number(gapMs) || 0);
  const span = duration > 0 ? duration : PLAN_GROW_MS;
  const frame = frameMs > 0 ? frameMs : 16;
  if (!(shown > 0)) return seamVisibleMs(elapsed, 0);
  // Past twice the duration the clock may jump, but only after the 45ms cap.
  if (elapsed > span * 2 && shown > 20.5) return Math.min(span, elapsed);
  // The first committed pin is ≤20ms. The next presented frame is what
  // a 30fps capture records when it misses frame 1, so it stays at 45ms.
  let next;
  if (shown <= 20.5) next = Math.min(span, seamVisibleMs(Math.max(shown, elapsed), 1));
  else {
    const stalled = gap > frame * 1.5;
    next = stalled ? Math.min(span, shown + frame) : Math.min(span, Math.max(shown, elapsed));
  }
  if (next < span && next < shown + frame * 0.5) {
    next = Math.min(span, shown + frame);
    if (shown <= 20.5) next = Math.min(45, next);
  }
  return next;
}

/** Outward inset of an `inset()` clip, in px. The plan edge is the most
 *  negative side. A closed seam is only the bleed; an open one is the plan. */
export function seamClipOutset(value) {
  const nums = String(value || "").match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 4) return 0;
  let outward = 0;
  for (let i = 0; i < 4; i += 1) {
    const edge = Number(nums[i]);
    if (edge < 0) outward = Math.max(outward, -edge);
  }
  return outward;
}

/** The reveal claimed to finish, but the used clip is still the closed edge.
 *  Open outset is about the plan width; half of that is still closed. */
export function seamClipStillClosed(computed, open) {
  const full = seamClipOutset(open);
  if (!(full > 0)) return false;
  return seamClipOutset(computed) < full * 0.5;
}

/** Inline scale for one growth sample. t is 0..1 over PLAN_GROW_MS. The resting
 *  value is 1; 0.001 exists only on the frame the clock starts. */
export function seamScaleAt(t) {
  if (t <= 0) return SEAM_MIN;
  if (t >= 1) return 1;
  return Math.max(SEAM_MIN, seamEase(t));
}

/** Plan growth clip. The markdown stays at final size; only the wrapper's
 *  inset changes, so WebKitGTK does not re-raster the text each frame.
 *  Right dock eats the right edge. Left dock eats the left edge. t is 0..1. */
export function seamClip(side, t) {
  const reveal = t <= 0 ? 0 : t >= 1 ? 1 : seamEase(t);
  const hidden = Math.round((1 - reveal) * 1000) / 10;
  if (side === "left") return `inset(0px 0px 0px ${hidden}%)`;
  return `inset(0px ${hidden}% 0px 0px)`;
}

/** Outer wrapper width for one growth sample. The inner content stays at
 *  `full`. t is 0..1 over PLAN_GROW_MS. A positive t never rounds back to 0. */
export function seamWidthPx(full, t) {
  const width = Number(full) || 0;
  if (!(width > 0) || t <= 0) return 0;
  const reveal = t >= 1 ? 1 : seamEase(t);
  if (reveal >= 1) return Math.round(width);
  return Math.max(1, Math.round(width * reveal));
}

/** Composited seam. WebKitGTK does not run clip-path on the compositor, so a
 *  PLAN_GROW_MS inset animation paints on the main thread and the first presented
 *  frame is already most of the way open. scaleX is composited. The inner
 *  track is the reciprocal, with the ease baked into the values and a linear
 *  clock, so the text is not stretched. */
export function seamScaleFrames(steps = 12) {
  const n = Math.max(2, steps);
  const outer = [];
  const inner = [];
  for (let i = 0; i <= n; i += 1) {
    const offset = i / n;
    const eased = i === 0 ? 0 : i === n ? 1 : seamEase(offset);
    const scale = i === 0 ? SEAM_MIN : Math.max(SEAM_MIN, eased);
    outer.push({ transform: `scaleX(${scale})`, offset });
    inner.push({ transform: `scaleX(${1 / scale})`, offset });
  }
  return { outer, inner };
}

/** A message preview must not start, or cancel a close, while a panel is up. */
export function previewBlocked({
  intent = "",
  collapsing = false,
  opening = "",
  visual = "",
  state = "",
} = {}) {
  if (intent === "close" || collapsing) return true;
  if (opening === "panel") return true;
  if (state === "panel") return true;
  return visual === "panel" || visual === "wide" || visual === "tall";
}

function planNodeOf(shell) {
  if (!shell?.querySelector) return null;
  return shell.querySelector(".plan-window") || shell._planHost?.querySelector(".plan-window") || null;
}

/**
 * Plan border box beside a panel. Prefer the right side, then the left.
 * When neither side can hold the full width, keep that preference and clamp
 * so the plan stays inside the viewport (a 1024px runner used to open at x=-179).
 */
export function fitPlanBox({
  shellLeft = 0,
  shellTop = 0,
  shellW = 0,
  shellH = 0,
  planW = 0,
  screenW = 0,
  screenH = 0,
} = {}) {
  const rawW = Math.max(0, Math.round(Number(planW) || 0));
  const rawH = Math.max(0, Math.round(Number(shellH) || 0));
  let w = rawW;
  let h = rawH;
  if (screenW > 0 && w > screenW) w = Math.floor(screenW);
  if (screenH > 0 && h > screenH) h = Math.floor(screenH);
  const roomRight = screenW > 0 ? screenW - (shellLeft + shellW) : Number.POSITIVE_INFINITY;
  const roomLeft = shellLeft;
  let side = "right";
  if (roomRight >= rawW) side = "right";
  else if (roomLeft >= rawW) side = "left";
  else side = roomRight >= roomLeft ? "right" : "left";
  let x = side === "left" ? shellLeft - w : shellLeft + shellW;
  let y = shellTop;
  if (screenW > 0) {
    const maxX = Math.max(0, screenW - w);
    if (x < 0) x = 0;
    if (x > maxX) x = maxX;
  }
  if (screenH > 0) {
    const maxY = Math.max(0, screenH - h);
    if (y < 0) y = 0;
    if (y > maxY) y = maxY;
  }
  return { side, x, y, w, h };
}

/** Screen box of an open plan. The shell's own box is not widened. */
export function placePlanHost(shell) {
  const host = shell?._planHost;
  const plan = host?.querySelector?.(".plan-window");
  if (!host || !plan) return false;
  const shellLeft = Number.parseFloat(shell.style.left) || 0;
  const shellTop = Number.parseFloat(shell.style.top) || 0;
  const shellW = Number.parseFloat(shell.style.width) || 0;
  const shellH = Number.parseFloat(shell.style.height) || 0;
  const planW = Math.round(
    Number.parseFloat(plan.style.width)
    || Number(shell.dataset.planWidth)
    || 0,
  );
  if (!(shellW > 0) || !(shellH > 0) || !(planW > 0)) return false;
  const view = shell.ownerDocument?.defaultView;
  const fitted = fitPlanBox({
    shellLeft,
    shellTop,
    shellW,
    shellH,
    planW,
    screenW: Number(view?.innerWidth) || 0,
    screenH: Number(view?.innerHeight) || 0,
  });
  shell.dataset.planSide = fitted.side;
  host.dataset.planSide = fitted.side;
  host.style.position = "absolute";
  host.style.top = `${fitted.y}px`;
  host.style.width = `${fitted.w}px`;
  host.style.height = `${fitted.h}px`;
  host.style.left = `${fitted.x}px`;
  // A stacked shell can shrink. A locked plan height would keep painting
  // over the panel below (R-PN-07).
  plan.style.height = `${fitted.h}px`;
  plan.style.maxHeight = `${fitted.h}px`;
  shell.dataset.planHeight = String(fitted.h);
  const z = shell.style.zIndex;
  if (z) host.style.zIndex = z;
  else host.style.removeProperty("z-index");
  return true;
}

/**
 * WebKitGTK hit-testing honours clip-path, and a fill:both clip does not
 * extend the hit region outside the shell border box. The plan is painted
 * at left:100% / right:100%, so elementFromPoint falls through to the page.
 * After the reveal clip has finished, park the plan in a sibling that has
 * the same screen box and no ancestor clip. The shell width, left, and
 * clip stay exactly as the reveal left them. Collapse moves the plan back
 * first, so that clip still reads the original geometry.
 */
const PLAN_CONTROL_ROLES = ["plan-preview-mode", "plan-source-mode", "plan-close"];

/** Button whose layout box contains the point. Hit-testing can still
 *  report BODY when a clip-path ancestor excludes the control. */
export function planControlUnder(root, x, y) {
  if (!root?.querySelectorAll) return null;
  const nodes = root.querySelectorAll("[data-role]");
  for (const control of nodes) {
    if (!PLAN_CONTROL_ROLES.includes(control.dataset?.role)) continue;
    if (control.closest?.("[hidden]")) continue;
    const box = control.getBoundingClientRect?.();
    if (!box || box.width < 1 || box.height < 1) continue;
    if (x >= box.left && x < box.right && y >= box.top && y < box.bottom) return control;
  }
  return null;
}

/** Drag must move the morph shell. A panel that has not been adopted yet is
 *  not a host: writing its viewport left/top parks the card inside the shell
 *  and one click leaves only a sliver (R-PN-03). */
export function panelDragHost(panel) {
  const shell = panel?.closest?.(".morph");
  if (!shell || shell === panel) return null;
  return shell;
}

/** An open asked for while a pill is retracting has to win. Leaving
 *  intent=close makes the morph refuse, and the open flag then sticks. */
export function closeYieldsToOpen(target, intent) {
  return target !== "orb" && intent === "close";
}

/** Raise only a panel that is actually showing. A stuck open flag on an
 *  orb or a retracting pill must open again. */
export function chromeToggleAction({
  open = false,
  state = "orb",
  opening = "",
  collapsing = false,
} = {}) {
  const shown = !collapsing && (state === "panel" || opening === "panel");
  if (open && shown) return "raise";
  return "open";
}

export function rectsOverlap(a, b) {
  if (!a || !b) return false;
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Close button in a top header. `end` is the trailing edge, where a
 *  right-docked plan's 預覽/原文 row lands on a 1024px screen. */
export function headerCloseBox(shell, {
  side = "end",
  pad = 8,
  buttonW = 52,
  buttonH = 28,
  insetY = 8,
} = {}) {
  const left = Number(shell?.left) || 0;
  const top = Number(shell?.top) || 0;
  const width = Number(shell?.width) || 0;
  const x = side === "end" ? left + width - pad - buttonW : left + pad;
  return { x, y: top + insetY, w: buttonW, h: buttonH };
}

/** 預覽 / 原文 / ✕ cluster along the top of a plan. */
export function planActionRow(plan, { rowH = 36, width = 180 } = {}) {
  const x = Number(plan?.x) || 0;
  const y = Number(plan?.y) || 0;
  const w = Number(plan?.w) || 0;
  const span = Math.min(Math.max(0, width), w);
  return { x: x + w - span, y, w: span, h: rowH };
}

/** Smallest shift that puts the whole close button outside every blocker.
 *  Down wins a tie so the button stays on the trailing edge, clear of the
 *  header orb. */
export function closeNudge(button, blockers) {
  let dx = 0;
  let dy = 0;
  const placed = () => ({
    x: button.x + dx,
    y: button.y + dy,
    w: button.w,
    h: button.h,
  });
  for (let pass = 0; pass < 4; pass += 1) {
    const current = placed();
    const hit = (blockers || []).find((block) => rectsOverlap(current, block));
    if (!hit) break;
    const down = hit.y + hit.h - current.y;
    const up = current.y + current.h - hit.y;
    const left = current.x + current.w - hit.x;
    const right = hit.x + hit.w - current.x;
    const options = [
      { dx: 0, dy: down, cost: down - 0.01 },
      { dx: -left, dy: 0, cost: left },
      { dx: right, dy: 0, cost: right },
      { dx: 0, dy: -up, cost: up },
    ].filter((item) => item.cost > 0 && item.cost < 80);
    options.sort((a, b) => a.cost - b.cost);
    const pick = options[0];
    if (!pick) break;
    dx += pick.dx;
    dy += pick.dy;
  }
  return { dx, dy };
}

/** Poll refresh. True when the open chat would look the same. */
export function sameChatSnapshot(current, opened) {
  const prev = current?.messages || [];
  const messages = opened?.messages || [];
  if ((current?.sessionId || "") !== (opened?.sessionId || "")) return false;
  if (!!current?.sessionExplicit !== !!opened?.sessionExplicit) return false;
  if (!!current?.sessionReadOnly !== !!opened?.sessionReadOnly) return false;
  if (prev.length !== messages.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    if ((prev[i]?.role || "") !== (messages[i]?.role || "")) return false;
    if ((prev[i]?.text || "") !== (messages[i]?.text || "")) return false;
    if (!!prev[i]?.live !== !!messages[i]?.live) return false;
  }
  const had = current?.sessions || [];
  const sessions = opened?.sessions || [];
  if (had.length !== sessions.length) return false;
  for (let i = 0; i < had.length; i += 1) {
    if ((had[i]?.id || "") !== (sessions[i]?.id || "")) return false;
    if ((had[i]?.title || "") !== (sessions[i]?.title || "")) return false;
  }
  return true;
}

export function hostOpenPlan(shell) {
  if (!shell || shell.dataset.planOpen !== "1") return false;
  if (shell.dataset.state !== "panel" && shell.dataset.visual !== "panel") return false;
  if (shell.classList.contains("is-collapsing")) return false;
  const plan = planNodeOf(shell);
  if (!plan || plan.hidden) return false;
  const phase = plan._seamPhase || plan.dataset.seam || "";
  if (phase !== "grown") return false;
  // A stuck reveal animation stays "running" after the plan is already open.
  // Waiting on it left the plan under the clip, so 預覽/原文/× hit BODY.
  if (shell.dataset.intent === "close" || shell._motion === "collapse") return false;
  const parent = shell.parentElement;
  if (!parent) return false;
  let host = shell._planHost;
  if (!host?.isConnected) {
    host = shell.ownerDocument.createElement("div");
    host.className = "plan-hit-host";
    parent.append(host);
    shell._planHost = host;
  }
  if (plan.parentElement !== host) host.append(plan);
  plan._planShell = shell;
  host._planShell = shell;
  shell.dataset.planHost = "1";
  // The plan window is the clip-path ancestor once the warm sweep's
  // fill:forwards clip stays on it. That clip is not the reveal (the shell
  // clip is), and it drops 預覽/原文/× out of the hit region. Clear it only
  // after the plan has left the shell, so the shell clip still paints.
  plan.classList.remove("is-plan-parked");
  host.style.setProperty("pointer-events", "auto", "important");
  plan.style.setProperty("pointer-events", "auto", "important");
  plan.getAnimations?.().forEach((anim) => {
    let frames = [];
    try { frames = anim.effect?.getKeyframes?.() || []; } catch { frames = []; }
    if (!frames.some((frame) => frame?.clipPath)) return;
    try { anim.cancel(); } catch { /* the inline value below replaces it */ }
  });
  plan.style.clipPath = "none";
  if (/translate/i.test(plan.style.transform || "")) plan.style.transform = "none";
  return placePlanHost(shell);
}

/** Put the plan back inside the shell before a collapse clip reads it. */
export function restoreHostedPlan(shell) {
  if (!shell || shell.dataset.planHost !== "1") return false;
  const host = shell._planHost;
  const plan = host?.querySelector?.(".plan-window") || null;
  if (plan) {
    shell.append(plan);
    delete plan._planShell;
  }
  host?.remove();
  shell._planHost = null;
  delete shell.dataset.planHost;
  return true;
}
