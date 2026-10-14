import assert from "node:assert/strict";
import test from "node:test";
import {
  THINKING_WATCHDOG_MS,
  TOAST_MAX,
  emptyActivity,
  pushToast,
  reduceActivity,
  toastAnchor,
  toastSide,
} from "./activity.js";

test("thinking follows send, tools, tokens, and terminal events", () => {
  let state = emptyActivity();
  let step = reduceActivity(state, { type: "send" }, 0);
  assert.equal(step.state.thinking, true);
  assert.equal(step.state.streaming, false);
  assert.equal(step.state.deadline, THINKING_WATCHDOG_MS);
  state = step.state;

  step = reduceActivity(state, { type: "run.started" }, 1000);
  assert.equal(step.state.thinking, true);
  assert.equal(step.state.deadline, 1000 + THINKING_WATCHDOG_MS);

  step = reduceActivity(step.state, { type: "tool.progress", text: "讀檔" }, 2000);
  assert.equal(step.state.thinking, true);
  assert.equal(step.toast.kind, "tool");
  assert.equal(step.toast.text, "讀檔");
  assert.equal(step.unread, true);
  assert.equal(step.state.deadline, 2000 + THINKING_WATCHDOG_MS);

  step = reduceActivity(step.state, { type: "delta" }, 3000);
  assert.equal(step.state.thinking, false);
  assert.equal(step.state.streaming, true);
  assert.equal(step.toast, null);

  step = reduceActivity(step.state, { type: "completed", text: "做好" }, 4000);
  assert.deepEqual(step.state, emptyActivity());
  assert.equal(step.toast.kind, "message");
  assert.equal(step.unread, true);

  step = reduceActivity({ thinking: true, streaming: false, deadline: 1 }, { type: "failed", text: "" }, 9);
  assert.equal(step.state.thinking, false);
  assert.equal(step.toast.kind, "error");
  assert.equal(step.toast.text, "回覆失敗");

  step = reduceActivity({ thinking: true, streaming: true, deadline: 1 }, { type: "cancelled" }, 9);
  assert.equal(step.toast.text, "已停止");

  step = reduceActivity({ thinking: true, streaming: true, deadline: 1 }, { type: "watchdog" }, 90_000);
  assert.deepEqual(step.state, emptyActivity());
});

test("toasts stack to three and sit away from the screen edge", () => {
  let stack = [];
  for (const id of ["a", "b", "c", "d"]) stack = pushToast(stack, { id });
  assert.equal(stack.length, TOAST_MAX);
  assert.deepEqual(stack.map((item) => item.id), ["b", "c", "d"]);
  const rightOrb = { x: 900, y: 40, w: 52, h: 52 };
  assert.equal(toastSide(rightOrb, 1000), "left");
  const left = toastAnchor(rightOrb, { width: 1000, height: 800 }, 1);
  assert.equal(left.side, "left");
  assert.ok(left.x < rightOrb.x);
  assert.ok(left.y > rightOrb.y);
  const leftOrb = { x: 16, y: 40, w: 52, h: 52 };
  assert.equal(toastSide(leftOrb, 1000), "right");
});
