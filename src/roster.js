/** Profile visibility. Missing `enabled` stays visible so older configs keep their orbs. */

export function isProfileEnabled(bot) {
  return !!bot && bot.enabled !== false;
}

export const ROSTER_SYNC_MS = 60_000;

/** About 60s, multiplied by a factor in [0.8, 1.2]. */
export function rosterSyncDelayMs(random = Math.random) {
  const roll = typeof random === "function" ? Number(random()) : Number(random);
  const unit = Math.min(1, Math.max(0, Number.isFinite(roll) ? roll : 0.5));
  return Math.round(ROSTER_SYNC_MS * (0.8 + unit * 0.4));
}

/** Skip the quiet tick while the gateway is down or any probe is already running. */
export function rosterTickAllowed(flags) {
  const row = flags || {};
  if (row.gatewayDown || row.rosterBusy || row.kanbanBusy || row.otherBusy) return false;
  return true;
}

function bannerHits(slot, banner, box, gap) {
  return slot.x < box.x + box.w + gap && slot.x + banner.w + gap > box.x
    && slot.y < box.y + box.h + gap && slot.y + banner.h + gap > box.y;
}

function bannerOnScreen(slot, banner, screen) {
  if (!screen || !(screen.w > 0) || !(screen.h > 0)) return slot.x >= 0 && slot.y >= 0;
  return slot.x >= 0 && slot.y >= 0
    && slot.x + banner.w <= screen.w
    && slot.y + banner.h <= screen.h;
}

/**
 * Fixed slot for the key banner. The home position stays when it is `gap`
 * clear of every open panel. Otherwise the banner sits just outside the
 * panel edge (below, then above, then right, then left). The header row is
 * the last slot, so the banner never rests on panel content.
 */
export function keyBannerSlot(banner, panels, screen, gap = 8) {
  if (!banner) return { x: 0, y: 0 };
  const home = { x: banner.x, y: banner.y };
  const boxes = (panels || []).filter((box) => box && box.w >= 1 && box.h >= 1);
  const clear = (slot) => bannerOnScreen(slot, banner, screen)
    && boxes.every((box) => !bannerHits(slot, banner, box, gap));
  if (clear(home)) return home;

  const blocking = boxes.filter((box) => bannerHits(home, banner, box, gap));
  const list = blocking.length ? blocking : boxes;
  let top = Infinity;
  let bottom = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  for (const box of list) {
    top = Math.min(top, box.y);
    bottom = Math.max(bottom, box.y + box.h);
    left = Math.min(left, box.x);
    right = Math.max(right, box.x + box.w);
  }
  const outside = [
    { x: home.x, y: bottom + gap },
    { x: home.x, y: top - banner.h - gap },
    { x: right + gap, y: home.y },
    { x: left - banner.w - gap, y: home.y },
  ];
  for (const slot of outside) {
    if (clear(slot)) return slot;
  }

  for (const box of list) {
    const header = box.header;
    if (!header || header.h < 1 || header.w < 1) continue;
    const y = header.h >= banner.h
      ? header.y + (header.h - banner.h) / 2
      : header.y + header.h - banner.h;
    const slot = { x: home.x, y };
    const bottomEdge = y + banner.h;
    const staysOnHeader = bottomEdge <= header.y + header.h + 0.01 && bottomEdge > header.y;
    const othersClear = boxes.every((other) => other === box || !bannerHits(slot, banner, other, gap));
    if (staysOnHeader && bannerOnScreen(slot, banner, screen) && othersClear) return slot;
  }
  return home;
}

/** Profiles added by this sync that still have no API key. */
export function profilesNeedingKeys(before, after) {
  const known = new Set((before || []).map((bot) => bot.profile));
  return (after || []).filter(
    (bot) => isProfileEnabled(bot) && !known.has(bot.profile) && !bot.has_key,
  );
}
