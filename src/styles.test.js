import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function infiniteSelectors(source) {
  const found = [];
  const re = /([^{}@]+)\{([^{}]*)\}/g;
  let match = re.exec(source);
  while (match) {
    const body = match[2];
    if (/animation\s*:/.test(body) && /infinite/.test(body)) {
      found.push(match[1].trim());
    }
    match = re.exec(source);
  }
  return found;
}

test("modifier select is a light hairline control", () => {
  const block = css.slice(css.indexOf(".field select {"));
  assert.match(block, /appearance:\s*none/);
  assert.match(block, /-webkit-appearance:\s*none/);
  assert.match(block, /color-scheme:\s*light/);
  assert.match(block, /background-color:\s*rgb\(255 255 255 \/ \.6\)/);
  assert.match(css, /\.field select option \{[^}]*background-color:\s*#f7f8f8/s);
  assert.match(css, /\.field select option \{[^}]*color:\s*var\(--nous-navy\)/s);
});

test("hud glass drops blur, lime, and 16px panels", () => {
  assert.doesNotMatch(css, /backdrop-filter/);
  assert.doesNotMatch(css, /#edff45/);
  assert.doesNotMatch(css, /border-radius:\s*16px/);
  assert.match(css, /--glass-fog:\s*rgb\(247 248 248 \/ \.72\)/);
  assert.match(css, /--bot-20:\s*rgb\(var\(--bot-rgb\) \/ \.20\)/);
  assert.match(css, /--text:\s*var\(--nous-navy\)/);
  assert.match(css, /--nous-navy:\s*#000091/);
  assert.match(css, /--noise:\s*url\("\.\/assets\/noise\.png"\)/);
  assert.match(css, /--r-panel:\s*10px/);
  assert.match(css, /--r-sm:\s*3px/);
  const spring = css.match(/--ease-spring:\s*cubic-bezier\(([^)]+)\)/);
  assert.ok(spring, "spring easing");
  const overshoot = Number(spring[1].split(",").pop());
  assert.ok(overshoot <= 1.05, `spring overshoot ${overshoot}`);
  assert.match(css, /url\("\.\/assets\/fonts\/barlow-condensed-500\.woff2"\)/);
  assert.match(css, /url\("\.\/assets\/fonts\/noto-sans-hk-400\.woff2"\)/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.match(css, /:lang\(en\)/);
  assert.match(css, /html\.platform-linux \{[^}]*--glass-fog:\s*rgb\(247 248 248 \/ \.92\)/s);
});

test("orbs, bubbles, toasts, and kanban keep the mapped class names", () => {
  assert.match(css, /\.bot-btn \.bot-hit \{[^}]*inset:\s*-12px/s);
  assert.match(css, /\.bot-btn \.bot-hit \{[^}]*border-radius:\s*50%/s);
  assert.match(css, /\.bot-btn,[\s\S]*?contain:\s*layout style/);
  assert.match(css, /\.center-panel\[hidden\][^}]*display:\s*none/s);
  assert.match(css, /\.bubble\.bot \{[^}]*border-left:\s*2px solid var\(--bot-40\)/s);
  assert.match(css, /\.bubble\.user \{[^}]*background:\s*var\(--bot-10\)/s);
  assert.match(css, /\.cmd-chip[^}]*font:\s*400 var\(--fs-meta\)/s);
  assert.match(css, /\.send-btn \{[^}]*background:\s*var\(--bot\)/s);
  assert.match(css, /\.toast \{[^}]*max-width:\s*280px/s);
  assert.match(css, /\.kanban-panel \{[^}]*width:\s*min\(960px, 80vw\)/s);
  assert.match(css, /\.orb--kanban \.orb-core \{[^}]*rotate\(45deg\)/s);
  assert.match(css, /\.orb--kanban \.orb-core \{[^}]*border:\s*3px solid #0e0e24/s);
  assert.match(css, /\.orb--kanban \.orb-core \{[^}]*background:\s*#fff/s);
  assert.match(css, /\.orb--kanban \.orb-core \{[^}]*0 0 0 5px rgb\(0 0 0 \/ \.72\)/s);
  assert.match(css, /\.bot-btn\.is-waiting \.spinner \{[^}]*animation:\s*none/s);
  assert.match(css, /\.kanban-col-head:lang\(en\)/);
  assert.match(css, /\.bot-btn \.spinner \{[^}]*border-top-color:\s*var\(--bot\)/s);
  assert.match(css, /\.is-thinking \.spinner \{[^}]*animation:\s*spin 900ms linear infinite/s);
  assert.match(css, /\.chat-messages\.streaming \.bubble\.bot\[data-live\]::after \{[^}]*infinite/s);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /\.is-thinking \.bot-status \.spinner::before \{[^}]*content:\s*"···"/s);
});

test("idle document.getAnimations has no infinite iterations", () => {
  const selectors = infiniteSelectors(css);
  assert.ok(selectors.length >= 2, selectors.join(" | "));
  for (const selector of selectors) {
    for (const part of selector.split(",")) {
      assert.match(part, /\.is-thinking|\.streaming/, part);
    }
  }
  const dom = new JSDOM(`<!doctype html><style>${css}</style><body>
    <button class="bot-btn"><span class="spinner"></span><span class="orb-core"></span></button>
    <div class="chat-messages"><div class="bubble bot" data-live="1"></div></div>
  </body>`);
  const { document } = dom.window;
  document.getAnimations = () =>
    selectors
      .flatMap((selector) => selector.split(",").map((part) => part.trim().replace(/::[a-z-]+/g, "")))
      .filter((selector) => {
        try {
          return selector && document.querySelector(selector);
        } catch {
          return null;
        }
      })
      .map(() => ({ effect: { getTiming: () => ({ iterations: Infinity }) } }));
  const idle = document.getAnimations().filter((item) => item.effect.getTiming().iterations === Infinity);
  assert.equal(idle.length, 0);
  document.querySelector(".bot-btn").classList.add("is-thinking");
  document.querySelector(".chat-messages").classList.add("streaming");
  const live = document.getAnimations().filter((item) => item.effect.getTiming().iterations === Infinity);
  assert.ok(live.length >= 2);
});
