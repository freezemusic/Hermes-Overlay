/** Profile visibility. Missing `enabled` stays visible so older configs keep their orbs. */

export function isProfileEnabled(bot) {
  return !!bot && bot.enabled !== false;
}

/** Profiles added by this sync that still have no API key. */
export function profilesNeedingKeys(before, after) {
  const known = new Set((before || []).map((bot) => bot.profile));
  return (after || []).filter(
    (bot) => isProfileEnabled(bot) && !known.has(bot.profile) && !bot.has_key,
  );
}
