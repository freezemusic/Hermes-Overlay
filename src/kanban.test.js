import assert from "node:assert/strict";
import test from "node:test";
import {
  KANBAN_EMPTY,
  KANBAN_LOGIN,
  KANBAN_UNAVAILABLE,
  kanbanUnavailable,
  KANBAN_STATUSES,
  boardFingerprint,
  kanbanChangeLine,
  columnsFromTasks,
  moveTask,
  normalizeBoard,
  kanbanErrorText,
  ownerColor,
} from "./kanban.js";

const sample = {
  board: "default",
  columns: [
    {
      name: "done",
      tasks: [
        { id: "a", title: "已完成", assignee: "計劃助手", status: "done", priority: "low", updated_at: "1" },
        { id: "z", title: "封存", assignee: "", status: "archived", priority: "", updated_at: "0" },
      ],
    },
    {
      name: "todo",
      tasks: [{ id: "b", title: "未做", assignee: "coder", status: "todo", priority: "high", updated_at: "2" }],
    },
  ],
};

test("board columns follow status order and hide archived", () => {
  const board = normalizeBoard(sample);
  assert.deepEqual(board.columns.map((column) => column.name), KANBAN_STATUSES);
  assert.equal(board.columns.find((column) => column.name === "done").tasks.length, 1);
  assert.equal(board.columns.find((column) => column.name === "archived"), undefined);
  const moved = moveTask(board, "b", "running");
  assert.equal(moved.columns.find((column) => column.name === "running").tasks[0].id, "b");
  assert.equal(moved.columns.find((column) => column.name === "todo").tasks.length, 0);
  assert.notEqual(boardFingerprint(board), boardFingerprint(moved));
  assert.equal(moveTask(board, "missing", "todo").columns.length, board.columns.length);
});

test("a kanban change becomes one preview line and the first snapshot stays quiet", () => {
  const base = {
    columns: [{ name: "todo", tasks: [{ id: "a", title: "已有", status: "todo" }] }],
  };
  assert.equal(kanbanChangeLine(null, base), "");
  assert.equal(kanbanChangeLine({ unavailable: true }, base), "");
  assert.equal(kanbanChangeLine(base, base), "");
  assert.equal(
    kanbanChangeLine(base, {
      columns: [{ name: "todo", tasks: [
        { id: "a", title: "已有", status: "todo" },
        { id: "b", title: "新卡片", status: "todo" },
      ] }],
    }),
    "新增：新卡片",
  );
  assert.equal(
    kanbanChangeLine(base, {
      columns: [{ name: "todo", tasks: [
        { id: "a", title: "已有", status: "todo" },
        { id: "b", title: "甲", status: "todo" },
        { id: "c", title: "乙", status: "todo" },
      ] }],
    }),
    "新增 2 張卡片",
  );
  assert.equal(
    kanbanChangeLine(base, {
      columns: [{ name: "ready", tasks: [{ id: "a", title: "已有", status: "ready" }] }],
    }),
    "已有 → ready",
  );
  assert.equal(
    kanbanChangeLine(
      { columns: [{ name: "todo", tasks: [
        { id: "a", title: "甲", status: "todo" },
        { id: "b", title: "乙", status: "todo" },
      ] }] },
      { columns: [{ name: "done", tasks: [
        { id: "a", title: "甲", status: "done" },
        { id: "b", title: "乙", status: "done" },
      ] }] },
    ),
    "2 張卡片改咗狀態",
  );
  assert.equal(
    kanbanChangeLine(base, {
      columns: [{ name: "todo", tasks: [{ id: "a", title: "改咗名", status: "todo" }] }],
    }),
    "看板有更新",
  );
});

test("404 is an empty state and owner colour follows the bot", () => {
  const empty = normalizeBoard({ unavailable: true });
  assert.equal(empty.unavailable, true);
  assert.equal(empty.message, KANBAN_EMPTY);
  assert.equal(kanbanUnavailable(KANBAN_EMPTY), true);
  assert.equal(kanbanUnavailable(KANBAN_UNAVAILABLE), true);
  assert.equal(kanbanUnavailable("找不到路徑（404）。"), true);
  const feature = normalizeBoard({ unavailable: true, message: KANBAN_UNAVAILABLE });
  assert.equal(feature.message, KANBAN_UNAVAILABLE);
  assert.equal(feature.unavailable, true);
  assert.deepEqual(empty.columns, []);
  assert.equal(columnsFromTasks([]).length, KANBAN_STATUSES.length);
  assert.equal(ownerColor("計劃助手", [{ name: "計劃助手", color: "#0000f2" }]), "#0000f2");
  assert.equal(ownerColor("coder", [{ id: "coder", color: "#00f2f2" }]), "#00f2f2");
  assert.equal(ownerColor("", []), "#616191");
  assert.equal(
    kanbanErrorText('Gateway 回應 409。{"error":"completion blocked: no result"}'),
    "看板拒絕呢次移動：completion blocked: no result",
  );
  assert.equal(
    kanbanErrorText('{"error":{"message":"needs a summary","code":"kanban_conflict"}}'),
    "看板更新失敗：needs a summary",
  );
  assert.equal(kanbanErrorText("看板拒絕呢次移動：已有人做"), "看板拒絕呢次移動：已有人做");
  assert.equal(kanbanErrorText("{not json"), "看板更新失敗。");
  assert.equal(kanbanUnavailable(KANBAN_LOGIN), false);
  const login = normalizeBoard({ needs_login: true });
  assert.equal(login.needsLogin, true);
  assert.equal(login.unavailable, false);
  assert.equal(login.message, KANBAN_LOGIN);
  assert.equal(login.columns.length, 0);
  assert.equal(kanbanChangeLine({ columns: [] }, login), "");
  assert.notEqual(
    boardFingerprint({ unavailable: true, message: KANBAN_UNAVAILABLE, columns: [] }),
    boardFingerprint(login),
  );
});
