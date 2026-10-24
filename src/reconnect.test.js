import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  RECONNECT_STATUS,
  createProbeGate,
  createReconnect,
  gatewayDown,
  reconnectDelayMs,
  reconnectStatus,
} from "./reconnect.js";

test("backoff is 5s, 10s, 20s, then 60s, with ±20% jitter", () => {
  const mid = () => 0.5;
  assert.equal(reconnectDelayMs(0, mid), 5000);
  assert.equal(reconnectDelayMs(1, mid), 10000);
  assert.equal(reconnectDelayMs(2, mid), 20000);
  assert.equal(reconnectDelayMs(3, mid), 60000);
  assert.equal(reconnectDelayMs(8, mid), 60000);
  assert.equal(reconnectDelayMs(0, () => 0), 4000);
  assert.equal(reconnectDelayMs(0, () => 1), 6000);
  assert.equal(reconnectDelayMs(1, () => 0), 8000);
  assert.equal(reconnectDelayMs(3, () => 1), 72000);
});

test("gateway down covers the kanban timeout and ignores a rejected key", () => {
  assert.equal(gatewayDown("hermes gateway timeout"), true);
  assert.equal(gatewayDown("Hermes gateway timeout"), true);
  assert.equal(gatewayDown("Hermes gateway 逾時。請確認 gateway 已開。"), true);
  assert.equal(gatewayDown("連唔到 Hermes gateway。"), true);
  assert.equal(gatewayDown("同 Hermes gateway 嘅連線中斷。"), true);
  assert.equal(gatewayDown("error sending request for url"), true);
  assert.equal(gatewayDown("Gateway 拒絕金鑰（401）。"), false);
  assert.equal(gatewayDown("Gateway 太忙（429），稍後再試。"), false);
  assert.equal(gatewayDown("呢部 Hermes 未有看板。伺服器冇提供看板功能（404）。"), false);
  assert.equal(gatewayDown("呢部 Hermes 未有看板。伺服器冇提供看板功能。"), false);
  assert.equal(gatewayDown("找不到路徑（404）。"), false);
});

test("retry copy is calm and names the next try", () => {
  const text = reconnectStatus(10_000, 4_200);
  assert.equal(text.startsWith(RECONNECT_STATUS), true);
  assert.match(text, /6 秒後再試/);
  assert.equal(text.includes("timeout"), false);
  assert.equal(reconnectStatus(1_000, 1_000), `${RECONNECT_STATUS} 即將再試`);
});

test("one probe per profile, and a down gateway recovers without creating a session", async () => {
  let now = 0;
  const timers = [];
  const calls = [];
  let up = false;
  const gate = createProbeGate();
  assert.equal(gate.tryBegin("mt-coder"), true);
  assert.equal(gate.tryBegin("mt-coder"), false);
  assert.equal(gate.tryBegin("mt-tester"), true);
  gate.end("mt-coder");
  gate.end("mt-tester");

  const link = createReconnect({
    now: () => now,
    random: () => 0.5,
    setTimer(fn, ms) {
      const id = timers.length + 1;
      timers.push({ id, fn, at: now + ms });
      return id;
    },
    clearTimer(id) {
      const row = timers.find((item) => item.id === id);
      if (row) row.fn = null;
    },
  });
  link.bind("gateway", async () => {
    if (!gate.tryBegin("kanban")) return "busy";
    calls.push("get_kanban_board");
    try {
      if (!up) return false;
      calls.push("sync_profiles");
      calls.push("list_cron_jobs");
      if (!gate.tryBegin("mt-coder")) return "busy";
      try {
        calls.push("open_bot:mt-coder");
      } finally {
        gate.end("mt-coder");
      }
      return true;
    } finally {
      gate.end("kanban");
    }
  });

  link.fail("gateway");
  link.fail("gateway");
  assert.equal(timers.filter((item) => item.fn).length, 1);
  assert.match(link.status("gateway"), /連唔到 Hermes，自動重試中…/);
  assert.match(link.status("gateway"), /5 秒後再試/);
  assert.equal(calls.length, 0);

  const first = timers.filter((item) => item.fn).at(-1);
  now = first.at;
  first.fn();
  first.fn = null;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["get_kanban_board"]);
  assert.equal(link.isDown("gateway"), true);
  assert.equal(link.inflight("gateway"), false);
  assert.equal(timers.filter((item) => item.fn).length, 1);

  up = true;
  const second = timers.filter((item) => item.fn).at(-1);
  now = second.at;
  second.fn();
  second.fn = null;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [
    "get_kanban_board",
    "get_kanban_board",
    "sync_profiles",
    "list_cron_jobs",
    "open_bot:mt-coder",
  ]);
  assert.equal(calls.some((name) => name.includes("create")), false);
  assert.equal(link.isDown("gateway"), false);
  assert.equal(link.status("gateway"), "");
});

test("opening a panel retries immediately and stays on the 20s rung", async () => {
  let now = 1_000;
  const timers = [];
  const link = createReconnect({
    now: () => now,
    random: () => 0.5,
    setTimer(fn, ms) {
      const id = timers.length + 1;
      timers.push({ id, fn, at: now + ms, ms });
      return id;
    },
    clearTimer(id) {
      const row = timers.find((item) => item.id === id);
      if (row) row.fn = null;
    },
  });
  link.bind("gateway", async () => false);
  link.fail("gateway");
  assert.equal(timers.at(-1).ms, 5000);
  for (const expect of [10_000, 20_000]) {
    const timer = timers.filter((item) => item.fn).at(-1);
    now = timer.at;
    timer.fn();
    timer.fn = null;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(timers.filter((item) => item.fn).at(-1).ms, expect);
  }
  assert.equal(link.attempt("gateway"), 2);
  assert.equal(link.kick("gateway"), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timers.filter((item) => item.fn).at(-1).ms, 20_000);
  assert.equal(link.attempt("gateway"), 2);
  const status = link.status("gateway", now + 15_000);
  assert.match(status, /5 秒後再試/);
});

test("opening the panel or the network returning retries immediately", async () => {
  let now = 0;
  const timers = [];
  const calls = [];
  const link = createReconnect({
    now: () => now,
    random: () => 0.5,
    setTimer(fn, ms) {
      const id = timers.length + 1;
      timers.push({ id, fn, at: now + ms });
      return id;
    },
    clearTimer(id) {
      const row = timers.find((item) => item.id === id);
      if (row) row.fn = null;
    },
  });
  link.bind("gateway", async () => {
    calls.push("probe");
    return false;
  });
  link.fail("gateway");
  assert.equal(link.kick("gateway"), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["probe"]);
  assert.equal(timers.filter((item) => item.fn).length, 1);
  assert.equal(link.kickDown(), 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
});

test("the recover path only reads kanban, cron, profiles, and bot chat", () => {
  const main = fs.readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const body = main.slice(main.indexOf("async function recoverGateway"), main.indexOf("function applyRoster"));
  assert.match(body, /get_kanban_board/);
  assert.match(body, /sync_profiles/);
  assert.match(body, /list_cron_jobs/);
  assert.match(body, /refreshBotQuiet/);
  assert.doesNotMatch(body, /create_session|create_bot_chat|client_command/);
  const history = main.slice(main.indexOf("async function loadBotHistory"), main.indexOf("function paintSessionSelect"));
  assert.match(history, /invoke\("open_bot"/);
  assert.doesNotMatch(history, /create_session|create_bot_chat/);
  const css = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.match(css, /\.kanban-empty\.is-retry \{[^}]*color:\s*#14142b/s);
  assert.doesNotMatch(css, /\.kanban-empty\.is-retry \{[^}]*animation/s);
  assert.match(body, /kanbanUnavailable/);
  assert.match(body, /announceNewKeys/);
  const kanbanRead = body.slice(0, body.indexOf("claimProfiles"));
  assert.doesNotMatch(kanbanRead, /return false/);
  assert.doesNotMatch(kanbanRead, /noteGatewayDown/);
  const refresh = main.slice(main.indexOf("async function refreshKanban"), main.indexOf("function commitKanban"));
  assert.doesNotMatch(refresh, /noteGatewayDown/);
  assert.match(css, /\.kanban-empty\.is-unavailable \{[^}]*color:\s*#14142b/s);
  assert.doesNotMatch(css, /\.kanban-empty\.is-unavailable \{[^}]*animation/s);
  assert.match(css, /\.kanban-empty\.is-login \{[^}]*color:\s*#14142b/s);
  assert.doesNotMatch(css, /\.kanban-empty\.is-login \{[^}]*animation/s);
  assert.match(main, /連唔到 Hermes，自動重試中…|RECONNECT_STATUS/);
});
