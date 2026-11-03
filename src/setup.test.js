import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEMO_BANNER, setupHintVisible, shouldAutoOpenSettings, SETUP_BANNER, SETUP_HINT } from "./setup.js";
import { withDevConfig } from "../scripts/tauri.mjs";

test("first run with no config opens settings", () => {
  assert.equal(shouldAutoOpenSettings({ needs_setup: true, mode: "hermes" }), true);
  assert.equal(shouldAutoOpenSettings({ needs_setup: false, mode: "hermes" }), false);
  assert.equal(shouldAutoOpenSettings({ needs_setup: true, mode: "mock" }), true);
  assert.equal(shouldAutoOpenSettings(null), false);
  assert.equal(setupHintVisible({ needs_setup: true }), true);
  assert.equal(setupHintVisible({ needs_setup: false }), false);
  assert.equal(setupHintVisible(null), false);
  assert.match(SETUP_BANNER, /撳呢度/);
  assert.match(SETUP_BANNER, /Kanban server/);
  assert.match(SETUP_HINT, /127\.0\.0\.1:9119/);
  assert.doesNotMatch(SETUP_HINT, /8642|金鑰/);
  assert.match(DEMO_BANNER, /--demo/);
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="setup-hint"/);
  assert.match(html, /127\.0\.0\.1:9119/);
});

test("settings have no gateway address, per-bot address or API key, and no demo switch", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const settings = html.slice(html.indexOf('id="settings"'), html.indexOf("</aside>", html.indexOf('id="settings"')));
  assert.doesNotMatch(settings, /gateway-url|Gateway 位址|8642|API_SERVER_KEY|API 金鑰/);
  assert.doesNotMatch(settings, /示範|demo/i);
  assert.doesNotMatch(main, /gateway-url|gateway_base_url|8642/);
  const row = main.slice(main.indexOf("function rowFromBot"), main.indexOf("function readRows"));
  assert.doesNotMatch(row, /data-field="key"|data-field="base_url"|專用位址|API 金鑰/);
  const read = main.slice(main.indexOf("function readRows"), main.indexOf("function applyInteraction"));
  assert.doesNotMatch(read, /base_url|key|has_key/);
  const save = main.slice(main.indexOf("async function saveSettings"), main.indexOf("async function probeSaved"));
  assert.doesNotMatch(save, /gateway_base_url|bot\.key/);
  // Demo comes from the backend's launch flag (settings.mode), never from a field.
  const boot = main.slice(main.indexOf("const settings = await invoke(\"get_settings\")"), main.indexOf("startWatchers();\n}"));
  assert.match(boot, /settings\.mode === "mock"\) useMock\(DEMO_BANNER\)/);
  assert.doesNotMatch(boot, /useMock\(SETUP_BANNER/);
});

test("tauri dev merges the dev identifier and build does not", () => {
  assert.deepEqual(withDevConfig(["dev"]), ["dev", "--config", "src-tauri/tauri.dev.conf.json"]);
  assert.deepEqual(withDevConfig(["dev", "--release"]), [
    "dev",
    "--config",
    "src-tauri/tauri.dev.conf.json",
    "--release",
  ]);
  assert.deepEqual(withDevConfig(["dev", "--config", "other.json"]), ["dev", "--config", "other.json"]);
  assert.deepEqual(withDevConfig(["build", "--bundles", "deb"]), ["build", "--bundles", "deb"]);
  const dev = JSON.parse(readFileSync(new URL("../src-tauri/tauri.dev.conf.json", import.meta.url), "utf8"));
  const prod = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  assert.equal(dev.identifier, "com.freezemusic.hermes-overlay.dev");
  assert.equal(prod.identifier, "com.freezemusic.hermes-overlay");
  assert.equal(prod.app.windows[0].visible, false);
  assert.equal(prod.app.windows[0].decorations, false);
  assert.equal(prod.app.windows[0].transparent, true);
  assert.equal(prod.app.windows[0].maximized, false);
  const windows = JSON.parse(readFileSync(new URL("../src-tauri/tauri.windows.conf.json", import.meta.url), "utf8"));
  assert.equal(windows.app.windows[0].visible, true);
  assert.equal(windows.app.windows[0].maximized, true);
  assert.equal(windows.app.windows[0].decorations, false);
  assert.equal(windows.app.windows[0].transparent, true);
  assert.equal(prod.bundle.category, "Utility");
  assert.equal(prod.bundle.linux.deb.recommends.includes("gnome-keyring"), true);
  assert.equal(prod.bundle.linux.deb.recommends.includes("xdg-utils"), true);
  assert.ok(prod.bundle.shortDescription);
  assert.ok(prod.bundle.longDescription);
});
