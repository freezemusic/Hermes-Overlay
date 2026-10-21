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
  assert.equal(opened.id, "older");
  assert.equal(opened.explicit, false);
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
