import assert from "node:assert/strict";
import test from "node:test";
import {
  PREVIEW_COMMANDS,
  completionText,
  filterCommands,
  gatewayDown,
  modelFields,
  moveSlashIndex,
  markerChip,
  parseSlashMarker,
  reconnectDelayMs,
  resolveClient,
  slashFilterQuery,
} from "./slash.js";

test("slash popup filters by prefix and fuzzy match and keeps disabled rows", () => {
  const all = filterCommands(PREVIEW_COMMANDS, "");
  assert.equal(all.length, PREVIEW_COMMANDS.length);
  assert.deepEqual(filterCommands(PREVIEW_COMMANDS, "pl").map((c) => c.name), ["/plan"]);
  assert.deepEqual(filterCommands(PREVIEW_COMMANDS, "arv").map((c) => c.name), ["/arxiv"]);
  assert.equal(filterCommands(PREVIEW_COMMANDS, "zzzz").length, 0);
  assert.equal(filterCommands(PREVIEW_COMMANDS, "語音").some((c) => c.name === "/voice"), true);
  assert.equal(slashFilterQuery("/plan"), "plan");
  assert.equal(slashFilterQuery("/plan "), null);
  assert.equal(slashFilterQuery("plan"), null);
  assert.equal(slashFilterQuery("//plan"), null);
});

test("slash keyboard skips disabled rows and wraps", () => {
  const items = filterCommands(PREVIEW_COMMANDS, "");
  const voice = items.findIndex((c) => c.name === "/voice");
  const before = items[voice - 1] ? voice - 1 : 0;
  assert.equal(items[voice].enabled, false);
  assert.equal(moveSlashIndex(items, before, "ArrowDown"), voice + 1 < items.length ? voice + 1 : 0);
  assert.notEqual(moveSlashIndex(items, 0, "ArrowDown"), voice);
  const lastEnabled = moveSlashIndex(items, 0, "ArrowUp");
  assert.equal(items[lastEnabled].enabled !== false, true);
  assert.equal(completionText(items[0]), "/plan ");
});

test("history marker collapses to display plus command chip", () => {
  const text = '<!-- overlay-slash: {"display":"/plan add dark mode","command":"plan"} -->\n[/plan — plan mode]\n正文';
  const parsed = parseSlashMarker(text);
  assert.equal(parsed.display, "/plan add dark mode");
  assert.equal(parsed.command, "plan");
  assert.equal(markerChip(parsed.command), "plan");
  assert.match(parsed.rest, /plan mode/);
  assert.equal(parseSlashMarker("普通一句"), null);
  assert.equal(parseSlashMarker('<!-- overlay-slash: {bad} -->\nstay'), null);
  const skill = parseSlashMarker('<!-- overlay-slash: {"display":"/arxiv /pdf q","command":"arxiv+pdf"} -->\nexpanded');
  assert.equal(skill.command, "arxiv+pdf");
  assert.equal(skill.command.startsWith("skill:"), false);
  assert.equal(skill.display, "/arxiv /pdf q");
});

test("client commands map to session endpoints and prompts stay on the server", () => {
  assert.deepEqual(resolveClient("/new 筆記", PREVIEW_COMMANDS), {
    command: "new",
    args: "筆記",
    mapsTo: "POST /api/sessions",
  });
  assert.deepEqual(resolveClient("/reset", PREVIEW_COMMANDS).command, "new");
  assert.equal(resolveClient("/fork 另一條", PREVIEW_COMMANDS).command, "branch");
  assert.equal(resolveClient("/title 今日", PREVIEW_COMMANDS).mapsTo, "PATCH /api/sessions/{id}");
  assert.equal(resolveClient("/model", PREVIEW_COMMANDS).mapsTo, "POST /api/sessions/{id}/model");
  assert.equal(resolveClient("/stop", PREVIEW_COMMANDS).command, "stop");
  assert.equal(resolveClient("/plan 任務", PREVIEW_COMMANDS), null);
  assert.equal(resolveClient("/voice", PREVIEW_COMMANDS), null);
  assert.equal(resolveClient("/new", []).command, "new");
  assert.equal(resolveClient("hello", PREVIEW_COMMANDS), null);
  assert.deepEqual(modelFields("MiniMax-M2 --provider minimax"), {
    model: "MiniMax-M2",
    provider: "minimax",
  });
});

test("gateway retry backs off to 30 seconds", () => {
  assert.equal(reconnectDelayMs(0), 1000);
  assert.equal(reconnectDelayMs(1), 2000);
  assert.equal(reconnectDelayMs(2), 4000);
  assert.equal(reconnectDelayMs(4), 16000);
  assert.equal(reconnectDelayMs(5), 30000);
  assert.equal(reconnectDelayMs(9), 30000);
  assert.equal(gatewayDown("連唔到 Hermes gateway。請確認 gateway 已開，位址係設定入面嗰個（預設埠 8642）。"), true);
  assert.equal(gatewayDown("Hermes gateway 逾時。請確認 gateway 已開。"), true);
  assert.equal(gatewayDown("Gateway 拒絕金鑰（401）。"), false);
});
