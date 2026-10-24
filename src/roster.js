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

/**
 * The key banner's top. A header, a plan Goal line, or a kanban status
 * line closer than `gap` pushes the banner just below that box.
 */
export function keyBannerTop(banner, obstacles, gap = 8) {
  if (!banner) return 0;
  let top = banner.y;
  const list = obstacles || [];
  let moved = true;
  let guard = 0;
  while (moved && guard < 8) {
    moved = false;
    guard += 1;
    for (const box of list) {
      if (!(box?.w >= 1) || !(box?.h >= 1)) continue;
      const overlapsX = banner.x < box.x + box.w && banner.x + banner.w > box.x;
      const overlapsY = top < box.y + box.h + gap && top + banner.h + gap > box.y;
      if (!overlapsX || !overlapsY) continue;
      const next = box.y + box.h + gap;
      if (next > top) {
        top = next;
        moved = true;
      }
    }
  }
  return top;
}

/** Profiles added by this sync that still have no API key. */
export function profilesNeedingKeys(before, after) {
  const known = new Set((before || []).map((bot) => bot.profile));
  return (after || []).filter(
    (bot) => isProfileEnabled(bot) && !known.has(bot.profile) && !bot.has_key,
  );
}
