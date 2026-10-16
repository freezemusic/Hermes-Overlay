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
  assert.match(block, /background-color:\s*rgb\(255 255 255 \/ \.96\)/);
  assert.match(css, /\.field select option \{[^}]*background-color:\s*#f7f8f8/s);
  assert.match(css, /\.field select option \{[^}]*color:\s*var\(--nous-navy\)/s);
});

test("hud glass stays readable and follows the v20 rulings", () => {
  assert.doesNotMatch(css, /backdrop-filter/);
  assert.doesNotMatch(css, /#edff45/);
  assert.doesNotMatch(css, /border-radius:\s*16px/);
  assert.doesNotMatch(css, /ease-spring/);
  assert.doesNotMatch(css, /scale\(\s*\.98\s*\)|scale\(\s*0\.98\s*\)/);
  assert.match(css, /--glass-fog:\s*rgb\(247 248 248 \/ \.88\)/);
  assert.match(css, /--glass-fog-soft:\s*rgb\(247 248 248 \/ \.88\)/);
  assert.match(css, /--bot-20:\s*rgb\(var\(--bot-rgb\) \/ \.20\)/);
  assert.match(css, /--text:\s*#000091/);
  assert.match(css, /--text-body:\s*#1a1a1a/);
  assert.match(css, /--nous-navy:\s*#000091/);
  assert.match(css, /--noise:\s*url\("\.\/assets\/noise\.png"\)/);
  assert.match(css, /--r-panel:\s*3px/);
  assert.match(css, /--r-sm:\s*3px/);
  assert.doesNotMatch(css, /--r-panel:\s*(?:6|10)px/);
  assert.match(css, /--dur-1:\s*120ms/);
  assert.match(css, /--dur-2:\s*200ms/);
  assert.match(css, /--dur-enter:\s*0?\.48s/);
  assert.match(css, /--shadow-pop:\s*0 4px 40px rgb\(0 0 145 \/ \.6\)/);
  assert.doesNotMatch(css, /0 12px 40px/);
  assert.match(css, /--ease-morph:\s*cubic-bezier\(\.2,\s*\.8,\s*\.2,\s*1\)/);
  assert.match(css, /\.morph \{[^}]*clip-path:\s*inset\(/s);
  assert.match(css, /\.morph-pill \{[^}]*height:\s*44px/s);
  assert.match(css, /\.morph-pill \{[^}]*width:\s*320px/s);
  assert.match(css, /\.morph\[data-state="panel"\] \.morph-orb \{[^}]*scale\(calc\(28 \/ 44\)\)/s);
  assert.match(css, /\.morph\.is-morphing \{[^}]*will-change:\s*clip-path, transform, opacity/s);
  assert.match(css, /\.morph\[data-hit-id\] \{[^}]*will-change:\s*auto/s);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\) \{[\s\S]*\.morph-body,\s*\.morph-pill \{[^}]*opacity 120ms linear/);
  assert.doesNotMatch(css, /panel-from-orb|panel-to-orb|scale\(0\.92\)/);
  assert.doesNotMatch(css, /@keyframes panel-in/);
  assert.match(css, /animation:\s*toast-in var\(--dur-enter\) var\(--ease-out\)/);
  assert.match(css, /url\("\.\/assets\/fonts\/barlow-condensed-500\.woff2"\)/);
  assert.match(css, /url\("\.\/assets\/fonts\/noto-sans-hk-400\.woff2"\)/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.match(css, /:lang\(en\)/);
  const upper = css.indexOf("text-transform: uppercase");
  assert.ok(upper > 0);
  assert.match(css.slice(Math.max(0, upper - 400), upper), /:lang\(en\)/);
  assert.equal([...css.matchAll(/text-transform:\s*uppercase/g)].length, 1);
  assert.match(css, /html\.platform-linux \{[^}]*--glass-fog:\s*rgb\(247 248 248 \/ \.92\)/s);
  assert.match(css, /\.center-panel,[\s\S]*?border:\s*1px solid var\(--nous-blue\)/);
  assert.match(css, /\.hud-corner \{[^}]*border:\s*1px solid var\(--nous-blue\)/s);
  assert.match(html, /class="hud-corner tl"/);
  assert.match(html, /class="hud-corner br"/);
});

test("bot panels own SOUL and the settings orb owns the gateway", () => {
  const template = html.slice(html.indexOf('id="bot-panel-template"'), html.indexOf("</template>"));
  assert.match(template, /SOUL\.md/);
  assert.match(template, /data-role="session"/);
  assert.match(template, /揀一個對話/);
  assert.match(template, /data-role="plan"/);
  assert.match(template, /data-role="plan-body"/);
  assert.match(template, /data-role="plan-toggle"/);
  assert.match(template, /收起/);
  assert.match(template, /data-role="soul"/);
  const settings = html.slice(html.indexOf('id="settings"'), html.indexOf('id="kanban-panel"'));
  assert.doesNotMatch(settings, /data-role="plan"/);
  assert.doesNotMatch(template, /Gateway/);
  assert.match(html, /Gateway 位址/);
  assert.match(html, /id="settings"/);
  assert.doesNotMatch(html, /data-tauri-drag-region/);
  assert.doesNotMatch(html, /游標靠近時淡出/);
  assert.match(html, /id="orb-menu"/);
  assert.match(html, /隱藏呢個 Bot/);
  assert.match(html, /隱藏保留金鑰/);
  assert.match(css, /\.orb-menu-btn \{[^}]*text-transform:\s*none/s);
});

test("orbs, bubbles, toasts, and kanban keep the mapped class names", () => {
  assert.match(css, /\.bot-btn \.bot-hit \{[^}]*inset:\s*-12px/s);
  assert.match(css, /\.bot-btn \.bot-hit \{[^}]*border-radius:\s*50%/s);
  assert.match(css, /\.bot-btn,[\s\S]*?contain:\s*layout style/);
  assert.match(css, /\.center-panel\[hidden\][^}]*display:\s*none/s);
  assert.match(css, /\.bubble\.bot \{[^}]*border-left:\s*2px solid var\(--bot-40\)/s);
  assert.match(css, /\.bubble\.bot \{[^}]*color:\s*#1a1a1a/s);
  assert.match(css, /\.bubble\.user \{[^}]*background:\s*rgb\(var\(--bot-rgb\) \/ \.22\)/s);
  assert.match(css, /\.bubble\.user \{[^}]*color:\s*#000091/s);
  assert.match(css, /\.bubble\.bot pre \{[^}]*background:\s*#000/s);
  assert.match(css, /\.bubble\.bot pre \{[^}]*color:\s*#fff/s);
  assert.match(css, /\.cmd-chip[^}]*font:\s*400 var\(--fs-meta\)/s);
  assert.match(css, /\.send-btn \{[^}]*background:\s*var\(--bot\)/s);
  assert.match(css, /\.send-btn \{[^}]*color:\s*#fff/s);
  assert.match(css, /\.icon-btn,[\s\S]*?color:\s*#000091/);
  assert.match(css, /\.toast \{[^}]*max-width:\s*280px/s);
  assert.match(css, /\.toast \{[^}]*border-radius:\s*var\(--r-sm\)/s);
  assert.match(css, /\.kanban-panel \{[^}]*width:\s*min\(960px, 80vw\)/s);
  assert.match(css, /\.kanban-panel \{[^}]*--grid-line:\s*var\(--bot-5\)/s);
  assert.match(css, /\.kanban-col-head \{[^}]*color:\s*var\(--nous-blue\)/s);
  assert.match(css, /\.orb-core \{[^}]*#fff 0 36%/s);
  assert.doesNotMatch(css, /\.orb-core \{[^}]*var\(--bot-20\) 55%/s);
  assert.match(css, /\.bot-btn\[data-hit-id\] \{[^}]*opacity:\s*var\(--hit-opacity,\s*0\.18\)/s);
  assert.match(html, /光球（包括設定同看板）預設半透明/);
  assert.match(css, /\.bot-btn::before,[\s\S]*?rgb\(var\(--bot-rgb\) \/ \.55\)/);
  assert.match(css, /\.plan-preview \{[^}]*border:\s*1px solid var\(--nous-blue\)/s);
  assert.match(css, /\.plan-preview \{[^}]*border-radius:\s*var\(--r-panel\)/s);
  assert.match(css, /\.plan-preview \{[^}]*background:\s*rgb\(247 248 248 \/ \.96\)/s);
  assert.match(css, /\.plan-title \{[^}]*color:\s*#000091/s);
  assert.match(css, /\.plan-title \{[^}]*text-transform:\s*none/s);
  assert.match(css, /\.plan-body \{[^}]*color:\s*#1a1a1a/s);
  assert.match(css, /\.plan-body pre \{[^}]*background:\s*#000/s);
  assert.match(css, /\.plan-body pre \{[^}]*color:\s*#fff/s);
  assert.match(css, /\.bot-btn \.bot-label \{[^}]*color:\s*#000091/s);
  assert.match(css, /\.bot-btn \.bot-label \{[^}]*text-shadow:[^;]*#fff/s);
  assert.match(css, /\.bot-btn \.bot-label \{[^}]*rgb\(247 248 248 \/ \.92\)/s);
  assert.match(css, /\.orb--kanban \.orb-core \{[^}]*rotate\(45deg\)/s);
  assert.doesNotMatch(css, /\.orb--kanban \.orb-core \{[^}]*scale\(/s);
  assert.match(css, /\.orb--kanban \.orb-core \{[^}]*border:\s*1px solid #616191/s);
  assert.match(css, /\.orb--kanban \.orb-glyph \{[^}]*color:\s*#616191/s);
  assert.match(css, /\.orb--kanban \.orb-glyph \{[^}]*text-shadow:\s*none/s);
  assert.match(css, /\.orb--kanban \.orb-core \{[^}]*background:\s*#fff/s);
  assert.doesNotMatch(css, /#0e0e24/);
  assert.doesNotMatch(css, /0 0 0 5px rgb\(0 0 0/);
  assert.match(css, /\.bot-btn\.is-waiting \.spinner \{[^}]*animation:\s*none/s);
  assert.match(css, /\.kanban-col-head:lang\(en\)/);
  assert.match(css, /\.bot-btn \.spinner \{[^}]*border:\s*1px solid transparent/s);
  assert.match(css, /\.bot-btn \.spinner \{[^}]*border-top-color:\s*var\(--bot-60\)/s);
  assert.doesNotMatch(css, /\.bot-btn \.spinner \{[^}]*border:\s*[2-9]px/s);
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
