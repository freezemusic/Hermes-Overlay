import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { botIdFromHit } from "./proximity.js";
import {
  dispatchOrbClick,
  emptySuborbModel,
  reconcileSuborbs,
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
  assert.equal(later.shown.length, 0);
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
