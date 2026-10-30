import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { botIdFromHit, chooseEscapePanel, elementUnderCursor, keepOverlayKeyTarget } from "./proximity.js";
import {
  capSuborbs,
  dispatchOrbClick,
  emptySuborbModel,
  placeSuborbCascade,
  suborbCascadeOrigin,
  sessionCreateError,
  reconcileSuborbs,
  releaseSuborbNodes,
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
  const first = placeSuborbCascade({
    left: 860,
    top: 40,
    width: 420,
    height: 560,
    index: 0,
    screenW: 1280,
    screenH: 800,
  });
  const stepped = placeSuborbCascade({
    left: 860,
    top: 40,
    width: 420,
    height: 560,
    index: 1,
    screenW: 1280,
    screenH: 800,
  });
  assert.equal(first.height, 560);
  assert.equal(stepped.height, 560);
  assert.equal(stepped.top, first.top + 36);
  const place = main.slice(main.indexOf("function placeSuborbShell"), main.indexOf("function wireSuborbPanel"));
  assert.match(place, /placeSuborbCascade/);
  const escape = main.slice(main.indexOf("function closeOpenPanel"), main.indexOf("let composerField"));
  assert.match(escape, /isSuborbId\(id\)\) closeSuborbPanel\(id\)/);
  const send = main.slice(main.indexOf("async function sendActive"), main.indexOf("async function continueApiSession"));
  const actionAt = send.indexOf("if (action)");
  const endedAt = send.indexOf("sessionEnded");
  assert.ok(actionAt >= 0 && actionAt < endedAt);
  const keys = main.slice(main.indexOf("function wireBotPanel"), main.indexOf("function mountBotPanel", main.indexOf("function wireBotPanel")));
  assert.match(keys, /bareNewSubmits\(picked, input\?\.value/);
});

test("an idle sub-orb glow is not clipped by the hidden panel shell", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const idle = css.slice(css.indexOf('.morph[data-kind="suborb"][data-state="orb"]'));
  assert.match(idle, /overflow:\s*visible !important/);
  assert.match(idle, /\.suborb-disc::before/);
  assert.match(idle, /contain:\s*none/);
  assert.match(idle, /\.plan-hit-host:has\(> \.plan-window\[hidden\]\)/);
  assert.doesNotMatch(css, /clip-path:\s*none !important/);
  const glow = main.slice(main.indexOf("function releaseSuborbGlow"), main.indexOf("function placeSuborbShell"));
  assert.match(glow, /clipPath = "none"/);
  assert.match(glow, /overflow = "visible"/);
  assert.match(glow, /getAnimations/);
  const layout = main.slice(main.indexOf("function layoutShell"), main.indexOf("function parkFinalBox"));
  assert.match(layout, /releaseSuborbGlow\(shell\)/);
});

test("Esc after a closed sub-orb closes the main panel that is still open", () => {
  const panels = [
    { id: "suborb:writer:job", kind: "suborb", state: "panel", open: false, hidden: true, collapsing: false, z: 9 },
    { id: "writer", kind: "bot", state: "panel", open: true, hidden: false, collapsing: false, z: 2 },
  ];
  assert.equal(chooseEscapePanel(panels, "suborb:writer:job"), "writer");
  assert.equal(chooseEscapePanel(panels, ""), "writer");
  assert.equal(chooseEscapePanel([
    { id: "suborb:writer:job", kind: "suborb", state: "panel", open: true, hidden: false, z: 9 },
    { id: "writer", kind: "bot", state: "panel", open: true, hidden: false, z: 2 },
  ], "suborb:writer:job"), "suborb:writer:job");
  const top = main.slice(main.indexOf("function topOpenPanelId"), main.indexOf("function focusedOpenPanelId"));
  assert.match(top, /chooseEscapePanel\(panels, ""\)/);
  const close = main.slice(main.indexOf("function closeSuborbPanel"), main.indexOf("async function loadSuborb"));
  const drop = close.indexOf('classList.remove("open")');
  const morph = close.indexOf("finishClose(shell)");
  assert.ok(drop >= 0 && drop < morph);
});

test("a cascade that would shrink the card wraps and keeps the full height", () => {
  const short = placeSuborbCascade({
    left: 800,
    top: 500,
    width: 420,
    height: 240,
    index: 1,
    screenW: 1280,
    screenH: 800,
    panelW: 420,
    panelH: 560,
  });
  assert.equal(short.height, 560);
  assert.ok(short.top + short.height <= 800);
  assert.ok(short.left >= 0 && short.left + short.width <= 1280);
  assert.ok(short.left < 800);
  const room = placeSuborbCascade({
    left: 40,
    top: 40,
    width: 420,
    height: 560,
    index: 2,
    screenW: 1280,
    screenH: 900,
  });
  assert.equal(room.height, 560);
  assert.equal(room.top, 40 + 72);
  const stack = main.slice(main.indexOf("function separateOpenShells"), main.indexOf("function layoutShells"));
  assert.match(stack, /kind === "suborb"\) return false/);
});

test("a repeated default title is unique, and a failed create shows a notice", () => {
  const aboveTaskbar = placeSuborbCascade({
    left: 800,
    top: 240,
    width: 420,
    height: 560,
    index: 0,
    screenW: 1280,
    screenH: 800,
    insetBottom: 48,
  });
  assert.equal(aboveTaskbar.height, 560);
  assert.ok(aboveTaskbar.top + aboveTaskbar.height <= 800 - 48);
  assert.equal(keepOverlayKeyTarget(["suborb:writer:job", "writer"], "suborb:writer:job"), true);
  assert.equal(keepOverlayKeyTarget(["writer"], "writer"), false);
  assert.equal(sessionCreateError({}), "開唔到新對話。");
  const created = main.slice(main.indexOf("async function createTaskSession"), main.indexOf("function installNewSessionButton"));
  assert.match(created, /uniqueTaskTitle\(title, known\)/);
  assert.match(created, /noteSessionCreateFailed\(fromId, sessionCreateError\(err\)\)/);
  assert.match(created, /noteSessionCreateFailed\(fromId, "開唔到新對話。"\)/);
  const focus = main.slice(main.indexOf("function releaseOverlayFocus"), main.indexOf("function paintLocalProximity"));
  assert.match(focus, /keepOverlayKeyTarget\(openIds, closingId\)/);
  assert.match(focus, /invoke\("release_overlay_focus", \{ restore \}\)/);
  const interaction = readFileSync(new URL("../src-tauri/src/interaction.rs", import.meta.url), "utf8");
  const linux = interaction.slice(interaction.indexOf("pub fn release_overlay_focus"), interaction.indexOf("pub fn focus_owner_name"));
  assert.match(linux, /if restore/);
  assert.match(linux, /focus_overlay_webview/);
  assert.match(linux, /grab_focus/);
  assert.match(linux, /set_focus\(None/);
  assert.match(linux, /not\(target_os = "linux"\)/);
  const windows = linux.slice(linux.indexOf('not(target_os = "linux")'), linux.indexOf("fn focus_overlay_webview"));
  assert.doesNotMatch(windows, /grab_focus|set_focus\(\)/);
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.match(css, /\.morph\[data-state="panel"\]:not\(\.is-collapsing\) \{\s*z-index:\s*6;/);
});

test("three /new panels step 36px instead of opening on the same point", () => {
  const origin = {
    left: 526,
    top: 580,
    width: 420,
    height: 240,
    screenW: 1920,
    screenH: 1080,
    panelW: 420,
    panelH: 560,
    insetBottom: 48,
  };
  const boxes = [0, 1, 2].map((index) => placeSuborbCascade({ ...origin, index }));
  assert.equal(new Set(boxes.map((box) => `${box.left},${box.top}`)).size, 3);
  assert.equal(boxes.every((box) => box.height === 560), true);
  assert.equal(boxes.every((box) => box.top + box.height <= 1080 - 48), true);
  const room = [0, 1, 2].map((index) => placeSuborbCascade({
    left: 526,
    top: 80,
    width: 420,
    height: 560,
    index,
    screenW: 1920,
    screenH: 1400,
    insetBottom: 48,
  }));
  assert.equal(room[1].top, room[0].top + 36);
  assert.equal(room[2].top, room[0].top + 72);
  assert.equal(room[1].left, room[0].left);
  const place = main.slice(main.indexOf("function placeSuborbShell"), main.indexOf("function wireSuborbPanel"));
  assert.match(place, /openSuborbPanelIndex\(shell\)/);
  assert.doesNotMatch(place, /parentDiscAvoid/);
  assert.match(place, /dataset\.anchor/);
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.match(css, /\.morph\[data-kind="suborb"\]\[data-anchor="end"\] \.center-panel > \.panel-header \{\s*padding-right:\s*64px;/);
});

test("S23: after the /new cascade wraps, every panel still steps a full 36px", () => {
  // Box layout: 1920x1200, taskbar 41px, panels docked at the bottom (top 580, full 560 height).
  const base = { left: 592, top: 580, width: 420, height: 560, screenW: 1920, screenH: 1200, panelW: 420, panelH: 560, insetBottom: 41 };
  const boxes = Array.from({ length: 10 }, (_, index) => placeSuborbCascade({ ...base, index }));
  boxes.forEach((box, index) => {
    assert.equal(box.height, 560);
    assert.equal(box.top, 580);
    assert.equal(box.left, 592 + index * 36);
    assert.ok(box.left + box.width <= 1920 && box.top + box.height <= 1200 - 41);
  });
  assert.equal(new Set(boxes.map((box) => `${box.left},${box.top}`)).size, boxes.length);
  // Once one side runs out, the columns continue on the other side of the origin, still 36px apart.
  const side = { left: 700, top: 240, width: 420, height: 560, screenW: 1280, screenH: 800, panelW: 420, panelH: 560 };
  const lefts = Array.from({ length: 24 }, (_, index) => placeSuborbCascade({ ...side, index }).left);
  assert.equal(lefts[19], 700 - 19 * 36);
  assert.equal(lefts[20], 736);
  assert.equal(lefts[21], 772);
  for (let i = 1; i <= 21; i += 1) assert.equal(Math.abs(lefts[i] - lefts[i - 1]) % 36, 0);
  assert.equal(new Set(lefts.slice(0, 24)).size >= 23, true);
  // The origin is the first open panel's disc, not each panel's own disc (the drift behind S23).
  const a = { id: "a" };
  const b = { id: "b" };
  assert.equal(suborbCascadeOrigin([a, b], b), a);
  assert.equal(suborbCascadeOrigin([], b), b);
  const place = main.slice(main.indexOf("function placeSuborbShell"), main.indexOf("function wireSuborbPanel"));
  assert.match(place, /cascadeOriginBox\(shell, size, vw, vh\)/);
  assert.match(place, /left: origin\.left,\s*top: origin\.top,/);
  const originBox = main.slice(main.indexOf("function cascadeOriginBox"), main.indexOf("function openSuborbPanel("));
  assert.match(originBox, /suborbCascadeOrigin\(openSuborbShells\(\), shell\)/);
});

test("開新 session is a compact ＋ icon beside the session picker, with a tooltip", () => {
  const install = main.slice(main.indexOf("function installNewSessionButton"), main.indexOf("function toggleNewSessionForm"));
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const template = html.slice(html.indexOf('<template id="bot-panel-template">'), html.indexOf("</template>"));
  const build = (suborb) => {
    const dom = new JSDOM(`<!doctype html><body>${template.replace(/^<template[^>]*>/, "")}</body>`);
    const { document } = dom.window;
    const panel = document.querySelector(".bot-panel");
    const role = (root, name) => root?.querySelector(`[data-role="${name}"]`);
    if (suborb) {
      const pin = document.createElement("button");
      pin.dataset.role = "pin";
      role(panel, "close").before(pin);
    }
    const toggled = [];
    const run = new Function("document", "role", "isSuborbId", "NEW_SESSION_LABEL", "toggleNewSessionForm", "panel", "id",
      `${install}\ninstallNewSessionButton(panel, id);`);
    run(document, role, (id) => id.startsWith("suborb:"), "開新 session", (p, id) => toggled.push(id), panel, suborb ? "suborb:writer:job" : "writer");
    const button = role(panel, "new-session");
    button.click();
    return { panel, button, toggled };
  };
  const mainPanel = build(false);
  assert.equal(mainPanel.button.textContent, "＋");
  assert.equal(mainPanel.button.title, "開新 session");
  assert.equal(mainPanel.button.getAttribute("aria-label"), "開新 session");
  assert.equal(mainPanel.button.type, "button");
  assert.equal(mainPanel.button.classList.contains("continue-btn"), false);
  assert.equal(mainPanel.button.previousElementSibling.dataset.role, "session");
  assert.equal(mainPanel.button.closest(".chat-head") !== null, true);
  assert.equal(mainPanel.panel.querySelector(".composer [data-role='new-session']"), null);
  assert.deepEqual(mainPanel.toggled, ["writer"]);
  const sub = build(true);
  assert.equal(sub.button.closest(".panel-actions") !== null, true);
  assert.equal(sub.button.nextElementSibling.dataset.role, "pin");
  assert.deepEqual(sub.toggled, ["suborb:writer:job"]);
  const wire = main.slice(main.indexOf("function wireSuborbPanel"), main.indexOf("function paintSuborbPin"));
  assert.match(wire, /paintSuborbPin\(id, panel\)/);
  assert.match(main, /function paintSuborbPin\(id, panel = panelFor\(id\)\)/);
  const toggle = main.slice(main.indexOf("function toggleNewSessionForm"), main.indexOf("async function toggleSuborbPin"));
  assert.match(toggle, /composer\?\.insertBefore\(form, composer\.firstChild\)/);
  assert.match(toggle, /aria-expanded/);
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const rule = css.slice(css.indexOf(".icon-btn.new-session-btn {"), css.indexOf("}", css.indexOf(".icon-btn.new-session-btn {")));
  assert.match(rule, /width: 24px/);
  assert.match(rule, /height: 24px/);
  assert.match(css, /\.icon-btn\.new-session-btn:focus-visible/);
  assert.match(css, /\.new-session-form \{\s*flex: 1 0 100%/);
  const keys = main.slice(main.indexOf("function setupComposer"), main.indexOf('window.addEventListener("keyup"', main.indexOf("function setupComposer")));
  assert.match(keys, /action === "insert" && composerField && !foreignFieldFocus\(\) && !newSessionKeyFocus\(event\.key\)/);
  assert.match(keys, /composerHostOpen\(composerField\) \|\| composerFieldHidden\(composerField\)\)\) composerField = latched/);
  const hiddenField = main.slice(main.indexOf("function composerFieldHidden"), main.indexOf("function composerIsBusy"));
  assert.match(hiddenField, /closest\?\.\("\[hidden\]"\)/);
  const space = main.slice(main.indexOf("function newSessionKeyFocus"), main.indexOf("function composerIsBusy"));
  assert.match(space, /key === " " && document\.activeElement\?\.dataset\?\.role === "new-session"/);
});
