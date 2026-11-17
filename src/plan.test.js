import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { logQuietRefreshFailure, openHistory, schedulePlanFileCatchUp } from "./history-open.js";
import { composeBubble, composeModeLabel, composeModeWire, composeSkipsBusyQueue, dismissPlan, focusPlan, latestPlan, latestTurnPlan, looksLikePlan, nextComposeMode, notePlans, offeredComposeModes, planBodyLead, planChipText, planDemoMarkdown, planFileCaughtUp, planForPanel, planNeedsFileCatchUp, plansIn, planTask, planTextHash, planTitle, planView, rememberPlan } from "./plan.js";
import { gatewayDown } from "./reconnect.js";
import { continueLiveTurn, finishLiveBubble } from "./sessions.js";

const PLAN_PATH_WIN = String.raw`C:\Users\freez\Desktop\MetaTrader Workbench\.hermes\plans\2026-11-11_013841-runtime-gate-status.md`;

/** A bot row that carries a same-turn write_file plan (hermes.rs attach_plan). */
function filed(text, content, path = ".hermes/plans/2026-11-17_170300-ship.md") {
  return { role: "bot", text, plan: { path, content } };
}

/** A loaded thread that has already painted once (history recorded). */
function loadedThread(messages, sessionId = "s1") {
  const thread = { messages, loaded: true, sessionId };
  notePlans(thread);
  return thread;
}

test("plan titles and the /plan task still parse", () => {
  const body = planDemoMarkdown("整理設定");
  assert.equal(planTitle(body), "整理設定 Implementation Plan");
  assert.equal(planBodyLead(body, "計劃"), body);
  assert.equal(planBodyLead(body, planTitle(body)), body);
  assert.equal(planBodyLead("正文", "v25 replace test"), "# v25 replace test\n\n正文");
  assert.equal(planTitle("收到，我再諗。"), "計劃");
  assert.equal(planTask("/plan 整理設定"), "整理設定");
  assert.equal(planTask("/planet"), null);
  assert.equal(planTask("hello"), null);
});

test("R-PL-01 (Devon 2026-11-17): chat text alone is never a plan", () => {
  const goal = "# 筆記\n\n**Goal:** 對齊面板\n\n- 第一步\n- 第二步";
  const implementation = "# Ship Implementation Plan\n\n- a\n- b";
  const fenced = ["```markdown", "# 整理設定 Implementation Plan", "", "**Goal:** 對齊面板", "```"].join("\n");
  const planFence = ["```plan", "# 只得標題", "", "下一步", "```"].join("\n");
  const pathHeading = "# 已寫\n\n`.hermes/plans/2026-10-15_120000-setup.md`";
  const pathLong = `${"先在原路徑重建 worktree，分支用現有的 hermes/mt5-ea-wrappers。".repeat(5)}\n${PLAN_PATH_WIN}`;
  assert.ok(pathLong.length >= 200);
  const slashReply = "呢份計劃會先改設定畫面，再核對每個 profile 嘅圓球顏色、光暈同預覽面板。";
  for (const text of [goal, implementation, fenced, planFence, pathHeading, pathLong, planDemoMarkdown("舊")]) {
    assert.deepEqual(plansIn([{ role: "user", text: "幫手睇睇" }, { role: "bot", text }]), [], text.slice(0, 30));
  }
  // A /plan turn followed by a long reply is not a plan without the file either.
  assert.deepEqual(plansIn([{ role: "user", text: "/plan 新", command: "plan" }, { role: "bot", text: slashReply }]), []);
  assert.equal(latestPlan([{ role: "user", text: "hi" }, { role: "bot", text: goal }]), null);
  // No 「計劃檔內容唔在對話紀錄裡面。」 summary any more: a path-only summary opens nothing.
  const found = plansIn([{ role: "user", text: "寫計劃", command: "plan" }, { role: "bot", text: `詳細計劃已寫好。\n\n${PLAN_PATH_WIN}` }]);
  assert.deepEqual(found, []);
});

test("only a same-turn write_file plan with content is a plan", () => {
  const file = "# Runtime Gate Status\n\n**Goal:** 補回缺失的 health 檔。\n";
  const messages = [
    { role: "user", text: "寫計劃", command: "plan" },
    { role: "tool-run", text: "用咗 1 個工具 · write_file" },
    filed("詳細計劃已寫好。", file, PLAN_PATH_WIN),
  ];
  const found = plansIn(messages);
  assert.equal(found.length, 1);
  assert.equal(found[0].fromFile, true);
  assert.equal(found[0].markdown, file);
  assert.equal(found[0].title, "Runtime Gate Status");
  assert.equal(found[0].index, 2);
  // Empty content, a non-plan path, or a live bubble do not count.
  assert.deepEqual(plansIn([filed("x", "")]), []);
  assert.deepEqual(plansIn([filed("x", "# A", "notes/a.md")]), []);
  assert.deepEqual(plansIn([{ ...filed("x", "# A"), live: true }]), []);
  assert.equal(latestTurnPlan(messages).key, found[0].key);
  assert.equal(latestTurnPlan([...messages, { role: "user", text: "多謝" }, { role: "bot", text: "# 唔係計劃\n\n**Goal:** x" }]), null);
});

test("an ordinary structured reply in a loaded session does not open the plan window", () => {
  const thread = loadedThread([{ role: "user", text: "hi" }, { role: "bot", text: "ok" }]);
  thread.messages.push({ role: "user", text: "整理吓" });
  thread.messages.push({ role: "bot", text: "# 筆記\n\n**Goal:** 對齊面板\n\n```markdown\n# 內文\n```\n\n.hermes/plans/x.md" });
  assert.equal(notePlans(thread), false);
  assert.equal(planForPanel(thread), null);
});

test("a new same-turn write_file plan in the latest turn opens; history does not", () => {
  const old = filed("舊計劃已寫好。", "# 舊計劃\n\n- a");
  const thread = loadedThread([{ role: "user", text: "/plan 舊", command: "plan" }, old]);
  // History (first load, restart, reopen) records the plan but leaves it shut.
  assert.equal(planForPanel(thread), null);
  thread.messages.push({ role: "user", text: "/plan 新", command: "plan" });
  thread.messages.push(filed("新計劃已寫好。", "# 新計劃\n\n- b", ".hermes/plans/new.md"));
  assert.equal(notePlans(thread), true);
  assert.equal(planForPanel(thread).title, "新計劃");
  assert.equal(notePlans(thread), false);
});

test("an older plan never reopens on a later ordinary turn", () => {
  const thread = loadedThread([{ role: "user", text: "hi" }]);
  thread.messages.push({ role: "user", text: "/plan 舊", command: "plan" });
  thread.messages.push(filed("寫好。", "# 舊計劃"));
  notePlans(thread);
  assert.equal(planForPanel(thread).title, "舊計劃");
  dismissPlan(thread);
  assert.equal(planForPanel(thread), null);
  thread.messages.push({ role: "user", text: "多謝" });
  thread.messages.push({ role: "bot", text: "# 好\n\n**Goal:** 收工" });
  assert.equal(notePlans(thread), false);
  assert.equal(planForPanel(thread), null);
  // A history reread with the same rows changes nothing either.
  thread.messages = thread.messages.map((row) => ({ ...row }));
  assert.equal(notePlans(thread), false);
  assert.equal(planForPanel(thread), null);
  // 睇計劃 is the only way back.
  const [plan] = plansIn(thread.messages);
  focusPlan(thread, plan.key);
  assert.equal(planForPanel(thread).key, plan.key);
});

test("an older plan does not open on a session switch, and dismiss is per session", () => {
  const thread = loadedThread([{ role: "user", text: "hi" }], "a");
  thread.messages.push({ role: "user", text: "/plan A", command: "plan" });
  thread.messages.push(filed("寫好。", "# 計劃 A"));
  notePlans(thread);
  assert.equal(planForPanel(thread).title, "計劃 A");
  dismissPlan(thread);
  assert.equal(planView(thread).dismissed, planView(thread).seen.values().next().value);
  // Switch to session b, whose history already has a plan in its latest turn.
  thread.sessionId = "b";
  thread.messages = [{ role: "user", text: "/plan B", command: "plan" }, filed("寫好。", "# 計劃 B", ".hermes/plans/b.md")];
  assert.equal(notePlans(thread), false);
  assert.equal(planForPanel(thread), null);
  const [planB] = plansIn(thread.messages);
  focusPlan(thread, planB.key);
  assert.equal(planForPanel(thread).title, "計劃 B");
  // Back to a: still dismissed there, and b's open plan did not leak.
  thread.sessionId = "a";
  thread.messages = [{ role: "user", text: "/plan A", command: "plan" }, filed("寫好。", "# 計劃 A")];
  notePlans(thread);
  assert.equal(planForPanel(thread), null);
  thread.sessionId = "b";
  thread.messages = [{ role: "user", text: "/plan B", command: "plan" }, filed("寫好。", "# 計劃 B", ".hermes/plans/b.md")];
  assert.equal(planForPanel(thread).title, "計劃 B");
});

test("a fresh thread hands its plan state to its first session id", () => {
  const thread = loadedThread([], "");
  thread.messages.push({ role: "user", text: "/plan 新", command: "plan" });
  thread.sessionId = "created";
  thread.messages.push(filed("寫好。", "# 新"));
  assert.equal(notePlans(thread), true);
  assert.equal(planForPanel(thread).title, "新");
  assert.equal(thread.planViews.has(""), false);
});

test("nothing opens before the session loads, and the cache never shows another session's plan", () => {
  const thread = { messages: [{ role: "user", text: "/plan", command: "plan" }, filed("寫好。", "# 計劃")], loaded: false, sessionId: "s1" };
  assert.equal(notePlans(thread), false);
  assert.equal(planForPanel(thread), null);
  thread.loaded = true;
  notePlans(thread);
  const [plan] = plansIn(thread.messages);
  focusPlan(thread, plan.key);
  const cached = rememberPlan(thread);
  assert.equal(cached.key, plan.key);
  assert.equal(cached.sessionId, "s1");
  // Before a reload the cache can paint for the same session only.
  thread.loaded = false;
  thread.messages = [];
  assert.equal(planForPanel(thread).key, plan.key);
  thread.sessionId = "s2";
  assert.equal(planForPanel(thread), null);
  thread.sessionId = "s1";
  dismissPlan(thread);
  assert.equal(planForPanel(thread), null);
  // A loaded session with no open plan clears the cache.
  thread.loaded = true;
  assert.equal(rememberPlan(thread), null);
  assert.equal(thread.planCache, null);
});

test("睇計劃 clears a dismiss so the same plan shows again", () => {
  const thread = loadedThread([{ role: "user", text: "/plan", command: "plan" }, filed("寫好。", planDemoMarkdown("再開"))]);
  const [plan] = plansIn(thread.messages);
  assert.equal(planForPanel(thread), null);
  focusPlan(thread, plan.key);
  assert.equal(planForPanel(thread).key, plan.key);
  dismissPlan(thread);
  assert.equal(planForPanel(thread), null);
  assert.equal(notePlans(thread), false);
  assert.equal(planForPanel(thread), null);
  focusPlan(thread, plan.key);
  assert.equal(planForPanel(thread).key, plan.key);
});

test("the sub-orb tail badge still uses the text check, which never opens a plan", () => {
  assert.equal(looksLikePlan(planDemoMarkdown("x")), true);
  assert.equal(looksLikePlan("收到，我再諗。"), false);
  const plan = plansIn([{ role: "bot", text: planDemoMarkdown("x") }]);
  assert.deepEqual(plan, []);
});

test("compose modes prefix plan and btw, and leave slash commands alone", () => {
  const both = { plan: true, btw: true };
  assert.equal(nextComposeMode("", both), "plan");
  assert.equal(nextComposeMode("plan", both), "btw");
  assert.equal(nextComposeMode("btw", both), "");
  assert.equal(nextComposeMode("plan", { plan: true, btw: false }), "");
  assert.equal(nextComposeMode("", { plan: false, btw: true }), "btw");
  assert.equal(nextComposeMode("btw", { plan: false, btw: true }), "");
  assert.equal(nextComposeMode("plan", { plan: false, btw: false }), "");
  assert.equal(nextComposeMode("debug", both), "plan");
  assert.equal(nextComposeMode("yolo", both), "plan");
  assert.equal(composeModeLabel(""), "一般");
  assert.equal(composeModeLabel("plan"), "Plan");
  assert.equal(composeModeLabel("btw"), "旁問");
  assert.equal(composeModeWire("整理設定", ""), "整理設定");
  assert.equal(composeModeWire("整理設定", "plan"), "/plan 整理設定");
  assert.equal(composeModeWire("  整理設定  ", "plan"), "/plan 整理設定");
  assert.equal(composeModeWire("/plan 已有", "plan"), "/plan 已有");
  assert.equal(composeModeWire("/Plan 已有", "plan"), "/Plan 已有");
  assert.equal(composeModeWire("順便問", "btw"), "/btw 順便問");
  assert.equal(composeModeWire("/btw 已有", "btw"), "/btw 已有");
  assert.equal(composeModeWire("/renew 舊題", "btw"), "/renew 舊題");
  assert.equal(composeModeWire("/renew", "plan"), "/renew");
  assert.equal(composeModeWire("/renew 舊題", "plan"), "/renew 舊題");
  assert.equal(composeModeWire("/stop", "plan"), "/stop");
  assert.equal(composeModeWire("/title 新名", "btw"), "/title 新名");
  assert.equal(composeModeWire("/", "plan"), "/");
  assert.equal(composeModeWire("整理設定", "debug"), "整理設定");
  assert.equal(composeModeWire("整理設定", "yolo"), "整理設定");
  assert.equal(composeSkipsBusyQueue("/btw 順便問"), true);
  assert.equal(composeSkipsBusyQueue("/BTW 順便問"), true);
  assert.equal(composeSkipsBusyQueue("/plan 整理設定"), false);
  assert.equal(composeSkipsBusyQueue("/stop"), false);
  assert.equal(composeSkipsBusyQueue("順便問"), false);
  assert.deepEqual(composeBubble("/plan 整理設定"), { text: "整理設定", command: "plan" });
  assert.deepEqual(composeBubble("/btw 順便問"), { text: "順便問", command: "btw" });
  assert.deepEqual(composeBubble("整理設定"), { text: "整理設定", command: "" });
  assert.equal(planChipText("plan"), "Plan");
  assert.equal(planChipText("btw"), "旁問");
  assert.equal(planChipText("stop"), "stop");
  const listed = [
    { name: "/plan", enabled: true, aliases: [] },
    { name: "/stop", enabled: true, aliases: [] },
  ];
  assert.deepEqual(offeredComposeModes(listed, true), { plan: true, btw: false });
  assert.deepEqual(offeredComposeModes([{ name: "/plan", enabled: false, aliases: [] }], true), { plan: false, btw: false });
  assert.deepEqual(offeredComposeModes([], false), { plan: true, btw: true });
  assert.deepEqual(offeredComposeModes([{ name: "ask", enabled: true, aliases: ["/btw"] }], true), { plan: false, btw: true });
});

test("a streamed plan followed by clarify is a plan before the run ends", () => {
  const plan = [
    "# 計劃",
    "",
    "檔案：`.hermes\\plans\\2026-10-27_125416-wrapper.md`",
    "",
    "x".repeat(220),
  ].join("\n");
  const messages = [{ role: "user", text: "寫計劃", command: "plan" }, { role: "bot", text: plan, live: true, plan: { path: ".hermes/plans/2026-10-27_125416-wrapper.md", content: plan } }];
  assert.equal(plansIn(messages).length, 0);
  const finished = finishLiveBubble(messages);
  assert.equal(finished.live, false);
  assert.equal(plansIn(messages).length, 1);
  messages.push({ role: "clarify", question: "邊個？" });
  const next = continueLiveTurn(messages);
  assert.equal(next.created, true);
  next.message.text = "澄清之後先至講";
  assert.equal(messages.map((message) => message.role).join(","), "user,bot,clarify,bot");
  assert.ok(messages.findIndex((message) => message.role === "clarify") < messages.findIndex((message) => message.text === "澄清之後先至講"));
  assert.equal(plansIn(messages).length, 1);
  assert.equal(plansIn(messages)[0].markdown.includes("澄清之後"), false);
  assert.equal(plansIn(messages)[0].fromFile, true);
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const clarify = main.slice(main.indexOf('payload.type === "clarify.request"'), main.indexOf('payload.type === "clarify.settled"'));
  const approval = main.slice(main.indexOf('payload.type === "approval.request"'), main.indexOf('payload.type === "approval.responded"'));
  const tool = main.slice(main.indexOf("function noteTool"), main.indexOf("function handleHermes"));
  assert.ok(clarify.indexOf("endLiveTurn(id)") >= 0 && clarify.indexOf("endLiveTurn(id)") < clarify.indexOf("appendMessage(id, card)"));
  assert.ok(approval.indexOf("endLiveTurn(id)") >= 0 && approval.indexOf("endLiveTurn(id)") < approval.indexOf("appendMessage(id, card)"));
  assert.ok(tool.indexOf("endLiveTurn(id)") >= 0 && tool.indexOf("endLiveTurn(id)") < tool.indexOf("absorbToolEvent"));
  const sync = main.slice(main.indexOf("function syncChatInPlace"), main.indexOf("function mountChat"));
  assert.match(sync, /restBubble\(node\)/);
  assert.match(sync, /restBubble\(created\)/);
  const done = main.slice(main.indexOf('payload.type === "done"'), main.indexOf('payload.type === "error"'));
  assert.match(done, /renderChat\(id\)/);
  assert.match(done, /armPlanFileCatchUp\(id\)/);
  assert.doesNotMatch(done, /replaceChildren|mountChat/);
});

test("the composer mode chip cycles, and a side question skips the busy queue", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const rust = readFileSync(new URL("../src-tauri/src/config.rs", import.meta.url), "utf8");
  const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  assert.match(html, /data-role="compose-mode"[^>]*>一般</);
  assert.doesNotMatch(html, /Debug|\/yolo|\/debug/);
  assert.match(css, /\.compose-mode-chip\[aria-pressed="true"\][^}]*background:\s*var\(--bot-10\)/);
  assert.match(css, /\.compose-mode-chip\[aria-pressed="true"\][^}]*#0000f2/);
  assert.match(css, /\.composer\.is-compose-mode textarea[^}]*#0000f2/);
  const keys = main.slice(main.indexOf('input?.addEventListener("keydown"'), main.indexOf("async function loadSoul"));
  const shift = keys.indexOf('event.shiftKey && (event.key === "Tab" || event.code === "Tab")');
  const slashTab = keys.indexOf('event.key === "Tab" || (event.key === "Enter" && !event.shiftKey');
  assert.ok(shift >= 0 && shift < slashTab);
  assert.match(keys, /cycleComposeMode\(id\)/);
  const send = main.slice(main.indexOf("async function sendActive"), main.indexOf("async function continueApiSession"));
  const wireAt = send.indexOf("composeModeWire");
  const resolveAt = send.indexOf("resolveClient");
  const busyAt = send.indexOf("sendWhileBusy");
  assert.ok(wireAt >= 0 && wireAt < resolveAt && resolveAt < busyAt);
  assert.match(send, /action\?\.command !== "stop" && !composeSkipsBusyQueue\(text\)/);
  assert.match(send, /invoke\("send_chat", \{ profile: sentId, text \}\)/);
  const busy = main.slice(main.indexOf("async function sendWhileBusy"), main.indexOf("async function stopActive"));
  assert.doesNotMatch(busy, /composeModeWire/);
  assert.match(busy, /steer_run", \{ profile: id, runId: thread\.runId, text \}/);
  assert.match(busy, /send_chat", \{ profile: id, text, queue: true \}/);
  const bubble = main.slice(main.indexOf("function paintUserBubble"), main.indexOf("function paintBotBubble"));
  assert.match(bubble, /planChipText\(message\.command\)/);
  const present = main.slice(main.indexOf("function presentMessage"), main.indexOf("function presentTranscript"));
  assert.match(present, /composeBubble\(m\.text\)/);
  assert.ok(present.indexOf("skillInvocationText(m.text)") < present.indexOf("composeBubble(m.text)"));
  assert.match(main, /payload\.type === "user\.shown"/);
  assert.match(main, /applySkillBubble\(message, payload\.text\)/);
  assert.equal(main.split("set_compose_mode").length - 1, 1);
  assert.doesNotMatch(main, /set_plan_mode|\/yolo|composeMode === "debug"/);
  const store = rust.slice(rust.indexOf("pub fn store_compose_mode"), rust.indexOf("pub fn fill_empty_details"));
  assert.match(store, /compose_mode/);
  assert.doesNotMatch(store, /config::save\(|"yolo"|"debug"/);
  assert.match(lib, /set_compose_mode/);
  assert.match(lib, /bot\.compose_mode\.clone\(\)/);
  assert.doesNotMatch(lib, /set_plan_mode/);
});


test("write_file plan content is preferred over a chat summary that mentions the path", () => {
  const file = "# Runtime Gate Status\n\n**Goal:** 補回缺失的 health 檔，再跑 live 閘。\n";
  const summary = ["詳細計劃已寫好，呢輪沒有再跑回測。", "", PLAN_PATH_WIN].join("\n");
  const messages = [
    { role: "user", text: "寫計劃", command: "plan" },
    { role: "tool-run", text: "用咗 1 個工具 · write_file" },
    { role: "bot", text: summary, plan: { path: PLAN_PATH_WIN, content: file } },
  ];
  const found = plansIn(messages);
  assert.equal(found.length, 1);
  assert.equal(found[0].markdown, file);
  assert.equal(planNeedsFileCatchUp(messages), false);
});

test("a /plan turn without the file body asks for a catch-up and opens only once it lands", () => {
  const summary = ["詳細計劃已寫好。", "", PLAN_PATH_WIN].join("\n");
  const local = [{ role: "user", text: "寫計劃", command: "plan" }, { role: "bot", text: summary }];
  assert.deepEqual(plansIn(local), []);
  assert.equal(planNeedsFileCatchUp(local), true);
  assert.equal(planNeedsFileCatchUp([{ role: "user", text: "整理", command: "plan" }, { role: "bot", text: planDemoMarkdown("x") }]), true);
  const thread = loadedThread([{ role: "user", text: "hi" }]);
  thread.messages.push(...local);
  assert.equal(notePlans(thread), false);
  assert.equal(planForPanel(thread), null);
  const landed = [thread.messages[0], local[0], { ...local[1], plan: { path: PLAN_PATH_WIN, content: "# Runtime Gate Status" } }];
  assert.equal(planFileCaughtUp(thread.messages, landed), true);
  thread.messages = landed;
  assert.equal(notePlans(thread), true);
  assert.equal(planForPanel(thread).title, "Runtime Gate Status");
});

test("an older file plan does not skip catch-up for a later summary-only turn", () => {
  const path = String.raw`C:\Users\freez\Desktop\MetaTrader Workbench\.hermes\plans\2026-11-11_013841-runtime-gate-status.md`;
  const nextPath = String.raw`C:\Users\freez\Desktop\MetaTrader Workbench\.hermes\plans\2026-11-13_202000-next-gate.md`;
  const file = "# Runtime Gate Status\n\n**Goal:** 補回缺失的 health 檔，再跑 live 閘。\n";
  const nextFile = "# Next Gate\n\n**Goal:** 下一輪先至寫入檔案。\n";
  const olderSummary = ["詳細計劃已寫好。", "", path].join("\n");
  const newerSummary = ["第二份計劃已寫好，檔案正文未在呢輪串流。", "", nextPath].join("\n");
  const messages = [
    { role: "user", text: "寫計劃", command: "plan" },
    { role: "bot", text: olderSummary, plan: { path, content: file } },
    { role: "user", text: "再寫", command: "plan" },
    { role: "bot", text: newerSummary },
  ];
  assert.equal(plansIn(messages).length, 1);
  assert.equal(plansIn(messages)[0].index, 1);
  assert.equal(planNeedsFileCatchUp(messages), true);
  const landed = [
    messages[0],
    messages[1],
    messages[2],
    { role: "bot", text: newerSummary, plan: { path: nextPath, content: nextFile } },
  ];
  assert.equal(planFileCaughtUp(messages, landed), true);
  assert.equal(planFileCaughtUp(messages, messages), false);
  assert.equal(planNeedsFileCatchUp([
    ...messages.slice(0, 2),
    { role: "user", text: "唔使計劃" },
    { role: "bot", text: "好。" },
  ]), false);
});

test("turn-end plan catch-up for a sub-orb id calls open_suborb and not open_bot", async () => {
  const path = String.raw`C:\Users\freez\Desktop\MetaTrader Workbench\.hermes\plans\2026-11-13_202000-next-gate.md`;
  const file = "# Next Gate\n\n**Goal:** 下一輪先至寫入檔案。\n";
  const summary = ["第二份計劃已寫好，檔案正文未在呢輪串流。", "", path].join("\n");
  const id = "suborb:mt-orch:sid-9";
  const messages = [
    { role: "user", text: "寫計劃", command: "plan" },
    { role: "bot", text: "# Runtime Gate Status\n\n**Goal:** 舊檔。\n", plan: { path: ".hermes/plans/old.md", content: "# Old\n\n**Goal:** 舊。\n" } },
    { role: "user", text: "再寫", command: "plan" },
    { role: "bot", text: summary },
  ];
  const calls = [];
  let job;
  const armed = schedulePlanFileCatchUp({
    id,
    messages: () => messages,
    sessionId: () => "sid-9",
    busy: () => false,
    enabled: () => true,
    schedule(fn) { job = fn(); },
    reload: (panelId) => openHistory(async (command, args) => {
      calls.push({ command, args });
      return {
        session_id: args.sessionId,
        session_explicit: false,
        messages: [
          { role: "user", text: "再寫" },
          { role: "assistant", text: summary, plan: { path, content: file } },
        ],
      };
    }, panelId, { quiet: true }),
  });
  assert.equal(armed, true);
  await job;
  assert.deepEqual(calls, [{
    command: "open_suborb",
    args: { profile: "mt-orch", sessionId: "sid-9" },
  }]);
  assert.equal(calls.some((call) => call.command === "open_bot"), false);

  const profileCalls = [];
  await openHistory(async (command, args) => {
    profileCalls.push({ command, args });
    return { messages: [] };
  }, "mt-orch", { quiet: true });
  assert.deepEqual(profileCalls, [{ command: "open_bot", args: { profile: "mt-orch", quiet: true } }]);

  const skipped = [];
  const filed = messages.slice();
  filed[filed.length - 1] = { role: "bot", text: summary, plan: { path, content: file } };
  const again = schedulePlanFileCatchUp({
    id,
    messages: () => filed,
    sessionId: () => "sid-9",
    busy: () => false,
    enabled: () => true,
    schedule(fn) { fn(); },
    reload: () => { skipped.push("reload"); },
  });
  assert.equal(again, false);
  assert.deepEqual(skipped, []);

  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const load = main.slice(main.indexOf("async function loadBotHistory"), main.indexOf("function paintSessionSelect"));
  const quiet = main.slice(main.indexOf("async function refreshBotQuiet"), main.indexOf("function kickGateway"));
  const arm = main.slice(main.indexOf("function armPlanFileCatchUp"), main.indexOf("function botChatRefusal"));
  assert.match(load, /openHistory\(invoke, id, \{ quiet \}\)/);
  assert.doesNotMatch(load, /invoke\("open_bot"/);
  assert.match(quiet, /noteQuietRefreshError\(id, err\)/);
  assert.match(arm, /schedulePlanFileCatchUp\(/);
  assert.match(arm, /refreshBotQuiet\(panelId\)/);
});

test("a failed quiet refresh is logged instead of dropped", () => {
  const debugged = [];
  const warned = [];
  const failure = logQuietRefreshFailure("suborb:mt-orch:sid-9", "名單冇 profile「suborb:mt-orch:sid-9」", {
    debug(event, detail) { debugged.push(`${event} ${detail}`); },
    warn(line) { warned.push(line); },
    gatewayDown,
  });
  assert.equal(failure.event, "refresh-quiet-error");
  assert.match(failure.detail, /名單冇 profile「suborb:mt-orch:sid-9」/);
  assert.deepEqual(debugged, [`refresh-quiet-error ${failure.detail}`]);
  assert.deepEqual(warned, [`refresh-quiet-error ${failure.detail}`]);

  const gatewayWarned = [];
  logQuietRefreshFailure("mt-orch", "hermes gateway timeout", {
    debug() {},
    warn(line) { gatewayWarned.push(line); },
    gatewayDown,
  });
  assert.deepEqual(gatewayWarned, []);
});

test("a later edit with the same opening changes the plan key", () => {
  const prefix = `# Same Title Implementation Plan\n\n${"x".repeat(50)}`;
  const first = `${prefix}ALPHA-TAIL`;
  const second = `${prefix}BRAVO-TAIL`;
  assert.equal(first.length, second.length);
  assert.equal(first.slice(0, 80), second.slice(0, 80));
  const left = plansIn([filed("寫好。", first)])[0];
  const right = plansIn([filed("寫好。", second)])[0];
  assert.notEqual(left.key, right.key);
  assert.equal(left.key.endsWith(planTextHash(first)), true);
  assert.equal(right.key.endsWith(planTextHash(second)), true);
});

test("Shift+Tab mode is per panel: a sub-orb keeps its own mode and never flips siblings", async () => {
  const { panelComposeModes } = await import("./plan.js");
  const modes = panelComposeModes();
  // Both sub-orbs start from the bot's stored mode.
  assert.equal(modes.of("suborb:sa:a", ""), "");
  assert.equal(modes.of("suborb:sa:b", ""), "");
  // The Bot Chat panel moves to Plan later: open sub-orbs keep what they had.
  assert.equal(modes.of("suborb:sa:a", "plan"), "");
  assert.equal(modes.of("suborb:sa:b", "plan"), "");
  // A new sub-orb opened after that starts from the new bot mode.
  assert.equal(modes.of("suborb:sa:c", "plan"), "plan");
  // Changing one sub-orb leaves the others alone.
  modes.set("suborb:sa:a", "btw");
  assert.equal(modes.of("suborb:sa:a", ""), "btw");
  assert.equal(modes.of("suborb:sa:b", ""), "");
  assert.equal(modes.of("suborb:sa:c", ""), "plan");
  modes.set("suborb:sa:b", "debug");
  assert.equal(modes.of("suborb:sa:b", ""), "");
  assert.equal(modes.has("suborb:sa:z"), false);
});

test("sub-orb Shift+Tab and chip cycle only that panel and write no config", () => {
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const wire = main.slice(main.indexOf("function wireSuborbPanel"), main.indexOf("installNewSessionButton(panel, id);", main.indexOf("function wireSuborbPanel")));
  assert.doesNotMatch(wire, /cycleComposeMode\(profile\)/);
  assert.match(wire, /event\.shiftKey && \(event\.key === "Tab" \|\| event\.code === "Tab"\)[\s\S]*?cycleComposeMode\(id\)/);
  assert.match(wire, /suborbComposeModes\.of\(id, initialSuborbMode\(id\)\)/);
  const cycle = main.slice(main.indexOf("async function cycleComposeMode"), main.indexOf("function composeUserMessage"));
  const subBranch = cycle.slice(cycle.indexOf("if (isSuborbId(id))"), cycle.indexOf("const bot = state.bots.find"));
  assert.ok(subBranch.length > 0);
  assert.doesNotMatch(subBranch, /set_compose_mode|bot\.composeMode/);
  assert.match(subBranch, /invoke\("set_suborb_mode", \{\s*profile: sub\.profile,\s*sessionId: sub\.sessionId,\s*mode: suborbModeWire\(next\),\s*live,/);
  assert.match(subBranch, /suborbComposeModes\.set\(id, next\)/);
  const of = main.slice(main.indexOf("function composeModeOf"), main.indexOf("const composeCatalogLoads"));
  assert.match(of, /isSuborbId\(id\) \? suborbComposeModes\.of\(id, initialSuborbMode\(id\)\) : stored/);
  const initial = main.slice(main.indexOf("function initialSuborbMode"), main.indexOf("function composeModeOf"));
  assert.match(initial, /savedSuborbMode\(state\.suborbModesSaved, sub\.profile, sub\.sessionId\)/);
  assert.match(initial, /saved \?\? storedComposeMode\(id\)/);
  assert.equal((main.match(/state\.suborbModesSaved = settings\?\.suborb_modes \|\| \{\};/g) || []).length, 2);
  const paintSubs = main.slice(main.indexOf("function paintSuborbComposeModes"), main.indexOf("function openSuborbShells"));
  assert.match(paintSubs, /composeModeOf\(shell\.dataset\.botId\)/);
});

test("R-SO-09 saved sub-orb modes: valid pairs only, 一般 is kept, missing falls back", async () => {
  const { savedSuborbMode, suborbModeWire, SUBORB_MODE_CAP } = await import("./plan.js");
  const saved = { planner: [["task-a", "plan"], ["task-b", "general"], ["task-c", "debug"], "x", ["dup", "plan"], ["dup", "btw"]] };
  assert.equal(savedSuborbMode(saved, "planner", "task-a"), "plan");
  assert.equal(savedSuborbMode(saved, "planner", "task-b"), "");
  assert.equal(savedSuborbMode(saved, "planner", "task-c"), null);
  assert.equal(savedSuborbMode(saved, "planner", "dup"), "btw");
  assert.equal(savedSuborbMode(saved, "planner", "gone"), null);
  assert.equal(savedSuborbMode(saved, "coder", "task-a"), null);
  assert.equal(savedSuborbMode(null, "planner", "task-a"), null);
  assert.equal(savedSuborbMode({ planner: "nope" }, "planner", "task-a"), null);
  assert.equal(suborbModeWire(""), "general");
  assert.equal(suborbModeWire("plan"), "plan");
  assert.equal(suborbModeWire("btw"), "btw");
  assert.equal(suborbModeWire("debug"), "general");
  const rust = readFileSync(new URL("../src-tauri/src/config.rs", import.meta.url), "utf8");
  assert.match(rust, new RegExp(`pub const SUBORB_MODE_CAP: usize = ${SUBORB_MODE_CAP};`));
});

test("R-SO-09 Rust: set_suborb_mode is registered, allowed, and save_settings keeps suborb_modes", () => {
  const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const perms = readFileSync(new URL("../src-tauri/permissions/hermes.toml", import.meta.url), "utf8");
  const caps = readFileSync(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8");
  assert.match(lib, /async fn set_suborb_mode\(/);
  assert.match(lib, /config::store_suborb_mode\(&path, profile\.trim\(\), session_id\.trim\(\), mode\.trim\(\), &live\)/);
  assert.match(lib, /generate_handler!\[[\s\S]*\bset_suborb_mode,/);
  assert.match(lib, /suborb_modes: previous\.suborb_modes\.clone\(\),/);
  assert.match(lib, /suborb_modes: cfg\.suborb_modes\.clone\(\),/);
  assert.match(perms, /identifier = "allow-set-suborb-mode"[\s\S]*?commands\.allow = \["set_suborb_mode"\]/);
  assert.match(caps, /"allow-set-suborb-mode"/);
});
