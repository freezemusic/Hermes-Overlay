import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  applyOrbName,
  layoutOrbNames,
  nameInkIsDark,
  nameLabelColors,
  nameLabelContrast,
  orbHitRect,
  truncateOrbName,
} from "./names.js";

test("a long orb name truncates and keeps the full name on the chip", () => {
  const full = "計劃助手超長名稱測試";
  assert.equal(truncateOrbName("計劃助手"), "計劃助手");
  assert.equal(truncateOrbName(full), "計劃助手超長名…");
  assert.ok(truncateOrbName(full).endsWith("…"));
  const dom = new JSDOM("<!doctype html><span id='n'></span>");
  const el = dom.window.document.getElementById("n");
  const painted = applyOrbName(el, full);
  assert.equal(el.textContent, painted.text);
  assert.equal(el.title, full);
  assert.equal(el.getAttribute("aria-label"), full);
  assert.equal(el.hidden, false);
  assert.ok(el.textContent.length < Array.from(full).length);
});

test("the name chip stays off the hit circle until Ctrl is held", () => {
  const disc = { x: 10, y: 20, w: 44, h: 44 };
  const label = { x: 0, y: 70, w: 96, h: 16 };
  assert.deepEqual(orbHitRect(disc, label, false), disc);
  assert.deepEqual(orbHitRect(disc, null, true), disc);
  const held = orbHitRect(disc, label, true);
  assert.ok(held.w > disc.w);
  assert.ok(held.h > disc.h);
  assert.ok(held.x <= label.x && held.y <= disc.y);
  assert.ok(held.y + held.h >= label.y + label.h);
});

test("name chips clear panels and each other", () => {
  const orbs = [
    { id: "a", name: "計劃助手", x: 10, y: 10, w: 44, h: 44 },
    { id: "b", name: "程式夥伴", x: 24, y: 10, w: 44, h: 44 },
  ];
  const panels = [{ x: 0, y: 60, w: 220, h: 180 }];
  const placed = layoutOrbNames(orbs, panels, { width: 800, height: 600 });
  assert.equal(placed.length, 2);
  assert.equal(placed[0].title, "計劃助手");
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  assert.equal(overlap(placed[0], placed[1]), false);
  for (const chip of placed) {
    assert.equal(overlap(chip, panels[0]), false);
  }
  const kanban = { id: "kanban", name: "看板", x: 618, y: 42, w: 44, h: 44 };
  const alone = layoutOrbNames([kanban], [], { width: 1280, height: 800 })[0];
  assert.equal(alone.align, "center");
  assert.ok(Math.abs(alone.anchorX - (kanban.x + kanban.w / 2)) < 0.6);
  assert.ok(Math.abs(alone.x + alone.w / 2 - (kanban.x + kanban.w / 2)) < 0.6);
  const banner = { x: 360, y: 90, w: 560, h: 36 };
  const moved = layoutOrbNames([kanban], [banner], { width: 1280, height: 800 })[0];
  assert.equal(overlap(moved, banner), false);
});

test("name ink clears 4.5 on the chip and is not a light bot colour", () => {
  const { fg, bg } = nameLabelColors();
  assert.equal(fg, "#14142b");
  assert.ok(nameLabelContrast() >= 4.5);
  assert.equal(nameInkIsDark(fg), true);
  assert.equal(nameInkIsDark("#f2f200"), false);
  assert.equal(nameInkIsDark("#00f2f2"), false);
  assert.equal(nameInkIsDark(bg) || bg === "#f7f8f8", true);
  const css = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const rule = css.slice(css.indexOf(".orb-name {"), css.indexOf(".orb-name[hidden]"));
  assert.match(rule, /color:\s*#14142b/);
  assert.match(rule, /background:\s*#f7f8f8/);
  assert.match(rule, /pointer-events:\s*none/);
  assert.match(rule, /text-overflow:\s*ellipsis/);
  assert.match(rule, /text-align:\s*center/);
  assert.doesNotMatch(rule, /color:\s*(?:var\(--bot\)|#f2f200|#00f2f2)/);
  assert.doesNotMatch(rule, /animation/);
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /永遠顯示員工名/);
  assert.match(html, /id="show-bot-names"/);
  const main = fs.readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const collect = main.slice(main.indexOf("function collectHits"), main.indexOf("let hitFrame"));
  assert.match(collect, /orbHitRect/);
  assert.match(collect, /modifierHeld/);
  const tick = main.slice(main.indexOf("async function tickRoster"), main.indexOf("async function refreshBotQuiet"));
  assert.doesNotMatch(tick, /set_show_bot_names/);
  assert.match(main, /set_show_bot_names/);
  const paint = main.slice(main.indexOf("function paintOrbNames"), main.indexOf("let showBotNamesWrite"));
  assert.match(paint, /conn-banner/);
  assert.match(paint, /style\.width = ""/);
  assert.match(paint, /translateX\(-50%\)/);
  assert.match(paint, /dataset\.state === "pill"/);
  const form = main.slice(main.indexOf("function readInteractionForm"), main.indexOf("function fillSettings"));
  assert.doesNotMatch(form, /fade_enabled:\s*false/);
  assert.match(form, /fadeEnabled/);
});
