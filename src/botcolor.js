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

export const INK = "#14142b";
export const TEXT_BLUE = "#0000f2";
export const BUTTON_TEXT = "#ffffff";
export const PAPER = "#f8f8fc";

export function parseHex(hex) {
  const raw = String(hex || "").trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  const n = Number.parseInt(raw, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Opaque mix of `hex` at `alpha` over `under`. Matches `rgb(bot / alpha)`. */
export function compositeHex(hex, alpha, under = "#ffffff") {
  const fg = parseHex(hex);
  const bg = parseHex(under);
  if (!fg || !bg) return under;
  const a = Math.min(1, Math.max(0, Number(alpha) || 0));
  const mix = (c, d) => Math.round(c * a + d * (1 - a));
  const byte = (n) => n.toString(16).padStart(2, "0");
  return `#${byte(mix(fg.r, bg.r))}${byte(mix(fg.g, bg.g))}${byte(mix(fg.b, bg.b))}`;
}

function linearChannel(channel) {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG contrast of two opaque hex colours. */
export function contrastRatio(fgHex, bgHex) {
  const fg = parseHex(fgHex);
  const bg = parseHex(bgHex);
  if (!fg || !bg) return 1;
  const lum = (c) => 0.2126 * linearChannel(c.r) + 0.7152 * linearChannel(c.g) + 0.0722 * linearChannel(c.b);
  const hi = Math.max(lum(fg), lum(bg));
  const lo = Math.min(lum(fg), lum(bg));
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Text on a solid bot-colour fill. Light fills (yellow, cyan, neon) use ink.
 * Dark fills use white when that pair clears 4.5:1.
 */
export function textOnBotFill(hex) {
  const fill = parseHex(hex) ? hex : NOUS.blue;
  const inkClears = contrastRatio(INK, fill) >= 4.5;
  const whiteClears = contrastRatio(BUTTON_TEXT, fill) >= 4.5;
  if (inkClears && !whiteClears) return INK;
  if (whiteClears) return BUTTON_TEXT;
  // Red and pink miss 4.5 with both ink and white. Black still clears.
  if (contrastRatio("#000000", fill) >= 4.5) return "#000000";
  return INK;
}

/** Text/background pairs the UI paints from a bot colour. None use the bot
 *  colour as the text or as a solid button fill. */
export function textPairsForBot(hex) {
  const color = parseHex(hex) ? hex : NOUS.blue;
  const wash = (alpha, under = "#ffffff") => compositeHex(color, alpha, under);
  return [
    { name: "panel-title", fg: TEXT_BLUE, bg: PAPER },
    { name: "user-bubble", fg: INK, bg: wash(0.1) },
    { name: "user-bubble-paper", fg: INK, bg: wash(0.1, PAPER) },
    { name: "code-chip", fg: INK, bg: wash(0.05) },
    { name: "slash-active", fg: INK, bg: wash(0.1, PAPER) },
    { name: "send-btn", fg: BUTTON_TEXT, bg: TEXT_BLUE },
    { name: "tab", fg: BUTTON_TEXT, bg: TEXT_BLUE },
    { name: "orb-glyph", fg: INK, bg: "#ffffff" },
    { name: "link", fg: TEXT_BLUE, bg: "#ffffff" },
    { name: "bot-fill", fg: textOnBotFill(color), bg: color },
  ];
}

/** Glyph ink for the two light swatches. The halo keeps the pure bot colour. */
const BOT_INK = {
  "#f2f200": "#6b6b00",
  "#00f2f2": "#006b6b",
};

export function botInk(hex) {
  return BOT_INK[String(hex || "").trim().toLowerCase()] || "";
}

/** Sets --bot and the rgb fallback channels old WebKitGTK can paint. */
export function applyBotColor(el, hex) {
  if (!el) return;
  const color = /^#[0-9a-fA-F]{6}$/.test(String(hex || "").trim()) ? hex : NOUS.blue;
  const channels = botChannels(color);
  const ink = botInk(color);
  const same = el.style.getPropertyValue("--bot") === color
    && el.style.getPropertyValue("--bot-rgb").trim() === channels
    && el.style.getPropertyValue("--bot-color") === color
    && el.style.getPropertyValue("--bot-ink") === ink;
  if (same) return;
  el.style.setProperty("--bot", color);
  el.style.setProperty("--bot-rgb", channels);
  el.style.setProperty("--bot-color", color);
  if (ink) el.style.setProperty("--bot-ink", ink);
  else el.style.removeProperty("--bot-ink");
}
