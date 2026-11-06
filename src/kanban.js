/** Kanban board shaping for the overlay-slash proxy. */

export const KANBAN_STATUSES = ["triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done"];
export const KANBAN_POLL_MS = 5_000;
export const KANBAN_EMPTY = "未裝 overlay-slash kanban，看板唔會出現。";
export const KANBAN_UNAVAILABLE = "呢部 Hermes 未有看板。伺服器冇提供看板功能。";
export const KANBAN_LOGIN = "要登入 Kanban";

/** Empty follows the server's current board. A slug is only an explicit pick. */
export function kanbanRequestSlug(explicit) {
  return String(explicit || "").trim();
}

/**
 * A newer pick or refresh owns the board. An older ticket, or a ticket whose
 * slug no longer matches the explicit pick, must not paint.
 */
export function kanbanFetchApplies(ticket, active, requested, explicit) {
  if (Number(ticket) !== Number(active)) return false;
  return kanbanRequestSlug(requested) === kanbanRequestSlug(explicit);
}

/** Aborted or cancelled reads are not a connection failure. */
export function kanbanFetchAborted(message) {
  const text = String(message || "").toLowerCase();
  return text.includes("abort") || text.includes("cancel");
}

/** Done starts collapsed so a long done column stays a count. */
export function columnCollapsed(name, doneOpen) {
  return String(name || "") === "done" && !doneOpen;
}

/** Mark the server's current board in the picker. Other slugs stay plain. */
export function boardOptionLabel(slug, current) {
  const name = kanbanRequestSlug(slug);
  if (!name) return "";
  return name === kanbanRequestSlug(current) ? `${name}（目前）` : name;
}

/** An explicit pick wins. Otherwise show the server current board. */
export function pickerSelection(explicit, current, shown) {
  const pick = kanbanRequestSlug(explicit);
  if (pick) return pick;
  const live = kanbanRequestSlug(current);
  if (live) return live;
  return kanbanRequestSlug(shown);
}

/** 404 or a missing kanban route. A sign-in prompt is not a 404. */
export function kanbanUnavailable(message) {
  const text = String(message || "");
  if (text.includes(KANBAN_LOGIN)) return false;
  return (
    text.includes("未有看板") ||
    text.includes("未裝 overlay-slash kanban") ||
    text.includes("找不到路徑（404）") ||
    text.includes("（404）") ||
    /\b404\b/.test(text)
  );
}

function clipLine(text) {
  const line = String(text || "").replace(/\s+/g, " ").trim();
  const chars = Array.from(line);
  if (chars.length <= 180) return line;
  return `${chars.slice(0, 179).join("")}…`;
}

/** One preview line for a real board change. The first snapshot stays quiet. */
export function kanbanChangeLine(previous, next) {
  if (!previous || !next || previous.unavailable || next.unavailable || previous.needsLogin || next.needsLogin) return "";
  const before = tasksOf(previous);
  const after = tasksOf(next);
  const beforeById = new Map(before.map((task) => [task.id, task]));
  const added = after.filter((task) => !beforeById.has(task.id));
  if (added.length === 1) return clipLine(`新增：${added[0].title || "卡片"}`);
  if (added.length > 1) return clipLine(`新增 ${added.length} 張卡片`);
  const moved = after.filter((task) => {
    const old = beforeById.get(task.id);
    return old && old.status !== task.status;
  });
  if (moved.length === 1) return clipLine(`${moved[0].title || "卡片"} → ${moved[0].status}`);
  if (moved.length > 1) return clipLine(`${moved.length} 張卡片改咗狀態`);
  if (boardFingerprint(previous) !== boardFingerprint(next)) return "看板有更新";
  return "";
}

export function boardFingerprint(board) {
  const tasks = tasksOf(board).map((task) => [
    task.id,
    task.title,
    task.assignee,
    task.status,
    task.priority,
    task.updated_at,
  ]);
  return JSON.stringify({
    needsLogin: Boolean(board?.needsLogin),
    unavailable: Boolean(board?.unavailable),
    message: board?.message || "",
    tasks,
  });
}

export function tasksOf(board) {
  const tasks = [];
  for (const column of board?.columns || []) {
    for (const task of column.tasks || []) {
      if (!task || !task.id) continue;
      const status = String(task.status || column.name || "").trim();
      if (status === "archived") continue;
      tasks.push({
        id: String(task.id),
        title: String(task.title || ""),
        assignee: String(task.assignee || ""),
        status,
        priority: String(task.priority || ""),
        updated_at: String(task.updated_at || ""),
      });
    }
  }
  return tasks;
}

export function columnsFromTasks(tasks) {
  const names = [...KANBAN_STATUSES];
  for (const task of tasks) {
    if (task.status && task.status !== "archived" && !names.includes(task.status)) names.push(task.status);
  }
  return names
    .filter((name) => name !== "archived")
    .map((name) => ({ name, tasks: tasks.filter((task) => task.status === name) }));
}

export function normalizeBoard(payload) {
  if (payload?.needs_login || payload?.needsLogin) {
    return {
      board: kanbanRequestSlug(payload.board),
      columns: [],
      unavailable: false,
      needsLogin: true,
      message: KANBAN_LOGIN,
    };
  }
  if (!payload || payload.unavailable) {
    return {
      board: kanbanRequestSlug(payload?.board),
      columns: [],
      unavailable: true,
      needsLogin: false,
      message: payload?.message || KANBAN_EMPTY,
    };
  }
  const tasks = tasksOf(payload);
  return {
    board: kanbanRequestSlug(payload.board),
    columns: columnsFromTasks(tasks),
    unavailable: false,
    needsLogin: false,
    message: "",
  };
}

/** Optimistic column move. Unknown ids return the same board. */
export function moveTask(board, taskId, status) {
  const nextStatus = String(status || "").trim();
  if (!nextStatus || nextStatus === "archived") return board;
  const tasks = tasksOf(board).map((task) => (task.id === taskId ? { ...task, status: nextStatus } : task));
  return { ...board, columns: columnsFromTasks(tasks), unavailable: false, message: "" };
}

function reasonFromJson(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  for (const key of ["error", "message", "reason", "detail"]) {
    if (value[key] == null) continue;
    const found = reasonFromJson(value[key]);
    if (found && found !== "null") return found;
  }
  return "";
}

/** Board copy for a failed move. 409/422 reasons stay; raw JSON does not. */
export function kanbanErrorText(err) {
  const raw = String(err && err.message ? err.message : err || "").trim();
  const start = raw.indexOf("{");
  let reason = "";
  if (start >= 0) {
    try {
      reason = reasonFromJson(JSON.parse(raw.slice(start)));
    } catch {
      reason = "";
    }
  }
  const rejected = /\b(409|422)\b/.test(raw);
  if (reason) return rejected ? `看板拒絕呢次移動：${reason}` : `看板更新失敗：${reason}`;
  if (raw.includes("{")) return rejected ? "看板拒絕呢次移動。" : "看板更新失敗。";
  return raw || "看板更新失敗。";
}

export function ownerColor(assignee, bots, fallback = "#616191") {
  const name = String(assignee || "").trim().toLowerCase();
  if (!name) return fallback;
  const bot = (bots || []).find((item) => {
    return [item.name, item.id, item.profile, item.short].some((value) => String(value || "").trim().toLowerCase() === name);
  });
  return bot?.color || fallback;
}

/* R-KB-09: notification bell. Events live in memory only (never config.json). */

export const KANBAN_EVENT_CAP = 50;
export const KANBAN_UPDATED = "看板有更新";
export const KANBAN_BELL_EMPTY = "未有看板通知";
export const KANBAN_BELL_TIP = "看板通知";

let eventSeq = 0;

/**
 * One entry per added card and per moved card, else one generic
 * 「看板有更新」 when the board changed some other way. The first snapshot,
 * login / unavailable states and a switch to another board stay quiet.
 */
export function kanbanEvents(previous, next, at = Date.now()) {
  if (!previous || !next) return [];
  if (previous.unavailable || next.unavailable || previous.needsLogin || next.needsLogin) return [];
  if (kanbanRequestSlug(previous.board) !== kanbanRequestSlug(next.board)) return [];
  const before = new Map(tasksOf(previous).map((task) => [task.id, task]));
  const out = [];
  for (const task of tasksOf(next)) {
    const old = before.get(task.id);
    if (!old) {
      out.push({ kind: "added", taskId: task.id, title: task.title, from: "", to: task.status });
    } else if (old.status !== task.status) {
      out.push({ kind: "moved", taskId: task.id, title: task.title, from: old.status, to: task.status });
    }
  }
  if (!out.length && boardFingerprint(previous) !== boardFingerprint(next)) {
    out.push({ kind: "updated", taskId: "", title: KANBAN_UPDATED, from: "", to: "" });
  }
  return out.map((entry) => ({ ...entry, at, id: `kb-${at}-${(eventSeq += 1)}`, read: false }));
}

/** Newest first, capped. `fresh` is in board order; it lands on top. */
export function pushKanbanEvents(list, fresh, cap = KANBAN_EVENT_CAP) {
  const added = [...(fresh || [])].reverse();
  return [...added, ...(list || [])].slice(0, Math.max(0, cap));
}

export function unreadKanbanCount(list) {
  return (list || []).filter((entry) => !entry.read).length;
}

/** Opening the list reads everything. */
export function markKanbanEventsRead(list) {
  return (list || []).map((entry) => (entry.read ? entry : { ...entry, read: true }));
}

/** True while Devon can see the board: the panel is open or on its way open
 *  (a Ctrl+click on the capsule mid-morph), or the bell list is up. A panel
 *  that is collapsing after 關閉 is not seen any more. A change that lands
 *  while this is true never sets the orb's unread mark (R-KB-09). */
export function kanbanSeen({ open = false, bell = false, opening = "", intent = "", collapsing = false } = {}) {
  if (bell) return true;
  if (collapsing) return false;
  return !!open || opening === "panel" || intent === "open";
}

/** Orb / bell badge text: "" for none, 1–9, then "9+". */
export function kanbanBadgeText(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (!n) return "";
  return n > 9 ? "9+" : String(n);
}

/** R-KB-15: under a minute. Digits, not 「啱啱」 (which read as 「啫啫」 at 11–12px). */
export const KANBAN_TIME_JUST_NOW = "1 分鐘內";

/** R-KB-15: the bell row's time slot. Only ever a time: 「1 分鐘內」 under a
 *  minute, 「N 分鐘前」 under an hour, else HH:MM (local); "" when the event
 *  has no usable timestamp (never a title, bot or assignee). */
export function kanbanEventTime(at, now = Date.now()) {
  const t = typeof at === "number" ? at : typeof at === "string" && /^\d+$/.test(at.trim()) ? Number(at) : NaN;
  if (!Number.isFinite(t) || t <= 0) return "";
  const age = Math.max(0, Number(now) - t);
  if (age < 60_000) return KANBAN_TIME_JUST_NOW;
  if (age < 3_600_000) return `${Math.floor(age / 60_000)} 分鐘前`;
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** R-KB-15: every string kanbanEventTime can return. */
export const KANBAN_EVENT_TIME_RE = /^(|1 分鐘內|[1-5]?\d 分鐘前|[0-2]\d:[0-5]\d)$/;

export const KANBAN_BELL_READ_ALL = "全部已讀";

/** A status as its column head reads it: TRIAGE, TODO, … (R-KB-10). */
export function kanbanColumnLabel(status) {
  return String(status || "?").trim().toUpperCase() || "?";
}

/** The status part of a row in column-head words, never mixed with Chinese:
 *  「NEW → TRIAGE」, 「TODO → READY」, or "" (R-KB-10). */
export function kanbanEventChange(entry) {
  if (entry?.kind === "added") return `NEW → ${kanbanColumnLabel(entry.to)}`;
  if (entry?.kind === "moved") return `${kanbanColumnLabel(entry.from)} → ${kanbanColumnLabel(entry.to)}`;
  return "";
}

/** Bold / bar for a row: not seen in the list before this showing (R-KB-10). */
export function kanbanEventUnread(entry, fresh) {
  if (!entry) return false;
  return !entry.listed || !!fresh?.has?.(entry.id);
}

/** 全部已讀: every entry read and listed, nothing left bold. */
export function markKanbanEventsListed(list) {
  return (list || []).map((entry) => (entry.read && entry.listed ? entry : { ...entry, read: true, listed: true }));
}

/**
 * R-KB-11: the small chip on a card is the Hermes task priority (kanban_db
 * `priority INTEGER DEFAULT 0`; higher is claimed first by the dispatcher).
 * 0 / blank is the default and shows nothing, the same as the Hermes dashboard
 * (which only shows `P{n}` when n > 0). A number shows as itself; an old text
 * priority (low / high) shows as its text.
 */
export function kanbanPriority(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    if (!n) return null;
    return { text: String(n), tip: `優先度 ${n}：數字愈大，Hermes 愈早派` };
  }
  return { text, tip: `優先度：${text}` };
}
