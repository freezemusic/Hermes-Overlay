/** Distance fade shared by the browser preview and unit tests. */

/** Chart colours sampled from the public Hermes / Nous UI, not their logos. */
export const PALETTE = [
  "#0000f2",
  "#edff45",
  "#0847c4",
  "#ff8442",
  "#6effd6",
  "#6e6eff",
  "#f0949e",
  "#ffcd42",
  "#8cc4a7",
  "#6eddff",
];

/** Dark ink on light swatches so avatar letters stay readable. */
export function inkFor(hex) {
  const raw = String(hex || "").trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return "#f5f5f5";
  const n = Number.parseInt(raw, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.58 ? "#1a1a1a" : "#f5f5f5";
}

export function colorForIndex(index) {
  const n = PALETTE.length;
  const i = ((index % n) + n) % n;
  return PALETTE[i];
}

export function distanceToRect(px, py, rect) {
  const dx = px < rect.x ? rect.x - px : px > rect.x + rect.w ? px - (rect.x + rect.w) : 0;
  const dy = py < rect.y ? rect.y - py : py > rect.y + rect.h ? py - (rect.y + rect.h) : 0;
  return Math.hypot(dx, dy);
}

/** Round avatars: distance outside the circle. Corners of the bounding box stay outside. */
export function distanceToHit(px, py, rect) {
  if (!rect.round) return distanceToRect(px, py, rect);
  const radius = Math.min(rect.w, rect.h) / 2;
  const dist = Math.hypot(px - (rect.x + rect.w / 2), py - (rect.y + rect.h / 2));
  return Math.max(0, dist - radius);
}

export function opacityForDistance(distance, fadeDistance, minOpacity, enabled) {
  if (!enabled) return 1;
  if (!(fadeDistance > 0)) return minOpacity;
  if (distance >= fadeDistance) return 1;
  if (distance <= 0) return minOpacity;
  return minOpacity + (1 - minOpacity) * (distance / fadeDistance);
}

/** An element marked solid (modifier target or latched panel) is full opacity at any distance. */
export function elementOpacity({ solid, distance, fadeDistance, minOpacity, fadeEnabled }) {
  if (solid) return 1;
  return opacityForDistance(distance, fadeDistance, minOpacity, fadeEnabled);
}

/** CSS pixels around a hit rect that still count as under the cursor. */
export const HIT_MARGIN_PX = 12;

/** One element under the cursor. Inside a rect beats margin-only neighbours. */
export function elementUnderCursor(cursor, rects, margin = HIT_MARGIN_PX, latchedIds = []) {
  if (!cursor) return null;
  let best = null;
  for (const rect of rects) {
    const distance = distanceToHit(cursor.x, cursor.y, rect);
    if (distance > margin) continue;
    const next = {
      id: rect.id,
      distance,
      area: rect.w * rect.h,
      latched: latchedIds.includes(rect.id),
      z: rect.z || 0,
    };
    if (!best || preferHit(next, best)) best = next;
  }
  return best ? best.id : null;
}

function preferHit(candidate, current) {
  if (candidate.distance < current.distance - 1e-9) return true;
  if (candidate.distance > current.distance + 1e-9) return false;
  if (candidate.latched !== current.latched) return candidate.latched;
  if (candidate.z !== current.z) return candidate.z > current.z;
  return candidate.area < current.area;
}

/**
 * Modifier solids only the element under the cursor.
 * Latched ids stay solid and capture only while the cursor is over them.
 */
export function elementStates({
  held = false,
  latchedIds = [],
  cursor = null,
  rects = [],
  margin = HIT_MARGIN_PX,
  fadeDistance = 120,
  minOpacity = 0.18,
  fadeEnabled = true,
} = {}) {
  const under = elementUnderCursor(cursor, rects, margin, latchedIds);
  return rects.map((rect) => {
    const latched = latchedIds.includes(rect.id);
    const targeted = held && under === rect.id;
    const distance = cursor ? distanceToHit(cursor.x, cursor.y, rect) : fadeDistance;
    const opacity =
      cursor == null
        ? 1
        : elementOpacity({
            solid: latched || targeted,
            distance,
            fadeDistance,
            minOpacity,
            fadeEnabled,
          });
    return {
      id: rect.id,
      opacity,
      capture: under === rect.id && (held || latched),
    };
  });
}

/** Focus lock names the panel that stays interactive. Dropped when the window blurs. */
export function latchedElementIds({
  windowFocused = true,
  textFocused = false,
  textInSettings = false,
  settingsOpen = false,
  pointerHitId = "",
} = {}) {
  if (windowFocused === false) return [];
  const ids = [];
  if (settingsOpen || (textFocused && textInSettings)) ids.push("settings");
  if (textFocused && !textInSettings) ids.push("center");
  if (pointerHitId && !ids.includes(pointerHitId)) ids.push(pointerHitId);
  return ids;
}

/** In-webview blur waits this long so a focus return can cancel it. */
export const BLUR_RELEASE_MS = 150;

/** Native menu is open only while this flag is set. A focused select is not enough. */
export function nextDropdownOpen(open, event) {
  if (event === "pointerdown" || event === "open-key") return true;
  if (event === "change" || event === "blur" || event === "escape" || event === "window-focus") {
    return false;
  }
  return !!open;
}

export function selectKeyOpensDropdown(key) {
  return key === "ArrowDown" || key === "ArrowUp" || key === " " || key === "Enter" || key === "F4";
}

/**
 * Another app taking the window releases immediately.
 * In-webview blur waits. An open dropdown holds either way.
 */
export function focusLossAction({ source = "webview", dropdownOpen = false } = {}) {
  if (dropdownOpen) return "hold";
  if (source === "tauri-window") return "release";
  return "debounce";
}

/** Linux window managers often bind Alt+drag, which can block the overlay modifier. */
export function linuxAltWarning(platform) {
  const value = String(platform || "");
  return /linux/i.test(value) && !/android/i.test(value);
}

export const SETTINGS_SHORTCUT = "Ctrl+Shift+Alt+H";

export function modifierMatches(kind, key) {
  if (kind === "shift") return key === "Shift";
  if (kind === "alt") return key === "Alt";
  return key === "Control";
}

export function modifierLabel(kind) {
  if (kind === "shift") return "Shift";
  if (kind === "alt") return "Alt";
  return "Ctrl";
}
