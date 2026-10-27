import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import test from "node:test";
import {
  CONTINUE_API_HINT,
  CONTINUE_API_LABEL,
  SESSION_READ_ONLY_REASON,
  bannerOwner,
  canonicalBotChat,
  isPermissionDeniedText,
  mostRecentBotChat,
  mostRecentSession,
  orderSessions,
  permissionDeniedMessage,
  previewLine,
  resolveSession,
  keepManualSession,
  CLOSED_SESSION_LINE,
  GATEWAY_FORK_TITLE,
  closedSwitchTarget,
  isBotChat,
  isClosedSendText,
  isGatewayForkTitle,
  sendErrorKind,
  sessionEnded,
  sessionLabel,
  sessionTitleText,
  stampKeptTitles,
  writeSessionMenu,
  sessionReadOnly,
  readOnlyNote,
  readOnlyLocked,
  rememberDenied,
  noteRunStarted,
  finishApplies,
  stopAfterMiss,
  continueSideTurn,
  streamingRunId,
  sessionRouteMatches,
  sendErrorKeepsConnected,
  storedPinAfterResolve,
  catchUpMessages,
  writableContinuation,
  refusedSessionIds,
  UNSENT_MARK,
  markUnsentDraft,
  mergePendingSend,
  mergeSendError,
  mergeUnsentDraft,
  pendingSend,
  rememberPendingSend,
  rememberSendError,
  rememberUnsent,
  sendErrorDraft,
  unsentDraft,
  clearRunSession,
  continueLiveTurn,
  finishLiveBubble,
  interruptsLiveRow,
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

test("a manual pick beats the latest row across a quiet refresh", () => {
  const sessions = [
    { id: "manual", title: "Notes", source: "api_server", last_active: 10 },
    { id: "latest", title: "Bot Chat", source: "api_server", last_active: 900, hidden: true },
  ];
  const picked = resolveSession(sessions, { id: "manual", explicit: true, anchor: 10 });
  assert.equal(picked.id, "manual");
  assert.equal(picked.explicit, true);
  const latest = resolveSession(sessions, { id: "manual", explicit: false, anchor: 10 });
  assert.equal(latest.id, "latest");
  assert.equal(keepManualSession(
    { id: "manual", explicit: true },
    { id: "latest", session_id: "latest" },
    true,
  ), true);
  assert.equal(keepManualSession(
    { id: "manual", explicit: true },
    { id: "manual" },
    true,
  ), false);
  assert.equal(keepManualSession(
    { id: "manual", explicit: true },
    { id: "latest" },
    false,
  ), false);
  assert.equal(keepManualSession(
    { id: "manual", explicit: false },
    { id: "latest" },
    true,
  ), false);
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const opened = main.slice(main.indexOf("function applyOpened"), main.indexOf("function beginBotHistory"));
  assert.match(opened, /keepManualSession\(/);
  const quiet = main.slice(main.indexOf("function refreshBotQuiet"), main.indexOf("function kickGateway"));
  assert.match(quiet, /quiet: true/);
  const roster = main.slice(main.indexOf("async function tickRoster"), main.indexOf("async function refreshBotQuiet"));
  assert.match(roster, /sync_profiles", \{ quiet: true \}/);
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
  const deniedAt = send.indexOf("isPermissionDeniedText(raw)");
  const deniedReturn = send.indexOf("return;", deniedAt);
  assert.ok(deniedReturn < send.indexOf("setBanner", deniedAt));
  const denied = send.slice(deniedAt, deniedReturn);
  assert.match(denied, /lockIfPermissionDenied/);
  assert.doesNotMatch(denied, /setBanner|appendMessage/);
  const cont = main.slice(main.indexOf("async function continueApiSession"), main.indexOf("function botsFromSettings"));
  assert.match(cont, /writableContinuation/);
  assert.match(cont, /refusedSessionIds/);
  assert.match(cont, /refused,/);
  assert.match(cont, /command: "continue"/);
  assert.doesNotMatch(cont, /create_session|create_bot_chat/);
  const open = main.slice(main.indexOf("async function loadBotHistory"), main.indexOf("function paintSessionSelect"));
  assert.doesNotMatch(open, /continueApiSession|command: "continue"/);
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, new RegExp(CONTINUE_API_LABEL));
  assert.match(paint, /readOnlyNote/);
  assert.match(paint, /cont\.hidden = !locked/);
});

test("a read-only chat continues in another api session of the same bot", () => {
  const cli = { id: "local-mt5", title: "MT5 wrapper (CLI)", source: "cli", last_active: 9 };
  const desktop = { id: "20261015_011713_2242f9", title: "Bot Chat", source: "desktop", last_active: 8 };
  const notes = { id: "api_notes", title: "notes", source: "api_server", last_active: 7 };
  const chat = { id: "api_1792573589_0c14ed12", title: "Bot Chat", source: "api_server", last_active: 3 };
  assert.equal(writableContinuation([cli, desktop, notes, chat], desktop.id).id, chat.id);
  assert.equal(writableContinuation([cli, desktop], cli.id), null);
  assert.equal(
    writableContinuation(
      [{ id: "api_refused", title: "Bot Chat", source: "api_server", last_active: 12 }, notes],
      "api_refused",
    ).id,
    notes.id,
  );
  assert.equal(CONTINUE_API_LABEL, "喺 API 對話繼續");
  assert.match(CONTINUE_API_HINT, /API 對話繼續/);
  const refusedApi = { id: "api_denied", title: "Bot Chat", source: "api_server", last_active: 20 };
  assert.equal(writableContinuation([refusedApi, notes], "local-mt5", ["api_denied"]).id, notes.id);
  assert.equal(writableContinuation([refusedApi, notes, chat], cli.id, ["api_denied", notes.id, chat.id]), null);
  assert.equal(writableContinuation([cli, desktop, notes, chat], desktop.id).id, chat.id);
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

test("a tool row ends the live bubble and later text starts below it", () => {
  const messages = [
    { role: "user", text: "找" },
    { role: "bot", text: "Looking into it.", live: true },
  ];
  const finished = finishLiveBubble(messages);
  assert.equal(finished.live, false);
  assert.equal(finished.text, "Looking into it.");
  messages.push({ role: "tool-run", text: "用咗 1 個工具 · search_files", tools: [{ name: "search_files" }] });
  const next = continueLiveTurn(messages);
  assert.equal(next.created, true);
  next.message.text = "Done: found 40 matches.";
  assert.deepEqual(messages.map((message) => message.role), ["user", "bot", "tool-run", "bot"]);
  assert.equal(messages[1].text, "Looking into it.");
  assert.equal(messages[3].text, "Done: found 40 matches.");
  const stuck = [
    { role: "bot", text: "之前", live: true },
    { role: "tool-run", text: "工具" },
  ];
  const again = continueLiveTurn(stuck);
  assert.equal(again.created, true);
  assert.equal(again.finished, stuck[0]);
  assert.equal(stuck[0].live, false);
  assert.equal(stuck.at(-1).live, true);
  assert.equal(interruptsLiveRow({ role: "clarify" }), true);
  assert.equal(interruptsLiveRow({ role: "approval" }), true);
  assert.equal(interruptsLiveRow({ role: "commentary" }), false);
  const reloaded = [
    { role: "user", text: "找" },
    { role: "bot", text: "Looking into it." },
    { role: "tool", text: "40" },
    { role: "bot", text: "Done: found 40 matches." },
  ];
  const { fresh, settled } = catchUpMessages(messages, reloaded);
  assert.equal(fresh.length, 0);
  assert.equal(settled, null);
});

test("a closed menu follows the active session, and a foreign route is hidden", () => {
  const { document } = new JSDOM("<select></select>").window;
  const select = document.querySelector("select");
  const fork1 = { id: "api_syn_fork_1", title: "notes", source: "api_server", last_active: 2, session_key: "agent:main:dm:api_syn_fork_1" };
  const fork2 = { id: "api_syn_fork_2", title: "notes", source: "api_server", last_active: 1, session_key: "agent:main:dm:api_syn_fork_2" };
  const orphan = { id: "fork_new", title: "Continue previous conversation", source: "api_server", last_active: 9, session_key: "agent:main:dm:api_syn_fork_1" };
  assert.equal(sessionRouteMatches(orphan), false);
  assert.equal(sessionRouteMatches(fork2), true);
  assert.equal(sessionRouteMatches({ id: "plain", title: "notes" }), true);
  writeSessionMenu(select, [fork1, fork2, orphan], "api_syn_fork_1", { rebuild: true });
  assert.equal([...select.options].map((option) => option.value).join("|"), "api_syn_fork_1|api_syn_fork_2");
  assert.ok([...select.options].every((option) => option.textContent.includes("·")));
  select.value = "api_syn_fork_1";
  const picked = writeSessionMenu(select, [fork1, fork2, orphan], "api_syn_fork_2");
  assert.equal(picked, "api_syn_fork_2");
  assert.equal(select.value, "api_syn_fork_2");
  writeSessionMenu(select, [orphan], "fork_new", { rebuild: true });
  assert.equal(select.options[0].textContent, "未有對話");
  const messages = [{ role: "bot", text: "main", live: true }];
  const side = continueSideTurn(messages);
  assert.equal(side.created, true);
  assert.equal(side.message.side, true);
  assert.equal(messages[0].live, true);
  assert.equal(continueSideTurn(messages).message, side.message);
  const thread = { runId: "" };
  noteRunStarted(thread, "run_live");
  noteRunStarted(thread, "run_queued", { queued: true });
  assert.equal(thread.runId, "run_live");
  assert.equal(thread.queuedRunId, "run_queued");
  assert.equal(streamingRunId(thread), "run_live");
  assert.equal(sendErrorKeepsConnected("busy"), true);
  assert.equal(sendErrorKeepsConnected("other"), true);
  assert.equal(sendErrorKeepsConnected("closed"), false);
  assert.equal(sendErrorKeepsConnected(""), false);
});

test("stop follows the latest run and a 409 is not a stop", () => {
  const thread = { runId: "", nextRunId: "" };
  noteRunStarted(thread, "run_slow");
  noteRunStarted(thread, "run_queued");
  noteRunStarted(thread, "run_live");
  assert.equal(thread.runId, "run_live");
  assert.equal(thread.nextRunId, "");
  assert.equal(thread.staleRunId, "run_queued");
  assert.equal(finishApplies(thread, "run_queued"), false);
  assert.equal(finishApplies(thread, "run_live"), true);
  assert.equal(finishApplies(thread, ""), true);
  assert.deepEqual(stopAfterMiss(thread, "run_queued"), { retry: "run_live", stopped: false });
  assert.deepEqual(stopAfterMiss(thread, "run_live"), { retry: "", stopped: false });
});

test("permission_denied stays read-only after history says the source is writable", () => {
  const denied = new Set();
  rememberDenied(denied, "mt-orch", "api_refused");
  assert.equal(readOnlyLocked(denied, "mt-orch", "api_refused", false), true);
  assert.equal(readOnlyLocked(denied, "mt-orch", "api_other", false), false);
  assert.equal(readOnlyLocked(new Set(), "mt-orch", "desk", true), true);
  assert.equal(readOnlyLocked(denied, "ff-daily", "api_refused", false), false);
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const opened = main.slice(main.indexOf("function applyOpened"), main.indexOf("function beginBotHistory"));
  assert.match(opened, /readOnlyLocked/);
  assert.doesNotMatch(opened, /sessionReadOnly = !!opened\.read_only/);
  const note = main.slice(main.indexOf("function noteReadOnly"), main.indexOf("function lockIfPermissionDenied"));
  assert.match(note, /rememberDenied/);
  assert.match(note, /markUnsentDraft/);
  assert.match(note, /rememberUnsent/);
  const bubble = main.slice(main.indexOf("function paintUserBubble"), main.indexOf("function paintBotBubble"));
  assert.match(bubble, /UNSENT_MARK/);
  assert.match(bubble, /unsent-mark/);
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.match(css, /\.unsent-mark[^}]*font-size:\s*11px/s);
  assert.equal(readOnlyNote(SESSION_READ_ONLY_REASON), `${SESSION_READ_ONLY_REASON}。${CONTINUE_API_HINT}`);
  assert.equal(readOnlyNote().includes("傳嘢。撳下面"), true);
  assert.equal(readOnlyNote().includes("傳嘢 撳"), false);
});

test("the session menu separates desktop, archived, and api Bot Chats", () => {
  const desktop = { id: "desk", title: "Bot Chat", source: "desktop" };
  const archived = { id: "old", title: "Bot Chat", source: "api_server", archived: true };
  const api = { id: "api", title: "Bot Chat", source: "api_server" };
  assert.equal(sessionLabel(desktop), "Bot Chat（Desktop／只可以睇）");
  assert.equal(sessionLabel(archived), "Bot Chat（已封存）");
  assert.equal(sessionLabel(api), "Bot Chat");
  assert.equal(sessionLabel({ id: "c", title: "Bot Chat", source: "cli" }), "Bot Chat（CLI／只可以睇）");
  assert.equal(sessionLabel({ id: "mt5", title: "MT5 wrapper (CLI)", source: "cli" }), "MT5 wrapper (CLI)（只可以睇）");
  assert.equal(sessionLabel({ id: "desk2", title: "Bot Chat (Desktop)", source: "desktop" }), "Bot Chat (Desktop)（只可以睇）");
  assert.equal(sessionLabel({ id: "tui2", title: "終端（TUI）", source: "tui" }), "終端（TUI）（只可以睇）");
  assert.equal(sessionLabel({ id: "mid", title: "CLI notes", source: "cli" }), "CLI notes（CLI／只可以睇）");
  assert.equal(sessionLabel({ id: "t", title: "Bot Chat", source: "tui" }), "Bot Chat（TUI／只可以睇）");
  assert.equal(sessionLabel({ id: "o", title: "shot", source: "oneshot" }), "shot（一次性／只可以睇）");
  assert.equal(sessionLabel({ id: "room", title: "Bot Chat", source: "bot_room" }), "Bot Chat");
  assert.notEqual(sessionLabel(desktop), sessionLabel(archived));
  assert.notEqual(sessionLabel(archived), sessionLabel(api));
  assert.equal(
    sessionLabel({ id: "e969", title: "MT5 wrapper", source: "api_server", ended: true, end_reason: "tui_shutdown" }),
    "MT5 wrapper（已結束）",
  );
  assert.equal(sessionEnded({ ended_at: 1761504480, end_reason: "tui_shutdown" }), true);
  assert.equal(sessionEnded({ end_reason: "tui_shutdown" }), true);
  assert.equal(sessionEnded({ ended_at: 0, end_reason: "" }), false);
  assert.equal(sessionEnded({ id: "open", title: "Bot Chat" }), false);
  const closedTarget = closedSwitchTarget([
    { id: "e969", title: "MT5 wrapper", source: "api_server", ended: true },
    { id: "other", title: "notes", source: "api_server", last_active: 1 },
    { id: "bot", title: "Bot Chat", source: "api_server", last_active: 2 },
  ], "e969");
  assert.equal(closedTarget.id, "bot");
  assert.equal(isClosedSendText("呢個對話已經喺伺服器關閉（admission_conflict），回覆唔會出現喺呢度。"), true);
  assert.equal(isClosedSendText("個 bot 仲忙，呢句未送出。"), false);
  assert.equal(CLOSED_SESSION_LINE.includes("已經喺伺服器關閉"), true);
  const closedErrors = new Map();
  rememberSendError(closedErrors, "mt-orch", "e969", "呢個對話已經喺伺服器關閉（admission_conflict），回覆唔會出現喺呢度。", {
    kind: "closed",
    switchId: "20261027_200326_8166f64d",
  });
  assert.equal(sendErrorKind(closedErrors, "mt-orch", "e969"), "closed");
  assert.equal(sendErrorDraft(closedErrors, "mt-orch", "e969").includes("admission_conflict"), true);
  assert.equal(sendErrorDraft(closedErrors, "mt-orch", "e969").includes("個 bot 仲忙"), false);
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const send = main.slice(main.indexOf("async function sendActive"), main.indexOf("async function continueApiSession"));
  const endedAt = send.indexOf("sessionEnded");
  const invokeAt = send.indexOf('await invoke("send_chat"');
  assert.ok(endedAt >= 0 && invokeAt > endedAt);
  const failed = main.slice(main.indexOf('if (payload.type === "session.moved")'), main.indexOf("async function sendActive"));
  assert.match(failed, /kind === "closed"/);
  assert.match(failed, /noteClosedSend/);
  assert.match(failed, /session\.moved/);
  assert.match(failed, /session\.offer/);
  const closedNote = main.slice(main.indexOf("function noteClosedSend"), main.indexOf("function noteSendFailed"));
  assert.match(closedNote, /對話已關閉/);
  assert.doesNotMatch(closedNote, /連線錯誤/);
  const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const failure = lib.slice(lib.indexOf("fn chat_failure_line"), lib.indexOf("fn chat_failure_line") + 180);
  assert.match(failure, /send_failure/);
  assert.doesNotMatch(failure, /個 bot 仲忙/);
  const replaced = {
    id: "20261027_200326_8166f64d",
    title: GATEWAY_FORK_TITLE,
    kept_title: "MT5 wrapper",
    source: "api_server",
  };
  assert.equal(isGatewayForkTitle(GATEWAY_FORK_TITLE), true);
  assert.equal(isGatewayForkTitle("Continue previous plan work #3"), false);
  assert.equal(sessionTitleText(replaced), "MT5 wrapper");
  assert.equal(sessionLabel(replaced), "MT5 wrapper");
  assert.equal(isBotChat(replaced), false);
  assert.equal(sessionLabel({ id: "named", title: "notes", kept_title: "MT5 wrapper" }), "notes");
  const stamped = stampKeptTitles(
    [{ id: replaced.id, title: GATEWAY_FORK_TITLE, source: "api_server" }],
    { [replaced.id]: "MT5 wrapper" },
  );
  assert.equal(stamped[0].title, GATEWAY_FORK_TITLE);
  assert.equal(stamped[0].kept_title, "MT5 wrapper");
  assert.equal(sessionLabel(stamped[0]), "MT5 wrapper");
  const moved = main.slice(main.indexOf('if (payload.type === "session.moved")'), main.indexOf('if (payload.type === "session.offer")'));
  assert.match(moved, /kept_title/);
  assert.match(moved, /paintSessionSelect\(id, \{ force: true \}\)/);
  assert.match(moved, /delete select\.dataset\.key/);
  const opened = main.slice(main.indexOf("function applyOpened"), main.indexOf("function beginBotHistory"));
  assert.match(opened, /stampKeptTitles/);
  const note = lib.slice(lib.indexOf("async fn note_landed_session"), lib.indexOf("async fn send_chat"));
  assert.match(note, /hand_title_to_replacement/);
  assert.match(note, /kept_replacement_title/);
  assert.doesNotMatch(note, /patch_session_title/);
  const hand = lib.slice(lib.indexOf("async fn hand_title_to_replacement"), lib.indexOf("async fn note_landed_session"));
  assert.equal(hand.split("patch_session_title").length - 1, 4);
  assert.match(hand, /patch_session_archived/);
  assert.match(hand, /retired_session_title/);
  assert.doesNotMatch(hand, /已閉/);
  assert.doesNotMatch(main, /已閉/);
  assert.doesNotMatch(sessionLabel({
    id: "old",
    title: "MT5 wrapper_202610271237",
    source: "api_server",
    archived: true,
    ended: true,
    end_reason: "tui_shutdown",
  }), /已閉/);
  const openMenu = main.slice(main.indexOf("const sessionSelect = role(panel, \"session\")"), main.indexOf("sessionSelect?.addEventListener(\"change\""));
  assert.match(openMenu, /addEventListener\("mousedown"/);
  assert.match(openMenu, /addEventListener\("focus"/);
  assert.match(openMenu, /paintSessionSelect\(id, \{ rebuild: true \}\)/);
  const paint = main.slice(main.indexOf("function paintSessionSelect"), main.indexOf("async function pickSession"));
  assert.doesNotMatch(paint, /activeElement === select/);
  assert.match(paint, /writeSessionMenu/);
  const chromeAt = main.indexOf("const quietChrome");
  const chrome = main.slice(chromeAt, main.indexOf("const stamp = chatStamp", chromeAt));
  assert.match(chrome, /if \(!quietChrome\)/);
  assert.match(chrome, /paintSessionSelect\(id\)/);
  const quietGate = chrome.slice(0, chrome.indexOf("paintSessionSelect"));
  assert.doesNotMatch(quietGate, /paintSessionSelect/);
  const refresh = main.slice(main.indexOf("function refreshBotChats"), main.indexOf("function armChatRefresh"));
  assert.match(refresh, /if \(visualQuiet\(shell\)\) \{\s*paintSessionSelect\(bot\.id\);/s);
  const choice = lib.slice(lib.indexOf("struct SessionChoice"), lib.indexOf("struct DiscoveredBot"));
  assert.match(choice, /source:\s*String/);
  assert.match(choice, /archived:\s*bool/);
  const menu = lib.slice(lib.indexOf("fn session_choices"), lib.indexOf("fn begin_stream"));
  assert.match(menu, /source:\s*session\.source\.clone\(\)/);
  assert.match(menu, /archived:\s*session\.archived/);
});

test("an open session menu updates titles in place and keeps the selected id", () => {
  const { document } = new JSDOM("<select></select>").window;
  const select = document.querySelector("select");
  const closed = { id: "e969", title: "MT5 wrapper", source: "api_server", ended: true, end_reason: "tui_shutdown", last_active: 1 };
  const fresh = { id: "new", title: "Continue previous conversation", kept_title: "MT5 wrapper", source: "api_server", last_active: 2 };
  writeSessionMenu(select, [closed, fresh], "e969", { rebuild: true });
  assert.equal(select.value, "e969");
  assert.equal([...select.options].map((option) => option.textContent).join("|"), "MT5 wrapper|MT5 wrapper（已結束）");
  select.value = "e969";
  const selected = select.selectedIndex;
  writeSessionMenu(select, [
    { id: "e969", title: "MT5 wrapper_202610271237", source: "api_server", archived: true, ended: true, end_reason: "tui_shutdown", last_active: 9 },
    { id: "new", title: "MT5 wrapper", source: "api_server", last_active: 1 },
  ], "new", { menuOpen: true });
  assert.equal(select.value, "e969");
  assert.equal(select.selectedOptions[0].textContent, "MT5 wrapper_202610271237（已封存）（已結束）");
  assert.equal([...select.options].find((option) => option.value === "new").textContent, "MT5 wrapper");
  assert.notEqual(select.selectedIndex, selected);
  assert.equal(select.options[select.selectedIndex].value, "e969");
});

test("a refused typed line stays visible and marked unsent after history reloads", () => {
  const messages = [
    { role: "user", text: "舊句" },
    { role: "bot", text: "舊回覆" },
    { role: "user", text: "幫我睇下個倉" },
  ];
  const typed = messages[2];
  assert.equal(markUnsentDraft(messages), "幫我睇下個倉");
  assert.notEqual(messages[2], typed);
  assert.equal(messages[2].text, "幫我睇下個倉");
  assert.equal(messages[2].unsent, true);
  assert.equal(messages[0].unsent, undefined);
  assert.equal(markUnsentDraft(messages), "幫我睇下個倉");
  assert.equal(messages[2].unsent, true);
  assert.equal(UNSENT_MARK, "未送出");
  const history = [
    { role: "user", text: "舊句" },
    { role: "bot", text: "舊回覆" },
  ];
  const merged = mergeUnsentDraft(history, "幫我睇下個倉");
  assert.equal(merged.at(-1).text, "幫我睇下個倉");
  assert.equal(merged.at(-1).unsent, true);
  assert.equal(mergeUnsentDraft(merged, "幫我睇下個倉").length, merged.length);
  const echoed = history.concat([{ role: "user", text: "幫我睇下個倉" }]);
  const marked = mergeUnsentDraft(echoed, "幫我睇下個倉");
  assert.equal(marked.length, echoed.length);
  assert.equal(marked.at(-1).unsent, true);
  assert.notEqual(marked.at(-1), echoed.at(-1));
  assert.equal(mergeUnsentDraft(marked, "幫我睇下個倉"), marked);
  assert.equal(mergeUnsentDraft(history, "").length, history.length);
  const store = new Map();
  const denied = new Set();
  rememberDenied(denied, "mt-orch", "api_refused");
  rememberUnsent(store, "mt-orch", "api_refused", "幫我睇下個倉");
  assert.deepEqual(refusedSessionIds(denied, "mt-orch"), ["api_refused"]);
  assert.equal(unsentDraft(store, "mt-orch", "api_refused"), "幫我睇下個倉");
  assert.equal(unsentDraft(store, "ff-daily", "api_refused"), "");
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const opened = main.slice(main.indexOf("function applyOpened"), main.indexOf("function beginBotHistory"));
  assert.match(opened, /mergeUnsentDraft/);
  const stamp = main.slice(main.indexOf("function chatStamp"), main.indexOf("function threadHasCache"));
  assert.match(stamp, /unsent/);
  const sync = main.slice(main.indexOf("function syncChatInPlace"), main.indexOf("function mountChat"));
  assert.match(sync, /unsent-mark/);
  assert.match(sync, /paintUserBubble\(node, message\)/);
  const morph = readFileSync(new URL("./morph.js", import.meta.url), "utf8");
  const snapshot = morph.slice(morph.indexOf("export function sameChatSnapshot"), morph.indexOf("export function hostOpenPlan"));
  assert.match(snapshot, /unsent/);
  const send = main.slice(main.indexOf("async function sendActive"), main.indexOf("async function continueApiSession"));
  const busy = main.slice(main.indexOf("async function sendWhileBusy"), main.indexOf("async function stopActive"));
  assert.match(send, /lockIfPermissionDenied/);
  assert.match(send, /noteSendFailed/);
  assert.match(busy, /lockIfPermissionDenied/);
  assert.match(busy, /noteSendFailed/);
  assert.match(opened, /mergeSendError/);
  const failed = [
    { role: "user", text: "舊句" },
    { role: "user", text: "HTTP 500" },
  ];
  const failedStore = new Map();
  const errors = new Map();
  rememberUnsent(failedStore, "mt-orch", "api_1", markUnsentDraft(failed));
  rememberSendError(errors, "mt-orch", "api_1", "HTTP 500");
  const kept = mergeSendError(mergeUnsentDraft([{ role: "user", text: "舊句" }], unsentDraft(failedStore, "mt-orch", "api_1")), sendErrorDraft(errors, "mt-orch", "api_1"));
  assert.equal(kept.at(-2).text, "HTTP 500");
  assert.equal(kept.at(-2).unsent, true);
  assert.equal(kept.at(-1).text, "HTTP 500");
  assert.equal(kept.at(-1).role, "commentary");
  assert.equal(mergeSendError(kept, "HTTP 500"), kept);
  rememberSendError(errors, "mt-orch", "api_1", "");
  assert.equal(sendErrorDraft(errors, "mt-orch", "api_1"), "");
  const stream = main.slice(main.indexOf('if (payload.outcome === "failed" && isPermissionDeniedText(detail))'), main.indexOf('if (payload.type === "error")'));
  assert.match(stream, /lockIfPermissionDenied/);
  const failedNote = main.slice(main.indexOf("function noteSendFailed"), main.indexOf("function noteReadOnly"));
  const markAt = failedNote.indexOf("markUnsentDraft");
  const paintAt = failedNote.indexOf("repaintUnsent");
  const appendAt = failedNote.indexOf("appendOnce");
  assert.ok(markAt >= 0 && paintAt > markAt && appendAt > paintAt);
  const sameStamp = main.slice(main.indexOf("const current = chat.dataset.stamp === stamp"), main.indexOf("paintPlan(id, { force })"));
  assert.match(sameStamp, /repaintUnsent/);
  assert.match(opened, /panelShowing\(id\)/);
  assert.match(opened, /restoreSendErrorBanner/);
  assert.match(opened, /setBanner\(keptError, "error"\)/);
  assert.match(opened, /clearConnectionBanner\(\)/);
  const quietAt = opened.indexOf("sameChatSnapshot");
  const restoreAt = opened.indexOf("restoreSendErrorBanner");
  const bannerAt = opened.indexOf('setBanner(keptError, "error")');
  assert.ok(quietAt >= 0 && restoreAt > quietAt && bannerAt > restoreAt);
  const owned = main.slice(main.indexOf("function applySendErrorBanner"), main.indexOf("function repaintUnsent"));
  assert.match(owned, /clearConnectionBanner/);
  assert.match(owned, /setBanner\(text, "error"\)/);
  const back = main.slice(main.indexOf("async function selectBot"), main.indexOf("function openBotPanel"));
  assert.match(back, /applySendErrorBanner/);
  assert.match(main.slice(main.indexOf("function placeKeyBanner"), main.indexOf("function reconcileKeyPrompt")), /banner\.hidden = true/);
});

test("the error banner follows the focused open panel", () => {
  const panels = [
    { id: "default", open: true, z: 2 },
    { id: "researcher", open: true, z: 5 },
  ];
  assert.equal(bannerOwner("default", panels), "default");
  assert.equal(bannerOwner("researcher", panels), "researcher");
  assert.equal(bannerOwner("", panels), "researcher");
  assert.equal(bannerOwner(null, panels), "researcher");
  assert.equal(bannerOwner("missing", panels), "researcher");
  const front = [
    { id: "default", open: true, z: 9 },
    { id: "researcher", open: true, z: 5 },
  ];
  assert.equal(bannerOwner("", front), "default");
  const closed = [
    { id: "default", open: false, z: 9 },
    { id: "researcher", open: true, collapsing: true, z: 8 },
    { id: "other", open: true, z: 3 },
  ];
  assert.equal(bannerOwner("default", closed), "other");
  assert.equal(bannerOwner("", [{ id: "default", open: true, collapsing: true, z: 4 }]), "");
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const showing = main.slice(main.indexOf("function panelShowing"), main.indexOf("function focusOpenPanel"));
  assert.match(showing, /bannerOwner/);
  assert.doesNotMatch(showing, /!state\.activeId/);
  const focus = main.slice(main.indexOf("function focusOpenPanel"), main.indexOf("function restoreSendErrorBanner"));
  assert.match(focus, /state\.activeId = id/);
  assert.match(focus, /applySendErrorBanner/);
  assert.match(focus, /raisePanel/);
  const hit = main.slice(main.indexOf("function attachShell"), main.indexOf("function mountBotPanel"));
  assert.match(hit, /focusOpenPanel\(id\)/);
  assert.doesNotMatch(hit, /state === "panel" && !orb\) return/);
  const proxAt = main.indexOf("function setupProximity");
  const down = main.slice(proxAt, main.indexOf('window.addEventListener("pointerdown"', proxAt));
  assert.match(down, /focusOpenPanel\(botId\)/);
  const opened = main.slice(main.indexOf("function applyOpened"), main.indexOf("function beginBotHistory"));
  assert.match(opened, /panelShowing\(id\)/);
  assert.match(opened, /clearConnectionBanner\(\)/);
});

test("ctrl-click on an open panel orb raises that panel", () => {
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const press = main.slice(main.indexOf("function openPressedOrb"), main.indexOf("function abortLiveRehearsals"));
  const focusAt = press.indexOf("focusOpenPanel");
  const early = press.indexOf("if (orbOpenedThisPress()) return");
  assert.ok(focusAt >= 0 && early > focusAt);
  assert.match(press, /raisedPanelShell/);
  const gate = main.slice(main.indexOf("function raisedPanelShell"), main.indexOf("function focusOpenPanel"));
  assert.match(gate, /openIds/);
  assert.match(gate, /dataset\.visual === "panel"/);
  assert.match(gate, /dataset\.state === "panel"/);
  const back = main.slice(main.indexOf("async function selectBot"), main.indexOf("function openBotPanel"));
  assert.match(back, /raisedPanelShell\(id\)/);
  assert.match(back, /applySendErrorBanner/);
  assert.match(back, /raisePanel/);
  const collect = main.slice(main.indexOf("function collectHits"), main.indexOf("let hitFrame"));
  assert.match(collect, /dockedPanelOrb\(shell, level\)/);
  const docked = main.slice(main.indexOf("function dockedPanelOrb"), main.indexOf("function pushCloseHit"));
  assert.match(docked, /dataset\.kind !== "bot"/);
  assert.match(docked, /id: `bot:\$\{id\}`/);
  assert.match(docked, /round: true/);
  assert.match(docked, /z: level - 1/);
  const announce = main.slice(main.indexOf("function announcePanelHits"), main.indexOf("function announceOrbHits"));
  assert.match(announce, /dockedPanelOrb\(shell\)/);
});

test("an in-flight typed line survives a re-render", () => {
  const history = [{ role: "user", text: "舊句" }, { role: "bot", text: "之前" }];
  const typed = "HTTP 500 呢句";
  const store = new Map();
  rememberPendingSend(store, "default", "api_1", typed);
  assert.equal(pendingSend(store, "default", "api_1"), typed);
  const raced = mergePendingSend(history, pendingSend(store, "default", "api_1"));
  assert.equal(raced.at(-1).text, typed);
  assert.equal(raced.at(-1).unsent, undefined);
  assert.equal(mergePendingSend(raced, typed).length, raced.length);
  assert.equal(mergePendingSend(history, "").length, history.length);
  const marked = mergeUnsentDraft(raced, typed);
  assert.equal(marked.at(-1).unsent, true);
  assert.equal(marked.length, raced.length);
  rememberPendingSend(store, "researcher", "", typed);
  assert.equal(pendingSend(store, "researcher", "api_later"), typed);
  rememberPendingSend(store, "default", "api_1", "");
  assert.equal(pendingSend(store, "default", "api_1"), "");
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const send = main.slice(main.indexOf("async function sendActive"), main.indexOf("async function continueApiSession"));
  const appendAt = send.indexOf("appendMessage");
  const holdAt = send.indexOf("holdOutgoing", appendAt);
  const invokeAt = send.indexOf('await invoke("send_chat"', appendAt);
  assert.ok(appendAt >= 0 && holdAt > appendAt && holdAt < invokeAt);
  const busy = main.slice(main.indexOf("async function sendWhileBusy"), main.indexOf("async function stopActive"));
  const busyAppend = busy.indexOf("appendMessage");
  const busyHold = busy.indexOf("holdOutgoing", busyAppend);
  const busyInvoke = busy.indexOf("await invoke", busyAppend);
  assert.ok(busyAppend >= 0 && busyHold > busyAppend && busyHold < busyInvoke);
  const paint = main.slice(main.indexOf("function renderChat"), main.indexOf("function logPlanChip"));
  assert.ok(paint.indexOf("retainOutgoing") >= 0 && paint.indexOf("retainOutgoing") < paint.indexOf("chatStamp"));
  const opened = main.slice(main.indexOf("function applyOpened"), main.indexOf("function beginBotHistory"));
  assert.match(opened, /mergePendingSend/);
  const failedNote = main.slice(main.indexOf("function noteSendFailed"), main.indexOf("function noteReadOnly"));
  assert.ok(failedNote.indexOf("retainOutgoing") >= 0 && failedNote.indexOf("retainOutgoing") < failedNote.indexOf("markUnsentDraft"));
});
