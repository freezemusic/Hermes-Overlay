import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  TUI_READ_ONLY_REASON,
  canonicalBotChat,
  mostRecentBotChat,
  mostRecentSession,
  orderSessions,
  previewLine,
  resolveSession,
  sessionLabel,
  storedPinAfterResolve,
  unseenMessages,
} from "./sessions.js";

const sessions = [
  { id: "older", title: "Bot Chat", source: "api_server", last_active: 50, hidden: false },
  { id: "newer", title: "Bot Chat", source: "desktop", last_active: 80, hidden: true },
  { id: "split", title: "_splitLot", last_active: 10, hidden: true },
  { id: "desktop", title: "System Architect", last_active: 200, hidden: false },
];

test("Bot Chat is the default even when another session is newer", () => {
  assert.equal(mostRecentSession(sessions).id, "desktop");
  assert.equal(mostRecentBotChat(sessions).id, "older");
  assert.equal(canonicalBotChat(sessions).id, "older");
  const opened = resolveSession(sessions, { id: "split", explicit: false, anchor: 10 });
  assert.equal(opened.id, "split");
  assert.equal(opened.explicit, false);
  assert.equal(opened.anchor, 10);
  const pinned = resolveSession(sessions, { id: "split", explicit: true, anchor: 10 });
  assert.equal(pinned.id, "split");
  assert.equal(pinned.explicit, true);
  assert.equal(resolveSession(sessions, { id: "missing", explicit: true, anchor: 1 }).id, "older");
  assert.equal(resolveSession([], { id: "split", explicit: true, anchor: 1 }), null);
  assert.equal(sessionLabel(sessions[2]), "_splitLot（隱藏）");
  const tied = [
    { id: "b", title: "Bot Chat", source: "api_server", last_active: 5 },
    { id: "a", title: "Bot Chat", source: "api_server", last_active: 5 },
  ];
  assert.equal(resolveSession(tied, {}).id, "a");
  const plain = [
    { id: "desktop", title: "System Architect", last_active: 99 },
    { id: "split", title: "_splitLot", last_active: 10 },
  ];
  assert.equal(resolveSession(plain, {}), null);
  assert.deepEqual(orderSessions(sessions).map((session) => session.id), ["newer", "older", "desktop", "split"]);
  const tui = { id: "tui-chat", title: "Bot Chat", source: "tui", last_active: 500 };
  const desk = { id: "desk-chat", title: "Bot Chat", source: "desktop", last_active: 40 };
  const mixed = [tui, desk, { id: "notes", title: "Notes", source: "cli", last_active: 900 }];
  assert.equal(mostRecentBotChat(mixed).id, "desk-chat");
  assert.equal(resolveSession(mixed, {}).id, "desk-chat");
  assert.equal(resolveSession(mixed, { id: "tui-chat", explicit: true, anchor: 1 }).id, "tui-chat");
  assert.equal(mostRecentBotChat([tui]).id, "tui-chat");
  assert.equal(resolveSession([tui], {}).readOnly, true);
  assert.deepEqual(orderSessions(mixed).map((session) => session.id), ["tui-chat", "desk-chat", "notes"]);
});

test("Devon Bot Chats: tui-only, and history beats a newer empty duplicate", () => {
  const forex = [{
    id: "20261001_013827_25b1eb",
    title: "Bot Chat",
    source: "tui",
    started_at: 1759279107,
    last_active: 1792500000,
    message_count: 18,
    preview: "forex note",
  }];
  const forest = resolveSession(forex, { id: "saved-other", explicit: true, anchor: 1 });
  assert.equal(forest.id, "20261001_013827_25b1eb");
  assert.equal(forest.readOnly, true);
  assert.equal(TUI_READ_ONLY_REASON.includes("permission_denied"), true);

  for (const [profile, emptyId] of [
    ["mt-coder", "api_1792573589_mtcoder"],
    ["mt-tester", "api_1792573589_mttester"],
  ]) {
    const realId = `${profile}-bot-chat`;
    const rows = [
      {
        id: realId,
        title: "Bot Chat",
        source: "desktop",
        started_at: 1758000000,
        last_active: 1792400000,
        message_count: 42,
        preview: "cron output",
      },
      {
        id: emptyId,
        title: "Bot Chat",
        source: "api_server",
        started_at: 1792573589,
        last_active: 1792573600,
        message_count: 0,
        preview: "",
      },
    ];
    assert.equal(canonicalBotChat(rows).id, realId);
    const opened = resolveSession(rows, { id: emptyId, explicit: false, anchor: 1792573600 });
    assert.equal(opened.id, realId);
    assert.equal(opened.readOnly, false);
  }

  const ffDaily = [
    {
      id: "20261013_180130_88f994",
      title: "Bot Chat",
      source: "desktop",
      started_at: 1791914490,
      last_active: 1792500000,
      message_count: 12,
      preview: "ff daily",
    },
    {
      id: "api_1792573589_0c14ed12",
      title: "Bot Chat",
      source: "api_server",
      started_at: 1792573589,
      last_active: 1792573600,
      message_count: 0,
      preview: "",
    },
  ];
  assert.equal(canonicalBotChat(ffDaily).id, "20261013_180130_88f994");
  const ffOpened = resolveSession(ffDaily, { id: "api_1792573589_0c14ed12", explicit: false, anchor: 1792573600 });
  assert.equal(ffOpened.id, "20261013_180130_88f994");
  assert.equal(ffOpened.readOnly, false);
});

test("laptop session check keeps a configured id and an explicit pick", () => {
  const forex = [{
    id: "20261001_013827_25b1eb",
    title: "Bot Chat",
    source: "tui",
    started_at: 1759279107,
    last_active: 1792500000,
    message_count: 2312,
    preview: "forex",
  }];
  const forest = resolveSession(forex, { id: "20261001_013827_25b1eb", explicit: false, anchor: 1759279107 });
  assert.equal(forest.id, "20261001_013827_25b1eb");
  assert.equal(forest.readOnly, true);
  assert.equal(forest.anchor, 1759279107);
  assert.equal(storedPinAfterResolve(
    { id: "20261001_013827_25b1eb", explicit: false, anchor: 1759279107 },
    { id: forest.id, explicit: false, anchor: forest.anchor },
  ), null);

  const orch = [
    {
      id: "20261020_231552_1372e7",
      title: "Bot Chat",
      source: "api_server",
      message_count: 3,
      last_active: 1792571000,
    },
    {
      id: "20261015_011713_2242f9",
      title: "Bot Chat",
      source: "desktop",
      message_count: 40,
      last_active: 1792000000,
    },
  ];
  const orchOpen = resolveSession(orch, { id: "20261015_011713_2242f9", explicit: true, anchor: 1791910000 });
  assert.equal(orchOpen.id, "20261015_011713_2242f9");
  assert.equal(orchOpen.explicit, true);
  assert.equal(orchOpen.anchor, 1791910000);
  assert.equal(storedPinAfterResolve(
    { id: "20261015_011713_2242f9", explicit: true, anchor: 1791910000 },
    { id: "20261020_231552_1372e7", explicit: false, anchor: 1792571000 },
  ), null);

  const ffDaily = [
    {
      id: "api_1792573589_0c14ed12",
      title: "Bot Chat",
      source: "api_server",
      started_at: 1792573589,
      last_active: 1792573600,
      message_count: 0,
      preview: "",
    },
    {
      id: "20261013_180130_88f994",
      title: "判斷截圖顯示嘅問題",
      source: "desktop",
      started_at: 1791914490,
      last_active: 1792500000,
      message_count: 373,
      preview: "判斷截圖顯示嘅問題",
    },
  ];
  const ffOpened = resolveSession(ffDaily, { id: "20261013_180130_88f994", explicit: false, anchor: 1791914490 });
  assert.equal(ffOpened.id, "20261013_180130_88f994");
  assert.equal(ffOpened.explicit, false);
  assert.equal(storedPinAfterResolve(
    { id: "20261013_180130_88f994", explicit: false, anchor: 1791914490 },
    { id: "api_1792573589_0c14ed12", explicit: false, anchor: 1792573600 },
  ), null);

  const coder = [
    {
      id: "20261012_mtcoder",
      title: "Bot Chat",
      source: "desktop",
      message_count: 42,
      last_active: 1792400000,
      preview: "coder",
    },
    {
      id: "api_1792573589_f1c99a3b",
      title: "Bot Chat",
      source: "api_server",
      started_at: 1792573589,
      last_active: 1792573600,
      message_count: 0,
      preview: "",
    },
  ];
  assert.equal(
    resolveSession(coder, { id: "api_1792573589_f1c99a3b", explicit: false, anchor: 1792573600 }).id,
    "20261012_mtcoder",
  );
  assert.equal(storedPinAfterResolve(
    { id: "api_1792573589_f1c99a3b", explicit: false, anchor: 1792573600 },
    { id: "20261012_mtcoder", explicit: false, anchor: 1792400000 },
  ), null);

  const reviewer = [{
    id: "api_1792573589_b1b8ccc5",
    title: "Bot Chat",
    source: "api_server",
    message_count: 0,
    preview: "",
  }];
  assert.equal(
    resolveSession(reviewer, { id: "api_1792573589_b1b8ccc5", explicit: false, anchor: 1 }).id,
    "api_1792573589_b1b8ccc5",
  );

  const tester = [
    {
      id: "api_1792573589_257658b2",
      title: "Bot Chat",
      source: "api_server",
      started_at: 1792574000,
      last_active: 1792574100,
      message_count: 0,
    },
    {
      id: "20260901_mttester",
      title: "Bot Chat",
      source: "desktop",
      started_at: 1750000000,
      last_active: 1750001000,
      message_count: 0,
    },
  ];
  assert.equal(canonicalBotChat(tester).id, "20260901_mttester");
  assert.equal(resolveSession(tester, {}).id, "20260901_mttester");
  const filled = storedPinAfterResolve(
    { id: "", explicit: false, anchor: 0 },
    { id: "20260901_mttester", explicit: false, anchor: 1750001000 },
  );
  assert.equal(filled.id, "20260901_mttester");
  assert.equal(filled.explicit, false);
  const kept = storedPinAfterResolve(
    { id: "", explicit: true, anchor: 42 },
    { id: "20260901_mttester", explicit: false, anchor: 9 },
  );
  assert.equal(kept.explicit, true);
  assert.equal(kept.anchor, 42);
});

test("cron messages already on screen are not appended again", () => {
  const existing = [
    { role: "user", text: "hi" },
    { role: "bot", text: "hello", live: true },
  ];
  const caughtUp = unseenMessages(existing, [
    { role: "user", text: "hi" },
    { role: "bot", text: "hello world" },
  ]);
  assert.equal(caughtUp.settled.text, "hello world");
  assert.equal(caughtUp.fresh.length, 0);
  const cron = unseenMessages(
    [{ role: "user", text: "hi" }, { role: "bot", text: "hello" }],
    [{ role: "bot", text: "cron line\nsecond" }],
  );
  assert.equal(cron.settled, null);
  assert.equal(cron.fresh.length, 1);
  assert.equal(cron.fresh[0].text, "cron line\nsecond");
  assert.equal(previewLine(cron.fresh), "cron line");
  const emptyLive = unseenMessages(
    [{ role: "bot", text: "", live: true }],
    [{ role: "bot", text: "cron" }],
  );
  assert.equal(emptyLive.settled, null);
  assert.equal(emptyLive.fresh[0].text, "cron");
});

test("the panel pins Bot Chat and applies cron on the open transcript", () => {
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  assert.match(main, /payload\.type === "cron"/);
  assert.match(main, /orderSessions\(/);
  assert.match(main, /title: "Bot Chat"/);
  assert.match(main, /shellBlocksPreview\(shell\)/);
});
