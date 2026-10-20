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
export const COLLAPSE_MS = 382;
export const CONTENT_OUT_MS = 80;
export const CONTENT_IN_MS = 160;
/** The fade starts with the clip. A delay makes WebKitGTK replay opacity from 0. */
export const CONTENT_IN_DELAY_MS = 0;
export const PLAN_GROW_MS = 280;
/** Plan closes before the panel. Do not add this onto the per-edge panel clocks. */
export const PLAN_COLLAPSE_MS = 200;
/**
 * Plan growth only. Art direction kept this curve; do not swap it.
 * Box gate: first painted frame ≤30%, ~100ms ≤80%, ~200ms ≥90%,
 * and at least five visibly changing frames.
 */
export const PLAN_EASE = "cubic-bezier(.3,.6,.2,1)";
export const STACK_GAP = 12;
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
  return {
    edge,
    header: anchor.header,
    anchor,
    left: anchorX - anchor.x,
    top: anchorY - anchor.y,
    width: boxW,
    height: boxH,
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
export function cronShellHeight(contentHeight, viewportHeight, min = 140) {
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
 * 267ms; a 2k px tail was what reached 300. 382ms puts that segment
 * clearly inside 300–333ms. Refresh, hit flush, and orb repaint wait more
 * than a second after the collapse, and an unchanged tick does not write the DOM.
 */
export function collapseMs(edge) {
  if (edge === "bottom") return 266;
  if (edge === "right") return 300;
  if (edge === "left") return 316;
  return 382;
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
export function separateStackedPanels(boxes, screenH, gap = STACK_GAP) {
  const next = (boxes || []).map((box) => ({
    top: box.top,
    height: box.height,
    left: box.left,
    width: box.width,
    edge: box.edge || "",
  }));
  const order = next.map((_, index) => index).sort((i, j) => next[i].top - next[j].top || i - j);
  const minH = 160;
  for (let pass = 0; pass < next.length; pass += 1) {
    for (let n = 0; n < order.length - 1; n += 1) {
      const a = next[order[n]];
      const b = next[order[n + 1]];
      if (!rangesOverlap(a.left, a.left + a.width, b.left, b.left + b.width)) continue;
      const space = b.top - (a.top + a.height);
      if (space >= gap) continue;
      let deficit = gap - space;
      const up = Math.min(Math.max(0, a.top), deficit);
      a.top -= up;
      deficit -= up;
      const down = Math.min(Math.max(0, screenH - (b.top + b.height)), deficit);
      b.top += down;
      deficit -= down;
      if (deficit <= 0) continue;
      const aShrink = Math.min(Math.max(0, a.height - minH), deficit);
      a.height -= aShrink;
      deficit -= aShrink;
      const bShrink = Math.min(Math.max(0, b.height - minH), deficit);
      b.top += bShrink;
      b.height -= bShrink;
    }
  }
  return next;
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

/** Top-edge bots sit either side of centre so they do not cover the kanban orb. */
function topSlot(index, count) {
  const half = Math.ceil(count / 2);
  if (index < half) return ((index + 1) / (half + 1)) * 0.42;
  const rest = count - half;
  return 0.58 + ((index - half + 1) / (rest + 1)) * 0.42;
}

export function distributeEdges(count) {
  const segments = [
    { edge: "top", weight: 1 },
    { edge: "right", weight: 3 },
    { edge: "bottom", weight: 3 },
    { edge: "left", weight: 2 },
  ];
  const total = segments.reduce((sum, seg) => sum + seg.weight, 0);
  const slots = [];
  let remaining = count;
  segments.forEach((seg, index) => {
    const isLast = index === segments.length - 1;
    const n = isLast ? remaining : Math.max(1, Math.round((seg.weight / total) * count));
    const take = Math.min(n, remaining);
    remaining -= take;
    for (let j = 0; j < take; j += 1) {
      const t = seg.edge === "top" ? topSlot(j, take) : (j + 1) / (take + 1);
      slots.push({ edge: seg.edge, t });
    }
  });
  while (remaining > 0) {
    slots.push({ edge: "right", t: 0.5 });
    remaining -= 1;
  }
  return slots;
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

/** Inline scale for one growth sample. t is 0..1 over 240ms. The resting
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
 *  `full`. t is 0..1 over 240ms. A positive t never rounds back to 0. */
export function seamWidthPx(full, t) {
  const width = Number(full) || 0;
  if (!(width > 0) || t <= 0) return 0;
  const reveal = t >= 1 ? 1 : seamEase(t);
  if (reveal >= 1) return Math.round(width);
  return Math.max(1, Math.round(width * reveal));
}

/** Composited seam. WebKitGTK does not run clip-path on the compositor, so a
 *  240ms inset animation paints on the main thread and the first presented
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
