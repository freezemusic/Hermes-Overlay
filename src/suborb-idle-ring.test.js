// R-SO-03 / R-SO-05 (Devon 2026-11-16 14:39 London: 「為什麼一直轉, 但寫閒置」).
// A pinned sub-orb whose own turn ended kept its arc spinning while the panel
// said 閒置: the list showed the count grew, the tail ended in a tool row, the
// row was not busy and the run id was already cleared, so suborbIdleDecision
// returned "spin" forever. Arc and label now read the same server answer.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BOT_CHAT_TITLE,
  SUBORB_IDLE_GRACE_MS,
  SUBORB_RUN_RECHECK_MS,
  SUBORB_SERVER_RUN_LABEL,
  emptySuborbModel,
  reconcileSuborbs,
  suborbIdleDecision,
  suborbRunStampKey,
  suborbSessionRun,
  suborbStatusLabel,
  tailSignals,
} from "./suborb.js";
import { EN } from "./look.js";

const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const perms = readFileSync(new URL("../src-tauri/permissions/hermes.toml", import.meta.url), "utf8");
const caps = readFileSync(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8");

const bot = { id: "bot-chat", title: BOT_CHAT_TITLE, message_count: 4, last_active: 10 };
const row = (extra = {}) => ({
  id: "job",
  title: "提交 AutoCompile",
  message_count: 20,
  last_active: 50,
  started_at: 1,
  archived: false,
  ended: false,
  source: "api_server",
  busy: false,
  ...extra,
});
const PIN = ["job"];

/** The 14:39 state: pinned, own turn done, count grew, tail ends in a tool row. */
function stuckState() {
  const first = reconcileSuborbs(emptySuborbModel(), {
    sessions: [bot, row()], mainId: "bot-chat", pinned: PIN, now: 1_000,
  });
  const grown = reconcileSuborbs(first.model, {
    sessions: [bot, row({ message_count: 27, last_active: 60 })], mainId: "bot-chat", pinned: PIN, now: 2_000,
  });
  // peekSuborbTail: last row is a tool run, so not settled.
  const tail = tailSignals([{ role: "bot", text: "我會開新 hermes 分支落 commit" }, { role: "tool-run", tools: [] }]);
  assert.equal(tail.settled, false);
  grown.model.settled.job = tail.settled;
  return reconcileSuborbs(grown.model, {
    sessions: [bot, row({ message_count: 27, last_active: 60 })], mainId: "bot-chat", pinned: PIN, now: 3_000,
  });
}

test("the stuck state is the one Devon saw: arc running, nothing local busy", () => {
  const view = stuckState();
  assert.equal(view.shown[0].channels.activity, "running");
  // Before the fix this returned "spin" and nothing ever asked the server.
  const decision = suborbIdleDecision({ sessionBusy: false, localBusy: false, hasRunId: false, confirmedIdle: false });
  assert.equal(decision, "check");
});

test("server says no live run → the arc stops and the panel stays 閒置", () => {
  const view = stuckState();
  const stamp = suborbRunStampKey(row({ message_count: 27, last_active: 60 }));
  const checked = { key: stamp, result: "none", at: 3_100 };
  assert.equal(suborbSessionRun(checked, stamp, 3_200), "none");
  assert.equal(suborbIdleDecision({ sessionBusy: false, hasRunId: false, sessionRun: "none" }), "idle");
  // releaseIdleSuborb: settled, serverIdle, idleAt.
  const model = view.model;
  model.settled.job = true;
  model.serverIdle.job = true;
  model.idleAt.job = 3_200;
  const after = reconcileSuborbs(model, {
    sessions: [bot, row({ message_count: 27, last_active: 60 })], mainId: "bot-chat", pinned: PIN, now: 4_000,
  });
  assert.equal(after.shown.length, 1, "pinned sub-orb stays on the rail (R-SO-07, R-SO-11)");
  assert.equal(after.shown[0].pinned, true);
  assert.equal(after.shown[0].channels.activity, "idle");
  assert.deepEqual(suborbStatusLabel({ text: "閒置", statusState: "idle", serverLive: false }), { text: "閒置", state: "idle" });
});

test("server says the run is live → arc and label both say busy", () => {
  const view = stuckState();
  const model = view.model;
  model.serverLive.job = true;
  const live = reconcileSuborbs(model, {
    sessions: [bot, row({ message_count: 27, last_active: 60 })], mainId: "bot-chat", pinned: PIN, now: 4_000,
  });
  assert.equal(live.shown[0].channels.activity, "running");
  assert.deepEqual(
    suborbStatusLabel({ text: "閒置", statusState: "idle", serverLive: true }),
    { text: SUBORB_SERVER_RUN_LABEL, state: "busy" },
  );
  // The panel's own states win: its own turn, a failure, an approval label.
  assert.equal(suborbStatusLabel({ text: "思考中…", statusState: "busy", serverLive: true }).text, "思考中…");
  assert.equal(suborbStatusLabel({ text: "回覆失敗", statusState: "error", serverLive: true }).text, "回覆失敗");
  assert.equal(suborbIdleDecision({ sessionBusy: false, hasRunId: false, sessionRun: "live" }), "spin");
  assert.equal(EN[SUBORB_SERVER_RUN_LABEL], "Running…");
});

test("a live answer goes stale and is asked again; a stamp change asks again", () => {
  const stamp = "27:60";
  assert.equal(suborbSessionRun({ key: stamp, result: "live", at: 0 }, stamp, SUBORB_RUN_RECHECK_MS - 1), "live");
  assert.equal(suborbSessionRun({ key: stamp, result: "live", at: 0 }, stamp, SUBORB_RUN_RECHECK_MS + 1), "");
  assert.equal(suborbSessionRun({ key: stamp, result: "none", at: 0 }, "28:61", 5), "");
  assert.equal(suborbSessionRun(undefined, stamp, 5), "");
});

test("own turn done releases first; the final reply flush cannot re-arm the arc", () => {
  const first = reconcileSuborbs(emptySuborbModel(), {
    sessions: [bot, row()], mainId: "bot-chat", pinned: PIN, now: 1_000,
  });
  // turn done → releaseIdleSuborb at t=2000
  const model = first.model;
  model.settled.job = true;
  model.serverIdle.job = true;
  model.idleAt.job = 2_000;
  const flush = reconcileSuborbs(model, {
    sessions: [bot, row({ message_count: 27, last_active: 60 })], mainId: "bot-chat", pinned: PIN, now: 2_000 + 3_000,
  });
  assert.equal(flush.shown[0].channels.activity, "idle");
  const quiet = reconcileSuborbs(flush.model, {
    sessions: [bot, row({ message_count: 27, last_active: 60 })], mainId: "bot-chat", pinned: PIN, now: 2_000 + SUBORB_IDLE_GRACE_MS + 5_000,
  });
  assert.equal(quiet.shown[0].channels.activity, "idle");
});

test("after a release, a later message-count rise (a new run elsewhere) shows the arc again", () => {
  const first = reconcileSuborbs(emptySuborbModel(), {
    sessions: [bot, row()], mainId: "bot-chat", pinned: PIN, now: 1_000,
  });
  const model = first.model;
  model.settled.job = true;
  model.serverIdle.job = true;
  model.idleAt.job = 1_000;
  const pinned = reconcileSuborbs(model, {
    sessions: [bot, row()], mainId: "bot-chat", pinned: PIN, now: 1_500,
  });
  const later = reconcileSuborbs(pinned.model, {
    sessions: [bot, row({ message_count: 22, last_active: 90 })], mainId: "bot-chat", pinned: PIN, now: 1_000 + SUBORB_IDLE_GRACE_MS + 30_000,
  });
  assert.equal(later.shown[0].channels.activity, "running");
  assert.equal(later.model.serverIdle.job, undefined);
});

test("the unread dot still waits for a reopen after the arc stops (R-SO-07)", () => {
  const view = stuckState();
  const model = view.model;
  model.settled.job = true;
  model.serverIdle.job = true;
  model.idleAt.job = 3_200;
  const after = reconcileSuborbs(model, {
    sessions: [bot, row({ message_count: 27, last_active: 60 })], mainId: "bot-chat", pinned: PIN, now: 4_000,
  });
  assert.equal(after.shown[0].channels.badge, "unread");
  const opened = reconcileSuborbs(after.model, {
    sessions: [bot, row({ message_count: 27, last_active: 60 })], mainId: "bot-chat", pinned: PIN, openIds: ["job"], now: 5_000,
  });
  assert.equal(opened.shown[0].channels.badge, "");
});

test("main.js wires the check, the label and the turn-done release", () => {
  const list = main.slice(main.indexOf("function noteSuborbList"), main.indexOf("function armSuborbDismiss"));
  assert.match(list, /sessionRun: suborbSessionRun\(model\.runChecked\?\.\[row\.id\], stamp, Date\.now\(\)\)/);
  assert.match(list, /decision === "check"[\s\S]{0,80}scheduleSuborbSessionCheck\(profile, row\.id, stamp\)/);
  const check = main.slice(main.indexOf("async function checkSuborbSessionRun"), main.indexOf("function armSuborbRunRecheck"));
  assert.match(check, /invoke\("check_session_run", \{ profile, sessionId \}\)/);
  assert.match(check, /if \(!result\) \{\s*armSuborbRunRecheck\(\);\s*return;/);
  assert.match(check, /paintSuborbStatus\(panelId\)/);
  const release = main.slice(main.indexOf("function releaseIdleSuborb"), main.indexOf("const suborbIdleChecks"));
  assert.match(release, /delete model\.serverLive\[sub\.sessionId\]/);
  assert.match(release, /model\.idleAt\[sub\.sessionId\] = Date\.now\(\)/);
  assert.match(main, /isSuborbId\(id\) && \(payload\.outcome === "completed" \|\| payload\.outcome === "failed"\) && !thread\.queued\) \{\s*if \(releaseIdleSuborb\(id\)\) reevalSuborbs\(\);/);
  const status = main.slice(main.indexOf("function shownStatus"), main.indexOf("function paintSuborbStatus"));
  assert.match(status, /suborbStatusLabel\(\{ text, statusState, serverLive \}\)/);
});

test("check_session_run is a read-only command with its own permission", () => {
  const cmd = lib.slice(lib.indexOf("async fn check_session_run"), lib.indexOf("struct SessionTail"));
  assert.match(cmd, /live_session_run/);
  assert.doesNotMatch(cmd, /ensure_open_run|bind_live_run|resume/);
  assert.match(lib, /\n\s+check_session_run,\n/);
  assert.match(perms, /commands\.allow = \["check_session_run"\]/);
  assert.match(caps, /"allow-check-session-run"/);
});
