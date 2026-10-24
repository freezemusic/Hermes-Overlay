import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createProbeGate } from "./reconnect.js";
import { isProfileEnabled, keyBannerTop, profilesNeedingKeys, rosterSyncDelayMs, rosterTickAllowed } from "./roster.js";

test("missing enabled stays visible and false hides", () => {
  assert.equal(isProfileEnabled({ profile: "a" }), true);
  assert.equal(isProfileEnabled({ enabled: true }), true);
  assert.equal(isProfileEnabled({ enabled: false }), false);
  assert.equal(isProfileEnabled(null), false);
});

test("only newly discovered profiles without a key are prompted", () => {
  const before = [
    { profile: "planner", has_key: false, enabled: true },
    { profile: "coder", has_key: true, enabled: true },
  ];
  const after = [
    ...before,
    { profile: "research", has_key: false, enabled: true },
    { profile: "writer", has_key: true, enabled: true },
    { profile: "hidden", has_key: false, enabled: false },
  ];
  assert.deepEqual(
    profilesNeedingKeys(before, after).map((bot) => bot.profile),
    ["research"],
  );
});

test("the key banner drops below an open panel header and stays put when clear", () => {
  const banner = { x: 360, y: 96, w: 560, h: 36 };
  const header = { x: 320, y: 42, w: 960, h: 72 };
  assert.equal(keyBannerTop(banner, [header]), 42 + 72 + 8);
  assert.equal(keyBannerTop(banner, [{ x: 1100, y: 42, w: 160, h: 72 }]), 96);
  assert.equal(keyBannerTop(banner, []), 96);
});

test("the quiet roster tick waits about a minute and skips a busy or down gateway", () => {
  assert.equal(rosterSyncDelayMs(0), 48_000);
  assert.equal(rosterSyncDelayMs(0.5), 60_000);
  assert.equal(rosterSyncDelayMs(1), 72_000);
  assert.equal(rosterTickAllowed({}), true);
  assert.equal(rosterTickAllowed({ gatewayDown: true }), false);
  assert.equal(rosterTickAllowed({ rosterBusy: true }), false);
  assert.equal(rosterTickAllowed({ kanbanBusy: true }), false);
  assert.equal(rosterTickAllowed({ otherBusy: true }), false);
  const gate = createProbeGate();
  assert.equal(gate.tryBegin("roster"), true);
  assert.equal(gate.tryBegin("roster"), false);
  assert.equal(rosterTickAllowed({ rosterBusy: gate.has("roster") }), false);
  gate.end("roster");
  assert.equal(gate.tryBegin("kanban"), true);
  assert.equal(rosterTickAllowed({ kanbanBusy: gate.has("kanban") }), false);
});

test("the quiet tick claims roster, prompts for a new key, and does not write keys", () => {
  const main = fs.readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const body = main.slice(main.indexOf("async function tickRoster"), main.indexOf("async function refreshBotQuiet"));
  assert.match(body, /claimProfiles\(\["roster"\]/);
  assert.match(body, /announceNewKeys/);
  assert.match(body, /quiet:\s*true/);
  assert.match(body, /sync_profiles/);
  assert.doesNotMatch(body, /create_session|set_profile_key|save_settings/);
  assert.match(main, /armRosterSync\(\)/);
  const announce = main.slice(main.indexOf("function keyPromptText"), main.indexOf("async function recoverGateway"));
  assert.match(announce, /profilesNeedingKeys/);
  assert.match(announce, /未有 API 金鑰，請喺設定填寫。金鑰唔會自動產生。/);
  assert.match(announce, /"keys"/);
  assert.match(announce, /showKeyPrompt/);
  const banner = main.slice(main.indexOf("function setBanner"), main.indexOf("function clearConnectionBanner"));
  assert.match(banner, /sticky !== "keys"/);
  const cleared = main.slice(main.indexOf("function clearConnectionBanner"), main.indexOf("/** undefined until"));
  assert.match(cleared, /"keys"/);
  const waited = main.slice(main.indexOf("function clearGatewayWait"), main.indexOf("function keyPromptText"));
  assert.match(waited, /showKeyPrompt/);
  assert.match(waited, /scheduleHitSync\("keys"\)/);
  const prompt = main.slice(main.indexOf("function showKeyPrompt"), main.indexOf("function hideKeyPrompt"));
  assert.match(prompt, /placeKeyBanner/);
  assert.match(prompt, /scheduleHitSync\("keys"\)/);
  const hide = main.slice(main.indexOf("function hideKeyPrompt"), main.indexOf("function placeKeyBanner"));
  assert.doesNotMatch(hide, /keyPromptBots = \[\]/);
  const placed = main.slice(main.indexOf("function placeKeyBanner"), main.indexOf("function reconcileKeyPrompt"));
  assert.match(placed, /keyBannerTop/);
  assert.match(placed, /panel-header/);
  const opened = main.slice(main.indexOf("function openSettings"), main.indexOf("function closeSettings"));
  assert.match(opened, /hideKeyPrompt/);
  assert.doesNotMatch(opened, /keyPromptBots = \[\]/);
  const closed = main.slice(main.indexOf("function closeSettings"), main.indexOf("async function saveSettings"));
  assert.match(closed, /showKeyPrompt/);
  const saved = main.slice(main.indexOf("async function saveSettings"), main.indexOf("async function probeSaved"));
  assert.match(saved, /reconcileKeyPrompt/);
  const recover = main.slice(main.indexOf("async function recoverGateway"), main.indexOf("function applyRoster"));
  assert.match(recover, /announceNewKeys/);
  const connect = main.slice(main.indexOf("async function connectHermes"), main.indexOf("function ensureSettingsList"));
  assert.match(connect, /announceNewKeys/);
  const refresh = main.slice(main.indexOf("async function refreshKanban"), main.indexOf("function commitKanban"));
  assert.doesNotMatch(refresh, /noteGatewayDown/);
  const login = main.slice(main.indexOf("function showKanbanLogin"), main.indexOf("function paintKanban"));
  assert.match(login, /replaceChildren\(\)/);
});
