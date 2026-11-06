import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  applyTextSize,
  createTranslator,
  DEFAULT_LANGUAGE,
  DEFAULT_TEXT_SIZE,
  EN,
  NO_TRANSLATE,
  normalizeLanguage,
  normalizeTextSize,
  storedLanguage,
  storedTextSize,
  TEXT_SIZES,
  textScale,
  translate,
  UI_LANGUAGES,
} from "./look.js";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");

test("text size has four steps, standard by default, and stores only non-standard steps (R-LK-01)", () => {
  assert.deepEqual(TEXT_SIZES.map((step) => step.id), ["s", "m", "l", "xl"]);
  assert.deepEqual(TEXT_SIZES.map((step) => step.scale), [0.9, 1, 1.15, 1.3]);
  assert.equal(DEFAULT_TEXT_SIZE, "m");
  assert.equal(normalizeTextSize(""), "m");
  assert.equal(normalizeTextSize("huge"), "m");
  assert.equal(normalizeTextSize(" XL "), "xl");
  assert.equal(textScale("l"), 1.15);
  assert.equal(storedTextSize("m"), "");
  assert.equal(storedTextSize("s"), "s");
  assert.equal(storedTextSize(undefined), "");
});

test("language is zh-HK by default, English is the second choice (R-LK-02)", () => {
  assert.deepEqual(UI_LANGUAGES.map((lang) => lang.code), ["zh-HK", "en"]);
  assert.equal(DEFAULT_LANGUAGE, "zh-HK");
  assert.equal(normalizeLanguage(""), "zh-HK");
  assert.equal(normalizeLanguage("ja"), "zh-HK");
  assert.equal(normalizeLanguage("en-GB"), "en");
  assert.equal(storedLanguage("zh-HK"), "");
  assert.equal(storedLanguage("en"), "en");
  assert.equal(translate("關閉", "zh-HK"), "關閉");
  assert.equal(translate("關閉", "en"), "Close");
  assert.equal(translate(" 傳送 ", "en"), " Send ");
  assert.equal(translate("唔喺表入面", "en"), "唔喺表入面");
  // Whole strings only: a sentence that contains a key is left alone.
  assert.equal(translate("請關閉個窗", "en"), "請關閉個窗");
});

test("the English table has a non-empty value for every key", () => {
  for (const [zh, en] of Object.entries(EN)) {
    assert.equal(zh, zh.trim());
    assert.ok(en && en.trim() === en, zh);
    assert.doesNotMatch(en, /[\u4e00-\u9fff]/, zh);
  }
});

test("applyTextSize puts the step on <html> and standard removes it", () => {
  const dom = new JSDOM("<!doctype html><html lang='zh-HK'><body></body></html>");
  const doc = dom.window.document;
  assert.equal(applyTextSize(doc, "xl"), "xl");
  assert.equal(doc.documentElement.dataset.textSize, "xl");
  assert.equal(doc.documentElement.style.getPropertyValue("--text-scale"), "1.3");
  assert.equal(applyTextSize(doc, "m"), "m");
  assert.equal(doc.documentElement.hasAttribute("data-text-size"), false);
  assert.equal(doc.documentElement.style.getPropertyValue("--text-scale"), "");
  assert.equal(applyTextSize(doc, "bogus"), "m");
});

function page() {
  const dom = new JSDOM(`<!doctype html><html lang="zh-HK"><body>
    <button id="close" title="收起呢個面板">關閉</button>
    <input id="msg" placeholder="輸入訊息給呢個 Bot…" />
    <h1 data-role="name">關閉</h1>
    <div class="chat-messages"><p id="chat">關閉</p></div>
    <div class="kanban-card"><p id="card">停止</p></div>
    <span id="status">閒置</span>
  </body></html>`);
  return dom;
}

test("English swaps UI strings and leaves chat, cards and bot names alone; zh-HK puts everything back", () => {
  const dom = page();
  const doc = dom.window.document;
  const t = createTranslator(doc, dom.window.MutationObserver);
  assert.equal(t.setLanguage("en"), "en");
  assert.equal(doc.documentElement.lang, "en");
  assert.equal(doc.getElementById("close").textContent, "Close");
  assert.equal(doc.getElementById("close").title, "Collapse this panel");
  assert.equal(doc.getElementById("msg").placeholder, "Message this bot…");
  assert.equal(doc.getElementById("status").textContent, "Idle");
  assert.equal(doc.getElementById("chat").textContent, "關閉");
  assert.equal(doc.getElementById("card").textContent, "停止");
  assert.equal(doc.querySelector('[data-role="name"]').textContent, "關閉");

  // The app keeps writing zh-HK; new text is translated as it lands.
  doc.getElementById("status").textContent = "思考中…";
  const send = doc.createElement("button");
  send.textContent = "傳送";
  doc.body.appendChild(send);
  doc.getElementById("chat").textContent = "傳送";
  t.flush();
  assert.equal(doc.getElementById("status").textContent, "Thinking…");
  assert.equal(send.textContent, "Send");
  assert.equal(doc.getElementById("chat").textContent, "傳送");

  assert.equal(t.setLanguage("zh-HK"), "zh-HK");
  assert.equal(doc.documentElement.lang, "zh-HK");
  assert.equal(doc.getElementById("close").textContent, "關閉");
  assert.equal(doc.getElementById("close").title, "收起呢個面板");
  assert.equal(doc.getElementById("msg").placeholder, "輸入訊息給呢個 Bot…");
  assert.equal(doc.getElementById("status").textContent, "思考中…");
  assert.equal(send.textContent, "傳送");

  // Back on zh-HK nothing watches the page any more.
  const later = doc.createElement("button");
  later.textContent = "關閉";
  doc.body.appendChild(later);
  t.flush();
  assert.equal(later.textContent, "關閉");
});

test("zh-HK never starts an observer, so the default runs exactly as before", () => {
  const dom = page();
  let made = 0;
  class Counting extends dom.window.MutationObserver {
    constructor(cb) {
      super(cb);
      made += 1;
    }
  }
  const t = createTranslator(dom.window.document, Counting);
  t.setLanguage("zh-HK");
  t.setLanguage("");
  assert.equal(made, 0);
  t.setLanguage("en");
  assert.equal(made, 1);
});

test("a string the app rewrote while English was on is not clobbered on the way back", () => {
  const dom = page();
  const doc = dom.window.document;
  const t = createTranslator(doc, dom.window.MutationObserver);
  t.setLanguage("en");
  t.flush();
  const status = doc.getElementById("status");
  status.firstChild.nodeValue = "行緊 00:42";
  t.flush();
  t.setLanguage("zh-HK");
  assert.equal(status.textContent, "行緊 00:42");
});

test("settings has compact text-size and language icon buttons with tooltips (R-LK-01/02, R-NS-01)", () => {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const sizes = [...doc.querySelectorAll("#text-size-group [data-look-size]")];
  assert.deepEqual(sizes.map((b) => b.dataset.lookSize), ["s", "m", "l", "xl"]);
  const langs = [...doc.querySelectorAll("#ui-language-group [data-look-lang]")];
  assert.deepEqual(langs.map((b) => b.dataset.lookLang), ["zh-HK", "en"]);
  for (const btn of [...sizes, ...langs]) {
    assert.equal(btn.getAttribute("type"), "button");
    assert.ok(btn.title, "tooltip");
    assert.equal(btn.getAttribute("aria-label"), btn.title);
    assert.equal(btn.getAttribute("role"), "radio");
    assert.ok(btn.textContent.trim().length <= 2, "icon, not a text button");
  }
  for (const btn of sizes) assert.ok(EN[btn.title], `EN has ${btn.title}`);
  assert.ok(EN["文字大小"] && EN["介面語言"] && EN["外觀"]);
  assert.match(css, /\.look-btn \{[^}]*width:\s*24px[^}]*height:\s*24px/s);
  assert.match(css, /\.look-btn\[aria-checked="true"\] \{[^}]*background:\s*#0000f2/s);
});

test("text size CSS only applies with data-text-size and leaves orbs alone", () => {
  assert.match(css, /html\[data-text-size\] \{[^}]*--fs-body:\s*calc\(14px \* var\(--text-scale, 1\)\)/s);
  assert.match(css, /html\[data-text-size\] \.plan-body \{ font-size: calc\(13px \* var\(--text-scale, 1\)\); \}/);
  assert.match(css, /html\[data-text-size\] \.settings-panel \.hint \{ font-size: calc\(12px/);
  assert.match(css, /html\[data-text-size\] \.session-menu-row \{[^}]*line-height: calc\(18px/);
  assert.doesNotMatch(css, /html\[data-text-size\] \.orb-glyph/);
  assert.match(css, /html\[data-text-size\] \.bot-btn \.bot-label,\s*html\[data-text-size\] \.orb-hover-label \{ font-size: 10px; \}/);
  assert.match(css, /html\[data-text-size\] \.morph-pill \{ font-size: 13px; \}/);
  // The base tokens are untouched, so standard size is byte-for-byte the old look.
  assert.match(css, /--fs-body: 14px;/);
  assert.match(css, /--fs-hero: 40px;/);
});

test("main.js previews the look, saves it with settings, and reverts on close without saving", () => {
  assert.match(main, /from "\.\/look\.js"/);
  assert.match(main, /text_size: storedTextSize\(look\.size\)/);
  assert.match(main, /ui_language: storedLanguage\(look\.lang\)/);
  const close = main.slice(main.indexOf("function closeSettings()"), main.indexOf("async function saveSettings("));
  assert.match(close, /applySavedLook\(state\.settings\)/);
  const open = main.slice(main.indexOf("function openSettings()"), main.indexOf("function closeSettings()"));
  assert.match(open, /applySavedLook\(state\.settings\)/);
  const boot = main.slice(main.indexOf("async function boot()"));
  assert.match(boot, /applySavedLook\(settings\)/);
  // The look is only written by 儲存 (no splice, no write on click).
  assert.doesNotMatch(main, /invoke\("set_text_size"|invoke\("set_ui_language"/);
});

test("settings bot rows can shrink, so 特大字 + English never pushes a sideways scrollbar over 儲存", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const row = css.slice(css.indexOf(".bot-row {"), css.indexOf("}", css.indexOf(".bot-row {")));
  assert.match(row, /grid-template-columns: auto minmax\(0, 1\.1fr\) minmax\(0, 1\.1fr\) 42px auto;/);
  const input = css.slice(css.indexOf(".bot-row input {"), css.indexOf("}", css.indexOf(".bot-row input {")));
  assert.match(input, /min-width: 0;/);
});

test("R-KB-10 bell strings have English, numbered whole strings use anchored patterns, card titles stay data", () => {
  assert.equal(translate("全部已讀", "en"), "Mark all read");
  assert.equal(translate("看板通知", "en"), "Kanban notifications");
  assert.equal(translate("1 分鐘內", "en"), "Under 1 min");
  assert.equal(translate("7 分鐘前", "en"), "7 min ago");
  assert.equal(translate("看板通知（3 個未讀）", "en"), "Kanban notifications (3 unread)");
  assert.equal(translate("看板通知（9+ 個未讀）", "en"), "Kanban notifications (9+ unread)");
  // Anchored: a longer sentence that contains the pattern is not touched.
  assert.equal(translate("佢 7 分鐘前講過", "en"), "佢 7 分鐘前講過");
  assert.equal(translate("7 分鐘前", "zh-HK"), "7 分鐘前");
  assert.match(NO_TRANSLATE, /\.kanban-bell-title/);
  assert.match(NO_TRANSLATE, /\.kanban-bell-change/);
});

test("R-LK-03 text-size buttons: 細／標準／大／特大 tooltips = aria-labels, English names, 12/14/16/18px glyphs, solid #0000f2 selected", () => {
  const doc = new JSDOM(html).window.document;
  const sizes = [...doc.querySelectorAll("#text-size-group [data-look-size]")];
  assert.deepEqual(sizes.map((b) => b.title), ["細", "標準", "大", "特大"]);
  assert.deepEqual(sizes.map((b) => b.getAttribute("aria-label")), ["細", "標準", "大", "特大"]);
  assert.deepEqual(TEXT_SIZES.map((s) => s.tip), ["細", "標準", "大", "特大"]);
  assert.deepEqual(sizes.map((b) => translate(b.title, "en")), ["Small", "Default", "Large", "Extra large"]);
  const px = ["s", "m", "l", "xl"].map((id) => Number(new RegExp(`\\.look-size-${id} span \\{ font-size: (\\d+)px; \\}`).exec(css)?.[1]));
  assert.deepEqual(px, [12, 14, 16, 18]);
  for (let i = 1; i < px.length; i += 1) assert.ok(px[i] > px[i - 1], "still grows");
  assert.ok(px[0] >= 12, "smallest A readable");
  assert.ok(px[3] <= 24 - 4, "largest fits the 24px button");
  assert.match(css, /\.look-btn\[aria-checked="true"\] \{[^}]*background:\s*#0000f2/s);
});
