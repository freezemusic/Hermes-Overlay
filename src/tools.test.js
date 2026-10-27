import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { EXECUTE_CODE_BLOCKED_LINE } from "./approval.js";
import {
  absorbToolEvent,
  foldToolRuns,
  oneLine,
  paintToolRun,
  toolRunSummary,
} from "./tools.js";

const { document } = new JSDOM("<!doctype html><body></body>").window;

function tools(names) {
  return names.map((name) => ({ role: "tool", name, tool_name: name, text: "ok" }));
}

test("consecutive tool results collapse into one row", () => {
  const names = ["browser_exec", "browser_exec", "browser_exec", "browser_exec", "browser_exec", "search_files"];
  const folded = foldToolRuns([
    { role: "user", text: "搵檔", unsent: true },
    ...tools(names),
    { role: "bot", text: "搵完" },
    { role: "approval", text: "", requestId: "req" },
    { role: "clarify", text: "", promptId: "ask" },
    { role: "failure", text: "回覆失敗" },
    { role: "commentary", text: "過程：已加入呢一輪" },
    { role: "tool", name: "terminal", text: "ls" },
  ]);
  assert.equal(folded[0].unsent, true);
  assert.equal(folded[0].text, "搵檔");
  assert.equal(folded[1].role, "tool-run");
  assert.equal(folded[1].open, false);
  assert.equal(folded[1].text, "用咗 6 個工具 · browser_exec ×5, search_files");
  assert.equal(toolRunSummary(folded[1]), folded[1].text);
  assert.deepEqual(folded.slice(2, 7).map((message) => message.role), [
    "bot",
    "approval",
    "clarify",
    "failure",
    "commentary",
  ]);
  assert.equal(folded[7].role, "tool-run");
  assert.equal(folded[7].text, "用咗 1 個工具 · terminal");
  const detail = foldToolRuns([{ role: "tool", name: "search_files", text: "x" }], { detail: true });
  assert.equal(detail[0].open, true);
});

test("a running tool updates one row in place", () => {
  const messages = [{ role: "user", text: "開頁" }];
  absorbToolEvent(messages, { phase: "started", name: "browser_exec", preview: "open" });
  absorbToolEvent(messages, { phase: "progress", name: "browser_exec", preview: "click the button" });
  absorbToolEvent(messages, { phase: "started", name: "browser_exec", preview: "next" });
  assert.equal(messages.length, 2);
  assert.equal(messages[1].role, "tool-run");
  assert.equal(messages[1].running, true);
  assert.equal(messages[1].text, "執行緊 browser_exec…");
  assert.equal(messages[1].tools.length, 2);
  assert.equal(messages[1].tools[0].label, "click the button");
  absorbToolEvent(messages, { phase: "completed", name: "browser_exec", preview: "done-1" });
  assert.equal(messages.length, 2);
  assert.equal(messages[1].text, "執行緊 browser_exec…");
  absorbToolEvent(messages, { phase: "completed", name: "browser_exec", preview: "done-2" });
  assert.equal(messages.length, 2);
  assert.equal(messages[1].running, false);
  assert.equal(messages[1].text, "用咗 2 個工具 · browser_exec ×2");
  messages.push({ role: "bot", text: "好" });
  absorbToolEvent(messages, { phase: "started", name: "search_files", preview: "q" });
  assert.equal(messages.filter((message) => message.role === "tool-run").length, 2);
});

test("tool result JSON stays behind the second expand", () => {
  const blob = JSON.stringify({
    total_count: 82,
    files: ["C:\\Users\\Devon\\Desktop\\MetaTrader Workbench\\Experts\\src\\Tug\\Forex Forest v2.mq4"],
  });
  const folded = foldToolRuns([
    { role: "user", text: "search" },
    { role: "tool", name: "search_files", text: blob },
  ]);
  const run = folded[1];
  assert.equal(run.tools[0].label, "");
  assert.equal(run.tools[0].result, blob);
  assert.doesNotMatch(run.text, /total_count|MetaTrader|\{/);
  assert.equal(oneLine(`${"path ".repeat(40)}end`).includes("\n"), false);

  const row = document.createElement("div");
  paintToolRun(row, run);
  assert.equal(row.querySelector(".tool-result"), null);
  assert.equal(row.querySelector(".tool-run-label").textContent, "用咗 1 個工具 · search_files");
  assert.doesNotMatch(row.textContent, /total_count|MetaTrader/);
  row.querySelector(".tool-run-toggle").click();
  assert.equal(run.open, true);
  assert.equal(row.querySelector(".tool-result"), null);
  assert.equal(row.querySelector(".tool-call-line").textContent, "search_files");
  assert.doesNotMatch(row.querySelector(".tool-call-line").textContent, /\{/);
  row.querySelector(".tool-call-toggle").click();
  const pre = row.querySelector(".tool-result");
  assert.ok(pre);
  assert.match(pre.textContent, /total_count/);
  assert.equal(pre.tagName, "PRE");

  const lines = Array.from({ length: 20 }, (_, index) => `line-${index}`).join("\n");
  run.tools[0].result = lines;
  run.tools[0].openResult = false;
  paintToolRun(row, run);
  row.querySelector(".tool-call-toggle").click();
  assert.match(row.querySelector(".tool-result").textContent, /line-19/);

  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const result = css.slice(css.indexOf(".tool-result {"), css.indexOf(".tool-blocked {"));
  assert.match(result, /max-height:\s*calc\(10 \* 1\.4em\)/);
  assert.match(result, /overflow:\s*auto/);
  assert.match(result, /font-family:\s*var\(--font-mono\)/);
  const rowCss = css.slice(css.indexOf(".bubble.tool-run {"), css.indexOf(".tool-run-toggle"));
  assert.match(rowCss, /border:\s*0/);
  assert.doesNotMatch(rowCss, /dashed/);
});

test("a blocked execute_code line is shown once and the raw error is not", () => {
  const raw = "BLOCKED execute_code: unattended deny";
  const toolFirst = foldToolRuns([
    { role: "tool", name: "execute_code", text: raw },
    { role: "bot", text: EXECUTE_CODE_BLOCKED_LINE },
  ]);
  assert.equal(toolFirst.length, 1);
  assert.equal(toolFirst[0].blockedLine, true);
  assert.equal(toolFirst[0].tools[0].result, EXECUTE_CODE_BLOCKED_LINE);
  assert.doesNotMatch(toolFirst[0].text, /BLOCKED/);
  assert.doesNotMatch(JSON.stringify(toolFirst[0].tools), /unattended/);
  const row = document.createElement("div");
  paintToolRun(row, toolFirst[0]);
  assert.equal(row.querySelector(".tool-blocked").textContent, EXECUTE_CODE_BLOCKED_LINE);
  assert.doesNotMatch(row.querySelector(".tool-run-label").textContent, /BLOCKED/);

  const botFirst = foldToolRuns([
    { role: "bot", text: EXECUTE_CODE_BLOCKED_LINE },
    { role: "tool", name: "execute_code", text: raw },
  ]);
  assert.equal(botFirst.length, 2);
  assert.equal(botFirst[0].text, EXECUTE_CODE_BLOCKED_LINE);
  assert.equal(botFirst[1].blockedLine, false);
  const hidden = document.createElement("div");
  paintToolRun(hidden, botFirst[1]);
  assert.equal(hidden.querySelector(".tool-blocked"), null);
});

test("tool detail is a settings toggle and expand stays off the config write", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const rust = readFileSync(new URL("../src-tauri/src/config.rs", import.meta.url), "utf8");
  assert.match(html, /顯示工具細節/);
  assert.match(html, /id="show-tool-detail"/);
  assert.doesNotMatch(html, /id="show-tool-detail"[^>]*checked/);
  const present = main.slice(main.indexOf("function presentMessage"), main.indexOf("function ensureLiveBubble"));
  assert.doesNotMatch(present, /工具 \$\{name\}/);
  assert.match(main, /foldToolRuns/);
  assert.match(main, /absorbToolEvent/);
  const note = main.slice(main.indexOf("function noteTool"), main.indexOf("function handleHermes"));
  assert.match(note, /absorbToolEvent/);
  assert.doesNotMatch(note, /appendOnce/);
  assert.doesNotMatch(note, /開始 /);
  assert.doesNotMatch(note, /sessionReadOnly/);
  const toggle = main.slice(main.indexOf("function applyToolDetail"), main.indexOf("function readOrbOpacity"));
  assert.match(toggle, /set_show_tool_detail/);
  assert.match(toggle, /message\.open = !!value/);
  assert.doesNotMatch(toggle, /"open"/);
  const store = rust.slice(rust.indexOf("pub fn store_show_tool_detail"), rust.indexOf("pub fn fill_empty_details"));
  assert.match(store, /show_tool_detail/);
  assert.doesNotMatch(store, /"open"/);
  const run = foldToolRuns([{ role: "tool", name: "search_files", text: "{\"files\":[]}" }])[0];
  run.open = true;
  assert.equal(run.open, true);
  assert.equal(Object.hasOwn({ show_tool_detail: false }, "open"), false);
});
