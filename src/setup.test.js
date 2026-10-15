import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bannerOpensSettings, setupHintVisible, shouldAutoOpenSettings, SETUP_BANNER, SETUP_HINT } from "./setup.js";
import { withDevConfig } from "../scripts/tauri.mjs";

test("first run with no config opens settings", () => {
  assert.equal(shouldAutoOpenSettings({ needs_setup: true, mode: "mock", gateway_base_url: "" }), true);
  assert.equal(shouldAutoOpenSettings({ needs_setup: false, mode: "mock", gateway_base_url: "" }), false);
  assert.equal(shouldAutoOpenSettings({ needs_setup: true, mode: "hermes", gateway_base_url: "http://127.0.0.1:8642" }), true);
  assert.equal(shouldAutoOpenSettings(null), false);
});

test("empty gateway banner opens settings and the hint names the url and key", () => {
  assert.equal(bannerOpensSettings({ mode: "mock", gateway_base_url: "" }), true);
  assert.equal(bannerOpensSettings({ mode: "mock", gateway_base_url: "  " }), true);
  assert.equal(bannerOpensSettings({ mode: "hermes", gateway_base_url: "http://127.0.0.1:8642" }), false);
  assert.equal(setupHintVisible(""), true);
  assert.equal(setupHintVisible("http://127.0.0.1:8642"), false);
  assert.match(SETUP_BANNER, /撳呢度/);
  assert.match(SETUP_HINT, /127\.0\.0\.1:8642/);
  assert.match(SETUP_HINT, /API 金鑰/);
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="setup-hint"/);
  assert.match(html, /127\.0\.0\.1:8642/);
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
  assert.equal(prod.bundle.category, "Utility");
  assert.equal(prod.bundle.linux.deb.recommends.includes("gnome-keyring"), true);
  assert.equal(prod.bundle.linux.deb.recommends.includes("xdg-utils"), true);
  assert.ok(prod.bundle.shortDescription);
  assert.ok(prod.bundle.longDescription);
});
