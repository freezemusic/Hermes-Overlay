/** Desktop's Bot Chat is the default. An explicit pick sticks while that session is listed. */

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

/** Narrow `tui` check. Sending uses `sessionAcceptsSend`. */
export function isTuiSource(source) {
  return String(source || "").trim().toLowerCase() === "tui";
}

/** Gateway 0.22.5 accepts a send only from these session sources. */
export function sessionAcceptsSend(source) {
  const value = String(source || "").trim().toLowerCase();
  return value === "api_server" || value === "bot_room";
}

export function sessionReadOnly(source) {
  return !sessionAcceptsSend(source);
}

export const SESSION_READ_ONLY_REASON = "呢個 session 係喺 CLI／Desktop 開嘅，只可以睇，唔可以喺呢度傳嘢";

export const CONTINUE_API_LABEL = "喺 API 對話繼續";

export const CONTINUE_API_HINT = "撳下面就可以喺呢個 Bot 嘅 API 對話繼續。";

/**
 * Another session of this bot that the gateway will accept a chat into.
 * A live Bot Chat wins. `avoidId` is the row that is read-only or was just refused.
 */
export function writableContinuation(sessions, avoidId = "") {
  const avoid = String(avoidId || "");
  const writable = (sessions || []).filter(
    (session) => session && session.id && session.id !== avoid && sessionAcceptsSend(session.source),
  );
  const live = writable.filter((session) => session.archived !== true);
  const pool = live.length ? live : writable;
  const chats = pool.filter((session) => isBotChat(session));
  return mostRecentSession(chats.length ? chats : pool);
}

export const TUI_READ_ONLY_REASON = SESSION_READ_ONLY_REASON;

export function isPermissionDeniedText(text) {
  const value = String(text || "");
  return value === SESSION_READ_ONLY_REASON || /permission[_\s-]*denied/i.test(value);
}

export function permissionDeniedMessage(text) {
  const value = String(text ?? "");
  return isPermissionDeniedText(value) ? SESSION_READ_ONLY_REASON : value;
}

function retiredBotChat(session) {
  const title = String(session?.title || "").trim();
  return !title && session?.archived === true && session?.hidden === true;
}

/**
 * Desktop's Bot Chat is the one row titled exactly "Bot Chat"
 * (usually hidden). The gateway title lookup already returns the latest
 * continuation child. The client opens that row and does not follow children.
 * Source and message count do not matter. An empty row is valid.
 */
export function canonicalBotChat(sessions) {
  const list = sessions || [];
  const titled = list.filter((session) => session && session.id && isBotChat(session));
  if (!titled.length) return null;
  const hidden = titled.filter((session) => session.hidden === true);
  let pool = hidden.length ? hidden : titled;
  const live = pool.filter((session) => session.archived !== true);
  if (live.length) pool = live;
  pool.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return pool[0];
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
  if (saved && explicit) {
    return {
      id: saved.id,
      explicit: true,
      anchor,
      source: saved.source || "",
      readOnly: sessionReadOnly(saved.source),
    };
  }
  const preferred = canonicalBotChat(sessions);
  if (preferred) {
    return {
      id: preferred.id,
      explicit: false,
      anchor: preferred.id === remembered ? anchor : (Number(preferred.last_active) || 0),
      source: preferred.source || "",
      readOnly: sessionReadOnly(preferred.source),
    };
  }
  if (saved && !retiredBotChat(saved)) {
    return {
      id: saved.id,
      explicit: false,
      anchor,
      source: saved.source || "",
      readOnly: sessionReadOnly(saved.source),
    };
  }
  return null;
}

/** Hidden wins, then archived, then a source the gateway will not accept. */
export function sessionLabel(session) {
  const title = String(session?.title || "").trim() || session?.id || "";
  return `${title}${sessionSuffix(session)}`;
}

function sessionSuffix(session) {
  if (session?.hidden) return "（隱藏）";
  if (session?.archived === true) return "（已封存）";
  const source = String(session?.source || "").trim().toLowerCase();
  if (!source || sessionAcceptsSend(source)) return "";
  const name = source === "desktop" ? "Desktop"
    : source === "cli" ? "CLI"
    : source === "tui" ? "TUI"
    : source === "oneshot" ? "一次性"
    : source;
  return `（${name}／只可以睇）`;
}

/** The read-only reason and the continue hint are two sentences. */
export function readOnlyNote(reason = SESSION_READ_ONLY_REASON) {
  const line = String(reason || SESSION_READ_ONLY_REASON).replace(/。+$/u, "");
  return `${line}。${CONTINUE_API_HINT}`;
}

export function deniedKey(profile, sessionId) {
  const id = String(sessionId || "");
  if (!profile || !id) return "";
  return `${profile}:${id}`;
}

/** `permission_denied` sticks for this app run, even when metadata source is writable. */
export function rememberDenied(set, profile, sessionId) {
  const key = deniedKey(profile, sessionId);
  if (key && set) set.add(key);
  return set;
}

export function readOnlyLocked(set, profile, sessionId, sourceReadOnly) {
  const key = deniedKey(profile, sessionId);
  return !!sourceReadOnly || (!!key && !!set?.has(key));
}

/** The latest `run.started` is the run 「停止」 must post. */
export function noteRunStarted(thread, runId) {
  const incoming = String(runId || "");
  if (!thread || !incoming) return thread;
  if (thread.runId && thread.runId !== incoming) thread.staleRunId = thread.runId;
  thread.runId = incoming;
  thread.nextRunId = "";
  return thread;
}

/** A finish for some other run must not idle the bot or drop the active id. */
export function finishApplies(thread, runId) {
  const finished = String(runId || "");
  const active = String(thread?.runId || "");
  if (finished && active && finished !== active) return false;
  return true;
}

/**
 * 409 means that id was already finished. It is not 「已停止」.
 * Retry when the active id has moved on.
 */
export function stopAfterMiss(thread, postedId) {
  const posted = String(postedId || "");
  const active = String(thread?.runId || "");
  if (active && active !== posted) return { retry: active, stopped: false };
  return { retry: "", stopped: false };
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

/** The session a live run is writing. Empty until a send or `run.started`. */
export function noteRunSession(thread) {
  const id = String(thread?.sessionId || "");
  if (id) thread.liveSessionId = id;
  return thread;
}

/**
 * Keep streaming into the open bot bubble. A steered or queued line sits in
 * the thread without splitting that reply into a second bubble.
 * A finished turn (`live` cleared) starts the next bubble.
 */
export function continueLiveTurn(messages) {
  const list = messages || [];
  const live = [...list].reverse().find((message) => message?.role === "bot" && message.live);
  if (live) return { message: live, created: false };
  const message = { role: "bot", text: "", live: true };
  list.push(message);
  return { message, created: true };
}

export function clearRunSession(thread) {
  if (thread) thread.liveSessionId = "";
  return thread;
}

export function viewingRun(thread) {
  const live = String(thread?.liveSessionId || "");
  return !live || live === String(thread?.sessionId || "");
}

/** Messages the open run should mutate. Another visible session stays untouched. */
export function runTranscript(thread) {
  const live = String(thread?.liveSessionId || "");
  if (!live || live === String(thread?.sessionId || "")) return thread.messages;
  if (!thread.bySession) thread.bySession = new Map();
  let stored = thread.bySession.get(live);
  if (!stored) {
    stored = [];
    thread.bySession.set(live, stored);
  }
  return stored;
}

/** Keep the visible transcript under its session id before showing another one. */
export function rememberView(thread) {
  if (!thread.bySession) thread.bySession = new Map();
  const id = String(thread?.sessionId || "");
  if (id) thread.bySession.set(id, thread.messages);
  return thread;
}

/**
 * Show `sessionId`. The running session keeps its local transcript, including
 * a reply that arrived while another session was on screen.
 */
export function showSession(thread, sessionId, incoming) {
  const next = String(sessionId || "");
  if (!thread.bySession) thread.bySession = new Map();
  const parked = thread.bySession.get(next);
  if (parked && (String(thread.liveSessionId || "") === next || parked.some((message) => message?.live))) {
    thread.messages = parked;
  } else if (parked && parked.length) {
    const { fresh, settled } = catchUpMessages(parked, incoming || []);
    const view = parked.map((message) => ({ ...message }));
    if (settled) {
      const last = [...view].reverse().find((message) => message.live && message.role === "bot");
      if (last) {
        last.text = settled.text;
        last.live = false;
      }
    }
    for (const message of fresh) view.push({ ...message });
    thread.messages = view;
    thread.bySession.set(next, view);
  } else {
    thread.messages = (incoming || []).map((message) => ({ ...message }));
  }
  thread.sessionId = next;
  return thread;
}

/**
 * Session rows the open thread has not shown. Tool rows stay with the stream.
 * A live bot bubble that is a prefix of the stored reply is returned as `settled`
 * so the caller can finish it without appending a second copy.
 */
export function catchUpMessages(existing, incoming) {
  const have = existing || [];
  const seen = new Set(have.map((message) => `${message?.role || ""}\n${message?.text || ""}`));
  const fresh = [];
  let settled = null;
  for (const message of incoming || []) {
    if (!message || (message.role !== "user" && message.role !== "bot" && message.role !== "failure")) continue;
    const text = String(message.text || "");
    if (!text) continue;
    const key = `${message.role}\n${text}`;
    if (seen.has(key)) continue;
    const live = [...have].reverse().find((item) => item?.role === "bot" && item.live && item.text);
    if (message.role === "bot" && live && text.startsWith(String(live.text))) {
      settled = { text };
      seen.add(key);
      continue;
    }
    seen.add(key);
    fresh.push({ role: message.role, text, tool_name: message.tool_name || "" });
  }
  return { fresh, settled };
}

export function previewLine(messages) {
  const last = [...(messages || [])].reverse().find((message) => String(message?.text || "").trim());
  if (!last) return "";
  const line = String(last.text).split(/\r?\n/).map((part) => part.trim()).find(Boolean) || "";
  return line.length > 180 ? `${line.slice(0, 179)}…` : line;
}
