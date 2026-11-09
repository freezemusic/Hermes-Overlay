/**
 * R-PN-09 (Devon 2026-11-09): an open panel can be made bigger or smaller by
 * dragging its free edge or free corner, i.e. the sides away from the orb.
 * The orb stays where it is (the header slot is the anchor), so only the box
 * grows. Sizes are saved per panel in config.json `panel_sizes` through the
 * app's own `set_panel_size` command; a double-click on a handle goes back to
 * the design size. Sub-orb panels (cascade) and the schedule column (fits its
 * content) are not resizable.
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

/** "" when the panel cannot be resized. */
export function panelResizeKind(id, kind = "bot") {
  if (kind === "suborb") return "";
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
