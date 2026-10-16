/** Distance fade shared by the browser preview and unit tests. */

import { PALETTE as NOUS_PALETTE } from "./botcolor.js";

/** Nous f2 swatches. Yellow is a bot colour, not the button accent. */
export const PALETTE = NOUS_PALETTE;

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

/** Distance fade helper. Hover no longer calls this; modifier transparency uses minOpacity directly. */
export function elementOpacity({ solid, distance, fadeDistance, minOpacity, fadeEnabled }) {
  if (solid) return 1;
  return opacityForDistance(distance, fadeDistance, minOpacity, fadeEnabled);
}

/** Message-preview pills. They are not orbs and not panels. */
export function isPillHit(rect) {
  return String(rect?.id || "").startsWith("pill:");
}

/** Close buttons stay clickable on the first press, even while the modifier is held. */
export function isCloseHit(rect) {
  return String(rect?.id || "").startsWith("close:");
}

/** Panels wash out while the modifier is held. Orbs, pills, close buttons, and toasts are not panels. */
export function isPanelHit(rect) {
  if (!rect || isPillHit(rect) || isCloseHit(rect) || isOrbHit(rect)) return false;
  const id = String(rect.id || "");
  if (id.startsWith("toast:")) return false;
  return true;
}

/** Bot, settings, and kanban orbs. Round hits and `bot:` ids both count. */
export function isOrbHit(rect) {
  if (!rect || isPillHit(rect) || isCloseHit(rect)) return false;
  if (rect.round) return true;
  return String(rect.id || "").startsWith("bot:");
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
 * Panels stay opaque and capture the cursor. Holding the modifier washes every
 * panel out and captures none of them.
 * Orbs stay faded and click-through. Only the orb under or near the cursor
 * turns solid and clickable while the modifier is held.
 * A message-preview pill stays visually solid. It captures only while the
 * modifier is held over it. A close button stays solid and captures whenever
 * the cursor is over it, including while the modifier is held. Toasts stay
 * visually solid and are clickable only when the modifier is up.
 */
export function elementStates({
  held = false,
  latchedIds = [],
  cursor = null,
  rects = [],
  margin = HIT_MARGIN_PX,
  minOpacity = 0.18,
} = {}) {
  const under = elementUnderCursor(cursor, rects, margin, latchedIds);
  const floor = Number.isFinite(minOpacity) ? minOpacity : 0.18;
  return rects.map((rect) => {
    const here = !!cursor && under === rect.id;
    if (isCloseHit(rect)) {
      return { id: rect.id, opacity: 1, capture: here };
    }
    if (isPillHit(rect)) {
      return { id: rect.id, opacity: 1, capture: here && held };
    }
    if (isOrbHit(rect)) {
      const awake = here && held;
      return { id: rect.id, opacity: awake ? 1 : floor, capture: awake };
    }
    if (isPanelHit(rect)) {
      return {
        id: rect.id,
        opacity: cursor && held ? floor : 1,
        capture: here && !held,
      };
    }
    return { id: rect.id, opacity: 1, capture: here && !held };
  });
}

/** Focus lock names the panel that stays interactive. Dropped when the window blurs. */
export function latchedElementIds({
  windowFocused = true,
  textFocused = false,
  textInSettings = false,
  settingsOpen = false,
  pointerHitId = "",
  slashOpen = false,
} = {}) {
  if (windowFocused === false) return [];
  const ids = [];
  if (settingsOpen || (textFocused && textInSettings)) ids.push("settings");
  if (textFocused && !textInSettings) ids.push("center");
  if (slashOpen && textFocused && !textInSettings) ids.push("slash");
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
 * GTK fires select blur when its popup opens, and the page then has no DOM focus.
 * That blur must not clear the dropdown flag. An in-page blur means the menu closed.
 */
export function selectBlurAction({ dropdownOpen = false, documentFocused = true } = {}) {
  if (!dropdownOpen) return "ignore";
  if (!documentFocused) return "defer";
  return "close";
}

/**
 * OS focus owner, already confirmed by the native poll.
 * own: this app's window, its frame, or its popup. other: another window.
 */
export function osFocusAction(owner) {
  if (owner === "own") return "hold";
  if (owner === "other") return "release";
  return "ignore";
}

/**
 * Another app taking the window releases immediately.
 * In-webview blur waits. An open dropdown holds until the OS says another process is focused.
 */
export function focusLossAction({
  source = "webview",
  dropdownOpen = false,
  focusOwner = "unknown",
} = {}) {
  const os = osFocusAction(focusOwner);
  if (os !== "ignore") return os;
  if (dropdownOpen) return "hold";
  if (source === "tauri-window") return "release";
  return "debounce";
}

/**
 * The first observed selection does not pulse. A later change pulses that orb once.
 * `previous` is `undefined` before the first paint.
 */
export function nextOrbPulse(previous, activeId) {
  const rendered = activeId ?? null;
  if (previous === undefined) return { rendered, pulseId: null };
  return { rendered, pulseId: rendered && rendered !== previous ? rendered : null };
}

/**
 * Forced close of the modifier menu. Blur and clear the flag.
 * Toggling `disabled` leaves the select so the next click does not open it.
 */
export function applyDropdownDismiss(state) {
  state.dropdownOpen = false;
  return { blur: true, disable: false };
}

/**
 * Pin only flips keep-above. It must not quit the process.
 * `true` shows 「置頂」; `false` shows 「取消置頂」.
 */
export function pinToggle(alwaysOnTop) {
  const next = !alwaysOnTop;
  return {
    alwaysOnTop: next,
    label: next ? "置頂" : "取消置頂",
    pressed: next,
    quits: false,
    armsCloseGuard: true,
  };
}

/** Settings 「結束」 quits through the app exit path. */
export function settingsQuitAction() {
  return { command: "quit_app", exitCode: 0 };
}

/** User-facing text when a settings or pin invoke is rejected. */
export function invokeFailureMessage(action, err) {
  const detail = typeof err === "string" ? err : err?.message || String(err ?? "");
  return `${action}失敗：${detail}`;
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

/** A lone modifier arms after this, so a Ctrl+C / Ctrl+V chord cannot flash the HUD. */
export const MODIFIER_ARM_MS = 100;

/**
 * Copy and paste stay at the resting frame. That includes the tail after C or V
 * is released while Ctrl is still down. A lone modifier arms after MODIFIER_ARM_MS.
 */
export function modifierEngages({
  modifier = "ctrl",
  keys = [],
  now = 0,
  armedAt = null,
  suppressed = false,
} = {}) {
  const down = keys.some((key) => modifierMatches(modifier, key));
  if (!down) return { held: false, armedAt: null, suppressed: false };
  const copyPaste = modifier !== "shift"
    && modifier !== "alt"
    && keys.some((key) => key === "c" || key === "C" || key === "v" || key === "V");
  if (copyPaste) return { held: false, armedAt: null, suppressed: true };
  if (suppressed) return { held: false, armedAt: null, suppressed: true };
  const start = armedAt == null ? now : armedAt;
  return {
    held: now - start >= MODIFIER_ARM_MS,
    armedAt: start,
    suppressed: false,
  };
}

export function modifierLabel(kind) {
  if (kind === "shift") return "Shift";
  if (kind === "alt") return "Alt";
  return "Ctrl";
}
