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
export const COLLAPSE_MS = 360;
export const CONTENT_OUT_MS = 100;
export const CONTENT_IN_MS = 120;
export const EASE = "cubic-bezier(.2,.8,.2,1)";
export const PREVIEW_MS = 5_000;

const SHAPE_MS = COLLAPSE_MS - CONTENT_OUT_MS;

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

/** Orb centre inside the pre-sized box. Pill width grows toward the screen centre. */
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
  let ay = r;
  if (edge === "bottom") ay = boxH - r;
  else if (edge === "top") ay = r;
  else if (orbY > screenH / 2) ay = boxH - r;
  return { x: ax, y: ay };
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

/** Orb → pill, then the two panel phases. Durations sum to 200 + 480. */
export function openPhases(edge) {
  const mid = edge === "left" || edge === "right" ? "wide" : "tall";
  const half = PILL_PANEL_MS / 2;
  return [
    { state: "pill", ms: ORB_PILL_MS },
    { state: mid, ms: half },
    { state: "panel", ms: half },
  ];
}

/** Reverse of the open path. Shape time is 260ms; content fade is separate. */
export function collapsePhases(edge, from = "panel") {
  if (from === "orb") return [];
  if (from === "pill") return [{ state: "orb", ms: Math.min(ORB_PILL_MS, SHAPE_MS) }];
  if (from === "wide" || from === "tall") {
    const step = Math.floor(SHAPE_MS / 2);
    return [
      { state: "pill", ms: step },
      { state: "orb", ms: SHAPE_MS - step },
    ];
  }
  const mid = edge === "left" || edge === "right" ? "wide" : "tall";
  const step = Math.floor(SHAPE_MS / 3);
  return [
    { state: mid, ms: step },
    { state: "pill", ms: step },
    { state: "orb", ms: SHAPE_MS - step * 2 },
  ];
}

export function phaseList(edge, from, to) {
  if (to === "orb") return collapsePhases(edge, from);
  if (to === "pill") {
    if (from === "pill" || from === "orb") return from === "pill" ? [] : [{ state: "pill", ms: ORB_PILL_MS }];
    return collapsePhases(edge, from).filter((step) => step.state === "pill" || step.state === "orb").slice(0, 1);
  }
  if (from === "panel") return [];
  if (from === "wide" || from === "tall") return [{ state: "panel", ms: PILL_PANEL_MS / 2 }];
  if (from === "pill") return openPhases(edge).slice(1);
  return openPhases(edge);
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
    for (let j = 0; j < take; j += 1) slots.push({ edge: seg.edge, t: (j + 1) / (take + 1) });
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
  const extra = which === "settings" ? 152 : 76;
  return {
    x: width - pad - extra - orb / 2,
    y: height - pad - orb / 2,
    edge: "bottom",
  };
}

/**
 * Offset from the clip anchor to the header-corner icon.
 * The anchor itself stays put. Y is always the top of the panel so a
 * bottom or lower-left orb does not sit on the composer. X stays on the
 * screen-edge side (left half → top-left).
 */
export function iconShift(ax, ay, boxW, boxH, orb = ORB) {
  const edgeX = ax > boxW / 2 ? boxW - orb / 2 : orb / 2;
  const headerY = orb / 2;
  return { x: edgeX - ax, y: headerY - ay };
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
