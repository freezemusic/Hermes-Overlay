/** R-OB-06: persistent orb names. Default off. Ink on a paper chip, never a light bot colour. */

import { contrastRatio, INK } from "./botcolor.js";

export const ORB_NAME_MAX_CHARS = 8;
export const ORB_NAME_MAX_W = 96;
export const ORB_NAME_H = 16;
export const ORB_NAME_GAP = 4;
export const NAME_LABEL_FG = INK;
export const NAME_LABEL_BG = "#f7f8f8";

const LIGHT_BOT = new Set(["#f2f200", "#00f2f2", "#79f200", "#edff45", "#f27900"]);

export function truncateOrbName(name, maxChars = ORB_NAME_MAX_CHARS) {
  const chars = Array.from(String(name || "").trim());
  if (chars.length <= maxChars) return chars.join("");
  if (maxChars <= 1) return "…";
  return `${chars.slice(0, maxChars - 1).join("")}…`;
}

export function applyOrbName(el, name) {
  const title = String(name || "").trim();
  const text = truncateOrbName(title);
  el.textContent = text;
  el.title = title;
  el.setAttribute("aria-label", title);
  el.hidden = !title;
  return { text, title };
}

export function nameLabelColors() {
  return { fg: NAME_LABEL_FG, bg: NAME_LABEL_BG };
}

export function nameLabelContrast() {
  const { fg, bg } = nameLabelColors();
  return contrastRatio(fg, bg);
}

export function nameInkIsDark(hex = NAME_LABEL_FG) {
  const color = String(hex || "").trim().toLowerCase();
  return !LIGHT_BOT.has(color) && color !== "#ffffff";
}

/** Disc hit stays the disc until Ctrl is held. Then the label can join it. */
export function orbHitRect(disc, label, ctrl) {
  const base = { x: disc.x, y: disc.y, w: disc.w, h: disc.h };
  if (!ctrl || !label || !(label.w >= 1) || !(label.h >= 1)) return base;
  const x = Math.min(disc.x, label.x);
  const y = Math.min(disc.y, label.y);
  const right = Math.max(disc.x + disc.w, label.x + label.w);
  const bottom = Math.max(disc.y + disc.h, label.y + label.h);
  return { x, y, w: right - x, h: bottom - y };
}

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function clampBox(box, viewport) {
  const width = viewport?.width || 1280;
  const height = viewport?.height || 800;
  return {
    x: Math.max(0, Math.min(box.x, Math.max(0, width - box.w))),
    y: Math.max(0, Math.min(box.y, Math.max(0, height - box.h))),
    w: box.w,
    h: box.h,
  };
}

/**
 * Prefer a chip under the orb. If that covers a panel or another name, try
 * the right, the left, then above.
 */
export function layoutOrbNames(orbs, panels = [], viewport = { width: 1280, height: 800 }) {
  const placed = [];
  const out = [];
  for (const orb of orbs) {
    const title = String(orb.name || "").trim();
    const text = truncateOrbName(title);
    const w = Math.min(ORB_NAME_MAX_W, Math.max(28, Array.from(text).length * 12));
    const h = ORB_NAME_H;
    const cx = orb.x + orb.w / 2;
    const spots = [
      { x: cx - w / 2, y: orb.y + orb.h + ORB_NAME_GAP },
      { x: orb.x + orb.w + ORB_NAME_GAP, y: orb.y + (orb.h - h) / 2 },
      { x: orb.x - w - ORB_NAME_GAP, y: orb.y + (orb.h - h) / 2 },
      { x: cx - w / 2, y: orb.y - h - ORB_NAME_GAP },
    ];
    let choice = null;
    for (const spot of spots) {
      const box = clampBox({ ...spot, w, h }, viewport);
      const blocked = [...panels, ...placed].some((other) => overlaps(box, other));
      if (!blocked) {
        choice = box;
        break;
      }
    }
    if (!choice) {
      let box = clampBox({ x: cx - w / 2, y: orb.y + orb.h + ORB_NAME_GAP, w, h }, viewport);
      for (let step = 0; step < 6 && [...panels, ...placed].some((other) => overlaps(box, other)); step += 1) {
        box = clampBox({ ...box, y: box.y + h + 2 }, viewport);
      }
      choice = box;
    }
    placed.push(choice);
    out.push({ id: orb.id, ...choice, text, title });
  }
  return out;
}
