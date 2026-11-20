// R-PN-11: what a settings save has to do. Look and behaviour settings apply
// live; only connection settings reconnect, and a reconnect keeps open panels.

const norm = (value) => String(value ?? "").trim();

function rosterKey(bots) {
  return (Array.isArray(bots) ? bots : []).map((bot) => [
    norm(bot?.profile),
    bot?.enabled === false ? 0 : 1,
    norm(bot?.display_name),
    norm(bot?.color),
  ]);
}

/** True when the saved settings differ from the old ones in something the connection depends on. */
export function settingsNeedReconnect(prev, next, tokenTyped = false) {
  if (!prev || typeof prev !== "object") return true;
  if (tokenTyped) return true;
  if (norm(prev.mode) !== norm(next?.mode)) return true;
  if (norm(prev.dashboard_base_url) !== norm(next?.dashboard_base_url)) return true;
  if (norm(prev.kanban_base_url) !== norm(next?.kanban_base_url)) return true;
  return JSON.stringify(rosterKey(prev.bots)) !== JSON.stringify(rosterKey(next?.bots));
}

/** The profile a thread / panel / shell id belongs to (`suborb:<profile>:<session>` or the profile). */
export function ownerProfile(id) {
  const text = String(id ?? "");
  if (!text.startsWith("suborb:")) return text;
  const rest = text.slice("suborb:".length);
  const cut = rest.indexOf(":");
  return cut < 0 ? rest : rest.slice(0, cut);
}

/** Ids (thread keys, panel ids) whose owning bot is no longer in the roster. */
export function idsOfGoneBots(ids, botIds) {
  const alive = new Set(botIds);
  return [...ids].filter((id) => !alive.has(ownerProfile(id)));
}
