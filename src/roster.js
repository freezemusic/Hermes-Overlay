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

const ORB_HALO_PX = 34;

function haloBox(orb) {
  return {
    x: orb.x - ORB_HALO_PX,
    y: orb.y - ORB_HALO_PX,
    w: orb.w + ORB_HALO_PX * 2,
    h: orb.h + ORB_HALO_PX * 2,
  };
}

/**
 * Fixed slot for the key banner and the gateway pill. The home position
 * stays when it is `gap` clear of every open panel and of every orb halo.
 * A halo that meets home is a blocker on its own, so an idle top orb moves
 * the slot below its glow. A panel that does not meet home is not a blocker.
 * Otherwise the banner sits 12px outside the blocker, on the side that faces
 * the screen centre. The header row is the last slot.
 */
export function keyBannerSlot(banner, panels, screen, gap = 12, orbs = []) {
  if (!banner) return { x: 0, y: 0 };
  const home = { x: banner.x, y: banner.y };
  const boxes = (panels || []).filter((box) => box && box.w >= 1 && box.h >= 1);
  const halos = (orbs || []).filter((orb) => orb && orb.w >= 1 && orb.h >= 1).map(haloBox);
  const clear = (slot) => bannerOnScreen(slot, banner, screen)
    && boxes.every((box) => !bannerHits(slot, banner, box, gap))
    && halos.every((box) => !bannerHits(slot, banner, box, gap));
  if (clear(home)) return home;

  const blockingPanels = boxes.filter((box) => bannerHits(home, banner, box, gap));
  const blockingHalos = halos.filter((box) => bannerHits(home, banner, box, gap));
  const list = blockingPanels.length || blockingHalos.length
    ? [...blockingPanels, ...blockingHalos]
    : boxes;
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
  const scx = screen && screen.w > 0 ? screen.w / 2 : home.x;
  const scy = screen && screen.h > 0 ? screen.h / 2 : home.y;
  const pcx = (left + right) / 2;
  const pcy = (top + bottom) / 2;
  const outside = [
    { x: home.x, y: bottom + gap, score: scy - pcy },
    { x: home.x, y: top - banner.h - gap, score: pcy - scy },
    { x: right + gap, y: home.y, score: scx - pcx },
    { x: left - banner.w - gap, y: home.y, score: pcx - scx },
  ].sort((a, b) => b.score - a.score);
  for (const slot of outside) {
    if (clear(slot)) return { x: slot.x, y: slot.y };
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
    const othersClear = boxes.every((other) => other === box || !bannerHits(slot, banner, other, gap))
      && halos.every((halo) => !bannerHits(slot, banner, halo, gap));
    if (staysOnHeader && bannerOnScreen(slot, banner, screen) && othersClear) return slot;
  }
  return home;
}

/**
 * Non-sticky error toast inside an open panel. It sits under a top header
 * (clear of 關閉) and, when chromeBottom is set, under the tabs and session
 * row. A bottom header keeps the toast at the top of the panel so it still
 * stays inside.
 */
export function panelErrorSlot(panel, pad = 16, gap = 8) {
  if (!panel || !(panel.w > 0) || !(panel.h > 0)) return null;
  const inset = Math.max(0, pad);
  const x = panel.x + inset;
  const w = Math.max(0, panel.w - inset * 2);
  const headerTop = Number.isFinite(panel.headerTop) ? panel.headerTop : panel.y;
  const headerBottom = Number.isFinite(panel.headerBottom) ? panel.headerBottom : panel.y;
  const chromeBottom = Number.isFinite(panel.chromeBottom) ? panel.chromeBottom : headerBottom;
  const headerInBottomHalf = headerTop > panel.y + panel.h * 0.5;
  const y = headerInBottomHalf ? panel.y + gap : Math.max(panel.y + gap, chromeBottom + gap);
  const bottomLimit = panel.y + panel.h;
  return {
    x,
    y,
    w,
    inside: x >= panel.x - 0.01
      && x + w <= panel.x + panel.w + 0.01
      && y >= panel.y - 0.01
      && y < bottomLimit,
  };
}

/** Profiles added by this sync that still have no API key. */
export function profilesNeedingKeys(before, after) {
  const known = new Set((before || []).map((bot) => bot.profile));
  return (after || []).filter(
    (bot) => isProfileEnabled(bot) && !known.has(bot.profile) && !bot.has_key,
  );
}
