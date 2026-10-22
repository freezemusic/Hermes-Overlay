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
  return luminance > 0.58 ? "#14142b" : "#f5f5f5";
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

/** Close buttons. They capture with the panel, and pass through while the modifier is held. */
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

/**
 * Fade starts this far outside the orb's hit circle (R-OB-05).
 * 72px is the glow/hit radius plus a margin, inside the 60–80px range.
 * Click capture stays at HIT_MARGIN_PX. This radius is visual only.
 */
export const ORB_PROXIMITY_PX = 72;

/**
 * Opacity transition while an orb enters or leaves ORB_PROXIMITY_PX.
 * 120ms ease-out reaches the ≤30% floor inside 250ms, including one poll.
 * The same timing brings the disc back to opaque, so Ctrl does not wait
 * on the old 180ms linear ramp. v92's 180ms linear timing is superseded.
 */
export const ORB_FADE_MS = 120;
export const ORB_FADE_EASE = "cubic-bezier(0, 0, .2, 1)";

function unitBezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const dx = sampleX(t) - x;
      if (Math.abs(dx) < 1e-6) break;
      const slope = sampleDX(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= dx / slope;
    }
    t = Math.min(1, Math.max(0, t));
    return sampleY(t);
  };
}

const fadeEase = unitBezier(0, 0, 0.2, 1);

/** CSS ease-out used by the orb opacity transition. */
export function orbFadeEase(u) {
  const x = Number(u);
  if (!Number.isFinite(x)) return 0;
  return fadeEase(Math.min(1, Math.max(0, x)));
}

/** Opacity after `elapsedMs`, once the fade has been running for `delay` ms. */
export function orbFadeOpacity(elapsedMs, {
  delay = 0,
  from = 1,
  to = 0.18,
  duration = ORB_FADE_MS,
} = {}) {
  const t = Number(elapsedMs) - Number(delay);
  if (!(t > 0)) return from;
  const u = duration > 0 ? Math.min(1, t / duration) : 1;
  return from + (to - from) * orbFadeEase(u);
}

/**
 * One poll may set a target. The same target again does not start a new
 * transition: rewriting it restarts the CSS ramp and paints one frame back
 * toward the old value.
 */
export function commitOrbOpacity(previous, next) {
  const target = Math.round(Number(next) * 100) / 100;
  if (previous && previous.target === target) {
    return { target, wrote: false, generation: previous.generation || 1 };
  }
  return { target, wrote: true, generation: (previous?.generation || 0) + 1 };
}

/**
 * Sampled disc opacity. Repeated polls of the same target stay on one ramp.
 * `restart` models the old poll, which began the ramp from 1 again.
 */
export function playOrbFade(polls, { fps = 30, duration = ORB_FADE_MS, restart = false } = {}) {
  const step = 1000 / fps;
  const end = (polls[polls.length - 1]?.t || 0) + duration;
  let spec = { from: 1, to: 1, started: 0, target: 1, generation: 0 };
  const frames = [];
  let index = 0;
  for (let t = 0; t <= end + 0.01; t += step) {
    while (index < polls.length && polls[index].t <= t + 1e-6) {
      const commit = commitOrbOpacity(spec, polls[index].opacity);
      index += 1;
      if (!commit.wrote && !restart) continue;
      const computed = orbFadeOpacity(t - spec.started, { from: spec.from, to: spec.to, duration });
      const from = restart ? 1 : computed;
      spec = {
        from,
        to: commit.target,
        started: t,
        target: commit.target,
        generation: commit.generation,
      };
    }
    frames.push(orbFadeOpacity(t - spec.started, { from: spec.from, to: spec.to, duration }));
  }
  return frames;
}

/** True when every step keeps the same direction. Equal samples are allowed. */
export function opacityFramesMonotonic(frames) {
  let direction = 0;
  for (let i = 1; i < frames.length; i += 1) {
    const delta = frames[i] - frames[i - 1];
    if (Math.abs(delta) <= 1e-6) continue;
    const sign = delta > 0 ? 1 : -1;
    if (!direction) direction = sign;
    else if (sign !== direction) return false;
  }
  return true;
}

/**
 * Hit circle on the visible disc. A 44×76 shell (the 44px disc plus the
 * 32px bottom-footer slack) must not drop the circle below the disc.
 */
export function orbDiscHit(shell, disc) {
  const button = disc && disc.w >= 1 && disc.h >= 1 ? disc : null;
  const host = button || shell;
  const size = Math.min(host.w, host.h);
  let x = host.x + (host.w - size) / 2;
  let y = host.y + (host.h - size) / 2;
  if (!button && shell && shell.h > shell.w + 1) y = shell.y;
  return { x, y, w: size, h: size };
}

/** Near-orb opacity never exceeds this, so the default 18% floor stays ≤30%. */
export const ORB_NEAR_OPACITY_CAP = 0.3;

/** Floor used when the cursor is inside ORB_PROXIMITY_PX and the modifier is up. */
export function orbNearOpacity(minOpacity = 0.18) {
  const floor = Number.isFinite(minOpacity) ? minOpacity : 0.18;
  return Math.min(ORB_NEAR_OPACITY_CAP, Math.max(0.05, floor));
}

/**
 * Far from the orb, and while the modifier is held inside the fade radius,
 * the orb is opaque. Inside the radius with the modifier up it is the near floor.
 * An unknown distance stays opaque so a missing cursor sample does not flash.
 */
export function orbProximityOpacity(distance, { held = false, minOpacity = 0.18 } = {}) {
  if (!(distance >= 0) || distance > ORB_PROXIMITY_PX) return 1;
  if (held) return 1;
  return orbNearOpacity(minOpacity);
}

/** Orb DOM writes and the plan rehearsal wait this long after pointerdown. */
export const POINTER_QUIET_MS = 300;

/**
 * Why a plan rehearsal or an orb re-render must wait.
 * A live plan open wins, then a panel morph, then a pointer that is still
 * down or that went down inside POINTER_QUIET_MS. Empty means it may run.
 */
export function rehearsalDeferReason({
  pointerDown = false,
  sincePointerDown = null,
  planLive = false,
  morphLive = false,
} = {}) {
  if (planLive) return "plan-open";
  if (morphLive) return "morph";
  if (pointerDown) return "pointer";
  if (sincePointerDown != null && sincePointerDown >= 0 && sincePointerDown < POINTER_QUIET_MS) {
    return "pointer-quiet";
  }
  return "";
}

/** Orb hit ids are `bot:<id>`. Preview pills are `pill:<id>`. */
export function botIdFromHit(hitId) {
  const id = String(hitId || "");
  if (id.startsWith("bot:")) return id.slice(4);
  if (id.startsWith("pill:")) return id.slice(5);
  return "";
}

/**
 * Which profile a Ctrl press should open. A frozen press uses the hit id
 * Rust latched when the button went down. Otherwise the id from pointerdown.
 */
export function pressOrbId({ domId = "", pressFrozen = false, latchedHitId = "" } = {}) {
  if (pressFrozen) {
    const latched = botIdFromHit(latchedHitId);
    if (latched) return latched;
  }
  return domId || "";
}

/**
 * pointerup opens only when this press began with the modifier held.
 * `ctrlAtDown` is the hit-check latch or a sample that was not cleared
 * by a later key. `ctrlKey` is the DOM state from pointerdown. Browser
 * preview (supported false) stays allowed.
 */
export function orbOpenFromPress({
  supported = true,
  button = 0,
  captured = false,
  orbId = "",
  ctrlAtDown = false,
  ctrlKey = false,
} = {}) {
  if (button !== 0 || !captured || !orbId) return false;
  if (supported === false) return true;
  return ctrlAtDown === true || ctrlKey === true;
}

/**
 * A hit flush must not publish an empty shape while the modifier is held over
 * an orb or preview pill, or while a pointer button is already down.
 * `orb` is the live orb/pill under the cursor when the fresh list missed it.
 * `kept` means the previous list should stay on the OS shape (`n=0` is not sent).
 */
/**
 * GDK input shape and WM_NCHITTEST share this rect. An open plan pane sits
 * outside the chat border box, so the published region has to cover it or
 * 預覽, 原文 and × fall through to the page.
 */
export function unionOpenPlanRect(panel, plan) {
  const next = {
    x: panel.x,
    y: panel.y,
    w: panel.w,
    h: panel.h,
  };
  if (!plan || plan.open === false || !(plan.w >= 1) || !(plan.h >= 1)) return next;
  const left = Math.min(next.x, plan.x);
  const top = Math.min(next.y, plan.y);
  const right = Math.max(next.x + next.w, plan.x + plan.w);
  const bottom = Math.max(next.y + next.h, plan.y + plan.h);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** True when every edge of `pane` lies inside `region`. */
export function inputRegionCovers(region, pane) {
  if (!region || !pane || !(pane.w >= 1) || !(pane.h >= 1)) return false;
  return region.x <= pane.x + 0.01
    && region.y <= pane.y + 0.01
    && region.x + region.w + 0.01 >= pane.x + pane.w
    && region.y + region.h + 0.01 >= pane.y + pane.h;
}

export function guardPublishedHits({
  rects = [],
  previous = [],
  held = false,
  pointerDown = false,
  cursor = null,
  orb = null,
} = {}) {
  const next = rects.map((rect) => ({ ...rect }));
  if (held && orb && orb.w >= 1 && orb.h >= 1 && !next.some((rect) => rect.id === orb.id)) {
    next.push({ ...orb });
  }
  if (next.length > 0) return { rects: next, kept: false };
  const cursorKnown = !!cursor && Number.isFinite(cursor.x) && Number.isFinite(cursor.y);
  const overInteractive = cursorKnown && previous.some((rect) => (
    (isOrbHit(rect) || isPillHit(rect))
    && distanceToHit(cursor.x, cursor.y, rect) <= HIT_MARGIN_PX
  ));
  if ((pointerDown || (held && (overInteractive || !cursorKnown))) && previous.length > 0) {
    return { rects: previous.map((rect) => ({ ...rect })), kept: true };
  }
  return { rects: next, kept: false };
}

/**
 * One Escape closes one layer.
 * An open orb menu, session dropdown, or slash popup goes first.
 * Otherwise the panel that holds focus, then the highest open panel.
 * A focused field does not spend the key on blur alone.
 */
export function escapeTarget({
  menuOpen = false,
  dropdownOpen = false,
  slashOpen = false,
  focusedPanelId = "",
  topPanelId = "",
} = {}) {
  if (menuOpen) return { kind: "menu", id: "" };
  if (dropdownOpen) return { kind: "dropdown", id: "" };
  if (slashOpen) return { kind: "slash", id: "" };
  const id = String(focusedPanelId || topPanelId || "");
  if (!id) return { kind: "none", id: "" };
  return { kind: "panel", id };
}

/** Orb or preview pill within HIT_MARGIN_PX. Panels are ignored. */
function orbOrPillUnder(cursor, rects) {
  if (!cursor) return null;
  let best = null;
  for (const rect of rects) {
    if (!(isOrbHit(rect) || isPillHit(rect)) || !(rect.w >= 1) || !(rect.h >= 1)) continue;
    const distance = distanceToHit(cursor.x, cursor.y, rect);
    if (distance > HIT_MARGIN_PX) continue;
    const next = {
      id: rect.id,
      distance,
      area: rect.w * rect.h,
      latched: false,
      z: rect.z || 0,
    };
    if (!best || preferHit(next, best)) best = next;
  }
  return best ? best.id : null;
}

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
 * Orbs are opaque and click-through until the cursor is within ORB_PROXIMITY_PX
 * of that orb's hit circle, which fades only that orb (R-OB-05). Holding the
 * modifier inside that radius makes the orb opaque again. It is clickable only
 * while the modifier is held and the cursor is within HIT_MARGIN_PX. An orb or
 * pill within HIT_MARGIN_PX wins over a panel that also contains that point
 * (R-CT-02). A message-preview pill stays visually solid. It captures only
 * while the modifier is held over it. A close button captures only while the
 * modifier is up. While the modifier is held it passes through with the panel.
 * Toasts stay visually solid and are clickable only when the modifier is up.
 */
export function elementStates({
  held = false,
  latchedIds = [],
  cursor = null,
  rects = [],
  margin = HIT_MARGIN_PX,
  minOpacity = 0.18,
} = {}) {
  const under = (held && orbOrPillUnder(cursor, rects))
    || elementUnderCursor(cursor, rects, margin, latchedIds);
  const floor = Number.isFinite(minOpacity) ? minOpacity : 0.18;
  return rects.map((rect) => {
    const here = !!cursor && under === rect.id;
    if (isCloseHit(rect)) {
      return { id: rect.id, opacity: 1, capture: here && !held };
    }
    if (isPillHit(rect)) {
      return { id: rect.id, opacity: 1, capture: here && held };
    }
    if (isOrbHit(rect)) {
      const distance = cursor ? distanceToHit(cursor.x, cursor.y, rect) : Infinity;
      const awake = here && held;
      return {
        id: rect.id,
        opacity: orbProximityOpacity(distance, { held, minOpacity: floor }),
        capture: awake,
      };
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
  // Any other key, not only C/V. A 40ms Ctrl→C lead must not arm the wash.
  const chord = modifier !== "shift"
    && modifier !== "alt"
    && keys.some((key) => !modifierMatches(modifier, key));
  if (chord) return { held: false, armedAt: null, suppressed: true };
  if (suppressed) return { held: false, armedAt: null, suppressed: true };
  const start = armedAt == null ? now : armedAt;
  return {
    held: now - start >= MODIFIER_ARM_MS,
    armedAt: start,
    suppressed: false,
  };
}

/**
 * Modifier changes must not drop the first keys typed into a focused composer.
 * `remember` keeps the field. `type` leaves the event on the focused field.
 * `insert` writes the character when focus was lost before this keydown.
 */
export function composerKeyAction({
  key = "",
  ctrlKey = false,
  altKey = false,
  metaKey = false,
  activeIsComposer = false,
  composerConnected = false,
  osModifierDown = null,
} = {}) {
  if (key === "Control" || key === "Shift" || key === "Alt" || key === "Meta") {
    return "remember";
  }
  if (!composerConnected) return "ignore";
  // Focused-webview ctrlKey is authoritative. OR the OS flag: either one
  // is Ctrl+Enter. AND missed the key when the monitor was a poll behind.
  const ctrl = !!ctrlKey || osModifierDown === true;
  if (ctrl || altKey || metaKey) return "ignore";
  // Enter is not a character. The field listener sends when focus is still
  // there; `send` covers the seam stealing focus after the click.
  if (key === "Enter") return "send";
  if (key.length !== 1) return "ignore";
  return activeIsComposer ? "type" : "insert";
}

/**
 * A streaming reply leaves 停止 visible. During the open clip and the seam,
 * the focused field's default insert never lands (a click can also hit 停止
 * and forget the composer). Own the character so it queues in the input.
 * Enter stays on the send path. A settled panel keeps native typing.
 */
export function ownComposerKey({
  action = "ignore",
  busy = false,
  settling = false,
} = {}) {
  if (!busy || !settling) return false;
  return action === "type" || action === "insert";
}

export function modifierLabel(kind) {
  if (kind === "shift") return "Shift";
  if (kind === "alt") return "Alt";
  return "Ctrl";
}
