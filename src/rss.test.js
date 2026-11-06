import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("R-SS main.js wiring: picker, closed checks, Bot Chat refusal, whole reply", () => {
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  assert.doesNotMatch(main, /sessionReadOnly\(picked\?\.source\)/);
  assert.match(main, /readOnlyLocked\(state\.deniedSessions, id, sessionId, sessionReadOnlyIn\(picked, thread\.sessions\)\)/);
  assert.doesNotMatch(main, /sessionEnded\(/);
  assert.equal((main.match(/sessionSendClosed\(/g) || []).length, 4);
  const refused = main.slice(main.indexOf("function botChatRefusal"), main.indexOf("function noteReadOnly"));
  assert.match(refused, /BOT_CHAT_UNBOUND_LINE/);
  assert.match(refused, /markUnsentDraft/);
  assert.match(refused, /repaintUnsent/);
  assert.doesNotMatch(refused, /invoke\(|send_chat|rememberDenied|sessionReadOnly = true/);
  assert.ok((main.match(/noteBotChatRefused\(/g) || []).length >= 5);
  const catchUp = main.slice(main.indexOf("function armWholeReplyCatchUp"), main.indexOf("/** R-SS-08: Hermes' Bot Chat door refused"));
  assert.match(catchUp, /refreshBotQuiet\(id\)/);
  assert.match(catchUp, /claimProfiles\(\[id\]/);
  assert.doesNotMatch(catchUp, /send_chat|create_session|select_session/);
  assert.match(main, /payload\.outcome === "completed" && !String\(live\?\.text \|\| ""\)\.trim\(\)\) armWholeReplyCatchUp\(id\)/);
  assert.doesNotMatch(main, /botChatSendDisplaces/);
});

test("botChatRefusalLine maps both refusal codes to plain lines", async () => {
  const { botChatRefusalLine, BOT_CHAT_UNBOUND_LINE, BOT_CHAT_NOT_LOCAL_LINE } = await import("./sessions.js");
  assert.equal(botChatRefusalLine("run failed: bot_chat_unbound open it once"), BOT_CHAT_UNBOUND_LINE);
  assert.equal(botChatRefusalLine("bot_chat_not_local"), BOT_CHAT_NOT_LOCAL_LINE);
  assert.equal(botChatRefusalLine("permission_denied"), "");
});
