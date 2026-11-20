import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { idsOfGoneBots, ownerProfile, settingsNeedReconnect } from "./settings-save.js";

const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
const base = {
  mode: "hermes",
  dashboard_base_url: "http://h:9119",
  kanban_base_url: "http://k",
  bots: [{ profile: "a", display_name: "A", color: "#111111", enabled: true }],
};

test("R-PN-11 look and behaviour changes never reconnect", () => {
  const next = { ...base, text_size: "l", ui_language: "en", show_bot_names: true, show_tool_detail: true, interaction: { modifier: "alt" } };
  assert.equal(settingsNeedReconnect(base, next, false), false);
});

test("R-PN-11 connection changes reconnect", () => {
  assert.equal(settingsNeedReconnect(base, { ...base, dashboard_base_url: "http://x" }, false), true);
  assert.equal(settingsNeedReconnect(base, { ...base, kanban_base_url: "" }, false), true);
  assert.equal(settingsNeedReconnect(base, base, true), true);
  assert.equal(settingsNeedReconnect(base, { ...base, bots: [...base.bots, { profile: "b" }] }, false), true);
  assert.equal(settingsNeedReconnect(base, { ...base, bots: [{ ...base.bots[0], enabled: false }] }, false), true);
  assert.equal(settingsNeedReconnect(null, base, false), true);
});

test("R-PN-11 owner profile and gone ids", () => {
  assert.equal(ownerProfile("suborb:coder:s1"), "coder");
  assert.equal(ownerProfile("coder"), "coder");
  assert.deepEqual(idsOfGoneBots(["a", "suborb:b:1", "suborb:a:2"], ["a"]), ["suborb:b:1"]);
});

test("R-PN-11 wiring: save path keeps panels and never writes an empty open_panels", () => {
  assert.match(main, /connectHermes\(settings, \{ keepPanels: true \}\)/);
  assert.match(main, /else applyLiveSettings\(settings\)/);
  assert.match(main, /state\.openPanelsHold = true/);
  assert.match(main, /if \(!state\.openPanelsReady \|\| state\.openPanelsHold\) return;/);
  assert.match(main, /state\.openPanelsReady \|\| state\.openPanelsHold \|\| state\.mode/);
  const use = main.slice(main.indexOf("function useHermes("), main.indexOf("async function connectHermes("));
  assert.match(use, /if \(keepPanels\)/);
  assert.match(use, /dropBotShell\(shell\)/);
  // the teardown stays on the non-keep branch only
  assert.ok(use.indexOf("removeBotPanels()") > use.indexOf("} else {"));
});
