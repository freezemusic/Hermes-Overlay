import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { planEase } from "./morph.js";
import {
  BOT_CHAT_TITLE,
  GATEWAY_FORK_TITLE,
  SUBORB_CAP,
  SUBORB_DISMISS_MS,
  SUBORB_FADE_EASE,
  SUBORB_FADE_MS,
  SUBORB_MIN_OPACITY,
  defaultTaskTitle,
  eligibleSuborb,
  emptySuborbModel,
  isRenewArchiveTitle,
  normalizeTaskTitle,
  capSuborbs,
  composerHoldsSuborb,
  reconcileSuborbs,
  suborbChannels,
  suborbLabel,
  suborbPositions,
  suborbSizePx,
  tailSignals,
} from "./suborb.js";

const bot = { id: "bot-chat", title: BOT_CHAT_TITLE, message_count: 4, last_active: 10 };
const task = (id, extra = {}) => ({
  id,
  title: extra.title || `任務 ${id}`,
  message_count: extra.message_count ?? 0,
  last_active: extra.last_active ?? 1,
  started_at: extra.started_at ?? 1,
  archived: !!extra.archived,
  ended: !!extra.ended,
  source: extra.source || "api_server",
});

test("archived rows and renew titles never become sub-orbs", () => {
  assert.equal(isRenewArchiveTitle("MT5 wrapper_202610271200"), true);
  assert.equal(isRenewArchiveTitle("MT5 wrapper_20261027120030"), true);
  assert.equal(isRenewArchiveTitle("MT5 wrapper"), false);
  assert.equal(eligibleSuborb(bot, "bot-chat"), false);
  assert.equal(eligibleSuborb({ id: "old", title: "notes", archived: true }, ""), false);
  assert.equal(eligibleSuborb({ id: "arc", title: "MT5 wrapper_202610271200" }, ""), false);
  assert.equal(eligibleSuborb(task("live"), "bot-chat"), true);
  assert.equal(eligibleSuborb(task("live"), "live"), false);
});

test("the first list is a baseline; a new task and a pin show, history does not", () => {
  const first = reconcileSuborbs(emptySuborbModel(), {
    sessions: [bot, task("old", { message_count: 8, last_active: 4 })],
    mainId: "bot-chat",
    pinned: ["old"],
    now: 1000,
  });
  assert.deepEqual(first.shown.map((row) => row.id), ["old"]);
  assert.equal(first.shown[0].pinned, true);
  const born = reconcileSuborbs(first.model, {
    sessions: [bot, task("old", { message_count: 8, last_active: 4 }), task("new")],
    mainId: "bot-chat",
    pinned: ["old"],
    now: 2000,
  });
  assert.deepEqual(born.shown.map((row) => row.id), ["old", "new"]);
  assert.equal(born.peek.length, 0);
});

test("a moved stamp asks for a tail and an unpinned finished read leaves after 3s", () => {
  const base = reconcileSuborbs(emptySuborbModel(), {
    sessions: [bot, task("job", { message_count: 2, last_active: 5 })],
    mainId: "bot-chat",
    now: 0,
  });
  assert.equal(base.shown.length, 0);
  const moved = reconcileSuborbs(base.model, {
    sessions: [bot, task("job", { message_count: 3, last_active: 9 })],
    mainId: "bot-chat",
    now: 0,
  });
  assert.deepEqual(moved.shown.map((row) => row.id), ["job"]);
  assert.deepEqual(moved.peek, ["job"]);
  assert.equal(moved.shown[0].channels.activity, "running");
  const settled = {
    ...moved.model,
    settled: { ...moved.model.settled, job: true },
  };
  const done = reconcileSuborbs(settled, {
    sessions: [bot, task("job", { message_count: 3, last_active: 9 })],
    mainId: "bot-chat",
    now: 10,
  });
  assert.equal(done.shown[0].channels.badge, "unread");
  assert.equal(done.shown[0].finished, true);
  const read = reconcileSuborbs(done.model, {
    sessions: [bot, task("job", { message_count: 3, last_active: 9 })],
    mainId: "bot-chat",
    openIds: ["job"],
    now: 10,
  });
  assert.equal(read.shown.length, 1);
  assert.equal(read.model.dismissAt.job, undefined);
  const stillOpen = reconcileSuborbs(read.model, {
    sessions: [bot, task("job", { message_count: 3, last_active: 9 })],
    mainId: "bot-chat",
    openIds: ["job"],
    now: 10 + SUBORB_DISMISS_MS,
  });
  assert.equal(stillOpen.shown.length, 1);
  const closed = reconcileSuborbs(stillOpen.model, {
    sessions: [bot, task("job", { message_count: 3, last_active: 9 })],
    mainId: "bot-chat",
    now: 10,
  });
  closed.model.closedAt.job = 10;
  const waiting = reconcileSuborbs(closed.model, {
    sessions: [bot, task("job", { message_count: 3, last_active: 9 })],
    mainId: "bot-chat",
    now: 10 + SUBORB_DISMISS_MS - 1,
  });
  assert.equal(waiting.shown.length, 1);
  const gone = reconcileSuborbs(waiting.model, {
    sessions: [bot, task("job", { message_count: 3, last_active: 9 })],
    mainId: "bot-chat",
    now: 10 + SUBORB_DISMISS_MS,
  });
  assert.equal(gone.shown.length, 0);
  assert.equal(composerHoldsSuborb({ value: "未送", focused: false }), true);
});

test("a pin stays after it is finished and read, and status does not reorder", () => {
  let model = emptySuborbModel();
  model = reconcileSuborbs(model, {
    sessions: [task("a", { started_at: 1 }), task("b", { started_at: 2 })],
    pinned: ["b"],
    now: 0,
  }).model;
  const view = reconcileSuborbs(model, {
    sessions: [
      task("a", { started_at: 1, message_count: 4, last_active: 3 }),
      task("b", { started_at: 2, message_count: 1, last_active: 8 }),
    ],
    pinned: ["b"],
    openIds: ["a", "b"],
    now: 50_000,
  });
  view.model.settled.a = true;
  view.model.settled.b = true;
  const again = reconcileSuborbs(view.model, {
    sessions: [
      task("a", { started_at: 1, message_count: 4, last_active: 3, ended: true }),
      task("b", { started_at: 2, message_count: 1, last_active: 8, ended: true }),
    ],
    pinned: ["b"],
    openIds: ["a", "b"],
    now: 50_000,
  });
  assert.equal(again.shown.some((row) => row.id === "b" && row.pinned), true);
  assert.equal(again.shown[0].id, "b");
});

test("overflow is capped at five orbs plus a +N slot", () => {
  const sessions = [bot];
  for (let i = 0; i < 8; i += 1) sessions.push(task(`t${i}`, { started_at: i + 1 }));
  const first = reconcileSuborbs(emptySuborbModel(), { sessions, mainId: "bot-chat", now: 0 });
  const extra = task("later", { started_at: 20 });
  const view = reconcileSuborbs(first.model, {
    sessions: [...sessions, extra],
    mainId: "bot-chat",
    pinned: ["t0", "t1", "t2", "t3", "t4", "t5"],
    now: 1,
  });
  assert.equal(SUBORB_CAP, 5);
  assert.equal(view.shown.length, 5);
  assert.equal(view.overflow.length, 2);
  assert.deepEqual(view.shown.map((row) => row.id), ["t0", "t1", "t2", "t3", "t4"]);
});

test("badges prefer waiting, then failure, then a plan, then unread", () => {
  assert.deepEqual(suborbChannels({ running: true, waiting: true, plan: true, unread: true }), {
    activity: "running",
    badge: "waiting",
  });
  assert.equal(suborbChannels({ failed: true, plan: true, unread: true }).badge, "failed");
  assert.equal(suborbChannels({ plan: true, unread: true }).badge, "plan");
  assert.equal(suborbChannels({ unread: true }).badge, "unread");
  assert.equal(suborbChannels({}).activity, "idle");
});

test("titles skip the gateway fork name and the closed suffix", () => {
  assert.equal(suborbLabel({ title: GATEWAY_FORK_TITLE, kept_title: "MT5 wrapper" }), "MT5 wrapper");
  assert.equal(suborbLabel({ title: GATEWAY_FORK_TITLE }), "任務");
  assert.equal(normalizeTaskTitle("", "mt-coder", new Date("2026-10-29T12:28:00")), "mt-coder 任務 2026-10-29 12:28");
  assert.equal(normalizeTaskTitle(GATEWAY_FORK_TITLE, "mt-coder", new Date("2026-10-29T12:28:00")), defaultTaskTitle("mt-coder", new Date("2026-10-29T12:28:00")));
  assert.equal(normalizeTaskTitle("包裝（已閂）", "mt-coder"), "包裝");
  assert.equal(defaultTaskTitle("mt-coder", new Date("2026-10-29T12:28:00")).includes(GATEWAY_FORK_TITLE), false);
});

test("sub-orbs sit along the parent edge and stay at least 14px", () => {
  assert.equal(suborbSizePx(44), 44 * 0.45);
  assert.equal(suborbSizePx(20), 14);
  const row = suborbPositions({ edge: "right", x: 1200, y: 400, parent: 44, count: 2, size: 20, screenW: 1280, screenH: 800 });
  assert.equal(row.length, 2);
  assert.ok(row[1].y > row[0].y);
  assert.ok(row.every((slot) => slot.x >= 0 && slot.y >= 0));
});

test("a tail is a plan only when the plan detector agrees, and a bot line is settled", () => {
  const plan = tailSignals([{ role: "bot", text: "C:\\work\\.hermes\\plans\\2026-10-26_210008-mt5.md\n\n# 計劃\n\n" + "字".repeat(200) }]);
  assert.equal(plan.plan, true);
  assert.equal(plan.settled, true);
  assert.equal(tailSignals([{ role: "user", text: "hello" }]).settled, false);
  assert.equal(tailSignals([{ role: "bot", text: "路徑 .hermes/plans/x.md" }]).plan, false);
});

test("a new disc stays visible and an archived row drops its pin", () => {
  const seed = reconcileSuborbs(emptySuborbModel(), {
    sessions: [bot],
    mainId: "bot-chat",
    listedIds: ["bot-chat"],
    now: 0,
  });
  const tasks = [0, 1, 2, 3, 4].map((i) => task(`t${i}`, { started_at: i + 1 }));
  const five = reconcileSuborbs(seed.model, {
    sessions: [bot, ...tasks],
    mainId: "bot-chat",
    listedIds: ["bot-chat", ...tasks.map((item) => item.id)],
    now: 1,
  });
  five.model.forced.fresh = true;
  const born = reconcileSuborbs(five.model, {
    sessions: [bot, ...tasks, task("fresh", { started_at: 40 })],
    mainId: "bot-chat",
    listedIds: ["bot-chat", ...tasks.map((item) => item.id)],
    now: 2,
  });
  assert.equal(born.shown.some((item) => item.id === "fresh"), true);
  assert.equal(born.overflow.some((item) => item.id === "t0"), true);
  assert.equal(born.unpin.includes("fresh"), false);
  const pinned = reconcileSuborbs(born.model, {
    sessions: [bot, task("kept", { archived: false }), task("old", { archived: true })],
    listedIds: ["bot-chat", "kept", "old"],
    pinned: ["old", "kept"],
    now: 3,
  });
  assert.equal(pinned.shown.some((item) => item.id === "old"), false);
  assert.equal(pinned.unpin.includes("old"), true);
  assert.equal(pinned.unpin.includes("kept"), false);
  const seen = reconcileSuborbs(emptySuborbModel(), {
    sessions: [bot, task("gone")],
    listedIds: ["bot-chat", "gone"],
    pinned: ["gone"],
    now: 4,
  });
  const dropped = reconcileSuborbs(seen.model, {
    sessions: [bot, task("gone")],
    listedIds: ["bot-chat"],
    pinned: ["gone"],
    now: 5,
  });
  assert.deepEqual(dropped.unpin, ["gone"]);
  assert.equal(dropped.shown.some((item) => item.id === "gone"), false);
  const pending = reconcileSuborbs(dropped.model, {
    sessions: [bot, task("brand")],
    listedIds: ["bot-chat"],
    pinned: ["brand"],
    now: 6,
  });
  assert.equal(pending.unpin.includes("brand"), false);
  assert.equal(pending.shown.some((item) => item.id === "brand"), true);
  assert.equal(capSuborbs(born.shown, 5, ["fresh"]).shown.some((item) => item.id === "fresh"), true);
});

test("the sub-orb fade uses the plan curve and a 0.18 floor", () => {
  assert.equal(SUBORB_FADE_MS, 280);
  assert.equal(SUBORB_FADE_EASE, "cubic-bezier(.3,.6,.2,1)");
  assert.equal(SUBORB_MIN_OPACITY, 0.18);
  assert.ok(planEase(0) === 0);
  assert.ok(planEase(1) > 0.99);
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const rust = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const interaction = readFileSync(new URL("../src-tauri/src/interaction.rs", import.meta.url), "utf8");
  assert.match(main, /SUBORB_FADE_MS/);
  assert.match(main, /planEase/);
  assert.match(main, /開新 session/);
  assert.doesNotMatch(main, /（已閂）/);
  assert.doesNotMatch(rust, /（已閂）/);
  const created = rust.slice(rust.indexOf("async fn create_task_session"), rust.indexOf("async fn open_suborb"));
  assert.match(created, /create_session/);
  assert.doesNotMatch(created, /persist_pin/);
  const opened = rust.slice(rust.indexOf("async fn open_suborb"), rust.indexOf("async fn peek_session_tail"));
  assert.doesNotMatch(opened, /persist_pin/);
  assert.match(opened, /fetch_counted_messages/);
  const sent = rust.slice(rust.indexOf("async fn send_suborb"), rust.indexOf("async fn stop_suborb"));
  assert.doesNotMatch(sent, /persist_pin|create_session|ensure_bot_chat/);
  assert.match(interaction, /suborb_hit/);
  assert.match(interaction, /0\.18/);
  const send = rust.slice(rust.indexOf("async fn send_chat"), rust.indexOf("fn dispatch_turn"));
  assert.doesNotMatch(send, /create_session/);
});
