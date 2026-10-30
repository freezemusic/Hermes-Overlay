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

/** Sources Hermes 0.22.5 keeps as a local chat. A bound row reads `local`. */
export function isLocalChatSource(source) {
  const value = String(source || "").trim().toLowerCase();
  return ["local", "cli", "tui", "gui", "desktop", "oneshot", "tool", "acp"].includes(value);
}

/**
 * `session` is this profile's Desktop Bot Chat and the only row titled
 * "Bot Chat" (Hermes' unique title index allows one).
 */
export function isMainBotChat(session, sessions) {
  const titled = (sessions || []).filter((row) => row && isBotChat(row) && sessionRouteMatches(row));
  if (titled.length !== 1) return false;
  const chat = canonicalBotChat(sessions);
  return !!chat && !!session && chat.id === session.id;
}

/**
 * Read-only with the list in hand. Hermes' Bot Chat door takes a send into
 * the Desktop Bot Chat when its source is local. Other rows keep R-SS-08.
 */
export function sessionReadOnlyIn(session, sessions) {
  if (isMainBotChat(session, sessions) && isLocalChatSource(session?.source)) return false;
  return sessionReadOnly(session?.source);
}

/** Hermes reopens its Bot Chat on the next turn, so only other rows are closed for a send. */
export function sessionSendClosed(session, sessions) {
  return sessionEnded(session) && !isMainBotChat(session, sessions);
}

/** Hermes 0.22.5 moves an `api_server` Bot Chat aside on the next Bot Chat turn. */
export function botChatSendDisplaces(session, sessions) {
  const value = String(session?.source || "").trim().toLowerCase();
  return isMainBotChat(session, sessions) && (value === "api_server" || value === "" || value === "bot_peer_dm");
}

export const BOT_CHAT_UNBOUND_LINE = "呢個 Bot Chat 未喺新版 Hermes 開過，伺服器未肯收。喺 Hermes Desktop 開一次呢個 Bot 嘅 Bot Chat，之後就可以喺度傳。";
export const BOT_CHAT_NOT_LOCAL_LINE = "伺服器話呢個 Bot Chat 唔係本機對話，唔肯收。要喺擁有佢嘅 Hermes Desktop 開一次。";

export function botChatRefusalLine(text) {
  const value = String(text || "").toLowerCase();
  if (value.includes("bot_chat_unbound")) return BOT_CHAT_UNBOUND_LINE;
  if (value.includes("bot_chat_not_local")) return BOT_CHAT_NOT_LOCAL_LINE;
  return "";
}

export const SESSION_READ_ONLY_REASON = "呢個 session 係喺 CLI／Desktop 開嘅，只可以睇，唔可以喺呢度傳嘢";

export const CONTINUE_API_LABEL = "喺 API 對話繼續";

export const CONTINUE_API_HINT = "撳下面就可以喺呢個 Bot 嘅 API 對話繼續。";

/**
 * Another session of this bot that the gateway will accept a chat into.
 * A live Bot Chat wins. `avoidId` is the row on screen. `refused` is every
 * session id that already returned permission_denied this app run.
 */
export function writableContinuation(sessions, avoidId = "", refused = []) {
  const skip = new Set(
    [String(avoidId || ""), ...(Array.isArray(refused) ? refused : [])]
      .map((id) => String(id || ""))
      .filter(Boolean),
  );
  const writable = (sessions || []).filter(
    (session) => session && session.id && sessionRouteMatches(session) && !skip.has(session.id) && sessionAcceptsSend(session.source),
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
  const list = (sessions || []).filter(sessionRouteMatches);
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

/** Bot Chat rows first, then every other session. Each group is most-recent first.
 *  A row whose routing key names another session is not offered. */
export function orderSessions(sessions) {
  const list = (sessions || []).filter((session) => session && session.id && sessionRouteMatches(session));
  const chats = list.filter(isBotChat).sort(byRecent);
  const rest = list.filter((session) => !isBotChat(session)).sort(byRecent);
  return chats.concat(rest);
}

/**
 * A quiet reload or roster refresh must not replace a manual pick with the
 * auto-latest row. A non-quiet open may still resolve a missing id.
 */
export function keepManualSession(current, opened, quiet = false) {
  if (!quiet || current?.explicit !== true) return false;
  const id = String(current?.id || "").trim();
  const next = String(opened?.id || opened?.session_id || "").trim();
  return !!id && !!next && id !== next;
}

export function resolveSession(sessions, pin = {}) {
  const remembered = String(pin.id || "").trim();
  const explicit = pin.explicit === true;
  const rawAnchor = Number(pin.anchor);
  const anchor = Number.isFinite(rawAnchor) ? rawAnchor : 0;
  const saved = remembered
    ? (sessions || []).find((session) => session && session.id === remembered && sessionRouteMatches(session))
    : null;
  if (saved && explicit) {
    return {
      id: saved.id,
      explicit: true,
      anchor,
      source: saved.source || "",
      readOnly: sessionReadOnlyIn(saved, sessions),
    };
  }
  const preferred = canonicalBotChat(sessions);
  if (preferred) {
    return {
      id: preferred.id,
      explicit: false,
      anchor: preferred.id === remembered ? anchor : (Number(preferred.last_active) || 0),
      source: preferred.source || "",
      readOnly: sessionReadOnlyIn(preferred, sessions),
    };
  }
  if (saved && !retiredBotChat(saved)) {
    return {
      id: saved.id,
      explicit: false,
      anchor,
      source: saved.source || "",
      readOnly: sessionReadOnlyIn(saved, sessions),
    };
  }
  return null;
}

/** Routing key from a session list row. Empty when the gateway did not send one. */
export function sessionRoutingKey(session) {
  const key = session?.session_key ?? session?.routing_key ?? session?.sessionKey ?? "";
  return String(key || "").trim();
}

/**
 * Offer the row when it has no routing key, the key is its own id, or the
 * key is a route whose last segment is its own id (`agent:…:dm:<id>`).
 * Any other key is the Continue-previous-conversation fork: messages for
 * that key land on a different session, so the row is never offered.
 */
export function sessionRouteMatches(session) {
  const id = String(session?.id || "").trim();
  const key = sessionRoutingKey(session);
  if (!id || !key) return true;
  if (key === id) return true;
  const last = key.split(":").pop();
  return last === id;
}

/** The server closed this row (`ended_at` or `end_reason`, including `tui_shutdown`). */
export function sessionEnded(session) {
  if (!session) return false;
  if (session.ended === true) return true;
  const reason = String(session.end_reason || session.endReason || "").trim();
  if (reason) return true;
  const at = session.ended_at ?? session.endedAt;
  if (typeof at === "number") return at > 0;
  if (typeof at === "string") {
    const text = at.trim();
    return !!text && text !== "0" && text !== "null";
  }
  return false;
}

export const CLOSED_SESSION_LINE = "呢個對話已經喺伺服器關閉，回覆唔會出現喺呢度。";
export const MOVED_SESSION_LINE = "回覆寫入咗另一個對話，已轉過去。";
/** Title Hermes stamps when it recreates a session for a closed chat. */
export const GATEWAY_FORK_TITLE = "Continue previous conversation";

export function isGatewayForkTitle(title) {
  const text = String(title || "").trim();
  return !text || text === GATEWAY_FORK_TITLE;
}

/** Picker text. A followed replacement keeps the closed chat's name. */
export function sessionTitleText(session) {
  const kept = String(session?.kept_title || "").trim();
  const title = String(session?.title || "").trim();
  if (kept && isGatewayForkTitle(title)) return kept;
  return title || session?.id || "";
}

/** Remember a followed session's old name across a later list that still has the gateway title. */
export function stampKeptTitles(sessions, keptTitles) {
  const map = keptTitles || {};
  return (sessions || []).map((session) => {
    if (!session || !session.id) return session;
    const kept = String(map[session.id] || session.kept_title || "").trim();
    if (!kept || session.kept_title === kept) return session;
    return { ...session, kept_title: kept };
  });
}

export function isClosedSendText(text) {
  return String(text || "").includes("已經喺伺服器關閉");
}

/** A live writable chat to open after a closed one. Bot Chat wins. */
export function closedSwitchTarget(sessions, currentId) {
  const current = String(currentId || "");
  const rows = (sessions || []).filter((session) => (
    session
    && session.id
    && sessionRouteMatches(session)
    && session.id !== current
    && !sessionEnded(session)
    && session.archived !== true
    && !sessionReadOnly(session.source)
  ));
  return rows.find(isBotChat) || rows.slice().sort(byRecent)[0] || null;
}

/** Hidden wins, then archived, then a source the gateway will not accept. */
export function sessionLabel(session) {
  return `${sessionTitleText(session)}${sessionSuffix(session)}`;
}

/** Same visible label twice becomes `title · id`, so two rows named notes stay distinct. */
export function disambiguateSessionLabels(rows) {
  const list = rows || [];
  const counts = new Map();
  for (const row of list) {
    const label = row.label;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return list.map((row) => {
    if ((counts.get(row.label) || 0) < 2) return row;
    return { ...row, label: `${row.label} · ${row.id}` };
  });
}

/** Rows the session menu paints. An open chat with an empty list still shows its id.
 *  A routing-key mismatch is never the fallback row. */
export function sessionMenuRows(sessions, activeId) {
  const ordered = orderSessions(sessions);
  if (ordered.length) return ordered;
  const id = String(activeId || "").trim();
  const active = (sessions || []).find((session) => session && session.id === id);
  if (!id || (active && !sessionRouteMatches(active))) return [];
  return [{ id, title: id, hidden: false }];
}

export function sessionMenuKey(activeId, sessions) {
  return JSON.stringify([
    String(activeId || ""),
    sessionMenuRows(sessions, activeId).map((session) => [
      session.id,
      session.title,
      session.kept_title,
      session.hidden,
      session.archived,
      session.source,
      session.ended,
      session.end_reason,
    ]),
  ]);
}

/**
 * Write the latest session labels into a `<select>`.
 * Opening the menu passes `rebuild` and replaces the options.
 * A change while the menu is open updates labels in place and keeps the selected session id.
 */
export function writeSessionMenu(select, sessions, activeId, { rebuild = false, menuOpen = false } = {}) {
  const labels = disambiguateSessionLabels(sessionMenuRows(sessions, activeId).map((session) => ({
    id: String(session.id || ""),
    label: sessionLabel(session),
  })));
  const previous = String(select.value || "");
  const active = String(activeId || "");
  const preferred = menuOpen && labels.some((row) => row.id === previous)
    ? previous
    : (labels.some((row) => row.id === active)
      ? active
      : (labels.some((row) => row.id === previous) ? previous : (labels[0]?.id || "")));
  if (!labels.length) {
    select.replaceChildren();
    const option = select.ownerDocument.createElement("option");
    option.value = "";
    option.textContent = "未有對話";
    select.append(option);
    select.disabled = true;
    select.value = "";
    return "";
  }
  if (rebuild || select.options.length === 0) {
    select.replaceChildren();
    for (const row of labels) {
      const option = select.ownerDocument.createElement("option");
      option.value = row.id;
      option.textContent = row.label;
      select.append(option);
    }
  } else {
    const pool = [...select.options];
    const used = new Set();
    labels.forEach((row, index) => {
      let option = pool.find((item) => item.value === row.id && !used.has(item));
      if (!option) {
        option = select.ownerDocument.createElement("option");
        option.value = row.id;
        select.insertBefore(option, select.options[index] || null);
      } else if (select.options[index] !== option) {
        select.insertBefore(option, select.options[index] || null);
      }
      used.add(option);
      option.value = row.id;
      if (option.textContent !== row.label) option.textContent = row.label;
    });
    for (const option of [...select.options]) {
      if (!used.has(option)) option.remove();
    }
  }
  select.disabled = false;
  if (select.value !== preferred) select.value = preferred;
  return preferred;
}

function sourceWord(source) {
  if (source === "desktop") return "Desktop";
  if (source === "cli") return "CLI";
  if (source === "tui") return "TUI";
  if (source === "oneshot") return "一次性";
  return source;
}

/** `MT5 wrapper (CLI)` already names the source. The suffix stays 「只可以睇」. */
function titleEndsWithSource(title, name) {
  const tail = String(title || "").trim();
  if (!tail || !name) return false;
  const folded = tail.toLowerCase();
  return folded.endsWith(`(${name.toLowerCase()})`) || folded.endsWith(`（${name.toLowerCase()}）`);
}

function sessionSuffix(session) {
  const closed = sessionEnded(session) ? "（已結束）" : "";
  if (session?.hidden) return closed ? "（隱藏／已結束）" : "（隱藏）";
  if (session?.archived === true) return `（已封存）${closed}`;
  const source = String(session?.source || "").trim().toLowerCase();
  if (!source || sessionAcceptsSend(source)) return closed;
  const name = sourceWord(source);
  if (titleEndsWithSource(session?.title, name)) return `（只可以睇）${closed}`;
  return `（${name}／只可以睇）${closed}`;
}

/** The read-only reason and the continue hint are two sentences. */
export function readOnlyNote(reason = SESSION_READ_ONLY_REASON) {
  const line = String(reason || SESSION_READ_ONLY_REASON).replace(/。+$/u, "");
  return `${line}。${CONTINUE_API_HINT}`;
}

/**
 * The open panel the error banner follows. A focused panel that is still open
 * wins. With no focus, the front panel (highest z) owns it — not every open panel.
 */
export function bannerOwner(activeId, panels) {
  const open = (panels || []).filter((panel) => panel && panel.open && !panel.collapsing && panel.id);
  const focus = String(activeId || "");
  if (focus && open.some((panel) => panel.id === focus)) return focus;
  let best = "";
  let bestZ = -Infinity;
  for (const panel of open) {
    const z = Number.isFinite(panel.z) ? panel.z : 0;
    if (z >= bestZ) {
      bestZ = z;
      best = panel.id;
    }
  }
  return best;
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

export function refusedSessionIds(set, profile) {
  const prefix = `${profile}:`;
  const ids = [];
  if (!set || !profile) return ids;
  for (const key of set) {
    const value = String(key || "");
    if (value.startsWith(prefix)) ids.push(value.slice(prefix.length));
  }
  return ids;
}

export const UNSENT_MARK = "未送出";

/** The latest typed line was refused. Replace that object so the bubble repaints. */
export function markUnsentDraft(messages) {
  const list = messages || [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    if (message?.role !== "user" || !String(message.text || "").trim()) continue;
    if (!message.unsent) list[index] = { ...message, unsent: true };
    return String(list[index].text);
  }
  return "";
}

/** History from the gateway does not contain a refused send. Put the line back.
 *  The same user text without the mark still needs the mark, not a second bubble. */
export function mergeUnsentDraft(messages, text) {
  const line = String(text || "");
  const list = messages || [];
  if (!line) return list;
  const index = list.findIndex((message) => message?.role === "user" && message.text === line);
  if (index >= 0) {
    if (list[index].unsent) return list;
    const next = list.slice();
    next[index] = { ...list[index], unsent: true };
    return next;
  }
  return list.concat([{ role: "user", text: line, unsent: true }]);
}

export function rememberUnsent(store, profile, sessionId, text) {
  const key = deniedKey(profile, sessionId);
  const line = String(text || "");
  if (!key || !store) return store;
  if (!line) {
    store.delete(key);
    return store;
  }
  store.set(key, line);
  return store;
}

/** The error that belongs with an unsent send. Empty clears it. */
export function rememberSendError(store, profile, sessionId, text, meta = {}) {
  const key = deniedKey(profile, sessionId);
  const line = String(text || "");
  if (!key || !store) return store;
  if (!line) {
    store.delete(key);
    return store;
  }
  store.set(key, {
    text: line,
    kind: String(meta.kind || ""),
    switchId: String(meta.switchId || ""),
  });
  return store;
}

function storedSendError(store, profile, sessionId) {
  const key = deniedKey(profile, sessionId);
  const raw = key && store ? store.get(key) : null;
  if (!raw) return { text: "", kind: "", switchId: "" };
  if (typeof raw === "string") return { text: raw, kind: "", switchId: "" };
  return {
    text: String(raw.text || ""),
    kind: String(raw.kind || ""),
    switchId: String(raw.switchId || ""),
  };
}

export function sendErrorDraft(store, profile, sessionId) {
  return storedSendError(store, profile, sessionId).text;
}

export function sendErrorKind(store, profile, sessionId) {
  return storedSendError(store, profile, sessionId).kind;
}

/** HTTP 409 busy / other is a refusal. The gateway is still connected. */
export function sendErrorKeepsConnected(kind) {
  return kind === "busy" || kind === "other";
}

export function sendErrorSwitch(store, profile, sessionId) {
  return storedSendError(store, profile, sessionId).switchId;
}

/** Put the send error back under the thread. The same text is not added twice. */
export function mergeSendError(messages, error) {
  const line = String(error || "");
  const list = messages || [];
  if (!line) return list;
  if (list.some((message) => (
    message?.text === line && (message.role === "commentary" || message.role === "failure")
  ))) {
    return list;
  }
  return list.concat([{ role: "commentary", text: line }]);
}

export function unsentDraft(store, profile, sessionId) {
  const key = deniedKey(profile, sessionId);
  if (!key || !store) return "";
  return String(store.get(key) || "");
}

/**
 * The typed line of a send that has not returned. A history reload during
 * that wait must paint this line. It is not 未送出 until the send fails.
 */
export function mergePendingSend(messages, text) {
  const line = String(text || "");
  const list = messages || [];
  if (!line) return list;
  if (list.some((message) => message?.role === "user" && message.text === line)) return list;
  return list.concat([{ role: "user", text: line }]);
}

export function rememberPendingSend(store, profile, sessionId, text) {
  if (!profile || !store) return store;
  const line = String(text || "");
  const key = `${profile}:${String(sessionId || "*")}`;
  if (!line) {
    store.delete(key);
    store.delete(`${profile}:*`);
    if (sessionId) store.delete(`${profile}:${sessionId}`);
    return store;
  }
  store.set(key, line);
  if (sessionId) store.delete(`${profile}:*`);
  return store;
}

export function pendingSend(store, profile, sessionId) {
  if (!profile || !store) return "";
  const id = String(sessionId || "");
  if (id) {
    const exact = store.get(`${profile}:${id}`);
    if (exact) return String(exact);
  }
  return String(store.get(`${profile}:*`) || "");
}

export function readOnlyLocked(set, profile, sessionId, sourceReadOnly) {
  const key = deniedKey(profile, sessionId);
  return !!sourceReadOnly || (!!key && !!set?.has(key));
}

/**
 * The run that is streaming tokens. A later admission that is still queued
 * keeps its own id and does not become the stop target.
 */
export function noteRunStarted(thread, runId, { queued = false } = {}) {
  const incoming = String(runId || "");
  if (!thread || !incoming) return thread;
  if (queued && thread.runId && thread.runId !== incoming) {
    thread.queuedRunId = incoming;
    return thread;
  }
  if (thread.runId && thread.runId !== incoming) thread.staleRunId = thread.runId;
  thread.runId = incoming;
  thread.queuedRunId = thread.queuedRunId === incoming ? "" : (thread.queuedRunId || "");
  thread.nextRunId = "";
  return thread;
}

/** 「停止」 posts the streaming run. The queued admission is left alone. */
export function streamingRunId(thread) {
  return String(thread?.runId || "");
}

/**
 * The streaming run ended. Its queued admission becomes the active run.
 * A finish that is only the queued id leaves the streaming run in place
 * and returns "".
 */
export function promoteQueuedRun(thread, finishedId) {
  if (!thread) return "";
  const finished = String(finishedId || "");
  const active = String(thread.runId || "");
  const queued = String(thread.queuedRunId || "");
  if (finished && queued && finished === queued && finished !== active) {
    thread.queuedRunId = "";
    return "";
  }
  if (queued && (!finished || !active || finished === active)) {
    thread.staleRunId = active;
    thread.runId = queued;
    thread.queuedRunId = "";
    thread.queued = false;
    return queued;
  }
  return "";
}

/** A finish for some other run must not idle the bot or drop the active id. */
export function finishApplies(thread, runId) {
  const finished = String(runId || "");
  const active = String(thread?.runId || "");
  const queued = String(thread?.queuedRunId || "");
  if (finished && active && finished !== active && finished !== queued) return false;
  return true;
}

/**
 * Drop a second copy of a reply inside one run.
 * The same words in a later run stay. A row with no run id is a stored turn
 * and is never removed.
 */
export function dedupeShownReply(messages) {
  const list = messages || [];
  const seen = new Map();
  for (let index = 0; index < list.length; index += 1) {
    const message = list[index];
    if (!message || message.role !== "bot") continue;
    const runId = String(message.runId || "");
    if (!runId) continue;
    const text = String(message.text || "").trim();
    if (!text) continue;
    let bucket = seen.get(runId);
    if (!bucket) {
      bucket = new Set();
      seen.set(runId, bucket);
    }
    if (bucket.has(text)) {
      list.splice(index, 1);
      index -= 1;
      continue;
    }
    bucket.add(text);
  }
  return list;
}

function isSideMessage(message) {
  return !!(
    message?.side
    || message?.command === "btw"
    || /^\/btw\b/i.test(String(message?.text || ""))
  );
}

function sideQuestionIndex(list) {
  return (list || []).findIndex((message) => message?.role === "user" && isSideMessage(message));
}

function isAnchorRow(message) {
  if (!message || isSideMessage(message)) return false;
  const role = message.role;
  return role === "user" || role === "bot" || role === "tool" || role === "tool-run" || role === "failure";
}

/**
 * The main row a /btw followed. A reply that is still streaming is not a
 * stable anchor: the pair follows the user message of that turn, and
 * `afterAnchor` waits until the reply is in the list.
 */
export function sideAnchor(messages) {
  return settledAnchor((messages || []).filter(isAnchorRow));
}

function settledAnchor(mains) {
  if (!mains.length) return null;
  let at = mains.length - 1;
  const last = mains[at];
  if (last?.role === "bot" && last.live) {
    for (let i = at - 1; i >= 0; i -= 1) {
      if (mains[i]?.role === "user") {
        at = i;
        break;
      }
    }
  }
  const message = mains[at];
  return {
    index: at,
    role: message.role || "",
    text: String(message.text || ""),
    user: anchorUser(mains, at),
  };
}

function anchorUser(mains, at) {
  const message = mains[at];
  if (message?.role === "user") return String(message.text || "");
  for (let i = at - 1; i >= 0; i -= 1) {
    if (mains[i]?.role === "user") return String(mains[i].text || "");
  }
  return "";
}

/** A stored anchor that still points at a streaming reply moves to that turn's user message. */
function releaseStreamingAnchor(mains, anchor) {
  if (!anchor || anchor.role !== "bot") return anchor;
  const want = String(anchor.text || "");
  const recorded = Number(anchor.index);
  const target = Number.isInteger(recorded) ? recorded : mains.length - 1;
  let liveAt = -1;
  let liveDist = Infinity;
  let settledDist = Infinity;
  for (let i = 0; i < mains.length; i += 1) {
    const message = mains[i];
    if (message?.role !== "bot" || String(message.text || "") !== want) continue;
    const dist = Math.abs(i - target);
    if (message.live) {
      if (dist < liveDist || (dist === liveDist && i > liveAt)) {
        liveAt = i;
        liveDist = dist;
      }
    } else if (dist < settledDist) settledDist = dist;
  }
  if (liveAt < 0 || settledDist <= liveDist) return anchor;
  for (let i = liveAt - 1; i >= 0; i -= 1) {
    if (mains[i]?.role === "user") {
      return { index: i, role: "user", text: String(mains[i].text || ""), user: String(mains[i].text || "") };
    }
  }
  return anchor;
}

/** The local /btw question and its answer. The main turn stays with the server list. */
function sideTurnMessages(list) {
  const messages = list || [];
  const turns = [];
  let index = 0;
  while (index < messages.length) {
    const message = messages[index];
    if (!(message?.role === "user" && isSideMessage(message))) {
      index += 1;
      continue;
    }
    turns.push(message);
    index += 1;
    while (index < messages.length) {
      const next = messages[index];
      if (next?.role === "user" && !isSideMessage(next)) break;
      turns.push(next);
      index += 1;
      if (next?.role === "bot") break;
    }
  }
  return turns;
}

function mainQuestionBefore(list, sideAt) {
  return (list || []).findIndex((message, index) => (
    index < sideAt
    && message?.role === "user"
    && message.command !== "btw"
    && !/^\/btw\b/i.test(String(message?.text || ""))
  ));
}

function textsRelate(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a === b) return true;
  if (!a || !b) return false;
  return a.startsWith(b) || b.startsWith(a);
}

function sidePairs(list) {
  const messages = list || [];
  const pairs = [];
  const mains = [];
  let index = 0;
  while (index < messages.length) {
    const message = messages[index];
    if (message?.role === "user" && isSideMessage(message)) {
      const turn = [message];
      index += 1;
      while (index < messages.length) {
        const next = messages[index];
        if (next?.role === "user" && !isSideMessage(next)) break;
        turn.push(next);
        index += 1;
        if (next?.role === "bot") break;
      }
      const recorded = message.anchor;
      const stored = recorded && Number.isInteger(Number(recorded.index))
        ? {
          index: Number(recorded.index),
          role: recorded.role || "",
          text: String(recorded.text || ""),
          user: String(recorded.user || ""),
        }
        : null;
      const anchor = stored ? releaseStreamingAnchor(mains, stored) : settledAnchor(mains);
      pairs.push({ messages: turn, anchor });
      continue;
    }
    if (isAnchorRow(message)) mains.push(message);
    index += 1;
  }
  return pairs;
}

function relationRank(message, anchor) {
  if (!message || !anchor) return 0;
  if (anchor.role && message.role !== anchor.role) return 0;
  const text = String(message.text || "");
  const want = String(anchor.text || "");
  if (text === want) return 2;
  if (textsRelate(text, want)) return 1;
  return 0;
}

/**
 * Exact text wins over a shared prefix. Among those, the row closest to the
 * recorded index wins, so a cancelled turn the server dropped does not leave
 * the pair on the first earlier prefix. A tie keeps the later row.
 */
function turnUserText(main, index) {
  for (let i = index; i >= 0; i -= 1) {
    if (main[i]?.role === "user" && !isSideMessage(main[i])) return String(main[i].text || "");
  }
  return "";
}

function locateAnchor(main, anchor) {
  if (!anchor || !main?.length) return -1;
  const role = anchor.role || "";
  const want = String(anchor.text || "");
  const user = String(anchor.user || "");
  let hits = [];
  for (let i = 0; i < main.length; i += 1) {
    const message = main[i];
    if (!message) continue;
    if (role && message.role !== role) continue;
    const text = String(message.text || "");
    if (text === want) hits.push({ index: i, exact: true });
    else if (textsRelate(text, want)) hits.push({ index: i, exact: false });
  }
  if (user) hits = hits.filter((hit) => turnUserText(main, hit.index) === user);
  if (!hits.length) return -1;
  const exact = hits.filter((hit) => hit.exact);
  const pool = exact.length ? exact : hits;
  const recorded = Number(anchor.index);
  const target = Number.isInteger(recorded) ? recorded : main.length - 1;
  let best = pool[0];
  for (const hit of pool) {
    const dist = Math.abs(hit.index - target);
    const bestDist = Math.abs(best.index - target);
    if (dist < bestDist || (dist === bestDist && hit.index > best.index)) best = hit;
  }
  return best.index;
}

function retargetAnchor(pair, main, located) {
  const head = pair.messages?.[0];
  const anchor = pair.anchor;
  if (!head || !anchor || located < 0) return;
  const row = main[located];
  const locatedRank = relationRank(row, anchor);
  if (!locatedRank) return;
  const recorded = Number(anchor.index);
  const recordedRank = Number.isInteger(recorded) ? relationRank(main[recorded], anchor) : 0;
  if (locatedRank < recordedRank) return;
  if (locatedRank === recordedRank && recorded === located) return;
  const next = {
    index: located,
    role: row.role || "",
    text: locatedRank >= 2 ? String(row.text || "") : String(anchor.text || ""),
    user: String(anchor.user || turnUserText(main, located)),
  };
  head.anchor = next;
  pair.anchor = next;
}

/** A user anchor waits for that turn's reply. A bot anchor is the reply. */
function afterAnchor(main, index) {
  if (index < 0) return -1;
  const message = main[index];
  if (!message) return -1;
  if (message.role !== "user") return index;
  let end = index;
  for (let i = index + 1; i < main.length; i += 1) {
    if (main[i]?.role === "user") break;
    end = i;
  }
  return end;
}

function placeSidePairs(main, pairs) {
  const slots = main.map(() => []);
  const head = [];
  for (const pair of pairs) {
    if (!pair.anchor) {
      head.push(pair);
      continue;
    }
    const located = locateAnchor(main, pair.anchor);
    retargetAnchor(pair, main, located);
    const after = afterAnchor(main, located);
    if (after < 0) continue;
    slots[after].push(pair);
  }
  const out = [];
  for (const pair of head) out.push(...pair.messages);
  for (let i = 0; i < main.length; i += 1) {
    out.push(main[i]);
    for (const pair of slots[i]) out.push(...pair.messages);
  }
  return out;
}

/**
 * Hermes gateway `/btw` does not write the side exchange into the session.
 * A runs-API `/btw` is stored with the main turn, after the main question.
 * Keep the live order in that case. A server transcript that places the
 * side question before the main question is the stored order.
 * A different session id shows that session alone. Each side pair is put
 * back after the main reply it followed. A streaming reply anchors to that
 * turn's user message. A pair with no anchor stays at the top. A recorded
 * anchor that is gone is dropped. A better match replaces a stale anchor.
 */
export function reconcileSideQuestion(local, incoming, sessionId, nextSessionId, options = {}) {
  const have = local || [];
  const next = incoming || [];
  const current = String(sessionId || "");
  const opened = nextSessionId === undefined ? current : String(nextSessionId || "");
  if (current && opened && current !== opened) return next.slice();
  const pairs = sidePairs(have);
  if (!pairs.length) return next.slice();
  const serverAt = sideQuestionIndex(next);
  if (serverAt >= 0 && mainQuestionBefore(next, serverAt) < 0) return next.slice();
  const storedSide = sideTurnMessages(next);
  const serverMain = next.filter((message) => !storedSide.includes(message));
  const localMain = have.filter((message) => isAnchorRow(message));
  const main = serverMain.length
    ? (options.trustServer ? serverMain.map((message) => ({ ...message })) : growMainReply(serverMain, localMain))
    : localMain;
  return placeSidePairs(main, pairs);
}

function growMainReply(serverMain, localMain) {
  const out = serverMain.map((message) => ({ ...message }));
  const localBot = [...localMain].reverse().find((message) => message?.role === "bot" && message.text);
  const serverBot = [...out].reverse().find((message) => message?.role === "bot" && message.text);
  if (!localBot || !serverBot) return out;
  const localText = String(localBot.text);
  const serverText = String(serverBot.text);
  if (localText.startsWith(serverText) && localText !== serverText) serverBot.text = localText;
  return out;
}

/** A refused send is idle. An in-flight run id is still busy. */
export function idleAfterConflict(runId) {
  return !String(runId || "");
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
function toolCallIds(message) {
  if (!message) return [];
  if (message.role === "tool") return [message.tool_call_id || ""].filter(Boolean);
  if (message.role === "tool-run") {
    return (message.tools || []).map((tool) => tool?.tool_call_id || "").filter(Boolean);
  }
  return [];
}

function sameOrGrowth(have, next) {
  const role = have?.role || "";
  if (role !== (next?.role || "")) return null;
  const haveIds = toolCallIds(have);
  const nextIds = toolCallIds(next);
  if (haveIds.length && nextIds.length && haveIds.join("\n") !== nextIds.join("\n")) return null;
  const sofar = String(have?.text || "");
  const text = String(next?.text || "");
  if (sofar === text) return { grew: false };
  if (role === "bot" && have?.live && sofar && text.startsWith(sofar)) return { grew: true, text };
  return null;
}

function isLocalChrome(message) {
  const role = message?.role;
  return role === "approval" || role === "clarify" || role === "commentary" || role === "notice";
}

function cardStillOpen(message) {
  if (message?.role === "approval") return message.status === "pending" || message.status === "sending";
  if (message?.role === "clarify") return ["pending", "sending", "timeout"].includes(message.status);
  return false;
}

/** A refresh that started before stop, or lands while stop is in flight, stays append-only. */
export function stopCatchUpMode(requested = {}, generation = {}) {
  const stopWon = !!requested.stopping
    || !!generation.stopping
    || (generation.serialNow || 0) !== (generation.serialAtStart || 0);
  if (stopWon) return { append: true, stopped: true };
  return { append: !!requested.append, stopped: !!requested.stopped };
}

/** Shown rows and the server transcript disagree, so a reopen must take the server list. */
export function historyCountMismatch(shown, serverMessages, messageCount) {
  const content = (rows) => (rows || []).filter((message) => message && !isLocalChrome(message) && !isSideMessage(message));
  const local = content(shown);
  const remote = content(serverMessages);
  if (local.length !== remote.length) return true;
  for (let index = 0; index < local.length; index += 1) {
    if ((local[index]?.role || "") !== (remote[index]?.role || "")) return true;
    if ((local[index]?.text || "") !== (remote[index]?.text || "")) return true;
  }
  const raw = Number(messageCount);
  if (Number.isFinite(raw) && raw >= 0 && raw < local.length) return true;
  return false;
}

/** Milliseconds until the countdown label changes, aligned to the next minute of time left. */
export function noticeTickDelay(message, nowMs = Date.now()) {
  let payload = {};
  try {
    payload = JSON.parse(String(message?.text || ""));
  } catch {
    payload = {};
  }
  const timeout = Number(payload.timeout_s);
  const asked = Number(payload.asked_at);
  if (!(timeout > 0) || !(asked > 0)) return 15000;
  const left = timeout - (nowMs / 1000 - asked);
  if (!(left > 0)) return 60000;
  const into = left % 60;
  const delayS = into < 0.5 ? 60 : into;
  return Math.max(1000, Math.round(delayS * 1000));
}
export function historyNoticeCopy(message, botName, nowMs = Date.now()) {
  let payload = {};
  try {
    payload = JSON.parse(String(message?.text || ""));
  } catch {
    payload = { text: message?.text || "" };
  }
  const kind = message?.tool_name === "approval" ? "approval" : "clarify";
  const subject = String(payload.text || "").trim() || (kind === "approval" ? "一個指令" : "一條問題");
  const who = String(botName || "").trim() || "呢個 bot";
  const verb = kind === "approval" ? "等緊你批准" : "等緊你答";
  const timeout = Number(payload.timeout_s);
  const asked = Number(payload.asked_at);
  let remain = "";
  if (Number.isFinite(timeout) && timeout > 0 && Number.isFinite(asked) && asked > 0) {
    const left = Math.ceil(timeout - (nowMs / 1000 - asked));
    remain = left > 0 ? `大約 ${Math.max(1, Math.ceil(left / 60))} 分鐘後逾時。` : "逾時時間已過，等歷史更新。";
  } else if (Number.isFinite(timeout) && timeout > 0) {
    remain = `大約 ${Math.max(1, Math.ceil(timeout / 60))} 分鐘後逾時。`;
  }
  return {
    kind,
    title: `${who} ${verb}：${subject}`,
    detail: `呢度答唔到。${remain}`.trim(),
  };
}

export function historyNoticePending(message) {
  return message?.role === "notice" && (message.tool_name === "clarify" || message.tool_name === "approval");
}

export function historyNoticeId(message) {
  if (message?.tool_call_id) return String(message.tool_call_id);
  try {
    return String(JSON.parse(String(message?.text || "")).tool_call_id || "");
  } catch {
    return "";
  }
}

function resultCallIds(message) {
  return toolCallIds(message);
}

/** A clarify result retires only the notice with the same tool_call_id. */
export function dropSettledHistoryNotices(messages) {
  const list = messages || [];
  const drop = new Set();
  for (let index = 0; index < list.length; index += 1) {
    for (const id of resultCallIds(list[index])) {
      for (let earlier = index - 1; earlier >= 0; earlier -= 1) {
        if (list[earlier]?.role === "notice" && historyNoticeId(list[earlier]) === id) {
          drop.add(earlier);
          break;
        }
      }
    }
  }
  if (!drop.size) return list;
  return list.filter((_, index) => !drop.has(index));
}

/** Commentary and answered cards leave with a server refresh. An open card stays. */
export function dropSettledLocalRows(messages) {
  return (messages || []).filter((message) => {
    if (!message) return false;
    if (message.keptLocal) return true;
    if (message.role === "commentary") return false;
    if (message.role === "approval" || message.role === "clarify") return cardStillOpen(message);
    return true;
  });
}

/** The cancelled turn stays on screen until the server stores that user line. */
export function markStoppedTurn(messages) {
  const list = messages || [];
  let botIndex = -1;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    if (message?.role === "bot" && !isSideMessage(message)) {
      botIndex = index;
      break;
    }
  }
  let start = -1;
  if (botIndex >= 0) {
    start = botIndex;
    for (let index = botIndex - 1; index >= 0; index -= 1) {
      const message = list[index];
      if (message?.role === "user" && !isSideMessage(message)) {
        start = index;
        break;
      }
    }
  } else {
    const split = splitBeforeLiveTurn(list);
    start = list.length - split.turn.length;
  }
  if (start < 0) return messages;
  for (let index = start; index < list.length; index += 1) {
    const message = list[index];
    if (!message || isSideMessage(message)) continue;
    message.keptLocal = true;
  }
  return messages;
}

export function releaseStoppedTurn(messages) {
  for (const message of messages || []) {
    if (message?.keptLocal) delete message.keptLocal;
  }
  return messages;
}

/** The next send retires a kept cancelled turn. It leaves once that turn settles. */
export function retireStoppedTurn(messages) {
  let retired = false;
  for (const message of messages || []) {
    if (!message?.keptLocal) continue;
    message.dropAfterTurn = true;
    delete message.keptLocal;
    retired = true;
  }
  return retired;
}

export function dropRetiredTurn(messages) {
  return (messages || []).filter((message) => !message?.dropAfterTurn);
}

/** A stored copy of a kept user replaces that row. The rest of the flag comes off with it. */
function settleKeptUser(prior, incoming) {
  const next = prior.slice();
  const replaced = new Set();
  for (const row of incoming || []) {
    if (row?.role !== "user" || !String(row.text || "").trim()) continue;
    const index = next.findIndex((message) => message?.keptLocal && message.role === "user" && message.text === row.text);
    if (index < 0) continue;
    replaced.add(row.text);
    next[index] = { ...row };
  }
  if (replaced.size) {
    for (const message of next) {
      if (message?.keptLocal) delete message.keptLocal;
    }
  }
  return { next, replaced };
}

export function keepStoppedRows(previous, next) {
  const kept = (previous || []).filter((message) => message?.keptLocal);
  const server = next || [];
  if (!kept.length) return server;
  const user = kept.find((message) => message.role === "user" && String(message.text || "").trim());
  const stored = !!user && server.some((message) => message?.role === "user" && message.text === user.text);
  if (stored) {
    releaseStoppedTurn(kept);
    return server;
  }
  const out = server.slice();
  for (const row of kept) {
    const present = out.some((message) => message === row
      || (message?.role === row.role && message?.text === row.text && !!message?.keptLocal === true));
    if (!present) out.push(row);
  }
  return out;
}

function attachOpenCards(previous, next) {
  const out = (next || []).slice();
  for (const card of previous || []) {
    if (!cardStillOpen(card)) continue;
    const same = out.some((message) => {
      if (card.role === "approval") return message.role === "approval" && message.requestId === card.requestId;
      if (card.role === "clarify") return message.role === "clarify" && message.promptId === card.promptId;
      return false;
    });
    if (!same) out.push(card);
  }
  return out;
}

/**
 * S20: the watcher can read our own user line after the run ended but before
 * the reply row is stored. Hold that tail like a live one, so the reply that
 * follows replaces the turn instead of both rows being appended.
 */
export function holdsOwnTurnUser(incoming, ownTurn) {
  const userText = String(ownTurn?.userText || "").trim();
  if (!ownTurn?.awaitTail || !userText) return false;
  const rows = (incoming || []).filter((message) => message && message.role);
  if (!rows.length || rows.some((message) => message.role !== "user" || isSideMessage(message))) return false;
  return rows.some((message) => String(message.text || "").trim() === userText);
}

/**
 * Rows from the bot-chat watcher while this run is still streaming.
 * `server` is a full transcript (a reset). `tails` are suffixes in arrival order.
 */
export function holdWatchedTail(held, incoming, { reset = false } = {}) {
  const rows = (incoming || []).filter((message) => message && message.role);
  if (reset) return { server: rows.slice(), tails: [] };
  if (held?.server) {
    const { fresh } = unseenMessages(held.server, rows);
    return { server: held.server.concat(fresh), tails: [] };
  }
  return { server: null, tails: (held?.tails || []).concat(rows) };
}

function splitBeforeLiveTurn(messages) {
  const list = messages || [];
  let start = -1;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    if (message?.role === "user" && !isSideMessage(message)) {
      start = index;
      break;
    }
  }
  if (start < 0) return { prefix: list.slice(), turn: [] };
  return { prefix: list.slice(0, start), turn: list.slice(start) };
}

function rowKey(message) {
  return `${message?.role || ""}\n${String(message?.text || "")}`;
}

function isToolRow(message) {
  return message?.role === "tool" || message?.role === "tool-run";
}

/** The watched rows replace the live turn. A reply the server has not stored yet stays. */
export function releaseHeldWatch(view, held) {
  const prior = view || [];
  if (held?.server) return finishWatchedRows(prior, held.server, true);
  const tails = held?.tails || [];
  if (!tails.length) return prior;
  const { prefix, turn } = splitBeforeLiveTurn(prior);
  const serverHasReply = tails.some((message) => message.role === "bot" || message.role === "failure");
  let body;
  if (serverHasReply) {
    const tools = turn.filter(isToolRow);
    const tailHasTool = tails.some(isToolRow);
    if (tools.length && !tailHasTool) {
      const lastBot = tails.findLastIndex((message) => message.role === "bot" || message.role === "failure");
      body = lastBot < 0 ? tails.concat(tools) : tails.slice(0, lastBot).concat(tools, tails.slice(lastBot));
    } else {
      body = tails;
    }
  } else {
    const seen = new Set(turn.map(rowKey));
    const extra = tails.filter((message) => !seen.has(rowKey(message)));
    const local = turn.filter((message) => message && !isLocalChrome(message) && !isSideMessage(message)).map((message) => (
      message.live ? { ...message, live: false } : message
    )).filter((message) => message.role !== "bot" || String(message.text || "").trim());
    body = extra.concat(local);
  }
  return finishWatchedRows(prior, prefix.concat(body), true);
}

function sharesTurnText(localBots, serverBots) {
  for (const local of localBots) {
    const text = String(local || "").trim();
    if (text.length < 8) continue;
    for (const server of serverBots) {
      const stored = String(server || "").trim();
      if (!stored) continue;
      if (stored === text || stored.startsWith(text) || text.startsWith(stored) || stored.includes(text)) return true;
    }
  }
  return false;
}

/**
 * A just-finished clarify turn can be two local bot bubbles and one server row,
 * or assistant + tool + assistant. Only the run that just ended may replace,
 * and only when this tail contains that user line, or has no foreign user in front.
 */
function replaceOwnTurn(prior, incoming, ownTurn) {
  const userText = String(ownTurn?.userText || "").trim();
  if (!userText) return null;
  const list = prior || [];
  let userIndex = -1;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    if (message?.role === "user" && !isSideMessage(message) && String(message.text || "").trim() === userText) {
      userIndex = index;
      break;
    }
  }
  if (userIndex < 0) return null;
  const user = list[userIndex];
  const span = list.slice(userIndex);
  const localBots = span.filter((message) => message?.role === "bot" && !isSideMessage(message)).map((message) => String(message.text || ""));
  if (!localBots.length) return null;
  const rows = (incoming || []).filter((message) => message && message.role);
  const tailUser = rows.findIndex((message) => message.role === "user" && String(message.text || "").trim() === userText);
  if (tailUser < 0 && rows.some((message) => message.role === "user")) return null;
  if (tailUser < 0 && !rows.some(isToolRow)) return null;
  const serverTurn = tailUser >= 0 ? rows.slice(tailUser) : rows;
  const serverBots = serverTurn.filter((message) => message.role === "bot" || message.role === "failure").map((message) => String(message.text || ""));
  if (!sharesTurnText(localBots, serverBots)) return null;
  if (!serverBots.length && !serverTurn.some(isToolRow)) return null;
  const prefix = list.slice(0, userIndex);
  const lead = tailUser > 0 ? rows.slice(0, tailUser) : [];
  const leadFresh = unseenMessages(prefix, lead).fresh;
  const head = tailUser >= 0 ? [] : [user];
  const kept = span.filter((message) => {
    if (!message || message === user) return false;
    if (message.role === "notice") return true;
    if (message.role === "commentary" && message.keptLocal) return true;
    return cardStillOpen(message);
  });
  const body = prefix.concat(leadFresh, head, serverTurn.map((message) => (
    message?.role === "tool-run"
      ? { ...message, tools: (message.tools || []).map((tool) => ({ ...tool })) }
      : { ...message }
  )));
  const placed = reconcileSideQuestion(list, body);
  const extras = kept.filter((message) => !placed.includes(message));
  return placed.concat(extras);
}
export function finishWatchedRows(previous, incoming, reset = false, options = {}) {
  const prior = previous || [];
  const rows = incoming || [];
  let next;
  if (reset) {
    next = reconcileSideQuestion(prior, rows, "", undefined, { trustServer: !!options.trustServer });
  } else {
    const settled = settleKeptUser(prior, rows);
    const seen = unseenMessages(settled.next, rows);
    const incomingRows = rows.filter((message) => message && message.role);
    const noOverlap = incomingRows.length > 0 && seen.fresh.length === incomingRows.length;
    const replaced = noOverlap && options.ownTurn ? replaceOwnTurn(settled.next, rows, options.ownTurn) : null;
    const fresh = seen.fresh.filter((row) => !(row?.role === "user" && settled.replaced.has(row.text)));
    next = replaced || settled.next.concat(fresh);
  }
  const cleaned = dropSettledHistoryNotices(dropSettledLocalRows(next));
  const withKept = keepStoppedRows(prior, cleaned);
  return reset ? attachOpenCards(prior, withKept) : withKept;
}

export function unseenMessages(existing, incoming) {
  const have = (existing || []).filter((message) => message && !isSideMessage(message) && !isLocalChrome(message));
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
    fresh: next.slice(matched).map((message) => {
      if (message.role === "tool-run") {
        return {
          ...message,
          tools: (message.tools || []).map((tool) => ({ ...tool })),
        };
      }
      return {
        role: message.role,
        text: String(message.text || ""),
        tool_name: message.tool_name || "",
        tool_call_id: message.tool_call_id || "",
      };
    }),
    settled,
  };
}

/** The session a live run is writing. Empty until a send or `run.started`. */
export function noteRunSession(thread) {
  const id = String(thread?.sessionId || "");
  if (id) thread.liveSessionId = id;
  return thread;
}

/** Tool fold, approval card, or clarify card. Commentary and a steered line do not. */
export function interruptsLiveRow(message) {
  const role = message?.role;
  return role === "tool" || role === "tool-run" || role === "approval" || role === "clarify";
}

/**
 * The open bot bubble is finished. Plan detection can see it.
 * An empty live bubble is dropped. Returns the finished message, or null.
 */
export function finishLiveBubble(messages) {
  const list = messages || [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    if (!message || message.role !== "bot" || !message.live || message.side) continue;
    if (!String(message.text || "").trim()) {
      list.splice(index, 1);
      return null;
    }
    message.live = false;
    return message;
  }
  return null;
}

/**
 * Keep streaming into the open bot bubble. A steered or queued line sits in
 * the thread without splitting that reply into a second bubble.
 * A tool row, approval card, or clarify card after the bubble ends it, and
 * the next text starts a new bubble below that row.
 */
export function continueLiveTurn(messages) {
  const list = messages || [];
  let liveIndex = -1;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (list[index]?.role === "bot" && list[index].live && !list[index].side) {
      liveIndex = index;
      break;
    }
  }
  if (liveIndex >= 0 && !list.slice(liveIndex + 1).some(interruptsLiveRow)) {
    return { message: list[liveIndex], created: false, finished: null };
  }
  const finished = liveIndex >= 0 ? finishLiveBubble(list) : null;
  const message = { role: "bot", text: "", live: true };
  list.push(message);
  return { message, created: true, finished };
}

/** A /btw answer while the main turn is live. It does not finish that turn. */
export function continueSideTurn(messages) {
  const list = messages || [];
  const live = [...list].reverse().find((message) => message?.role === "bot" && message.live && message.side);
  if (live) return { message: live, created: false };
  const message = { role: "bot", text: "", live: true, side: true };
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
/**
 * Stop catch-up only adds server rows that are not already on screen.
 * The local user line and the 「已停止」 note stay until a later refresh.
 */
export function catchUpAfterStop(existing, incoming) {
  const prior = (existing || []).map((message) => ({ ...message }));
  const { fresh, settled } = catchUpMessages(prior, incoming);
  if (settled) {
    const last = [...prior].reverse().find((message) => message?.role === "bot" && message.live && message.text);
    if (last) {
      last.text = settled.text;
      last.live = false;
    }
  }
  for (const message of fresh) prior.push({ ...message });
  return prior;
}

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
