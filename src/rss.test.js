import assert from "node:assert/strict";
import test from "node:test";
import {
  BOT_CHAT_UNBOUND_LINE,
  BOT_CHAT_NOT_LOCAL_LINE,
  botChatRefusalLine,
  botChatSendDisplaces,
  isLocalChatSource,
  resolveSession,
  sessionReadOnlyIn,
  sessionSendClosed,
} from "./sessions.js";

const chat = (id, source, extra = {}) => ({ id, title: "Bot Chat", hidden: true, source, last_active: 50, ...extra });

test("R-SS: a local-source Desktop Bot Chat takes a send (Hermes 0.22.5 Bot Chat door)", () => {
  for (const source of ["tui", "cli", "local", "desktop", "gui"]) {
    const rows = [chat("chat", source), { id: "other", title: "Plan", source, last_active: 90 }];
    assert.equal(sessionReadOnlyIn(rows[0], rows), false, source);
    assert.equal(sessionReadOnlyIn(rows[1], rows), true, `${source} non-Bot-Chat stays R-SS-08`);
    const resolved = resolveSession(rows, {});
    assert.equal(resolved.id, "chat");
    assert.equal(resolved.readOnly, false, source);
  }
  assert.equal(isLocalChatSource("api_server"), false);
  assert.equal(isLocalChatSource(""), false);
});

test("R-SS: an explicit non-Bot-Chat desktop row stays read-only", () => {
  const rows = [chat("chat", "tui"), { id: "20261015_011713_2242f9", title: "Continue previous plan work #3", source: "desktop", last_active: 90 }];
  const resolved = resolveSession(rows, { id: "20261015_011713_2242f9", explicit: true, anchor: 7 });
  assert.equal(resolved.id, "20261015_011713_2242f9");
  assert.equal(resolved.readOnly, true);
});

test("R-SS: an ended Desktop Bot Chat is not closed for a send; other ended rows are", () => {
  const rows = [chat("chat", "tui", { ended_at: 1793381892, end_reason: "cli_close" }), { id: "task", title: "MT5 wrapper", source: "api_server", end_reason: "tui_shutdown" }];
  assert.equal(sessionSendClosed(rows[0], rows), false);
  assert.equal(sessionSendClosed(rows[1], rows), true);
});

test("R-SS: an api_server Bot Chat is flagged as displaced by a send", () => {
  const rows = [chat("api_1792573589_0c14ed12", "api_server")];
  assert.equal(botChatSendDisplaces(rows[0], rows), true);
  const tui = [chat("chat", "tui")];
  assert.equal(botChatSendDisplaces(tui[0], tui), false);
});

test("R-SS: Bot Chat door refusals get a plain line", () => {
  assert.equal(botChatRefusalLine("Bot Chat admission refused: bot_chat_unbound (…)"), BOT_CHAT_UNBOUND_LINE);
  assert.equal(botChatRefusalLine("bot_chat_not_local"), BOT_CHAT_NOT_LOCAL_LINE);
  assert.equal(botChatRefusalLine("permission_denied"), "");
});
