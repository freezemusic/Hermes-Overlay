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
