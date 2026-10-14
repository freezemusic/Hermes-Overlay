import assert from "node:assert/strict";
import test from "node:test";
import {
  KANBAN_EMPTY,
  KANBAN_STATUSES,
  boardFingerprint,
  columnsFromTasks,
  moveTask,
  normalizeBoard,
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

test("404 is an empty state and owner colour follows the bot", () => {
  const empty = normalizeBoard({ unavailable: true });
  assert.equal(empty.unavailable, true);
  assert.equal(empty.message, KANBAN_EMPTY);
  assert.deepEqual(empty.columns, []);
  assert.equal(columnsFromTasks([]).length, KANBAN_STATUSES.length);
  assert.equal(ownerColor("計劃助手", [{ name: "計劃助手", color: "#0000f2" }]), "#0000f2");
  assert.equal(ownerColor("coder", [{ id: "coder", color: "#00f2f2" }]), "#00f2f2");
  assert.equal(ownerColor("", []), "#616191");
});
