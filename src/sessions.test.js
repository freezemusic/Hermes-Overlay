import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SESSION_READ_ONLY_REASON,
  canonicalBotChat,
  isPermissionDeniedText,
  mostRecentBotChat,
  mostRecentSession,
  orderSessions,
  permissionDeniedMessage,
  previewLine,
  resolveSession,
  sessionLabel,
  sessionReadOnly,
  storedPinAfterResolve,
  catchUpMessages,
  clearRunSession,
  continueLiveTurn,
  noteRunSession,
  rememberView,
  runTranscript,
  showSession,
  unseenMessages,
  viewingRun,
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
  assert.equal(canonicalBotChat(sessions).id, "newer");
  const opened = resolveSession(sessions, { id: "split", explicit: false, anchor: 10 });
  assert.equal(opened.id, "newer");
  assert.equal(opened.explicit, false);
  assert.equal(opened.anchor, 80);
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
  assert.equal(resolveSession(plain, {}), null);
  assert.deepEqual(orderSessions(sessions).map((session) => session.id), ["newer", "older", "desktop", "split"]);
  const tui = { id: "tui-chat", title: "Bot Chat", source: "tui", last_active: 500 };
  const desk = { id: "desk-chat", title: "Bot Chat", source: "desktop", last_active: 40 };
  const mixed = [tui, desk, { id: "notes", title: "Notes", source: "cli", last_active: 900 }];
  assert.equal(mostRecentBotChat(mixed).id, "desk-chat");
  const deskOpen = resolveSession(mixed, {});
  assert.equal(deskOpen.id, "desk-chat");
  assert.equal(deskOpen.readOnly, true);
  assert.equal(resolveSession(mixed, { id: "tui-chat", explicit: true, anchor: 1 }).id, "tui-chat");
  assert.equal(mostRecentBotChat([tui]).id, "tui-chat");
  assert.equal(resolveSession([tui], {}).readOnly, true);
  assert.deepEqual(orderSessions(mixed).map((session) => session.id), ["tui-chat", "desk-chat", "notes"]);
});

test("Devon Bot Chats: the hidden titled row wins, including an empty one", () => {
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
  assert.equal(forest.id, "20261001_013827_25b1eb");
  assert.equal(SESSION_READ_ONLY_REASON, "呢個 session 係喺 CLI／Desktop 開嘅，只可以睇，唔可以喺呢度傳嘢");

  for (const [profile, emptyId] of [
    ["mt-coder", "api_1792573589_f1c99a3b"],
    ["mt-tester", "api_1792573589_257658b2"],
  ]) {
    const retiredId = `${profile}-retired`;
    const rows = [
      { id: retiredId, title: "", archived: true, hidden: true, source: "tui", last_active: 1 },
      {
        id: emptyId,
        title: "Bot Chat",
        source: "api_server",
        hidden: true,
        started_at: 1792573589,
        last_active: 1792573600,
        message_count: 0,
        preview: "",
      },
      { id: "notes", title: "Notes", last_active: 1792579999 },
    ];
    assert.equal(canonicalBotChat(rows).id, emptyId);
    const opened = resolveSession(rows, { id: retiredId, explicit: false, anchor: 1 });
    assert.equal(opened.id, emptyId);
    assert.equal(opened.readOnly, false);
  }

  const ffDaily = [
    {
      id: "20261013_180130_88f994",
      title: "判斷截圖顯示嘅問題",
      source: "desktop",
      started_at: 1791914490,
      last_active: 1792500000,
      message_count: 373,
      preview: "ff daily",
    },
    {
      id: "api_1792573589_0c14ed12",
      title: "Bot Chat",
      source: "api_server",
      hidden: true,
      started_at: 1792573589,
      last_active: 1792573600,
      message_count: 387,
      preview: "ff",
    },
  ];
  assert.equal(canonicalBotChat(ffDaily).id, "api_1792573589_0c14ed12");
  const ffOpened = resolveSession(ffDaily, { id: "20261013_180130_88f994", explicit: false, anchor: 1791914490 });
  assert.equal(ffOpened.id, "api_1792573589_0c14ed12");
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
  assert.equal(orchOpen.readOnly, true);
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
  assert.equal(ffOpened.id, "api_1792573589_0c14ed12");
  assert.equal(ffOpened.explicit, false);
  assert.equal(storedPinAfterResolve(
    { id: "20261013_180130_88f994", explicit: false, anchor: 1791914490 },
    { id: "api_1792573589_0c14ed12", explicit: false, anchor: 1792573600 },
  ), null);

  const coder = [
    {
      id: "20261012_mtcoder",
      title: "Coder notes",
      source: "desktop",
      message_count: 42,
      last_active: 1792400000,
      preview: "coder",
    },
    {
      id: "api_1792573589_f1c99a3b",
      title: "Bot Chat",
      source: "api_server",
      hidden: true,
      started_at: 1792573589,
      last_active: 1792573600,
      message_count: 0,
      preview: "",
    },
  ];
  assert.equal(
    resolveSession(coder, { id: "api_1792573589_f1c99a3b", explicit: false, anchor: 1792573600 }).id,
    "api_1792573589_f1c99a3b",
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
      hidden: true,
      started_at: 1792574000,
      last_active: 1792574100,
      message_count: 0,
    },
    {
      id: "20260901_mttester",
      title: "Tester notes",
      source: "desktop",
      started_at: 1750000000,
      last_active: 1750001000,
      message_count: 0,
    },
  ];
  assert.equal(canonicalBotChat(tester).id, "api_1792573589_257658b2");
  assert.equal(resolveSession(tester, {}).id, "api_1792573589_257658b2");
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

test("desktop Bot Chat stays on the titled row and does not follow a continuation child", () => {
  const chain = [
    { id: "bot-root", title: "Bot Chat", hidden: true, source: "tui", last_active: 10, message_count: 4 },
    { id: "bot-old", title: "old branch", parent_session_id: "bot-root", last_active: 15 },
    { id: "bot-mid", title: "continued", parent_session_id: "bot-root", last_active: 20 },
    { id: "bot-tip", title: "tip", parent_session_id: "bot-mid", last_active: 40 },
  ];
  assert.equal(canonicalBotChat(chain).id, "bot-root");
  assert.equal(resolveSession(chain, { id: "stale-config", explicit: false, anchor: 1 }).id, "bot-root");
  const js = readFileSync(new URL("./sessions.js", import.meta.url), "utf8");
  assert.doesNotMatch(js, /parent_session_id/);
  const rust = readFileSync(new URL("../src-tauri/src/hermes.rs", import.meta.url), "utf8");
  const list = rust.slice(rust.indexOf("pub async fn list_sessions("), rust.indexOf("pub async fn list_titled_bot_chats"));
  const titled = rust.slice(rust.indexOf("pub async fn list_titled_bot_chats"), rust.indexOf("pub async fn list_sessions_for_bot_chat"));
  assert.match(list, /include_hidden=true/);
  assert.match(titled, /title=\{title\}&include_hidden=true&include_archived=true/);
  assert.doesNotMatch(list, /include_children/);
  assert.doesNotMatch(titled, /include_children/);
  assert.doesNotMatch(rust.slice(rust.indexOf("pub fn canonical_bot_chat"), rust.indexOf("pub fn fallback_session")), /parent_session_id/);

  const archived = [
    { id: "20261001_013821_3e5864", title: "", archived: true, hidden: true, source: "tui" },
    { id: "api_1792573589_f1c99a3b", title: "Bot Chat", hidden: true, source: "api_server", message_count: 0 },
    { id: "kanban-latest", title: "Bingo", last_active: 999 },
  ];
  assert.equal(
    resolveSession(archived, { id: "20261001_013821_3e5864", explicit: false, anchor: 1 }).id,
    "api_1792573589_f1c99a3b",
  );
  const explicit = [
    { id: "20261020_231552_1372e7", title: "Bot Chat", hidden: true, source: "tui", message_count: 1406 },
    { id: "20261015_011713_2242f9", title: "Continue previous plan work #3", source: "desktop" },
  ];
  const picked = resolveSession(explicit, { id: "20261015_011713_2242f9", explicit: true, anchor: 3 });
  assert.equal(picked.id, "20261015_011713_2242f9");
  assert.equal(picked.explicit, true);
  assert.equal(picked.readOnly, true);
  assert.equal(picked.anchor, 3);
  assert.equal(resolveSession(
    [{ id: "only-latest", title: "System Architect", last_active: 9 }],
    { id: "only-latest", explicit: false, anchor: 1 },
  ).id, "only-latest");
  assert.equal(resolveSession(
    [{ id: "retired-only", title: "", archived: true, hidden: true }],
    { id: "retired-only", explicit: false, anchor: 1 },
  ), null);
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

test("foreign session sources stay readable and permission_denied stays plain", () => {
  const reason = "呢個 session 係喺 CLI／Desktop 開嘅，只可以睇，唔可以喺呢度傳嘢";
  assert.equal(SESSION_READ_ONLY_REASON, reason);
  for (const source of ["oneshot", "desktop", "tui", "cli", "", "CLI"]) {
    const row = { id: `row-${source || "empty"}`, title: "Bot Chat", source };
    const opened = resolveSession([row], {});
    assert.equal(opened.id, row.id, source);
    assert.equal(opened.readOnly, true, source);
    assert.equal(sessionReadOnly(source), true, source);
  }
  for (const source of ["api_server", "API_Server", "bot_room", "Bot_Room"]) {
    const opened = resolveSession([{ id: "writable", title: "Bot Chat", source }], {});
    assert.equal(opened.id, "writable", source);
    assert.equal(opened.readOnly, false, source);
    assert.equal(sessionReadOnly(source), false, source);
  }
  const explicit = resolveSession(
    [
      { id: "api_1792573589_f1c99a3b", title: "Bot Chat", source: "api_server" },
      { id: "20261015_011713_2242f9", title: "Bot Chat", source: "desktop" },
    ],
    { id: "20261015_011713_2242f9", explicit: true, anchor: 3 },
  );
  assert.equal(explicit.id, "20261015_011713_2242f9");
  assert.equal(explicit.readOnly, true);
  const canonical = resolveSession(
    [
      { id: "shot", title: "oneshot", source: "oneshot", last_active: 99 },
      { id: "api_1792573589_0c14ed12", title: "Bot Chat", source: "api_server", hidden: true },
    ],
    { id: "shot", explicit: false, anchor: 1 },
  );
  assert.equal(canonical.id, "api_1792573589_0c14ed12");
  assert.equal(canonical.readOnly, false);

  assert.equal(permissionDeniedMessage("RuntimeStoreError('permission_denied')"), reason);
  assert.equal(permissionDeniedMessage("permission denied"), reason);
  assert.equal(permissionDeniedMessage("Gateway 回應 500。busy"), "Gateway 回應 500。busy");
  assert.equal(isPermissionDeniedText(reason), true);
  assert.equal(isPermissionDeniedText("回覆失敗"), false);

  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const send = main.slice(main.indexOf("async function sendActive"), main.indexOf("function botsFromSettings"));
  assert.match(send, /lockIfPermissionDenied/);
  assert.doesNotMatch(send, /create_session|create_bot_chat/);
  const paint = main.slice(main.indexOf("const note = role(panel, \"readonly\")"), main.indexOf("if (send) send.disabled"));
  assert.match(paint, /input\.disabled = locked/);
  assert.match(paint, /SESSION_READ_ONLY_REASON/);
  const insert = main.slice(main.indexOf("function insertComposerKey"), main.indexOf("function composerShellSettling"));
  assert.match(insert, /field\.disabled\) return/);
  const parked = main.slice(main.indexOf("function placePanelErrorBanner"), main.indexOf("function hideKeyPrompt"));
  assert.match(parked, /panelErrorSlot/);
  assert.match(parked, /dataset\.parked = "panel"/);
  const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const rustSend = lib.slice(lib.indexOf("async fn send_chat"), lib.indexOf("fn dispatch_turn"));
  const head = rustSend.slice(0, rustSend.indexOf("status: 404"));
  assert.match(head, /turn_is_permission_denied/);
  assert.doesNotMatch(head, /ensure_bot_chat|create_session|create_bot_chat|persist_pin/);
  assert.doesNotMatch(rustSend, /create_session|create_bot_chat/);
});

test("catch-up keeps an unseen reply and does not copy the live bubble", () => {
  const existing = [
    { role: "user", text: "第一句" },
    { role: "bot", text: "未講完", live: true },
    { role: "commentary", text: "排隊中，等佢講完就會行" },
  ];
  const incoming = [
    { role: "user", text: "第一句" },
    { role: "bot", text: "未講完，而家講完" },
    { role: "user", text: "第二句" },
    { role: "bot", text: "第二句嘅回覆" },
    { role: "tool", text: "ls" },
  ];
  const { fresh, settled } = catchUpMessages(existing, incoming);
  assert.deepEqual(settled, { text: "未講完，而家講完" });
  assert.deepEqual(fresh, [
    { role: "user", text: "第二句", tool_name: "" },
    { role: "bot", text: "第二句嘅回覆", tool_name: "" },
  ]);
  const again = catchUpMessages(
    [...existing, { role: "bot", text: "第二句嘅回覆" }],
    incoming,
  );
  assert.deepEqual(again.fresh, [{ role: "user", text: "第二句", tool_name: "" }]);
});

test("a running reply stays on its session while another session is open", () => {
  const thread = {
    sessionId: "live",
    liveSessionId: "",
    messages: [
      { role: "user", text: "做緊" },
      { role: "bot", text: "一半", live: true },
    ],
    bySession: new Map(),
  };
  noteRunSession(thread);
  assert.equal(thread.liveSessionId, "live");
  assert.equal(viewingRun(thread), true);
  rememberView(thread);
  showSession(thread, "other", [{ role: "bot", text: "另一個對話" }]);
  assert.equal(thread.sessionId, "other");
  assert.equal(thread.messages[0].text, "另一個對話");
  assert.equal(viewingRun(thread), false);
  const parked = runTranscript(thread);
  parked[1].text += "完成";
  parked[1].live = false;
  parked.push({ role: "commentary", text: "已停止呢次回覆。" });
  assert.equal(thread.messages.map((message) => message.text).join("\n"), "另一個對話");
  showSession(thread, "live", [
    { role: "user", text: "做緊" },
    { role: "bot", text: "一半完成" },
  ]);
  assert.equal(thread.messages[1].text, "一半完成");
  assert.equal(thread.messages[2].text, "已停止呢次回覆。");
  clearRunSession(thread);
  assert.equal(thread.liveSessionId, "");
  assert.equal(viewingRun(thread), true);
  showSession(thread, "other", [{ role: "bot", text: "另一個對話" }]);
  assert.equal(thread.messages[0].text, "另一個對話");
});

test("a steered or queued line does not split the live reply", () => {
  const messages = [
    { role: "user", text: "第一句" },
    { role: "bot", text: "一半", live: true },
    { role: "user", text: "跟住" },
    { role: "commentary", text: "排隊中，等佢講完就會行" },
  ];
  const first = continueLiveTurn(messages);
  assert.equal(first.created, false);
  first.message.text += "完成";
  assert.equal(messages.filter((message) => message.role === "bot").length, 1);
  assert.equal(messages[1].text, "一半完成");
  assert.equal(messages[2].text, "跟住");
  messages[1].live = false;
  const next = continueLiveTurn(messages);
  assert.equal(next.created, true);
  assert.equal(messages.filter((message) => message.role === "bot").length, 2);
  assert.equal(next.message, messages.at(-1));
  next.message.text = "下一輪";
  assert.equal(messages[1].text, "一半完成");
});
