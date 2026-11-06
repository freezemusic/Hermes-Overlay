/** Open panels stay independent. Motion starts at the orb that owns the panel. */

export function openPanel(ids, id) {
  const list = Array.isArray(ids) ? ids.slice() : [];
  if (id && !list.includes(id)) list.push(id);
  return list;
}

export function closePanel(ids, id) {
  return (Array.isArray(ids) ? ids : []).filter((item) => item !== id);
}

/** CSS pixels from the panel centre back to the orb centre. */
export function fromOrbDelta(orb, panel) {
  const ox = orb.x + orb.w / 2;
  const oy = orb.y + orb.h / 2;
  const px = panel.x + panel.w / 2;
  const py = panel.y + panel.h / 2;
  return { x: ox - px, y: oy - py };
}

/** Later panels step aside so they do not stack on the exact same origin. */
export function panelStackOffset(index) {
  const n = Number.isFinite(index) && index > 0 ? Math.floor(index) : 0;
  return { x: n * 28, y: n * 28 };
}
