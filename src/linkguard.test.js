import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { installLinkGuard } from "./linkguard.js";

const URL_PR = "https://bitbucket.org/freezemusic/forex-forest-code-base/pull-requests/3404";

function page() {
  const dom = new JSDOM(`<body>
    <section class="suborb-panel"><div data-role="chat"><p>see <a id="sub" href="${URL_PR}"><b id="inner">PR 3404</b></a></p></div></section>
    <div class="plan-body"><a id="plan" href="https://example.com/plan?a=1&b=2">plan link</a></div>
    <a id="mail" href="mailto:a@b.c">mail</a>
    <a id="js" href="javascript:alert(1)">js</a>
    <a id="hash" href="#top">hash</a>
    <a id="rel" href="/settings">rel</a>
    <a id="blank" href="https://example.com/x" target="_blank">blank</a>
    <span id="none">no link</span></body>`, { url: "http://tauri.localhost/" });
  const opened = [];
  const bubbled = [];
  installLinkGuard(dom.window.document, (url) => opened.push(url));
  dom.window.document.addEventListener("click", () => bubbled.push("click"));
  const fire = (id, type = "click", init = {}) => {
    const ev = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: type === "auxclick" ? 1 : 0, ...init });
    dom.window.document.getElementById(id).dispatchEvent(ev);
    return ev;
  };
  return { opened, bubbled, fire };
}

test("a link in a sub-orb chat opens outside and never navigates the overlay", () => {
  const { opened, fire, bubbled } = page();
  const ev = fire("sub");
  assert.equal(ev.defaultPrevented, true);
  assert.deepEqual(opened, [URL_PR]);
  assert.deepEqual(bubbled, [], "other handlers must not open it a second time");
});

test("a click on the bold text inside a link counts as the link", () => {
  const { opened, fire } = page();
  assert.equal(fire("inner").defaultPrevented, true);
  assert.deepEqual(opened, [URL_PR]);
});

test("a plan body link and a target=_blank link open outside", () => {
  const { opened, fire } = page();
  assert.equal(fire("plan").defaultPrevented, true);
  assert.equal(fire("blank").defaultPrevented, true);
  assert.deepEqual(opened, ["https://example.com/plan?a=1&b=2", "https://example.com/x"]);
});

test("middle click is cancelled and opens outside; right click is left alone", () => {
  const { opened, fire } = page();
  assert.equal(fire("sub", "auxclick").defaultPrevented, true);
  assert.deepEqual(opened, [URL_PR]);
  const right = fire("sub", "auxclick", { button: 2 });
  assert.equal(right.defaultPrevented, false);
  assert.equal(opened.length, 1);
});

test("unsafe, in-page and relative links are cancelled but never opened", () => {
  const { opened, fire } = page();
  for (const id of ["js", "hash", "rel"]) assert.equal(fire(id).defaultPrevented, true, id);
  assert.deepEqual(opened, []);
  assert.equal(fire("mail").defaultPrevented, true);
  assert.deepEqual(opened, ["mailto:a@b.c"]);
  assert.equal(fire("none").defaultPrevented, false);
});

test("main.js installs the guard on the document, and every anchor surface renders through markdown", () => {
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  assert.match(main, /installLinkGuard\(document, \(url\) => \{ void openExternal\(url\); \}\)/);
  const sources = ["main.js", "kanban.js", "plan.js", "tools.js", "clarify.js", "approval.js"];
  for (const name of sources) {
    const text = readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
    // Any hand-built anchor must be covered by the document guard (no target/onclick tricks).
    assert.doesNotMatch(text, /location\.(href|assign|replace)\s*[=(]/, `${name} must not navigate the page`);
    assert.doesNotMatch(text, /onclick\s*=\s*["'`]/, `${name} must not use inline onclick`);
  }
});
