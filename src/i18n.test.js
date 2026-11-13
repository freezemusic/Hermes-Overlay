import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createTranslator, EN, EN_PATTERNS, NO_TRANSLATE, translate, UI_IN_DATA } from "./look.js";
import {
  APPROVAL_APPROVED,
  APPROVAL_DENIED,
  APPROVAL_HEADING,
  APPROVAL_STALE,
  APPROVE_ONCE_LABEL,
  DENY_LABEL,
  EXECUTE_CODE_BLOCKED_LINE,
  renderApprovalCard,
} from "./approval.js";
import {
  CLARIFY_ANSWERED,
  CLARIFY_HEADING,
  CLARIFY_OTHER,
  CLARIFY_RECOMMENDED,
  CLARIFY_SEND,
  CLARIFY_SEND_FAIL,
  CLARIFY_SKIP,
  CLARIFY_SKIPPED,
  CLARIFY_STALE,
  CLARIFY_TIMEOUT,
  renderClarifyCard,
} from "./clarify.js";
import { paintToolRun, toolCallLine, toolRunSummary } from "./tools.js";
import { decorateCodeBlocks } from "./markdown.js";
import { KANBAN_BELL_EMPTY, KANBAN_EMPTY, KANBAN_UNAVAILABLE } from "./kanban.js";
import { CRON_EMPTY, CRON_FAILED_LABEL, CRON_NONE, CRON_UNAVAILABLE, runningLabel } from "./cron.js";
import { DEMO_BANNER } from "./setup.js";
import {
  CHROME_ORBS,
  chromeOrbText,
  DEMO_BANNER_EN,
  DEMO_BOTS_EN,
  DEMO_OLD_SESSION_EN,
  demoCommandEn,
  demoCronEn,
  demoKanbanEn,
  demoPlanEn,
  demoReplyEn,
  PREVIEW_BANNER,
  PREVIEW_BANNER_EN,
} from "./demo.js";

const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;
const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
const lookSrc = readFileSync(new URL("./look.js", import.meta.url), "utf8");

function chatPage() {
  const dom = new JSDOM(`<!doctype html><html lang="zh-HK"><body>
    <div class="chat-messages" id="chat"></div>
    <div class="kanban-detail" id="detail"></div>
  </body></html>`);
  return dom;
}

function fill(doc) {
  const chat = doc.getElementById("chat");
  const pending = doc.createElement("div");
  pending.className = "bubble approval";
  pending.append(renderApprovalCard(doc, { status: "pending", description: "要刪除暫存檔", command: "rm -rf ./tmp 批准" }, () => {}));
  const done = doc.createElement("div");
  done.className = "bubble approval";
  done.append(renderApprovalCard(doc, { status: "approved", description: "list" }, () => {}));
  const clarify = doc.createElement("div");
  clarify.className = "bubble clarify";
  clarify.append(renderClarifyCard(doc, { status: "pending", question: "揀邊個？", choices: ["跳過", "藍色"], timeoutS: 60, remain: 42 }));
  const multi = doc.createElement("div");
  multi.className = "bubble clarify";
  multi.append(renderClarifyCard(doc, { status: "pending", question: "多揀", choices: ["甲", "乙"], multiSelect: true, timeoutS: 0 }));
  const answered = doc.createElement("div");
  answered.className = "bubble clarify";
  answered.append(renderClarifyCard(doc, { status: "answered", question: "Q", postedAnswer: "藍色" }));
  const running = doc.createElement("div");
  paintToolRun(running, { role: "tool-run", running: true, tools: [{ name: "terminal", status: "running" }] });
  const tools = doc.createElement("div");
  paintToolRun(tools, {
    role: "tool-run",
    open: true,
    blockedLine: true,
    tools: [{ name: "terminal", label: "", status: "failed" }, { name: "terminal", label: "ls 批准", status: "done" }],
  });
  const bot = doc.createElement("div");
  bot.className = "bubble bot";
  bot.innerHTML = "<p>停止</p><pre><code>批准（一次）</code></pre>";
  decorateCodeBlocks(bot);
  chat.append(pending, done, clarify, multi, answered, running, tools, bot);
  const detail = doc.getElementById("detail");
  const back = doc.createElement("button");
  back.className = "icon-btn kanban-detail-back";
  back.textContent = "返回";
  const title = doc.createElement("h2");
  title.textContent = "返回";
  detail.append(back, title);
  return { pending, done, clarify, multi, answered, running, tools, bot, back, title };
}

test("R-LK-02 English translates the chrome inside chat and card detail, never the Hermes text around it", () => {
  const dom = chatPage();
  const doc = dom.window.document;
  const parts = fill(doc);
  const zh = doc.body.innerHTML;
  const t = createTranslator(doc, dom.window.MutationObserver);
  t.setLanguage("en");

  const q = (root, sel) => root.querySelector(sel).textContent;
  assert.equal(q(parts.pending, ".approval-heading"), "Needs your approval");
  assert.deepEqual([...parts.pending.querySelectorAll("button")].map((b) => b.textContent), ["Approve (once)", "Deny"]);
  assert.equal(q(parts.pending, ".approval-description"), "要刪除暫存檔");
  assert.equal(q(parts.pending, ".approval-command"), "rm -rf ./tmp 批准");
  assert.equal(q(parts.done, ".approval-result"), "Approved");

  assert.equal(q(parts.clarify, ".clarify-heading"), "Needs your answer");
  assert.equal(q(parts.clarify, ".clarify-question"), "揀邊個？");
  assert.equal(q(parts.clarify, ".clarify-countdown"), "42s left");
  const buttons = [...parts.clarify.querySelectorAll("button")].map((b) => b.textContent);
  // First choice keeps Hermes' words after the prefix; a later choice that happens to be 「跳過」 is data.
  assert.deepEqual(buttons, ["Recommended: 跳過", "藍色", "Send", "Skip"]);
  assert.equal(q(parts.clarify, ".clarify-other-label"), "Other (type your own)");
  const options = [...parts.multi.querySelectorAll(".clarify-option")].map((l) => l.textContent);
  assert.deepEqual(options, ["Recommended: 甲", "乙"]);
  assert.equal(q(parts.answered, ".clarify-result"), "Answered: 藍色");

  assert.equal(q(parts.running, ".tool-run-label"), "Running terminal…");
  assert.equal(q(parts.tools, ".tool-run-label"), "Used 2 tools · terminal ×2");
  const lines = [...parts.tools.querySelectorAll(".tool-call-line")].map((l) => l.textContent);
  assert.deepEqual(lines, ["terminal  failed", "terminal  ls 批准"]);
  assert.match(q(parts.tools, ".tool-blocked"), /^This bot wants to run Python/);

  assert.equal(q(parts.bot, "p"), "停止");
  assert.equal(q(parts.bot, "code"), "批准（一次）");
  assert.equal(q(parts.bot, ".code-copy"), "Copy");
  assert.equal(parts.back.textContent, "Back");
  assert.equal(parts.title.textContent, "返回");

  // A card painted while English is on is translated as it lands.
  const later = doc.createElement("div");
  later.append(renderApprovalCard(doc, { status: "denied" }, () => {}));
  doc.getElementById("chat").append(later);
  parts.running.querySelector(".tool-run-label").textContent = toolRunSummary({ tools: [{ name: "web" }] });
  t.flush();
  assert.equal(later.querySelector(".approval-result").textContent, "Denied");
  assert.equal(parts.running.querySelector(".tool-run-label").textContent, "Used 1 tool · web");

  // Back to zh-HK: byte-identical to the page before English was on.
  later.remove();
  parts.running.querySelector(".tool-run-label").textContent = "執行緊 terminal…";
  t.flush();
  t.setLanguage("zh-HK");
  assert.equal(doc.body.innerHTML, zh);
});

test("R-LK-02 zh-HK never touches chat chrome: the cards render exactly as before", () => {
  const plain = chatPage();
  fill(plain.window.document);
  const watched = chatPage();
  const t = createTranslator(watched.window.document, watched.window.MutationObserver);
  t.setLanguage("zh-HK");
  fill(watched.window.document);
  t.flush();
  assert.equal(watched.window.document.body.innerHTML, plain.window.document.body.innerHTML);
});

test("R-LK-02 every chrome selector sits inside a data area (otherwise it would not need the list)", () => {
  const inside = [".chat-messages", ".kanban-detail", "pre"];
  assert.ok(NO_TRANSLATE.includes(".chat-messages") && NO_TRANSLATE.includes(".kanban-detail"));
  for (const sel of UI_IN_DATA.split(", ")) assert.ok(sel.startsWith(".") || inside.includes(sel), sel);
  assert.match(lookSrc, /UI_IN_DATA/);
});

test("R-LK-02 chat-card, tool, kanban and schedule strings all have English", () => {
  const strings = [
    APPROVAL_HEADING, APPROVE_ONCE_LABEL, DENY_LABEL, APPROVAL_APPROVED, APPROVAL_DENIED, APPROVAL_STALE,
    EXECUTE_CODE_BLOCKED_LINE, "批准未送出。",
    CLARIFY_HEADING, CLARIFY_RECOMMENDED, CLARIFY_SEND, CLARIFY_OTHER, CLARIFY_SKIP, CLARIFY_STALE,
    CLARIFY_TIMEOUT, CLARIFY_ANSWERED, CLARIFY_SKIPPED, CLARIFY_SEND_FAIL,
    KANBAN_EMPTY, KANBAN_UNAVAILABLE, KANBAN_BELL_EMPTY, "返回",
    CRON_EMPTY, CRON_NONE, CRON_UNAVAILABLE, CRON_FAILED_LABEL,
    "設定", "看板", "排程", "Hermes 設定", "排程工作", "排程工作進行中", "排程工作失敗",
    "收起完整提示", "顯示完整提示", "未送出", "複製", "已複製", "睇計劃", "計劃檔內容唔在對話紀錄裡面。", "旁問",
    "示範模式（--demo），冇連 Hermes。",
  ];
  for (const zh of strings) {
    const en = translate(zh, "en");
    assert.notEqual(en, zh, zh);
    assert.doesNotMatch(en, CJK, zh);
  }
});

test("R-LK-02 numbered and templated strings: anchored patterns, data inside stays as it is", () => {
  const cases = [
    [toolRunSummary({ running: true, tools: [{ name: "browser", status: "running" }] }), "Running browser…"],
    [toolRunSummary({ tools: [{ name: "a" }, { name: "b" }, { name: "a" }] }), "Used 3 tools · a ×2, b"],
    [toolRunSummary({ tools: [] }), "Used 0 tools"],
    [toolCallLine({ name: "x", status: "failed" }), "x  failed"],
    ["已答：Option A", "Answered: Option A"],
    ["仲有 9 秒", "9s left"],
    ["推薦 Blue", "Recommended: Blue"],
    ["呢個 bot 等緊你批准：一個指令", "This bot is waiting for your approval: a command"],
    ["Planner 等緊你答：Which colour?", "Planner is waiting for your answer: Which colour?"],
    ["Planner 問過：Which colour?", "Planner asked: Which colour?"],
    ["Planner 問過批准：rm tmp", "Planner asked for approval: rm tmp"],
    ["呢度答唔到。大約 3 分鐘後逾時。", "Can't answer here. Times out in about 3 min."],
    ["呢度答唔到。逾時時間已過，等歷史更新。", "Can't answer here. The timeout has passed; waiting for the history to update."],
    ["呢輪已經完。", "That turn is over."],
    ["呢句送唔到做答案。", "This line could not be sent as the answer."],
    ["Planner，有工具等緊批准", "Planner, a tool is waiting for approval"],
    ["Planner，有問題等你答", "Planner, a question is waiting for your answer"],
    ["任務，已釘住", "Task, pinned"],
    ["仲有 2 個", "2 more"],
    ["仲有 2 個子光球", "2 more sub-orbs"],
    ["5 個子光球，揸住 Ctrl 展開", "5 sub-orbs, hold Ctrl to expand"],
    [`2 個${CRON_FAILED_LABEL}`, "2 failed last run"],
    ["下次 09:30", "Next 09:30"],
    ["上次 2026-11-05 18:00", "Last 2026-11-05 18:00"],
    [runningLabel({ id: "j" }, new Date(0)), "Running 00:00"],
    ["優先度：high", "Priority: high"],
    ["匯入 1 個 profile，然後儲存。", "Imported 1 profile. Now save."],
    ["a、b 未有 API 金鑰，請喺設定填寫。金鑰唔會自動產生。", "a, b: no API key yet. Add it in Settings. Keys are never generated for you."],
    ["看板更新失敗：409", "Board update failed: 409"],
    ["看板拒絕呢次移動：locked", "The board refused this move: locked"],
  ];
  for (const key of ["Ctrl", "Alt"]) {
    const zh = `光球預設實色同穿透。游標行近先淡出；按住 ${key}，游標下嗰粒返實色、可以點同右鍵隱藏。新訊息會由光球橫向展開成膠囊 5 秒，唔使按 ${key} 都睇到，但要按住先至點得。面板預設實色，可以拖同點；按住 ${key} 就變透明並穿透。`;
    assert.ok(main.includes("光球預設實色同穿透。游標行近先淡出；按住 ${name}，"));
    const en = translate(zh, "en");
    assert.doesNotMatch(en, CJK);
    assert.equal(en.split(key).length - 1, 3);
  }
  for (const [zh, en] of cases) {
    assert.equal(translate(zh, "en"), en, zh);
    assert.equal(translate(zh, "zh-HK"), zh);
  }
  // Joined cron line is translated part by part in main.js, never as one sentence.
  assert.equal(translate("下次 09:30 · 進行中", "en"), "下次 09:30 · 進行中");
  assert.match(main, /bits\.map\(\(bit\) => translate\(bit, look\.lang\)\)\.join\(" · "\)/);
  // Every pattern is anchored at both ends.
  for (const [pattern] of EN_PATTERNS) {
    assert.ok(pattern.source.startsWith("^") && pattern.source.endsWith("$"), pattern.source);
  }
});

test("R-LK-02 English demo: fake English content with the same bots as the zh-HK demo", () => {
  const zhIds = [...main.slice(main.indexOf("const MOCK_BOTS = ["), main.indexOf("function $(sel)")).matchAll(/^\s{4}id: "([^"]+)"/gm)].map((m) => m[1]);
  assert.deepEqual(DEMO_BOTS_EN.map((bot) => bot.id), zhIds);
  const shorts = DEMO_BOTS_EN.map((bot) => bot.short);
  assert.equal(new Set(shorts).size, shorts.length);
  for (const bot of DEMO_BOTS_EN) {
    assert.match(bot.short, /^[A-Z]$/);
    assert.ok(bot.name && bot.detail && bot.status);
  }
  const text = JSON.stringify([
    DEMO_BOTS_EN, DEMO_BANNER_EN, PREVIEW_BANNER_EN, DEMO_OLD_SESSION_EN, demoKanbanEn(), demoCronEn(0),
    demoReplyEn({ text: "Draft a checklist for my fictional garden" }), demoReplyEn({ text: "x", command: "btw" }),
    demoPlanEn("Garden"), demoCommandEn({ command: "model" }),
  ]);
  assert.doesNotMatch(text, CJK);
  // Fake only: no product logos or brands that are not ours.
  assert.doesNotMatch(text, /Teams|Slack|Outlook|Zoom|Bloomberg|ticker|stock|trade/i);
  assert.match(DEMO_BANNER_EN, /--demo/);
  assert.notEqual(DEMO_BANNER_EN, DEMO_BANNER);
  assert.equal(PREVIEW_BANNER, "瀏覽器預覽：離線示範。登入同連線只喺桌面版可用。");
  // Board assignees are English demo bot names, so owner colours still match.
  const names = new Set(DEMO_BOTS_EN.map((bot) => bot.name));
  for (const column of demoKanbanEn().columns) for (const task of column.tasks) assert.ok(names.has(task.assignee), task.assignee);
  for (const group of demoCronEn(0)) {
    const bot = DEMO_BOTS_EN.find((item) => item.id === group.profile);
    if (bot) assert.equal(group.name, bot.name);
  }
});

test("R-LK-02 main.js picks the demo, banner, board, schedule and replies by language; zh-HK keeps its own", () => {
  assert.match(main, /state\.bots = mockBotsFor\(look\.lang\)\.map/);
  assert.match(main, /if \(lang !== "en"\) return MOCK_BOTS;/);
  assert.match(main, /setBanner\(mockBanner\(reason\), "info", sticky, bannerAction\)/);
  assert.match(main, /if \(look\.lang === "en"\) return demoKanbanEn\(\);/);
  assert.match(main, /if \(look\.lang === "en"\) return demoCronEn\(\)/);
  assert.match(main, /if \(look\.lang === "en"\) return shown\.command === "plan" \? demoPlanEn\(shown\.text\) : demoReplyEn\(shown\);/);
  // Boot reads the saved look before the demo seeds, so --demo starts in English.
  const boot = main.slice(main.lastIndexOf("applySavedLook(settings);"));
  assert.ok(boot.indexOf('useMock(DEMO_BANNER, "", "demo")') > 0);
  // The zh-HK demo is untouched.
  for (const zh of ["計劃助手", "程式夥伴", "資料搜查", "整理今日待辦", "每日摘要", "（示範回覆）收到："]) assert.ok(main.includes(zh), zh);
  // Switching language in the demo re-seeds it.
  assert.match(main, /state\.mode === "mock" && seed && seed\.lang !== look\.lang/);
});

test("R-LK-02 settings, kanban and schedule orbs: zh-HK glyphs unchanged, English glyphs fit the 44px disc", () => {
  assert.deepEqual(chromeOrbText("settings", "zh-HK"), { glyph: "設", label: "設定" });
  assert.deepEqual(chromeOrbText("kanban", "zh-HK"), { glyph: "▥", label: "看板" });
  assert.deepEqual(chromeOrbText("cron", "zh-HK"), { glyph: "時", label: "排程" });
  assert.deepEqual(chromeOrbText("settings", "en"), { glyph: "⚙\uFE0E", label: "Settings" });
  assert.deepEqual(chromeOrbText("cron", "en"), { glyph: "◷", label: "Schedule" });
  assert.equal(chromeOrbText("kanban", "en").label, "Kanban");
  for (const row of Object.values(CHROME_ORBS)) {
    // One visible character (plus an optional text-presentation selector), like 設／時／▥.
    assert.equal(Array.from(row.en[0].replace("\uFE0E", "")).length, 1);
    assert.doesNotMatch(row.en.join(""), CJK);
  }
  assert.match(main, /ensureChromeShell\(settings, "settings", text\("settings"\)\.glyph, text\("settings"\)\.label/);
  assert.match(main, /if \(before === look\.lang\) return;\n  paintChromeOrbs\(\);/);
  assert.equal(chromeOrbText("nope", "en"), null);
});

test("R-LK-02 the English table stays free of Chinese and every new key is a whole string", () => {
  for (const [zh, en] of Object.entries(EN)) {
    assert.equal(zh, zh.trim(), zh);
    assert.doesNotMatch(en, CJK, zh);
  }
});

test("R-LK-02 index.html in English: no Chinese left outside data, except the 繁 language button and the board picker label", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  createTranslator(doc, dom.window.MutationObserver).setLanguage("en");
  const left = [];
  const walker = doc.createTreeWalker(doc.body, 0x1 | 0x4);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === 3 && CJK.test(node.nodeValue)) left.push(node.nodeValue.trim());
    if (node.nodeType === 1) {
      for (const name of ["title", "placeholder", "aria-label"]) {
        const value = node.getAttribute(name);
        if (value && CJK.test(value)) left.push(`${name}=${value}`);
      }
    }
    node = walker.nextNode();
  }
  assert.deepEqual(left, ["title=繁體中文（香港）", "aria-label=繁體中文（香港）", "繁", "aria-label=看板"]);
});

test("R-LK-02 re-seeding the demo never leaves a stale orb from a parked plan rehearsal", () => {
  const remove = main.slice(main.indexOf("function removeBotPanels()"), main.indexOf("function inTauri()"));
  assert.match(remove, /shell\._dropped = 1;\n\s+shell\.remove\(\);/);
  const restore = main.slice(main.indexOf("function restorePlanRehearsal("), main.indexOf("// A fade sample written while"));
  assert.equal((restore.match(/!shell\._dropped && saved\?\.rail/g) || []).length, 2);
});
