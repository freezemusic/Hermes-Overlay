/** Nous f2 swatches. One bot colour drives every tone via --bot-rgb. */

export const NOUS = {
  blue: "#0000f2",
  cyan: "#00f2f2",
  green: "#00f279",
  neon: "#79f200",
  yellow: "#f2f200",
  orange: "#f27900",
  red: "#f20000",
  pink: "#f20079",
  magenta: "#f200f2",
  indigo: "#7900f2",
  neutral: "#616191",
  navy: "#000091",
};

export const PALETTE = [
  NOUS.blue,
  NOUS.cyan,
  NOUS.green,
  NOUS.neon,
  NOUS.yellow,
  NOUS.orange,
  NOUS.red,
  NOUS.pink,
  NOUS.magenta,
  NOUS.indigo,
];

export function botChannels(hex) {
  const raw = String(hex || "").trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return "0 0 242";
  const n = Number.parseInt(raw, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** Sets --bot and the rgb fallback channels old WebKitGTK can paint. */
export function applyBotColor(el, hex) {
  if (!el) return;
  const color = /^#[0-9a-fA-F]{6}$/.test(String(hex || "").trim()) ? hex : NOUS.blue;
  el.style.setProperty("--bot", color);
  el.style.setProperty("--bot-rgb", botChannels(color));
  el.style.setProperty("--bot-color", color);
}
