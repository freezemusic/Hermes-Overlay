import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createProbeGate } from "./reconnect.js";
import { isProfileEnabled, keyBannerSlot, panelErrorSlot, profilesNeedingKeys, rosterSyncDelayMs, rosterTickAllowed } from "./roster.js";

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

test("an error toast stays inside the open panel and under the header", () => {
  const panel = { x: 860, y: 48, w: 420, h: 560, headerTop: 64, headerBottom: 112 };
  const slot = panelErrorSlot(panel);
  assert.equal(slot.inside, true);
  assert.ok(slot.x >= panel.x);
  assert.ok(slot.x + slot.w <= panel.x + panel.w);
  assert.ok(slot.y >= panel.headerBottom);
  assert.ok(slot.y < panel.y + panel.h);
  const bottomHeader = { x: 40, y: 80, w: 420, h: 560, headerTop: 560, headerBottom: 620 };
  const parked = panelErrorSlot(bottomHeader);
  assert.equal(parked.inside, true);
  assert.ok(parked.y < bottomHeader.headerTop);
  assert.ok(parked.x + parked.w <= bottomHeader.x + bottomHeader.w);
  assert.equal(panelErrorSlot(null), null);
  const underChrome = panelErrorSlot({ ...panel, chromeBottom: 188 });
  assert.equal(underChrome.inside, true);
  assert.ok(underChrome.y >= 188);
  assert.ok(underChrome.y < panel.y + panel.h);
  assert.ok(underChrome.y > panel.headerBottom);
});

test("the key banner keeps its home slot when open panels are clear", () => {
  const banner = { x: 360, y: 96, w: 560, h: 36 };
  const screen = { w: 1280, h: 900 };
  assert.deepEqual(keyBannerSlot(banner, [], screen), { x: 360, y: 96 });
  assert.deepEqual(
    keyBannerSlot(banner, [{ x: 1100, y: 42, w: 160, h: 72 }], screen),
    { x: 360, y: 96 },
  );
});

test("an open plan parks the key banner outside the panel, clear of step 1 and the session dropdown", () => {
  const banner = { x: 360, y: 96, w: 560, h: 36 };
  const screen = { w: 1280, h: 900 };
  const bot = { x: 200, y: 48, w: 420, h: 620 };
  const plan = { x: 620, y: 48, w: 300, h: 620 };
  const slot = keyBannerSlot(banner, [bot, plan], screen);
  assert.deepEqual(slot, { x: 360, y: 48 + 620 + 12 });
  const step = { x: 640, y: 133, w: 260, h: 22 };
  const dropdown = { x: 400, y: 118, w: 200, h: 28 };
  assert.ok(slot.y >= step.y + step.h + 12);
  assert.ok(slot.y >= dropdown.y + dropdown.h + 12);
  assert.notEqual(slot.y, 133);
});

test("a logged-in kanban board parks the key banner 12px outside the panel border", () => {
  const banner = { x: 360, y: 96, w: 560, h: 36 };
  const screen = { w: 1280, h: 900 };
  const panel = { x: 160, y: 41, w: 960, h: 760 };
  assert.equal(panel.y + panel.h, 801);
  const slot = keyBannerSlot(banner, [panel], screen);
  assert.deepEqual(slot, { x: 360, y: 801 + 12 });
  assert.ok(slot.y >= 801 + 12);
});

test("the key banner leaves the screen-centre side when an orb halo is there", () => {
  const banner = { x: 360, y: 96, w: 200, h: 36 };
  const screen = { w: 1280, h: 900 };
  const panel = { x: 200, y: 80, w: 880, h: 280 };
  const below = keyBannerSlot(banner, [panel], screen);
  assert.deepEqual(below, { x: 360, y: 80 + 280 + 12 });
  const orb = { x: 360, y: 360, w: 44, h: 44 };
  const moved = keyBannerSlot(banner, [panel], screen, 12, [orb]);
  assert.deepEqual(moved, { x: 360, y: 80 - banner.h - 12 });
  const halo = { x: orb.x - 34, y: orb.y - 34, w: orb.w + 68, h: orb.h + 68 };
  const hits = moved.x < halo.x + halo.w && moved.x + banner.w > halo.x
    && moved.y < halo.y + halo.h && moved.y + banner.h > halo.y;
  assert.equal(hits, false);
});

test("an idle banner clears the kanban halo, and a distant bottom panel stays out of it", () => {
  const banner = { x: 786, y: 96, w: 349, h: 33 };
  const screen = { w: 1920, h: 1200 };
  const kanban = { x: 938, y: 42, w: 44, h: 44 };
  const idle = keyBannerSlot(banner, [], screen, 12, [kanban]);
  assert.deepEqual(idle, { x: 786, y: 132 });
  const halo = { x: kanban.x - 34, y: kanban.y - 34, w: kanban.w + 68, h: kanban.h + 68 };
  const overlaps = idle.x < halo.x + halo.w && idle.x + banner.w > halo.x
    && idle.y < halo.y + halo.h && idle.y + banner.h > halo.y;
  assert.equal(overlaps, false);
  const bottom = { x: 400, y: 760, w: 680, h: 400 };
  assert.deepEqual(keyBannerSlot(banner, [bottom], screen, 12, [kanban]), idle);
  const pill = { x: 846, y: 96, w: 229, h: 33 };
  assert.deepEqual(keyBannerSlot(pill, [], screen, 12, [kanban]), { x: 846, y: 132 });
});

test("the key banner uses the header row when no outside edge fits on screen", () => {
  const banner = { x: 360, y: 96, w: 560, h: 36 };
  const screen = { w: 1280, h: 820 };
  const panel = {
    x: 160,
    y: 40,
    w: 960,
    h: 770,
    header: { x: 180, y: 52, w: 920, h: 56 },
  };
  const slot = keyBannerSlot(banner, [panel], screen);
  assert.equal(slot.x, 360);
  assert.equal(slot.y, 52 + (56 - 36) / 2);
  assert.ok(slot.y + banner.h <= 52 + 56);
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
  assert.match(placed, /keyBannerSlot/);
  assert.match(placed, /placePanelErrorBanner/);
  assert.match(placed, /sticky !== "gateway"/);
  const retry = main.slice(main.indexOf("function paintGatewayWait"), main.indexOf("function clearGatewayWait"));
  assert.match(retry, /placeKeyBanner/);
  assert.match(retry, /"gateway"/);
  assert.match(placed, /\.morph\[data-state='panel'\]:not\(\.is-collapsing\) \.center-panel/);
  assert.match(placed, /\.plan-hit-host/);
  assert.match(placed, /\.plan-window/);
  assert.doesNotMatch(placed, /Goal:/);
  assert.doesNotMatch(placed, /kanban-col/);
  const opened = main.slice(main.indexOf("function openSettings"), main.indexOf("function closeSettings"));
  assert.match(opened, /hideKeyPrompt/);
  assert.doesNotMatch(opened, /keyPromptBots = \[\]/);
  const row = main.slice(main.indexOf("function rowFromBot"), main.indexOf("function readRows"));
  assert.match(row, /bot\.profile && !bot\.has_key/);
  assert.match(row, /key-missing/);
  assert.match(row, /未有 API 金鑰/);
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
