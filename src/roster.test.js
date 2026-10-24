import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createProbeGate } from "./reconnect.js";
import { isProfileEnabled, profilesNeedingKeys, rosterSyncDelayMs, rosterTickAllowed } from "./roster.js";

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
  assert.match(body, /profilesNeedingKeys/);
  assert.match(body, /quiet:\s*true/);
  assert.match(body, /sync_profiles/);
  assert.match(body, /未有 API 金鑰，請喺設定填寫。金鑰唔會自動產生。/);
  assert.doesNotMatch(body, /create_session|set_profile_key|save_settings/);
  assert.match(main, /armRosterSync\(\)/);
});
