/** Kanban board shaping for the overlay-slash proxy. */

export const KANBAN_STATUSES = ["triage", "todo", "ready", "running", "blocked", "done"];
export const KANBAN_POLL_MS = 5_000;
export const KANBAN_EMPTY = "未裝 overlay-slash kanban，看板唔會出現。";
export const KANBAN_BOARD = "default";

export function boardFingerprint(board) {
  const tasks = tasksOf(board).map((task) => [
    task.id,
    task.title,
    task.assignee,
    task.status,
    task.priority,
    task.updated_at,
  ]);
  return JSON.stringify(tasks);
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
  if (!payload || payload.unavailable) {
    return {
      board: payload?.board || KANBAN_BOARD,
      columns: [],
      unavailable: true,
      message: payload?.message || KANBAN_EMPTY,
    };
  }
  const tasks = tasksOf(payload);
  return {
    board: payload.board || KANBAN_BOARD,
    columns: columnsFromTasks(tasks),
    unavailable: false,
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

export function ownerColor(assignee, bots, fallback = "#616191") {
  const name = String(assignee || "").trim().toLowerCase();
  if (!name) return fallback;
  const bot = (bots || []).find((item) => {
    return [item.name, item.id, item.profile, item.short].some((value) => String(value || "").trim().toLowerCase() === name);
  });
  return bot?.color || fallback;
}
