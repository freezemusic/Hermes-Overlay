/** Bot Chat is the default. An explicit pick sticks until that session disappears. */

export const BOT_CHAT_TITLE = "Bot Chat";

export function isBotChat(session) {
  return String(session?.title || "").trim() === BOT_CHAT_TITLE;
}

/** Overlay and Desktop chats. The main orb does not use this filter. */
export function isOverlayChatSource(source) {
  const value = String(source || "").trim();
  return value === "api_server" || value === "desktop";
}

export function isOverlayBotChat(session) {
  return isBotChat(session) && isOverlayChatSource(session?.source);
}

/** POST /api/sessions/{id}/chat refuses a tui row with permission_denied. */
export function isTuiSource(source) {
  return String(source || "").trim().toLowerCase() === "tui";
}

export const TUI_READ_ONLY_REASON = "呢個 Bot Chat 來源係 tui。API 唔接受寫入 tui session（permission_denied），只可以睇。";

export function hasChatHistory(session) {
  const count = Number(session?.message_count);
  if (Number.isFinite(count) && count > 0) return true;
  return String(session?.preview || "").trim().length > 0;
}

function startedAt(session) {
  const value = Number(session?.started_at);
  return Number.isFinite(value) && value > 0 ? value : Number.POSITIVE_INFINITY;
}

/** Smaller started_at, then smaller last_active, then smaller id. */
function olderThan(a, b) {
  const start = startedAt(a) - startedAt(b);
  if (start) return start;
  const active = (Number(a.last_active) || 0) - (Number(b.last_active) || 0);
  if (active) return active;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function isApiMinted(id) {
  return String(id || "").startsWith("api_");
}

/** More messages, then more recent activity, then the smaller id. */
function busierThan(a, b) {
  const count = (Number(a.message_count) || 0) - (Number(b.message_count) || 0);
  if (count) return count;
  const active = (Number(a.last_active) || 0) - (Number(b.last_active) || 0);
  if (active) return active;
  if (a.id < b.id) return 1;
  if (a.id > b.id) return -1;
  return 0;
}

/** Desktop or tui before an api_ mint, then the older row. */
function emptyRank(a, b) {
  const minted = (isApiMinted(a.id) ? 1 : 0) - (isApiMinted(b.id) ? 1 : 0);
  if (minted) return minted;
  return olderThan(a, b);
}

/**
 * Desktop's Bot Chat is the row titled exactly "Bot Chat"
 * (profiles.list canonical_session; hermes-agent PR 92129).
 * A marked delivery lease wins when it has messages, or when every titled
 * row is empty. Otherwise the titled row with the most messages wins.
 * A 0-message row never beats one with history. When every titled row is
 * empty, the oldest Desktop or tui row wins over an api_ duplicate.
 */
export function canonicalBotChat(sessions) {
  const titled = (sessions || []).filter((session) => session && session.id && isBotChat(session));
  if (!titled.length) return null;
  const history = titled.some(hasChatHistory);
  const delivery = titled.find((session) => session.delivery === true);
  if (delivery && (!history || hasChatHistory(delivery))) return delivery;
  if (history) {
    return titled.filter(hasChatHistory).reduce((best, item) => (busierThan(item, best) > 0 ? item : best));
  }
  return titled.reduce((best, item) => (emptyRank(item, best) < 0 ? item : best));
}

function emptyWithBetter(saved, sessions) {
  if (hasChatHistory(saved)) return false;
  const best = canonicalBotChat(sessions);
  return Boolean(best && best.id !== saved.id && hasChatHistory(best));
}

/**
 * Config already names a session: leave the id, the explicit flag, and the
 * anchor alone. The only automatic write fills an empty id.
 */
export function storedPinAfterResolve(existing, resolved) {
  const existingId = String(existing?.id || "").trim();
  if (existingId) return null;
  const resolvedId = String(resolved?.id || "").trim();
  if (!resolvedId) return null;
  const existingAnchor = Number(existing?.anchor);
  const resolvedAnchor = Number(resolved?.anchor);
  let anchor = 0;
  if (Number.isFinite(existingAnchor) && existingAnchor > 0) anchor = existingAnchor;
  else if (Number.isFinite(resolvedAnchor) && resolvedAnchor > 0) anchor = resolvedAnchor;
  return {
    id: resolvedId,
    explicit: existing?.explicit === true || resolved?.explicit === true,
    anchor,
  };
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
  return canonicalBotChat(sessions);
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
  const remembered = String(pin.id || "").trim();
  const explicit = pin.explicit === true;
  const rawAnchor = Number(pin.anchor);
  const anchor = Number.isFinite(rawAnchor) ? rawAnchor : 0;
  const saved = remembered
    ? (sessions || []).find((session) => session && session.id === remembered)
    : null;
  if (saved && (explicit || !emptyWithBetter(saved, sessions))) {
    return {
      id: saved.id,
      explicit,
      anchor,
      source: saved.source || "",
      readOnly: isTuiSource(saved.source),
    };
  }
  const preferred = canonicalBotChat(sessions);
  if (!preferred) return null;
  return {
    id: preferred.id,
    explicit: false,
    anchor: Number(preferred.last_active) || 0,
    source: preferred.source || "",
    readOnly: isTuiSource(preferred.source),
  };
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
