import assert from "node:assert/strict";
import test from "node:test";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { createLivePainter, isSafeLink, renderAssistantMarkdown } from "./markdown.js";

const purify = createDOMPurify(new JSDOM("<!DOCTYPE html><html><body></body></html>").window);

const sample = `# 標題

**粗體** 同 *斜體*

\`行內\`

\`\`\`js
const 甲 = 1
\`\`\`

- 一
- 二

1. 第一步

> 引文

[文件](https://example.com/路徑)

| 欄 | 值 |
| --- | --- |
| 甲 | 1 |

---

甲
乙
`;

test("assistant markdown renders headings, lists, code, tables, and CJK", () => {
  const html = renderAssistantMarkdown(sample, purify);
  assert.match(html, /<h1>標題<\/h1>/);
  assert.match(html, /<strong>粗體<\/strong>/);
  assert.match(html, /<em>斜體<\/em>/);
  assert.match(html, /<code>行內<\/code>/);
  assert.match(html, /<pre><code class="language-js">const 甲 = 1\n<\/code><\/pre>/);
  assert.match(html, /<ul>\s*<li>一<\/li>\s*<li>二<\/li>\s*<\/ul>/);
  assert.match(html, /<ol>\s*<li>第一步<\/li>\s*<\/ol>/);
  assert.match(html, /<blockquote>\s*<p>引文<\/p>\s*<\/blockquote>/);
  assert.match(html, /<a href="https:\/\/example\.com\/%E8%B7%AF%E5%BE%91">文件<\/a>/);
  assert.match(html, /<table>/);
  assert.match(html, /<th>欄<\/th>/);
  assert.match(html, /<td>甲<\/td>/);
  assert.match(html, /<hr>/);
  assert.match(html, /甲<br>乙/);
});

test("sanitizes raw html, event handlers, and javascript urls", () => {
  const html = renderAssistantMarkdown(
    [
      '<script>alert(1)</script>',
      '<img src=x onerror="alert(1)">',
      '<a href="javascript:alert(1)" onclick="alert(2)">點</a>',
      "[壞](javascript:alert(1))",
      "[好](https://example.com)",
    ].join("\n\n"),
    purify,
  );
  const doc = new JSDOM(`<!DOCTYPE html><body>${html}</body>`).window.document;
  assert.equal(doc.querySelector("script, img, iframe, object, embed"), null);
  for (const el of doc.body.querySelectorAll("*")) {
    for (const attr of el.attributes) {
      assert.equal(/^on/i.test(attr.name), false, attr.name);
      if (attr.name === "href") assert.equal(/^javascript:/i.test(attr.value), false);
    }
  }
  assert.equal(doc.querySelector('a[href="https://example.com"]')?.textContent, "好");
  const bad = [...doc.querySelectorAll("a")].find((a) => a.textContent === "壞");
  assert.ok(bad);
  assert.equal(bad.getAttribute("href"), null);
  assert.match(doc.body.textContent, /onerror/);
  assert.equal(isSafeLink("javascript:alert(1)"), false);
  assert.equal(isSafeLink("https://example.com/路徑"), true);
  assert.equal(isSafeLink("/local"), false);
});

test("an unclosed fence stays a code block and keeps the text before it", () => {
  const html = renderAssistantMarkdown("前文 標題\n\n```js\nconst 甲 = 1\nconst 乙 = 2", purify);
  assert.match(html, /<p>前文 標題<\/p>/);
  assert.match(html, /<pre><code class="language-js">/);
  assert.match(html, /const 甲 = 1/);
  assert.match(html, /const 乙 = 2/);
  assert.doesNotMatch(html, /<script/i);
});

test("streaming re-render is throttled and an open fence stays a code block", () => {
  let now = 1000;
  let text = "";
  const paints = [];
  let queued = null;
  const painter = createLivePainter({
    delay: 50,
    now: () => now,
    setTimer(fn) {
      queued = fn;
      return 1;
    },
    clearTimer() {
      queued = null;
    },
    paint() {
      paints.push(renderAssistantMarkdown(text, purify));
    },
  });

  text = "前文\n\n```js\nconst 甲 = 1";
  painter.schedule();
  text += "\nconst 乙 = 2";
  painter.schedule();
  painter.schedule();
  assert.equal(paints.length, 1);
  assert.match(paints[0], /<p>前文<\/p>/);
  assert.match(paints[0], /<pre><code class="language-js">/);
  assert.match(paints[0], /const 甲 = 1/);
  assert.doesNotMatch(paints[0], /const 乙/);
  assert.equal(typeof queued, "function");

  now = 1060;
  text += "\n```\n\n**完成**";
  queued();
  assert.equal(paints.length, 2);
  assert.match(paints[1], /const 乙 = 2/);
  assert.match(paints[1], /<strong>完成<\/strong>/);
  assert.doesNotMatch(paints[1], /<script/i);

  text += " 尾";
  painter.schedule();
  painter.flush();
  assert.equal(paints.length, 3);
  assert.match(paints[2], /完成<\/strong> 尾/);
  queued?.();
  assert.equal(paints.length, 3);
});
