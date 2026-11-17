import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { OWN_SCROLL_SELECTOR, wheelScrollsChat } from "./wheel.js";

const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const reqs = readFileSync(new URL("../REQUIREMENTS.md", import.meta.url), "utf8");
const spec = readFileSync(new URL("../SPEC.md", import.meta.url), "utf8");

function panelDom() {
  const dom = new JSDOM(`<section class="bot-panel">
    <header class="chat-head"><button class="session-trigger">揀</button>
      <div class="session-menu" role="listbox"><button class="session-menu-row"><span class="session-menu-label">A</span></button></div>
    </header>
    <div class="chat" data-role="chat"><div class="chat-messages"><p class="bubble">hi</p></div></div>
    <div class="composer"><div class="slash-popup" role="listbox"><button class="slash-item">/plan</button></div>
      <textarea data-role="input"></textarea><button class="send">送</button></div>
  </section>`);
  return dom.window.document;
}

test("R-SO-10 wheel inside the session menu or slash popup never scrolls chat", () => {
  const doc = panelDom();
  assert.equal(wheelScrollsChat(doc.querySelector(".session-menu")), false);
  assert.equal(wheelScrollsChat(doc.querySelector(".session-menu-label")), false);
  assert.equal(wheelScrollsChat(doc.querySelector(".slash-popup")), false);
  assert.equal(wheelScrollsChat(doc.querySelector(".slash-item")), false);
});

test("R-SO-10 existing own-scroll areas still keep the wheel; header and buttons forward", () => {
  const doc = panelDom();
  assert.equal(wheelScrollsChat(doc.querySelector(".bubble")), false);
  assert.equal(wheelScrollsChat(doc.querySelector("textarea")), false);
  assert.equal(wheelScrollsChat(doc.querySelector(".chat-head")), true);
  assert.equal(wheelScrollsChat(doc.querySelector(".session-trigger")), true);
  assert.equal(wheelScrollsChat(doc.querySelector(".send")), true);
  for (const sel of [".chat-messages", ".plan-preview", "textarea", "select", ".session-menu", ".slash-popup"]) {
    assert.ok(OWN_SCROLL_SELECTOR.split(",").map((s) => s.trim()).includes(sel), sel);
  }
});

test("R-SO-10 panel forwarder simulated: menu wheel leaves chat scrollTop alone", () => {
  const doc = panelDom();
  const panel = doc.querySelector(".bot-panel");
  const chat = doc.querySelector("[data-role=chat]");
  let top = 0;
  panel.addEventListener("wheel", (event) => {
    if (!wheelScrollsChat(event.target)) return;
    top += event.deltaY;
  });
  const win = doc.defaultView;
  const fire = (el) => el.dispatchEvent(new win.WheelEvent("wheel", { deltaY: 40, bubbles: true }));
  fire(doc.querySelector(".session-menu-row"));
  fire(doc.querySelector(".slash-item"));
  assert.equal(top, 0);
  fire(doc.querySelector(".chat-head"));
  assert.equal(top, 40);
  assert.ok(chat);
});

test("R-SO-10 main.js panel wheel uses the shared predicate; menus contain overscroll", () => {
  const start = main.indexOf('panel.addEventListener("wheel"');
  assert.ok(start > 0);
  const body = main.slice(start, start + 500);
  assert.match(body, /wheelScrollsChat\(event\.target\)/);
  assert.doesNotMatch(main, /closest\?\.\("\.chat-messages, \.plan-preview, textarea, select"\)/);
  for (const sel of [".session-menu", ".slash-popup"]) {
    const re = new RegExp(`\\n\\${sel} \\{[^}]*overscroll-behavior: contain;`);
    assert.match(css, re, sel);
  }
});

test("R-SO-10 docs: requirement and SPEC say menus scroll only themselves", () => {
  assert.match(reqs, /R-SO-10[^\n]*捲 session 清單或者斜線選單[^\n]*只捲嗰張清單，唔會捲對話/);
  assert.match(spec, /捲 session 清單或者斜線選單[^\n]*只捲嗰張清單，唔會捲對話/);
});
