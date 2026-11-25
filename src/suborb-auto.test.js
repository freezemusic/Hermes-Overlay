import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AUTO_HIDDEN_SOURCES,
  BOT_CHAT_TITLE,
  eligibleSuborb,
  emptySuborbModel,
  isAutomatedSession,
  pullOutCandidates,
  reconcileSuborbs,
} from "./suborb.js";

const bot = { id: "bot-chat", title: BOT_CHAT_TITLE, message_count: 4, last_active: 10, source: "api_server" };

function row(id, extra = {}) {
  return {
    id,
    title: extra.title || `任務 ${id}`,
    message_count: extra.message_count ?? 1,
    last_active: extra.last_active ?? 2,
    started_at: extra.started_at ?? 2,
    source: extra.source ?? "api_server",
    ...(extra.created_source != null ? { created_source: extra.created_source } : {}),
    ...(extra.pending ? { pending: true } : {}),
    ...(extra.busy === true || extra.busy === false ? { busy: extra.busy } : {}),
  };
}

function ids(view) {
  return view.shown.map((item) => item.id);
}

test("AUTO_HIDDEN_SOURCES is kanban and cron, matched on source or created_source", () => {
  assert.deepEqual(AUTO_HIDDEN_SOURCES, ["kanban", "cron"]);
  assert.equal(isAutomatedSession(row("k", { source: "Kanban" })), true);
  assert.equal(isAutomatedSession(row("c", { source: " CRON " })), true);
  assert.equal(isAutomatedSession(row("k2", { source: "api_server", created_source: "kanban" })), true);
  assert.equal(isAutomatedSession(row("c2", { source: "", created_source: "Cron" })), true);
  assert.equal(isAutomatedSession(row("a", { source: "api_server" })), false);
  assert.equal(isAutomatedSession(row("a2", { source: "api_server", created_source: "api_server" })), false);
  assert.equal(isAutomatedSession(row("x", { source: "kanban_dispatcher" })), false);
});

for (const source of ["kanban", "cron"]) {
  test(`${source}: a new row does not auto-spawn, including while blocked or waiting`, () => {
    const base = reconcileSuborbs(emptySuborbModel(), {
      sessions: [bot],
      mainId: "bot-chat",
      now: 0,
    });
    assert.deepEqual(ids(base), []);
    const fresh = row("auto", {
      source,
      message_count: 3,
      last_active: 9,
      pending: true,
      busy: true,
    });
    const waiting = { ...base.model, waiting: { auto: true } };
    const born = reconcileSuborbs(waiting, {
      sessions: [bot, fresh],
      mainId: "bot-chat",
      now: 1,
    });
    assert.deepEqual(ids(born), []);
    assert.deepEqual(born.peek, []);
  });

  test(`${source}: a changed stamp does not auto-spawn`, () => {
    const first = reconcileSuborbs(emptySuborbModel(), {
      sessions: [bot, row("job", { source, message_count: 1, last_active: 1 })],
      mainId: "bot-chat",
      now: 0,
    });
    assert.deepEqual(ids(first), []);
    const moved = reconcileSuborbs(first.model, {
      sessions: [bot, row("job", { source, message_count: 6, last_active: 20, pending: true, busy: true })],
      mainId: "bot-chat",
      now: 2,
    });
    assert.deepEqual(ids(moved), []);
    assert.deepEqual(moved.peek, []);
  });

  test(`${source}: created_source alone does not auto-spawn`, () => {
    const base = reconcileSuborbs(emptySuborbModel(), {
      sessions: [bot],
      mainId: "bot-chat",
      now: 0,
    });
    const onlyCreated = reconcileSuborbs(base.model, {
      sessions: [bot, row("made", { source: "api_server", created_source: source, pending: true })],
      mainId: "bot-chat",
      now: 1,
    });
    assert.deepEqual(ids(onlyCreated), []);
    const cased = reconcileSuborbs(base.model, {
      sessions: [bot, row("cased", { source: "", created_source: source === "kanban" ? "Kanban" : "CRON" })],
      mainId: "bot-chat",
      now: 1,
    });
    assert.deepEqual(ids(cased), []);
  });

  test(`${source}: a hand pull-out shows an unpinned sub-orb`, () => {
    const base = reconcileSuborbs(emptySuborbModel(), {
      sessions: [bot, row("hand", { source, message_count: 2, last_active: 4, pending: true })],
      mainId: "bot-chat",
      now: 0,
    });
    assert.deepEqual(ids(base), []);
    const model = { ...base.model, forced: { hand: true }, waiting: { hand: true } };
    const pulled = reconcileSuborbs(model, {
      sessions: [bot, row("hand", { source, message_count: 2, last_active: 4, pending: true })],
      mainId: "bot-chat",
      now: 5,
    });
    assert.deepEqual(ids(pulled), ["hand"]);
    assert.equal(pulled.shown[0].pinned, false);
    assert.equal(pulled.shown[0].channels.badge, "waiting");
  });

  test(`${source}: a pin shows on the first list and stays after the stamp moves`, () => {
    const pinned = reconcileSuborbs(emptySuborbModel(), {
      sessions: [bot, row("pin", { source, message_count: 1, last_active: 3 })],
      mainId: "bot-chat",
      pinned: ["pin"],
      now: 0,
    });
    assert.deepEqual(ids(pinned), ["pin"]);
    assert.equal(pinned.shown[0].pinned, true);
    const later = reconcileSuborbs(pinned.model, {
      sessions: [bot, row("pin", { source, message_count: 4, last_active: 30, pending: true })],
      mainId: "bot-chat",
      pinned: ["pin"],
      now: 9,
    });
    assert.deepEqual(ids(later), ["pin"]);
    assert.equal(later.shown[0].pinned, true);
  });
}

test("an api_server row still auto-spawns beside hidden kanban and cron rows", () => {
  const base = reconcileSuborbs(emptySuborbModel(), {
    sessions: [bot],
    mainId: "bot-chat",
    now: 0,
  });
  const born = reconcileSuborbs(base.model, {
    sessions: [
      bot,
      row("k", { source: "kanban", pending: true, busy: true, started_at: 3 }),
      row("c", { source: "cron", created_source: "cron", pending: true, started_at: 4 }),
      row("live", { source: "api_server", message_count: 1, last_active: 8, started_at: 5 }),
    ],
    mainId: "bot-chat",
    now: 1,
  });
  assert.deepEqual(ids(born), ["live"]);
  assert.deepEqual(born.peek, ["live"]);
});

test("kanban and cron rows stay eligible for the session-menu pull-out", () => {
  const kanban = row("k", { title: "看板", source: "kanban", created_source: "kanban", last_active: 5 });
  const cron = row("c", { title: "排程", source: "cron", last_active: 4 });
  const notes = row("n", { title: "筆記", source: "api_server", last_active: 1 });
  const archived = row("old", { title: "舊", source: "kanban", last_active: 9 });
  archived.archived = true;
  assert.equal(eligibleSuborb(kanban, "bot-chat"), true);
  assert.equal(eligibleSuborb(cron, "bot-chat"), true);
  assert.equal(eligibleSuborb(archived, "bot-chat"), false);
  assert.deepEqual(pullOutCandidates([kanban, cron, notes, archived, bot], "bot-chat").map((item) => item.id), ["k", "c", "n"]);
});

test("created_source is carried to the sessions event and the list is not filtered server-side", () => {
  const suborb = readFileSync(new URL("./suborb.js", import.meta.url), "utf8");
  const eligible = suborb.slice(suborb.indexOf("export function eligibleSuborb"), suborb.indexOf("export const PULL_SUBORB_LABEL"));
  assert.doesNotMatch(eligible, /AUTO_HIDDEN|created_source|kanban|cron/);
  const wanted = suborb.slice(suborb.indexOf("const automated = isAutomatedSession"), suborb.indexOf("if (!wanted"));
  assert.match(wanted, /wanted = pinnedHere \|\| forced \|\| \(!automated && \(isNew \|\| moved\)\)/);
  const hermes = readFileSync(new URL("../src-tauri/src/hermes.rs", import.meta.url), "utf8");
  const parse = hermes.slice(hermes.indexOf("fn session_from_item"), hermes.indexOf("pub fn parse_session_list"));
  assert.match(parse, /created_source/);
  assert.match(parse, /createdSource/);
  const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const choice = lib.slice(lib.indexOf("struct SessionChoice"), lib.indexOf("struct DiscoveredBot"));
  assert.match(choice, /created_source: String/);
  assert.match(choice, /skip_serializing_if = "String::is_empty"/);
  const menu = lib.slice(lib.indexOf("fn session_choices"), lib.indexOf("fn begin_stream"));
  assert.match(menu, /created_source: session\.created_source\.clone\(\)/);
  const client = readFileSync(new URL("../src-tauri/src/client/mod.rs", import.meta.url), "utf8");
  const list = client.slice(client.indexOf("pub async fn list_sessions("), client.indexOf("pub async fn list_sessions_for_bot_chat"));
  const query = list.split("\n").find((line) => line.includes("query(profile"));
  assert.ok(query);
  assert.doesNotMatch(query, /exclude_sources/);
  assert.match(query, /archived", "include"/);
});
