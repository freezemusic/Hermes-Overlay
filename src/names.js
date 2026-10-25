/** R-OB-06: persistent orb names. Default off. Ink on a paper chip, never a light bot colour. */

import { contrastRatio, INK } from "./botcolor.js";

export const ORB_NAME_MAX_CHARS = 8;
export const ORB_NAME_MAX_W = 96;
export const ORB_NAME_H = 18;
export const ORB_NAME_GAP = 10;
export const NAME_LABEL_FG = INK;
export const NAME_LABEL_BG = "#f8f8fc";

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

function nameSpots(orb, w, h, viewport) {
  const width = viewport?.width || 1280;
  const height = viewport?.height || 800;
  const cx = orb.x + orb.w / 2;
  const cy = orb.y + orb.h / 2;
  const dx = width / 2 - cx;
  const dy = height / 2 - cy;
  const right = { x: orb.x + orb.w + ORB_NAME_GAP, y: cy - h / 2, align: "side", place: "right" };
  const left = { x: orb.x - w - ORB_NAME_GAP, y: cy - h / 2, align: "side", place: "left" };
  const below = { x: cx - w / 2, y: orb.y + orb.h + ORB_NAME_GAP, align: "center", place: "below" };
  const above = { x: cx - w / 2, y: orb.y - h - ORB_NAME_GAP, align: "center", place: "above" };
  const side = dx >= 0 ? [right, left] : [left, right];
  if (Math.abs(dx) >= Math.abs(dy)) return [...side, dy >= 0 ? below : above, dy >= 0 ? above : below];
  const vertical = dy >= 0 ? [below, above] : [above, below];
  return [...vertical, ...side];
}

/**
 * The chip sits on the screen-centre side of the orb, 10px out from the disc,
 * and lines up with the disc's middle. A panel or another name moves it.
 */
export function layoutOrbNames(orbs, panels = [], viewport = { width: 1280, height: 800 }) {
  const placed = [];
  const out = [];
  for (const orb of orbs) {
    const title = String(orb.name || "").trim();
    const text = truncateOrbName(title);
    const w = Math.min(ORB_NAME_MAX_W, Math.max(28, Array.from(text).length * 12 + 12));
    const h = ORB_NAME_H;
    const cx = orb.x + orb.w / 2;
    const spots = nameSpots(orb, w, h, viewport);
    let choice = null;
    let align = "center";
    let place = "below";
    const blocked = (box) => [...panels, ...placed].some((other) => overlaps(box, other));
    for (const spot of spots) {
      const box = clampBox({ x: spot.x, y: spot.y, w, h }, viewport);
      if (!blocked(box)) {
        choice = box;
        align = spot.align;
        place = spot.place;
        break;
      }
    }
    if (!choice) {
      const primary = spots[0];
      align = primary.align;
      place = primary.place;
      let box = clampBox({ x: primary.x, y: primary.y, w, h }, viewport);
      const stepX = place === "right" ? w + 2 : place === "left" ? -(w + 2) : 0;
      const stepY = place === "below" ? h + 2 : place === "above" ? -(h + 2) : 0;
      for (let step = 0; step < 8 && blocked(box); step += 1) {
        box = clampBox({ ...box, x: box.x + stepX, y: box.y + stepY }, viewport);
      }
      choice = box;
    }
    placed.push(choice);
    out.push({ id: orb.id, ...choice, text, title, align, place, anchorX: cx });
  }
  return out;
}
