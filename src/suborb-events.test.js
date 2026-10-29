import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { botIdFromHit, elementUnderCursor } from "./proximity.js";
import {
  capSuborbs,
  dispatchOrbClick,
  emptySuborbModel,
  reconcileSuborbs,
  releaseSuborbNodes,
  suborbPanelShift,
  suborbPositions,
  suborbPublishesPanel,
  suborbSizePx,
} from "./suborb.js";

const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
const rust = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");

const bot = { id: "bot-chat", title: "Bot Chat", message_count: 4, last_active: 10 };
const row = (id, extra = {}) => ({
  id,
  title: extra.title || id,
  message_count: extra.message_count ?? 0,
  last_active: extra.last_active ?? 1,
  started_at: extra.started_at ?? 1,
  archived: !!extra.archived,
  ended: !!extra.ended,
  busy: !!extra.busy,
  source: "api_server",
});

test("a Ctrl-click on a sub-orb or +N does not open it as a profile", () => {
  const calls = [];
  const hooks = {
    settings: () => calls.push("settings"),
    kanban: () => calls.push("kanban"),
    cron: () => calls.push("cron"),
    picker: (profile) => calls.push(`picker:${profile}`),
    suborb: (id) => calls.push(`suborb:${id}`),
    bot: (id) => calls.push(`bot:${id}`),
  };
  assert.equal(dispatchOrbClick("suborb:writer:api_1", hooks), "suborb");
  assert.equal(dispatchOrbClick("suborb-more:writer", hooks), "picker");
  assert.equal(dispatchOrbClick("writer", hooks), "bot");
  assert.equal(botIdFromHit("bot:suborb:writer:api_1"), "suborb:writer:api_1");
  assert.equal(botIdFromHit("suborb-more:writer"), "suborb-more:writer");
  assert.equal(botIdFromHit("close:writer"), "");
  assert.deepEqual(calls, [
    "suborb:suborb:writer:api_1",
    "picker:writer",
    "bot:writer",
  ]);
  const activate = main.slice(main.indexOf("function activateHitShell"), main.indexOf("function attachShell"));
  assert.match(activate, /dispatchOrbClick/);
  assert.doesNotMatch(activate, /selectBot\(hitId\)/);
  const stand = main.slice(main.indexOf("function placeRehearsalStand"), main.indexOf("function parkRehearsalHost"));
  assert.match(stand, /dispatchOrbClick/);
  const botHook = stand.indexOf("bot:");
  const selectAt = stand.indexOf("selectBot(id)");
  assert.ok(botHook >= 0 && selectAt > botHook);
  const pressed = main.slice(main.indexOf("function openPressedOrb"), main.indexOf("function abortLiveRehearsals"));
  assert.match(pressed, /activateHitShell\(shell\)/);
});

test("a hidden or unstyled sub-orb panel is not a hit, and open uses the bot morph", () => {
  assert.equal(suborbPublishesPanel({ state: "panel", hidden: true, open: false }), false);
  assert.equal(suborbPublishesPanel({ state: "panel", hidden: false, open: false, morphing: false, opening: "" }), false);
  assert.equal(suborbPublishesPanel({ state: "orb", hidden: true }), false);
  assert.equal(suborbPublishesPanel({ state: "panel", hidden: false, open: true }), true);
  assert.equal(suborbPublishesPanel({ state: "orb", opening: "panel", morphing: true, hidden: false }), true);
  const open = main.slice(main.indexOf("function openSuborbPanel"), main.indexOf("function closeSuborbPanel"));
  assert.match(open, /runShellMorph\(shell, "panel"\)/);
  assert.doesNotMatch(open, /markVisual\(shell, "panel"\)/);
  const hits = main.slice(main.indexOf("function collectHits"), main.indexOf("let hitFrame"));
  assert.match(hits, /suborbPublishesPanel/);
  const close = main.slice(main.indexOf("function closeSuborbPanel"), main.indexOf("async function loadSuborb"));
  assert.match(close, /finishClose\(shell\)/);
  assert.match(close, /panel\.hidden = true/);
});

test("startup seed shows a pin immediately and the next outside session is a sub-orb", () => {
  const seeded = reconcileSuborbs(emptySuborbModel(), {
    sessions: [bot, row("old", { message_count: 3 }), row("pinned-task", { message_count: 1 })],
    mainId: "bot-chat",
    pinned: ["pinned-task"],
    now: 0,
  });
  assert.deepEqual(seeded.shown.map((item) => item.id), ["pinned-task"]);
  const created = reconcileSuborbs(seeded.model, {
    sessions: [bot, row("old", { message_count: 3 }), row("pinned-task", { message_count: 1 }), row("fresh")],
    mainId: "bot-chat",
    pinned: ["pinned-task"],
    now: 1000,
  });
  assert.deepEqual(created.shown.map((item) => item.id), ["pinned-task", "fresh"]);
  const hermes = main.slice(main.indexOf("function useHermes"), main.indexOf("function useHermes") + 1800);
  const reset = hermes.indexOf("state.suborbModels = new Map");
  const seed = hermes.indexOf("seedSessionLists");
  assert.ok(reset >= 0 && seed > reset);
  const seededFn = rust.slice(rust.indexOf("async fn seed_session_lists"), rust.indexOf("fn armed_press"));
  assert.match(seededFn, /list_sessions_for_bot_chat/);
  assert.match(seededFn, /fingerprint\.clear/);
  assert.doesNotMatch(seededFn, /fetch_counted_messages|persist_pin|create_session/);
});

test("the 3s dismiss timer re-evaluates instead of redrawing the old list", () => {
  const first = reconcileSuborbs(emptySuborbModel(), {
    sessions: [bot, row("job", { message_count: 2, last_active: 5 })],
    mainId: "bot-chat",
    now: 0,
  });
  const moved = reconcileSuborbs(first.model, {
    sessions: [bot, row("job", { message_count: 3, last_active: 9, ended: true })],
    mainId: "bot-chat",
    now: 0,
  });
  moved.model.settled.job = true;
  const read = reconcileSuborbs(moved.model, {
    sessions: [bot, row("job", { message_count: 3, last_active: 9, ended: true })],
    mainId: "bot-chat",
    openIds: ["job"],
    now: 10,
  });
  assert.equal(read.shown.length, 1);
  const later = reconcileSuborbs(read.model, {
    sessions: [bot, row("job", { message_count: 3, last_active: 9, ended: true })],
    mainId: "bot-chat",
    openIds: ["job"],
    now: 10 + 3000,
  });
  assert.equal(later.shown.length, 1);
  assert.equal(later.model.dismissAt.job, undefined);
  const note = main.slice(main.indexOf("function noteSuborbList"), main.indexOf("function reevalSuborbs"));
  assert.match(note, /armSuborbDismiss/);
  assert.doesNotMatch(note, /setTimeout\(\(\) => renderSuborbs\(\)\)/);
  const arm = main.slice(main.indexOf("function armSuborbDismiss"), main.indexOf("const suborbPeeks"));
  assert.match(arm, /reevalSuborbs/);
});

test("one fade clock uses the 280ms curve, and discs keep a gap when the parent is docked", () => {
  const tick = main.slice(main.indexOf("function tickOrbFades"), main.indexOf("function scheduleOrbFade"));
  assert.match(tick, /SUBORB_FADE_MS/);
  assert.match(tick, /planEase/);
  assert.match(tick, /el\.dataset\.kind === "suborb"/);
  const size = suborbSizePx(44);
  const slots = suborbPositions({
    edge: "right",
    x: 1000,
    y: 400,
    parent: 28,
    count: 2,
    size,
    gap: 6,
    screenW: 1280,
    screenH: 800,
  });
  const gap = (slots[1].y - slots[0].y) - size;
  assert.ok(gap >= 6 - 0.01, `gap ${gap}`);
  const paint = main.slice(main.indexOf("const anchor = parentOrbBox"), main.indexOf("const slots = anchor"));
  assert.match(paint, /suborbSizePx\(ORB\)/);
  assert.doesNotMatch(paint, /suborbSizePx\(anchor/);
});

test("a stored user line keeps the running arc until the reply settles", () => {
  const base = reconcileSuborbs(emptySuborbModel(), {
    sessions: [bot, row("job")],
    mainId: "bot-chat",
    now: 0,
  });
  const grew = reconcileSuborbs(base.model, {
    sessions: [bot, row("job", { message_count: 1, last_active: 4 })],
    mainId: "bot-chat",
    now: 1,
  });
  grew.model.settled.job = false;
  const waiting = reconcileSuborbs(grew.model, {
    sessions: [bot, row("job", { message_count: 1, last_active: 4 })],
    mainId: "bot-chat",
    now: 2,
  });
  assert.equal(waiting.shown[0].channels.activity, "running");
  waiting.model.settled.job = true;
  const done = reconcileSuborbs(waiting.model, {
    sessions: [bot, row("job", { message_count: 2, last_active: 8 })],
    mainId: "bot-chat",
    now: 3,
  });
  done.model.settled.job = true;
  const idle = reconcileSuborbs(done.model, {
    sessions: [bot, row("job", { message_count: 2, last_active: 8 })],
    mainId: "bot-chat",
    now: 4,
  });
  assert.equal(idle.shown[0].channels.activity, "idle");
  assert.equal(idle.shown[0].channels.badge, "unread");
});

test("the first click on 開新 session reveals the form, and main /new does not re-pin", () => {
  const dom = new JSDOM("<!doctype html><body><form hidden></form></body>");
  const { document } = dom.window;
  const panel = document.createElement("div");
  document.body.append(panel);
  const button = document.createElement("button");
  button.dataset.role = "new-session";
  panel.append(button);
  let form = panel.querySelector("[data-role='new-session-form']");
  const click = () => {
    let created = false;
    if (!form) {
      created = true;
      form = document.createElement("form");
      form.dataset.role = "new-session-form";
      form.hidden = true;
      button.after(form);
    }
    form.hidden = created ? false : !form.hidden;
  };
  click();
  assert.equal(form.hidden, false);
  click();
  assert.equal(form.hidden, true);
  const toggle = main.slice(main.indexOf("function toggleNewSessionForm"), main.indexOf("async function toggleSuborbPin"));
  const hideAt = toggle.indexOf("form.hidden = true");
  const flipAt = toggle.lastIndexOf("form.hidden = !form.hidden");
  assert.ok(hideAt >= 0 && hideAt < flipAt);
  const command = main.slice(main.indexOf("async function sendClientCommand"), main.indexOf("function useMock"));
  const fresh = command.indexOf('action.command === "new"');
  const invoke = command.indexOf('invoke("client_command"');
  assert.ok(fresh >= 0 && fresh < invoke);
  assert.match(command, /createTaskSession\(gatewayProfile\(id\)/);
  const rustNew = rust.slice(rust.indexOf('"new" =>'), rust.indexOf('"title" =>'));
  assert.doesNotMatch(rustNew, /pin_explicit/);
});

test("an open unpinned sub-orb stays until the panel has been closed for 3s", () => {
  const dom = new JSDOM("<!doctype html><body><div id='rail'></div></body>");
  const { document } = dom.window;
  const rail = document.getElementById("rail");
  const shell = document.createElement("div");
  shell.className = "morph";
  shell.dataset.kind = "suborb";
  shell.dataset.state = "panel";
  const input = document.createElement("textarea");
  input.dataset.role = "input";
  input.value = "仲未送";
  shell.append(input);
  rail.append(shell);
  const base = reconcileSuborbs(emptySuborbModel(), {
    sessions: [bot, row("job", { message_count: 1, last_active: 2 })],
    mainId: "bot-chat",
    now: 0,
  });
  const moved = reconcileSuborbs(base.model, {
    sessions: [bot, row("job", { message_count: 2, last_active: 4, ended: true })],
    mainId: "bot-chat",
    now: 1,
  });
  moved.model.settled.job = true;
  moved.model.read.job = 2;
  const open = reconcileSuborbs(moved.model, {
    sessions: [bot, row("job", { message_count: 2, last_active: 4, ended: true })],
    mainId: "bot-chat",
    openIds: ["job"],
    now: 3000,
  });
  assert.equal(open.shown.length, 1);
  const typing = reconcileSuborbs(open.model, {
    sessions: [bot, row("job", { message_count: 2, last_active: 4, ended: true })],
    mainId: "bot-chat",
    holdIds: ["job"],
    now: 9000,
  });
  assert.equal(typing.shown.length, 1);
  assert.equal(input.value.length > 0, true);
  const closed = reconcileSuborbs(typing.model, {
    sessions: [bot, row("job", { message_count: 2, last_active: 4, ended: true })],
    mainId: "bot-chat",
    now: 9000,
  });
  closed.model.closedAt.job = 9000;
  const due = reconcileSuborbs(closed.model, {
    sessions: [bot, row("job", { message_count: 2, last_active: 4, ended: true })],
    mainId: "bot-chat",
    now: 12000,
  });
  assert.equal(due.shown.length, 0);
  const close = main.slice(main.indexOf("function closeSuborbPanel"), main.indexOf("async function loadSuborb"));
  assert.match(close, /closedAt\[sub\.sessionId\] = Date\.now\(\)/);
  const note = main.slice(main.indexOf("function noteSuborbList"), main.indexOf("function reevalSuborbs"));
  assert.match(note, /holdIds: suborbHoldIds/);
});

test("a smaller orb wins a point that also sits in the main orb hit", () => {
  const mainOrb = { id: "bot:writer", x: 0, y: 0, w: 68, h: 68, z: 8, round: true };
  const sub = { id: "bot:suborb:writer:job", x: 40, y: 40, w: 42, h: 42, z: 1, round: true };
  assert.equal(elementUnderCursor({ x: 50, y: 50 }, [mainOrb, sub], 12), "bot:suborb:writer:job");
  const same = { id: "bot:suborb:writer:next", x: 40, y: 40, w: 42, h: 42, z: 4, round: true };
  assert.equal(elementUnderCursor({ x: 50, y: 50 }, [sub, same], 12), "bot:suborb:writer:next");
  const finish = main.slice(main.indexOf("async function finishClose"), main.indexOf("function showBotTab"));
  assert.match(finish, /layoutSuborbOrbs\(\)/);
  const settle = main.slice(main.indexOf("function settleShell"), main.indexOf("function stopShellTransition"));
  assert.match(settle, /layoutSuborbOrbs\(\)/);
  const at = main.slice(main.indexOf("function orbShellAtPoint"), main.indexOf("function ctrlOrbRect"));
  assert.match(at, /discBeats/);
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.match(css, /\.morph\[data-kind="suborb"\] \.bot-btn \.bot-hit \{\s*inset:\s*0;/);
});

test("removing a sub-orb tears down its plan host", () => {
  const dom = new JSDOM("<!doctype html><body><div class='bot-rail'></div></body>");
  const { document } = dom.window;
  const rail = document.querySelector(".bot-rail");
  const shell = document.createElement("div");
  shell.className = "morph";
  shell.dataset.kind = "suborb";
  const plan = document.createElement("div");
  plan.className = "plan-window";
  const host = document.createElement("div");
  host.className = "plan-hit-host";
  host.append(plan);
  host._planShell = shell;
  shell._planHost = host;
  rail.append(shell, host);
  releaseSuborbNodes(shell);
  assert.equal(rail.querySelector(".plan-hit-host"), null);
  assert.equal(rail.querySelector(".plan-window"), null);
  assert.equal(shell.isConnected, false);
  const paint = main.slice(main.indexOf("function renderSuborbs"), main.indexOf("function layoutSuborbOrbs"));
  assert.match(paint, /releaseSuborbNodes\(shell\)/);
  assert.doesNotMatch(paint, /shell\.remove\(\)/);
});

test("a new session with five discs stays on the rail and opens a shifted panel", () => {
  const seed = reconcileSuborbs(emptySuborbModel(), {
    sessions: [bot],
    mainId: "bot-chat",
    now: 0,
  });
  const tasks = [0, 1, 2, 3, 4].map((i) => row(`t${i}`, { started_at: i + 1 }));
  const five = reconcileSuborbs(seed.model, {
    sessions: [bot, ...tasks],
    mainId: "bot-chat",
    now: 1,
  });
  assert.equal(five.shown.length, 5);
  five.model.forced.fresh = true;
  const born = reconcileSuborbs(five.model, {
    sessions: [bot, ...tasks, row("fresh", { started_at: 40 })],
    mainId: "bot-chat",
    openIds: ["fresh"],
    now: 2,
  });
  assert.equal(born.shown.some((item) => item.id === "fresh"), true);
  assert.deepEqual(born.overflow.map((item) => item.id), ["t0"]);
  const pinned = tasks.map((item) => item.id);
  const overCap = reconcileSuborbs(five.model, {
    sessions: [bot, ...tasks, row("fresh", { started_at: 40 })],
    mainId: "bot-chat",
    pinned,
    now: 3,
  });
  overCap.model.forced.fresh = true;
  const kept = reconcileSuborbs(overCap.model, {
    sessions: [bot, ...tasks, row("fresh", { started_at: 40 })],
    mainId: "bot-chat",
    pinned,
    now: 4,
  });
  assert.equal(kept.shown.some((item) => item.id === "fresh"), true);
  assert.equal(kept.shown.length, 6);
  assert.deepEqual(capSuborbs(kept.shown, 5, ["fresh"]).shown.map((item) => item.id).includes("fresh"), true);
  assert.deepEqual(suborbPanelShift(0), { x: 0, y: 0 });
  assert.deepEqual(suborbPanelShift(1), { x: 36, y: 36 });
  const place = main.slice(main.indexOf("function placeSuborbShell"), main.indexOf("function wireSuborbPanel"));
  assert.match(place, /suborbPanelShift/);
  const escape = main.slice(main.indexOf("function closeOpenPanel"), main.indexOf("let composerField"));
  assert.match(escape, /isSuborbId\(id\)\) closeSuborbPanel\(id\)/);
  const send = main.slice(main.indexOf("async function sendActive"), main.indexOf("async function continueApiSession"));
  const actionAt = send.indexOf("if (action)");
  const endedAt = send.indexOf("sessionEnded");
  assert.ok(actionAt >= 0 && actionAt < endedAt);
  const keys = main.slice(main.indexOf("function wireBotPanel"), main.indexOf("function mountBotPanel", main.indexOf("function wireBotPanel")));
  assert.match(keys, /bareNewSubmits\(picked, input\?\.value/);
});
