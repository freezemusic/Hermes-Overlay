import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { installKeyGuard, isBrowserAccelerator } from "./keyguard.js";

const k = (key, mods = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

test("reload keys are blocked: F5, Ctrl+F5, Ctrl+R, Ctrl+Shift+R, Cmd+R", () => {
  assert.ok(isBrowserAccelerator(k("F5")));
  assert.ok(isBrowserAccelerator(k("F5", { ctrlKey: true })));
  assert.ok(isBrowserAccelerator(k("F5", { shiftKey: true })));
  assert.ok(isBrowserAccelerator(k("r", { ctrlKey: true })));
  assert.ok(isBrowserAccelerator(k("R", { ctrlKey: true, shiftKey: true })));
  assert.ok(isBrowserAccelerator(k("r", { metaKey: true })));
});

test("find, print, save, open, view-source and history keys are blocked", () => {
  for (const key of ["f", "g", "p", "s", "o", "u"]) assert.ok(isBrowserAccelerator(k(key, { ctrlKey: true })), key);
  assert.ok(isBrowserAccelerator(k("F3")));
  assert.ok(isBrowserAccelerator(k("ArrowLeft", { altKey: true })));
  assert.ok(isBrowserAccelerator(k("ArrowRight", { altKey: true })));
});

test("text-editing and ordinary keys stay free (R-CT-08 Ctrl+Enter untouched)", () => {
  for (const key of ["c", "v", "x", "z", "y", "a", "Backspace", "Enter", "ArrowLeft", "Home"]) {
    assert.equal(isBrowserAccelerator(k(key, { ctrlKey: true })), false, `Ctrl+${key}`);
  }
  assert.equal(isBrowserAccelerator(k("r")), false);
  assert.equal(isBrowserAccelerator(k("f")), false);
  assert.equal(isBrowserAccelerator(k("ArrowLeft")), false);
  assert.equal(isBrowserAccelerator(k("F2")), false);
  assert.equal(isBrowserAccelerator(k("r", { ctrlKey: true, altKey: true })), false); // AltGr combos
});

test("the capture guard cancels F5 before a page handler and leaves Ctrl+V alone", () => {
  const dom = new JSDOM("<textarea id=t></textarea>");
  const { window } = dom;
  installKeyGuard(window);
  const seen = [];
  window.addEventListener("keydown", (e) => seen.push(e.key));
  const f5 = new window.KeyboardEvent("keydown", { key: "F5", bubbles: true, cancelable: true });
  window.document.getElementById("t").dispatchEvent(f5);
  assert.equal(f5.defaultPrevented, true);
  assert.deepEqual(seen, []);
  const paste = new window.KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true, cancelable: true });
  window.document.getElementById("t").dispatchEvent(paste);
  assert.equal(paste.defaultPrevented, false);
  assert.deepEqual(seen, ["v"]);
});

test("main.js installs the guard; Rust turns WebView2 accelerators off on Windows", () => {
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  assert.match(main, /installKeyGuard\(window\)/);
  const rust = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  assert.match(rust, /SetAreBrowserAcceleratorKeysEnabled\(false\)/);
  assert.match(rust, /disable_browser_accelerators\(&window\)/);
});
