/** Bot Chat is the default. An explicit pick sticks until that session disappears. */

export const BOT_CHAT_TITLE = "Bot Chat";

export function isBotChat(session) {
  return String(session?.title || "").trim() === BOT_CHAT_TITLE;
}

/** Overlay and Desktop chats. A TUI Bot Chat stays in the picker only. */
export function isOverlayChatSource(source) {
  const value = String(source || "").trim();
  return value === "api_server" || value === "desktop";
}

export function isOverlayBotChat(session) {
  return isBotChat(session) && isOverlayChatSource(session?.source);
}

export function mostRecentSession(sessions) {
  const list = (sessions || []).filter((session) => session && session.id);
  if (!list.length) return null;
  return list.reduce((best, item) => {
    const active = Number(item.last_active) || 0;
    const bestActive = Number(best.last_active) || 0;
    if (active > bestActive) return item;
    if (active < bestActive) return best;
    return item.id < best.id ? item : best;
  });
}

export function mostRecentBotChat(sessions) {
  return mostRecentSession((sessions || []).filter(isOverlayBotChat));
}

function byRecent(a, b) {
  const delta = (Number(b.last_active) || 0) - (Number(a.last_active) || 0);
  if (delta) return delta;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** Bot Chat rows first, then every other session. Each group is most-recent first. */
export function orderSessions(sessions) {
  const list = (sessions || []).filter((session) => session && session.id);
  const chats = list.filter(isBotChat).sort(byRecent);
  const rest = list.filter((session) => !isBotChat(session)).sort(byRecent);
  return chats.concat(rest);
}

export function resolveSession(sessions, pin = {}) {
  const preferred = mostRecentBotChat(sessions) || mostRecentSession(sessions);
  if (!preferred) return null;
  const remembered = String(pin.id || "").trim();
  const explicit = pin.explicit === true;
  const anchor = Number(pin.anchor) || 0;
  const picked = explicit && remembered
    ? (sessions || []).find((session) => session.id === remembered)
    : null;
  if (picked) {
    const newest = Number(mostRecentSession(sessions)?.last_active) || 0;
    return { id: picked.id, explicit: true, anchor: Math.max(anchor, newest) };
  }
  return { id: preferred.id, explicit: false, anchor: Number(preferred.last_active) || 0 };
}

export function sessionLabel(session) {
  const title = String(session?.title || "").trim() || session?.id || "";
  return session?.hidden ? `${title}（隱藏）` : title;
}

/**
 * Messages the UI has not shown yet.
 * A non-empty live bot bubble absorbs a longer copy of itself so a streamed
 * reply is not appended twice when the poll catches up.
 */
function sameOrGrowth(have, next) {
  const role = have?.role || "";
  if (role !== (next?.role || "")) return null;
  const sofar = String(have?.text || "");
  const text = String(next?.text || "");
  if (sofar === text) return { grew: false };
  if (role === "bot" && have?.live && sofar && text.startsWith(sofar)) return { grew: true, text };
  return null;
}

export function unseenMessages(existing, incoming) {
  const have = (existing || []).filter(Boolean);
  const next = (incoming || []).filter((message) => message && message.role);
  let matched = 0;
  let settled = null;
  const limit = Math.min(have.length, next.length);
  for (let back = 0; back <= limit; back += 1) {
    let grew = null;
    let ok = true;
    for (let index = 0; index < back; index += 1) {
      const cmp = sameOrGrowth(have[have.length - back + index], next[index]);
      if (!cmp) {
        ok = false;
        break;
      }
      if (cmp.grew) grew = { text: cmp.text };
    }
    if (ok) {
      matched = back;
      settled = grew;
    }
  }
  return {
    fresh: next.slice(matched).map((message) => ({
      role: message.role,
      text: String(message.text || ""),
      tool_name: message.tool_name || "",
    })),
    settled,
  };
}

export function previewLine(messages) {
  const last = [...(messages || [])].reverse().find((message) => String(message?.text || "").trim());
  if (!last) return "";
  const line = String(last.text).split(/\r?\n/).map((part) => part.trim()).find(Boolean) || "";
  return line.length > 180 ? `${line.slice(0, 179)}…` : line;
}
