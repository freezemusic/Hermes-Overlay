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

/** Done starts collapsed so a long done column stays a count. */
export function columnCollapsed(name, doneOpen) {
  return String(name || "") === "done" && !doneOpen;
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
