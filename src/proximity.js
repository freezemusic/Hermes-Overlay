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

export function opacityForDistance(distance, fadeDistance, minOpacity, enabled) {
  if (!enabled) return 1;
  if (!(fadeDistance > 0)) return minOpacity;
  if (distance >= fadeDistance) return 1;
  if (distance <= 0) return minOpacity;
  return minOpacity + (1 - minOpacity) * (distance / fadeDistance);
}

/** Holding the modifier (or a focus latch) is full opacity at every distance. */
export function elementOpacity({ solid, distance, fadeDistance, minOpacity, fadeEnabled }) {
  if (solid) return 1;
  return opacityForDistance(distance, fadeDistance, minOpacity, fadeEnabled);
}

/** Focus lock is dropped while the overlay window itself is unfocused. */
export function interactionLatched({
  windowFocused = true,
  textFocused = false,
  settingsOpen = false,
  pointerInside = false,
} = {}) {
  return windowFocused !== false && (textFocused || settingsOpen || pointerInside);
}

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
