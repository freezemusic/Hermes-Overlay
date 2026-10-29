import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { composeBubble, composeModeLabel, composeModeWire, composeSkipsBusyQueue, latestPlan, looksLikePlan, nextComposeMode, noteNewestPlan, offeredComposeModes, planBodyLead, planChipText, planDemoMarkdown, planForPanel, planSource, plansIn, planTask, planTextHash, planTitle, rememberPlan, unwrapPlan } from "./plan.js";
import { continueLiveTurn, finishLiveBubble } from "./sessions.js";

test("plan markdown is recognized and a short ack is not", () => {
  const body = planDemoMarkdown("整理設定");
  assert.equal(looksLikePlan(body), true);
  assert.equal(planTitle(body), "整理設定 Implementation Plan");
  assert.equal(planBodyLead(body, "計劃"), body);
  assert.equal(planBodyLead(body, planTitle(body)), body);
  assert.equal(planBodyLead("正文", "v25 replace test"), "# v25 replace test\n\n正文");
  assert.equal(looksLikePlan("收到，我再諗。"), false);
  assert.equal(looksLikePlan("# 筆記\n\n**Goal:** 對齊面板"), true);
  assert.equal(looksLikePlan("# 已寫\n\n`.hermes/plans/2026-10-15_120000-setup.md`"), true);
  assert.equal(planTask("/plan 整理設定"), "整理設定");
  assert.equal(planTask("/planet"), null);
  assert.equal(planTask("hello"), null);
});

test("latest plan is the newest bot reply, including a /plan turn", () => {
  const older = planDemoMarkdown("舊");
  const newer = "呢份計劃會先改設定畫面，再核對每個 profile 嘅圓球顏色、光暈同預覽面板。";
  const found = latestPlan([
    { role: "user", text: "/plan 舊", command: "plan" },
    { role: "bot", text: older },
    { role: "user", text: "/plan 新", command: "plan" },
    { role: "bot", text: newer },
    { role: "bot", text: "# 未完成", live: true },
  ]);
  assert.equal(found.markdown, newer);
  assert.equal(found.title, "計劃");
  assert.equal(latestPlan([{ role: "user", text: "hi" }, { role: "bot", text: "ok" }]), null);
  const listed = plansIn([
    { role: "user", text: "/plan 舊", command: "plan" },
    { role: "bot", text: older },
    { role: "bot", text: "# 未完成", live: true },
    { role: "user", text: "/plan 新", command: "plan" },
    { role: "bot", text: newer },
  ]);
  assert.equal(listed.length, 2);
  assert.equal(listed[0].markdown, older);
  assert.equal(listed[1].markdown, newer);
  assert.equal(plansIn([{ role: "bot", text: "# 未完成", live: true }]).length, 0);
});

test("a fenced markdown or plan block is the plan, and a new plan replaces the open one", () => {
  const fenced = ["```markdown", "# 整理設定 Implementation Plan", "", "**Goal:** 對齊面板", "```"].join("\n");
  assert.equal(looksLikePlan(fenced), true);
  assert.match(unwrapPlan(fenced), /^# 整理設定/);
  assert.equal(planTitle(planSource(fenced)), "整理設定 Implementation Plan");
  assert.doesNotMatch(planSource(fenced), /```/);
  const planFence = ["```plan", "# 只得標題", "", "下一步", "```"].join("\n");
  assert.equal(looksLikePlan(planFence), true);
  assert.equal(planTitle(planSource(planFence)), "只得標題");
  assert.equal(looksLikePlan("```js\n# 唔算\n```"), false);
  const found = plansIn([{ role: "bot", text: fenced }]);
  assert.equal(found.length, 1);
  assert.equal(found[0].title, "整理設定 Implementation Plan");
  assert.doesNotMatch(found[0].markdown, /```/);
  const thread = { seenPlanKey: "old", planFocus: "old", planDismissed: "old" };
  assert.equal(noteNewestPlan(thread, [{ key: "old" }, { key: "new" }]), true);
  assert.equal(thread.planFocus, "new");
  assert.equal(thread.planDismissed, "");
  assert.equal(thread.seenPlanKey, "new");
  assert.equal(noteNewestPlan(thread, [{ key: "old" }, { key: "new" }]), false);
  thread.planFocus = "old";
  assert.equal(noteNewestPlan(thread, [{ key: "old" }, { key: "new" }]), false);
  assert.equal(thread.planFocus, "old");
});

test("the last plan is cached per bot and used only before the session loads", () => {
  const markdown = planDemoMarkdown("快取");
  const thread = { messages: [{ role: "bot", text: markdown }], planDismissed: "" };
  const cached = rememberPlan(thread, thread.messages);
  assert.equal(cached.markdown, markdown);
  assert.equal(planForPanel(thread).key, cached.key);
  thread.messages = [];
  thread.loaded = false;
  assert.equal(planForPanel(thread).markdown, markdown);
  thread.planDismissed = cached.key;
  assert.equal(planForPanel(thread), null);
  thread.planDismissed = "";
  thread.loaded = true;
  assert.equal(planForPanel(thread), null);
  thread.loaded = false;
  thread.messages = [{ role: "bot", text: planDemoMarkdown("新") }];
  noteNewestPlan(thread, plansIn(thread.messages));
  assert.equal(planForPanel(thread).markdown, thread.messages[0].text);
});

test("a long Windows plan path opens without a heading, and a one-line mention does not", () => {
  const win = "C:\\Users\\freez\\Desktop\\MetaTrader Workbench\\.hermes\\plans\\2026-10-26_210008-mt5-wrapper-next.md";
  const eaten = "C:\\Users\\freez\\Desktop\\MetaTrader Workbench.hermes\\plans\\2026-10-26_210008-mt5-wrapper-next.md";
  const prose = [
    "先在原路徑重建 worktree，分支用現有的 hermes/mt5-ea-wrappers。",
    "然後才開 coder 卡，只改 SMA_Core.mqh 上述兩處。",
    "編譯只含這 7 支，以及其他一支的 MT4 檔。118 還在就還原，不提交。",
    "不要跑 130 支。不要碰 NT_01。不要把 compat 符號寫進 Note。",
  ].join("\n");
  const withSlash = `${prose}\n${win}`;
  const withEaten = `${prose}\n${eaten}`;
  assert.ok(withSlash.length >= 200);
  assert.equal(withSlash.includes("#"), false);
  assert.equal(looksLikePlan(withSlash), true);
  assert.equal(looksLikePlan(withEaten), true);
  assert.equal(planTitle(withSlash), "mt5-wrapper-next");
  assert.equal(planTitle(withEaten), "mt5-wrapper-next");
  assert.equal(planTitle(`${prose}\n.hermes/plans/2026-10-26_210008-mt5-wrapper-next.md`), "mt5-wrapper-next");
  const found = plansIn([{ role: "bot", text: withSlash }]);
  assert.equal(found.length, 1);
  assert.equal(found[0].title, "mt5-wrapper-next");
  assert.equal(plansIn([{ role: "bot", text: withEaten }]).length, 1);
  const mention = `檔案：${win}`;
  assert.ok(mention.length < 200);
  assert.equal(mention.includes("\n"), false);
  assert.equal(looksLikePlan(mention), false);
  assert.equal(plansIn([{ role: "bot", text: mention }]).length, 0);
  assert.equal(plansIn([{ role: "bot", text: withSlash, live: true }]).length, 0);
  assert.equal(planTitle("收到，我再諗。"), "計劃");
});

test("睇計劃 clears a dismiss so the same plan shows again", () => {
  const markdown = planDemoMarkdown("再開");
  const thread = {
    messages: [{ role: "bot", text: markdown }],
    loaded: true,
    planDismissed: "",
    planFocus: "",
  };
  const plan = planForPanel(thread);
  assert.ok(plan);
  thread.planFocus = plan.key;
  thread.planDismissed = plan.key;
  thread.seenPlanKey = plan.key;
  assert.equal(planForPanel(thread), null);
  assert.equal(noteNewestPlan(thread, plansIn(thread.messages)), false);
  assert.equal(thread.planDismissed, plan.key);
  assert.equal(planForPanel(thread), null);
  thread.planDismissed = "";
  thread.planFocus = plan.key;
  assert.equal(planForPanel(thread).key, plan.key);
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
  const messages = [{ role: "user", text: "寫計劃", command: "plan" }, { role: "bot", text: plan, live: true }];
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
  assert.match(css, /\.composer\.is-compose-mode input[^}]*#0000f2/);
  const keys = main.slice(main.indexOf('input?.addEventListener("keydown"'), main.indexOf("async function loadSoul"));
  const shift = keys.indexOf('event.shiftKey && (event.key === "Tab" || event.code === "Tab")');
  const slashTab = keys.indexOf('event.key === "Tab" || event.key === "Enter"');
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
  assert.equal(main.split("set_compose_mode").length - 1, 1);
  assert.doesNotMatch(main, /set_plan_mode|\/yolo|composeMode === "debug"/);
  const store = rust.slice(rust.indexOf("pub fn store_compose_mode"), rust.indexOf("pub fn fill_empty_details"));
  assert.match(store, /compose_mode/);
  assert.doesNotMatch(store, /config::save\(|"yolo"|"debug"/);
  assert.match(lib, /set_compose_mode/);
  assert.match(lib, /bot\.compose_mode\.clone\(\)/);
  assert.doesNotMatch(lib, /set_plan_mode/);
});

test("a later edit with the same opening changes the plan key", () => {
  const prefix = `# Same Title Implementation Plan\n\n${"x".repeat(50)}`;
  const first = `${prefix}ALPHA-TAIL`;
  const second = `${prefix}BRAVO-TAIL`;
  assert.equal(first.length, second.length);
  assert.equal(first.slice(0, 80), second.slice(0, 80));
  const left = plansIn([{ role: "bot", text: first }])[0];
  const right = plansIn([{ role: "bot", text: second }])[0];
  assert.notEqual(left.key, right.key);
  assert.equal(left.key.endsWith(planTextHash(first)), true);
  assert.equal(right.key.endsWith(planTextHash(second)), true);
});
