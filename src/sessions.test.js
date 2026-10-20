import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
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
  assert.equal(mostRecentBotChat(sessions).id, "newer");
  const opened = resolveSession(sessions, { id: "split", explicit: false, anchor: 10 });
  assert.equal(opened.id, "newer");
  assert.equal(opened.explicit, false);
  const pinned = resolveSession(sessions, { id: "split", explicit: true, anchor: 10 });
  assert.equal(pinned.id, "split");
  assert.equal(pinned.explicit, true);
  assert.equal(resolveSession(sessions, { id: "missing", explicit: true, anchor: 1 }).id, "newer");
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
  assert.equal(resolveSession(plain, {}).id, "desktop");
  assert.deepEqual(orderSessions(sessions).map((session) => session.id), ["newer", "older", "desktop", "split"]);
  const tui = { id: "tui-chat", title: "Bot Chat", source: "tui", last_active: 500 };
  const desk = { id: "desk-chat", title: "Bot Chat", source: "desktop", last_active: 40 };
  const mixed = [tui, desk, { id: "notes", title: "Notes", source: "cli", last_active: 900 }];
  assert.equal(mostRecentBotChat(mixed).id, "desk-chat");
  assert.equal(resolveSession(mixed, {}).id, "desk-chat");
  assert.equal(resolveSession(mixed, { id: "tui-chat", explicit: true, anchor: 1 }).id, "tui-chat");
  assert.equal(mostRecentBotChat([tui]), null);
  assert.deepEqual(orderSessions(mixed).map((session) => session.id), ["tui-chat", "desk-chat", "notes"]);
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
