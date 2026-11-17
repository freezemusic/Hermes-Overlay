/**
 * R-PN-09 (Devon 2026-11-09): an open panel can be made bigger or smaller by
 * dragging its free edge or free corner, i.e. the sides away from the orb.
 * The orb stays where it is (the header slot is the anchor), so only the box
 * grows. Sizes are saved per panel in config.json `panel_sizes` through the
 * app's own `set_panel_size` command; a double-click on a handle goes back to
 * the design size. Sub-orb session panels resize too and share one size
 * (SUBORB_PANEL_KEY, 2026-11-16); the schedule column (fits its content) does
 * not resize.
 */

/** Smallest box a drag may leave, per panel kind. */
export const PANEL_MIN = Object.freeze({
  chat: Object.freeze({ w: 320, h: 240 }),
  kanban: Object.freeze({ w: 480, h: 320 }),
  settings: Object.freeze({ w: 420, h: 320 }),
});

/** Largest stored side. The live clamp is the monitor work area. */
export const PANEL_MAX_SIDE = 10000;

/** Same rule as the Rust side (`config::valid_panel_id`). */
export function validPanelId(id) {
  const text = String(id ?? "");
  return text.length > 0 && text.length <= 128 && /^[A-Za-z0-9_.\-]+$/.test(text);
}

/**
 * One `panel_sizes` key for every sub-orb session panel (Devon 2026-11-16
 * 「你有確認子球框能拉嗎」). A sub-orb id is `suborb:<profile>:<session>`, which
 * is not a valid panel id (no `:`), and per-session keys would pile up in
 * config.json as sessions come and go. The cascade keeps one shared size.
 */
export const SUBORB_PANEL_KEY = "_suborb";

/** The `panel_sizes` key a shell's size is stored under ("" = not resizable). */
export function panelSizeKey(id, kind = "bot") {
  if (kind === "suborb") return String(id ?? "").startsWith("suborb:") ? SUBORB_PANEL_KEY : "";
  return panelResizeKind(id, kind) ? String(id) : "";
}

/** "" when the panel cannot be resized. */
export function panelResizeKind(id, kind = "bot") {
  // A sub-orb session panel is a chat panel; the +N chip has no panel.
  if (kind === "suborb") return String(id ?? "").startsWith("suborb:") ? "chat" : "";
  if (id === "cron") return "";
  if (id === "kanban") return "kanban";
  if (id === "settings") return "settings";
  return validPanelId(id) ? "chat" : "";
}

/** The sides away from the orb. A start (left) anchor frees the right edge;
 *  a top header frees the bottom edge. */
export function freeEdges(anchor, header) {
  return {
    x: anchor === "end" ? "left" : "right",
    y: header === "bottom" ? "top" : "bottom",
  };
}

/** New size from a pointer delta on a handle. `dir` is "x", "y" or "xy". */
export function resizedSize({ dir = "xy", anchor = "start", header = "top", dx = 0, dy = 0, start }) {
  const edges = freeEdges(anchor, header);
  let w = start.w;
  let h = start.h;
  if (dir.includes("x")) w = start.w + (edges.x === "right" ? dx : -dx);
  if (dir.includes("y")) h = start.h + (edges.y === "bottom" ? dy : -dy);
  return { w, h };
}

/**
 * Clamp to the kind's minimum and to the monitor work area (viewport minus
 * the taskbar insets). Whole CSS px. When the work area itself is smaller
 * than the minimum, the work area wins (nothing hangs off screen, R-PN-01).
 */
export function clampPanelSize(size, { kind = "chat", vw = 1280, vh = 800, insets = null } = {}) {
  const min = PANEL_MIN[kind] || PANEL_MIN.chat;
  const pad = insets || {};
  const maxW = Math.max(1, Math.floor(vw - (pad.left || 0) - (pad.right || 0)));
  const maxH = Math.max(1, Math.floor(vh - (pad.top || 0) - (pad.bottom || 0)));
  const pick = (value, lo, hi) => {
    const n = Number(value);
    const v = Number.isFinite(n) ? Math.round(n) : lo;
    return Math.min(hi, Math.max(Math.min(lo, hi), v));
  };
  return { w: pick(size?.w, min.w, maxW), h: pick(size?.h, min.h, maxH) };
}

/** `panel_sizes` from settings: only valid ids with positive whole sizes. */
export function normalizePanelSizes(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, value] of Object.entries(raw)) {
    if (!validPanelId(id) || !value || typeof value !== "object") continue;
    const w = Math.round(Number(value.w));
    const h = Math.round(Number(value.h));
    if (!(w > 0 && h > 0 && w <= PANEL_MAX_SIDE && h <= PANEL_MAX_SIDE)) continue;
    out[id] = { w, h };
  }
  return out;
}

/*
 * R-PN-09 Windows fix (Devon 2026-11-10 「並沒有看到雙箭咀」). On Windows the
 * overlay is click-through (WS_EX_TRANSPARENT) until the Rust poll sees the
 * global cursor inside a published rect, and panels get no outside pad
 * (interaction.rs `windows_cursor_ignored`). A grab zone must therefore sit
 * wholly inside the panel box and be deep enough that the first mouse move
 * after the poll flips capture still lands on it. 6px (7.5 physical px at
 * 125%) was the last strip before click-through. These sizes are CSS px of the
 * shell box (the handles are not under the text-size zoom). styles.css uses
 * the same numbers through --resize-edge / --resize-corner.
 */
export const RESIZE_EDGE_PX = 10;
export const RESIZE_CORNER_PX = 12;
/** The vertical strip stops this far from the header row (close button, orb slot). */
export const RESIZE_EDGE_INSET_PX = 48;

/**
 * Handle boxes in shell coordinates (0,0 is the shell's top-left), for the
 * free sides of a `w`×`h` panel. Mirrors the stylesheet; used by tests and by
 * the debug log that the Windows CI check reads.
 */
export function resizeHandleBoxes({ w, h, anchor = "start", header = "top" }) {
  const edges = freeEdges(anchor, header);
  const e = RESIZE_EDGE_PX;
  const c = RESIZE_CORNER_PX;
  const inset = RESIZE_EDGE_INSET_PX;
  const xLeft = edges.x === "right" ? w - e : 0;
  const yTop = edges.y === "bottom" ? h - e : 0;
  // The vertical strip stops short of the header row; the horizontal one
  // runs the full width (the header is on the other side).
  const xTop = header === "bottom" ? 0 : inset;
  return {
    x: { x: xLeft, y: xTop, w: e, h: Math.max(0, h - inset) },
    y: { x: 0, y: yTop, w, h: e },
    xy: { x: edges.x === "right" ? w - c : 0, y: edges.y === "bottom" ? h - c : 0, w: c, h: c },
  };
}

/**
 * Same test as the Rust Windows path: the global cursor is integer physical
 * px, turned into CSS px by `(screen - origin) / scale`
 * (`css_point_from_screen`), and a panel captures only when that point is
 * inside its rect (pad 0). Returns how many physical pixels of `box` (CSS px,
 * view coordinates) would leave the window click-through.
 */
export function physicalPixelsOutside(box, rect, scale = 1, origin = { x: 0, y: 0 }) {
  const s = scale > 0 ? scale : 1;
  let outside = 0;
  let total = 0;
  const x0 = Math.floor(box.x * s + origin.x);
  const x1 = Math.ceil((box.x + box.w) * s + origin.x);
  const y0 = Math.floor(box.y * s + origin.y);
  const y1 = Math.ceil((box.y + box.h) * s + origin.y);
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const cx = (px - origin.x) / s;
      const cy = (py - origin.y) / s;
      if (cx < box.x || cx >= box.x + box.w || cy < box.y || cy >= box.y + box.h) continue;
      total += 1;
      const inside = cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h;
      if (!inside) outside += 1;
    }
  }
  return { total, outside };
}

/*
 * R-PN-09 grow fix (Devon 2026-11-16 「到而家都未可以拉大個框」). Windows
 * passes the cursor through unless it sits inside a published rect. A resize
 * or header drag publishes one full-view rect for its shell so the pointer
 * stays in the overlay once it leaves the old box. While hits are frozen (plan
 * seam, announce silence, collapse, motion) the normal flush is skipped, so
 * these two helpers build the list from the last published one instead.
 */

/** A rect that is the whole view (the drag capture shape). */
export function coversView(rect, vw, vh) {
  if (!rect || !(vw >= 1) || !(vh >= 1)) return false;
  return rect.x <= 1 && rect.y <= 1 && rect.w >= vw - 2 && rect.h >= vh - 2;
}

function keepOthers(previous, ids, vw, vh) {
  const drop = new Set((ids || []).filter(Boolean));
  return (previous || [])
    .filter((rect) => rect && !drop.has(rect.id) && !coversView(rect, vw, vh))
    .map((rect) => ({ ...rect }));
}

/**
 * Drag start: every other published rect stays, this shell's rects (panel,
 * close) are replaced by one full-view rect under `id` (z 1000).
 */
export function dragCaptureRects({ previous = [], ids = [], id, vw, vh }) {
  const out = keepOthers(previous, [id, ...ids], vw, vh);
  out.push({ id, x: 0, y: 0, w: vw, h: vh, z: 1000, round: false });
  return out;
}

/**
 * Drag end: the full-view rect goes, and the shell's box at its new size or
 * position (`rect`) takes its place, so the area a grow added catches clicks.
 */
export function settledDragRects({ previous = [], ids = [], rect, vw, vh }) {
  const out = keepOthers(previous, [rect?.id, ...ids], vw, vh);
  if (rect && rect.w >= 1 && rect.h >= 1) out.push({ ...rect });
  return out;
}

/*
 * R-PL-09 (Devon 2026-11-17 17:03 London 「加拉闊邊，一齊做」): the plan
 * window gets a width handle on its outer edge, the edge away from the seam.
 * Its height stays locked to the chat or sub-orb panel it is glued to
 * (R-PL-08). One width is shared by the main and every sub-orb plan and is
 * saved as `panel_sizes._plan` through the same `set_panel_size` command.
 */
export const PLAN_PANEL_KEY = "_plan";
/** Narrowest plan a drag may leave. The work area wins when it is smaller. */
export const PLAN_MIN_W = 240;
/** The design width: min(420px, 42vw). */
export function defaultPlanWidth(vw = 1280) {
  return Math.min(420, (Number(vw) || 1280) * 0.42);
}

/** Room left for the plan on its side of the panel, inside the work area. */
export function planRoom({ side = "right", shellLeft = 0, shellW = 0, vw = 1280, insets = null } = {}) {
  const pad = insets || {};
  const room = side === "left"
    ? shellLeft - (pad.left || 0)
    : (vw - (pad.right || 0)) - (shellLeft + shellW);
  return Math.max(1, Math.floor(room));
}

/** Whole px between PLAN_MIN_W and `room` (room wins when it is smaller). */
export function clampPlanWidth(width, { room = Number.POSITIVE_INFINITY } = {}) {
  const max = Math.max(1, Math.floor(Number(room) > 0 ? Number(room) : Number.POSITIVE_INFINITY));
  const n = Number(width);
  const v = Number.isFinite(n) ? Math.round(n) : PLAN_MIN_W;
  return Math.min(max, Math.max(Math.min(PLAN_MIN_W, max), v));
}

/** New plan width from a pointer delta on the outer edge. */
export function planResizedWidth({ side = "right", dx = 0, start = 0 } = {}) {
  return side === "left" ? start - dx : start + dx;
}

/**
 * Width to open a plan at: the saved `_plan` width (clamped to PLAN_MIN_W and
 * the work area less the smallest chat panel) or the design width.
 */
export function savedPlanWidth(saved, { vw = 1280, insets = null } = {}) {
  const w = Math.round(Number(saved?.w));
  if (!(w > 0)) return defaultPlanWidth(vw);
  const pad = insets || {};
  const room = Math.floor(vw - (pad.left || 0) - (pad.right || 0) - PANEL_MIN.chat.w);
  return clampPlanWidth(w, { room: Math.max(PLAN_MIN_W, room) });
}

/** The handle box in plan coordinates (debug log and tests). */
export function planHandleBox({ side = "right", w = 0, h = 0 } = {}) {
  const e = RESIZE_EDGE_PX;
  return { x: side === "left" ? 0 : Math.max(0, w - e), y: 0, w: e, h };
}
