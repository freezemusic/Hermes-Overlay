import assert from "node:assert/strict";
import test from "node:test";
import {
  THINKING_WATCHDOG_MS,
  TOAST_MAX,
  emptyActivity,
  pushToast,
  reduceActivity,
  orbMotion,
  statusAfterWatchdog,
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

  const quiet = reduceActivity(emptyActivity(), { type: "tool.progress", name: "_thinking", text: "_thinking" }, 5000);
  assert.equal(quiet.state.thinking, true);
  assert.equal(quiet.toast, null);
  assert.equal(quiet.unread, false);
  assert.equal(quiet.state.deadline, 5000 + THINKING_WATCHDOG_MS);
  const reasoning = reduceActivity(emptyActivity(), { type: "tool.progress", name: "reasoning", text: "reasoning" }, 1);
  assert.equal(reasoning.toast, null);
  assert.equal(reasoning.unread, false);
  assert.equal(statusAfterWatchdog("思考中…"), "等候中");
  assert.equal(statusAfterWatchdog("閒置"), "閒置");

  assert.equal(orbMotion(reduceActivity(emptyActivity(), { type: "send" }, 0).state, "busy"), "spin");
  assert.equal(orbMotion(reduceActivity(emptyActivity(), { type: "delta" }, 0).state, "busy"), "spin");
  assert.equal(orbMotion(reduceActivity({ thinking: true, streaming: false, deadline: 1 }, { type: "watchdog" }, 90_000).state, "busy"), "wait");
  assert.equal(orbMotion(emptyActivity(), "idle"), "idle");
  assert.equal(orbMotion(emptyActivity(), "error"), "idle");
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
