/**
 * Hermes Overlay — perimeter bots + center chat.
 * UI labels: Traditional Chinese (zh-HK).
 * Gateway keys stay in the Rust process; this file only sees has_key.
 */

import {
  PALETTE,
  colorForIndex,
  elementStates,
  focusLossAction,
  latchedElementIds,
  osFocusAction,
  selectBlurAction,
  linuxAltWarning,
  nextOrbPulse,
  modifierLabel,
  modifierMatches,
  nextDropdownOpen,
  selectKeyOpensDropdown,
  BLUR_RELEASE_MS,
} from "./proximity.js";

const MOCK_BOTS = [
  {
    id: "planner",
    name: "計劃助手",
    short: "計",
    color: PALETTE[0],
    status: "線上 · 可互動",
    detail: "幫你拆解任務、排優先次序，同埋跟進每日進度。適合長時 overlay 置頂使用。",
    messages: [
      { role: "bot", text: "而家有 3 件待辦可以即刻開工——想我先排邊件？" },
      { role: "user", text: "先做最緊急嗰件。" },
      { role: "bot", text: "得。我已經標咗「緊急」同估時 25 分鐘。" },
    ],
    float: "記住：置頂 Overlay 唔會擋你打字——空白位可穿透（平台支援時）。",
  },
  {
    id: "coder",
    name: "程式夥伴",
    short: "碼",
    color: PALETTE[1],
    status: "線上 · 程式碼模式",
    detail: "跨平台桌面／網頁開發助手。而家呢個骨架就係用 Tauri 2 整出嚟。",
    messages: [
      { role: "bot", text: "透明窗 + alwaysOnTop 已開。要唔要加系統托盤？" },
      { role: "user", text: "稍後先。而家想確認 bot 邊框互動。" },
      { role: "bot", text: "點選邊框頭像就會切換中間面板內容。" },
    ],
    float: "而家係離線示範。設定 gateway 之後先會連 Hermes。",
  },
  {
    id: "research",
    name: "資料搜查",
    short: "查",
    color: PALETTE[2],
    status: "待命",
    detail: "負責搜尋、摘要同來源整理。呢個版本用 mock 內容示範版面。",
    messages: [{ role: "bot", text: "你想查邊個主題？我可以先出重點摘要。" }],
    float: null,
  },
  {
    id: "writer",
    name: "文案助手",
    short: "文",
    color: PALETTE[3],
    status: "線上",
    detail: "粵語／書面語文稿、回覆草稿、標題建議。",
    messages: [
      { role: "bot", text: "想用正式書面語定口語風格？" },
      { role: "user", text: "口語，短少少。" },
    ],
    float: "例：幫你改短呢句「可唔可以幫我睇下」。",
  },
  {
    id: "ops",
    name: "系統監控",
    short: "監",
    color: PALETTE[4],
    status: "觀察中",
    detail: "預留位置顯示 CPU／網路／agent 狀態。目前係 stub。",
    messages: [{ role: "bot", text: "監控面板尚未接真數據——骨架已就位。" }],
    float: null,
  },
  {
    id: "voice",
    name: "語音 Bot",
    short: "聲",
    color: PALETTE[5],
    status: "靜音",
    detail: "語音輸入／輸出預留。點選可睇 mock 對話。",
    messages: [{ role: "bot", text: "語音通道未接上。你可以先用文字試 overlay。" }],
    float: null,
  },
  {
    id: "memory",
    name: "記憶庫",
    short: "憶",
    color: PALETTE[6],
    status: "本地 stub",
    detail: "記住偏好同跨 session 上下文（未實作持久化）。",
    messages: [{ role: "bot", text: "而家只係記憶示範字串，重開 app 會重置。" }],
    float: null,
  },
  {
    id: "security",
    name: "安全守門",
    short: "安",
    color: PALETTE[7],
    status: "守護中",
    detail: "提示敏感操作、權限同 click-through 風險。",
    messages: [
      { role: "bot", text: "全螢幕透明 overlay 要小心誤觸；空白位穿透仍屬實驗功能。" },
    ],
    float: "Esc 會收起中間面板。結束程式用系統匣。",
  },
];

function edgePositions(count) {
  const pads = { top: 0.08, right: 0.08, bottom: 0.08, left: 0.08 };
  const segments = [
    { edge: "top", weight: 1 },
    { edge: "right", weight: 3 },
    { edge: "bottom", weight: 3 },
    { edge: "left", weight: 2 },
  ];
  const total = segments.reduce((s, x) => s + x.weight, 0);
  const slots = [];
  let remaining = count;
  segments.forEach((seg, i) => {
    const isLast = i === segments.length - 1;
    const n = isLast ? remaining : Math.max(1, Math.round((seg.weight / total) * count));
    const take = Math.min(n, remaining);
    remaining -= take;
    for (let j = 0; j < take; j++) {
      const t = (j + 1) / (take + 1);
      slots.push({ edge: seg.edge, t });
    }
  });
  while (remaining > 0) {
    slots.push({ edge: "right", t: 0.5 });
    remaining--;
  }
  return slots.map(({ edge, t }) => {
    const inset = "var(--edge-pad)";
    if (edge === "top") {
      return {
        style: {
          top: inset,
          left: `calc(${pads.left * 100}% + (100% - ${pads.left * 100}% - ${pads.right * 100}%) * ${t})`,
          transform: "translateX(-50%)",
        },
      };
    }
    if (edge === "right") {
      return {
        style: {
          right: inset,
          top: `calc(${pads.top * 100}% + (100% - ${pads.top * 100}% - ${pads.bottom * 100}%) * ${t})`,
          transform: "translateY(-50%)",
        },
      };
    }
    if (edge === "bottom") {
      return {
        style: {
          bottom: inset,
          left: `calc(${pads.left * 100}% + (100% - ${pads.left * 100}% - ${pads.right * 100}%) * ${t})`,
          transform: "translateX(-50%)",
        },
      };
    }
    return {
      style: {
        left: inset,
        top: `calc(${pads.top * 100}% + (100% - ${pads.top * 100}% - ${pads.bottom * 100}%) * ${t})`,
        transform: "translateY(-50%)",
      },
    };
  });
}

function $(sel) {
  return document.querySelector(sel);
}

function inTauri() {
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

function shortLabel(name) {
  const chars = Array.from((name || "").trim());
  return chars[0] || "?";
}

const state = {
  mode: "mock",
  settings: null,
  bots: [],
  activeId: null,
  threads: new Map(),
  busy: new Set(),
  alwaysOnTop: true,
  interaction: {
    modifier: "ctrl",
    fadeEnabled: true,
    fadeDistance: 120,
    minOpacity: 0.18,
    supported: true,
  },
  pointerHitId: "",
  heldKeys: new Set(),
  latchedIds: [],
  windowFocused: true,
  dropdownOpen: false,
};

function threadFor(id) {
  if (!state.threads.has(id)) {
    state.threads.set(id, { messages: [], status: "閒置", float: null });
  }
  return state.threads.get(id);
}

function setBanner(text, kind = "error", sticky = "") {
  const banner = $("#conn-banner");
  banner.classList.remove("ok", "info");
  banner.dataset.sticky = sticky || "";
  if (!text) {
    banner.hidden = true;
    banner.textContent = "";
    return;
  }
  banner.hidden = false;
  banner.textContent = text;
  if (kind === "ok" || kind === "info") banner.classList.add(kind);
}

function clearConnectionBanner() {
  const banner = $("#conn-banner");
  if (banner.dataset.sticky === "keyring") return;
  setBanner("");
}

/** undefined until the first paint, so the initial selection does not pulse. */
let renderedActiveId;

function renderBots() {
  const rail = $("#bot-rail");
  const positions = edgePositions(Math.max(state.bots.length, 1));
  const pulse = nextOrbPulse(renderedActiveId, state.activeId);
  renderedActiveId = pulse.rendered;
  const pulseId = pulse.pulseId;
  const keep = new Set(state.bots.map((bot) => bot.id));
  const existing = new Map();
  rail.querySelectorAll(".bot-btn").forEach((el) => {
    if (!keep.has(el.dataset.botId)) el.remove();
    else existing.set(el.dataset.botId, el);
  });
  state.bots.forEach((bot, i) => {
    let btn = existing.get(bot.id);
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.botId = bot.id;
      btn.dataset.hitId = `bot:${bot.id}`;
      btn.addEventListener("click", () => selectBot(bot.id));
      btn.addEventListener("animationend", (event) => {
        if (event.animationName === "orb-pulse") btn.classList.remove("orb-enter");
      });
      const label = document.createElement("span");
      label.className = "bot-label";
      btn.appendChild(label);
    }
    const keepEnter = btn.classList.contains("orb-enter") && bot.id === state.activeId;
    const classes = ["bot-btn"];
    if (bot.id === state.activeId) classes.push("active");
    if (state.busy.has(bot.id)) classes.push("busy");
    if (threadFor(bot.id).statusState === "error") classes.push("error");
    if (bot.id === pulseId || keepEnter) classes.push("orb-enter");
    btn.className = classes.join(" ");
    btn.style.background = "";
    btn.style.top = "";
    btn.style.right = "";
    btn.style.bottom = "";
    btn.style.left = "";
    btn.style.transform = "";
    btn.style.setProperty("--bot-color", bot.color);
    Object.assign(btn.style, positions[i].style);
    btn.setAttribute("aria-label", bot.name);
    btn.title = bot.name;
    setBotLetter(btn, bot.short);
    btn.querySelector(".bot-label").textContent = bot.name;
    rail.appendChild(btn);
  });
  scheduleHitSync();
}

function setBotLetter(btn, letter) {
  const text = [...btn.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
  if (text) text.nodeValue = letter;
  else btn.insertBefore(document.createTextNode(letter || ""), btn.firstChild);
}

function renderChat() {
  const bot = state.bots.find((b) => b.id === state.activeId);
  const chat = $("#chat-messages");
  chat.innerHTML = "";
  if (!bot) {
    $("#bot-name").textContent = "未有 Bot";
    $("#bot-status").textContent = state.mode === "mock" ? "示範模式" : "請喺設定加入 Bot";
    $("#bot-detail").textContent =
      state.mode === "mock"
        ? "離線示範。"
        : "Gateway 已設定，但名單係空。打開設定加入 profile、顯示名稱同 API 金鑰。";
    paintOrb($("#active-avatar"), "var(--neutral)", "");
    paintOrb($("#float-avatar"), "var(--neutral)", "");
    $("#float-bubble").hidden = true;
    $("#btn-stop").hidden = true;
    return;
  }
  const thread = threadFor(bot.id);
  $("#bot-name").textContent = bot.name;
  const statusEl = $("#bot-status");
  statusEl.textContent = thread.status || bot.status || "閒置";
  statusEl.dataset.state = thread.statusState || "idle";
  $("#bot-detail").textContent = bot.detail || "";
  paintOrb($("#active-avatar"), bot.color, bot.short || "");
  thread.messages.forEach((m) => chat.appendChild(bubbleEl(m)));
  chat.scrollTop = chat.scrollHeight;
  const float = $("#float-bubble");
  if (thread.float) {
    float.hidden = false;
    $("#float-text").textContent = thread.float;
    paintOrb($("#float-avatar"), bot.color, bot.short || "");
  } else if (bot.float) {
    float.hidden = false;
    $("#float-text").textContent = bot.float;
    paintOrb($("#float-avatar"), bot.color, bot.short || "");
  } else {
    float.hidden = true;
  }
  $("#btn-stop").hidden = !(state.mode === "hermes" && state.busy.has(bot.id));
  $("#btn-send").disabled = state.mode === "hermes" && state.busy.has(bot.id);
  scheduleHitSync();
}

function bubbleEl(m) {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${m.role === "user" ? "user" : m.role === "bot" ? "bot" : m.role}`;
  bubble.textContent = m.text;
  if (m.live) bubble.dataset.live = "1";
  return bubble;
}

function appendMessage(id, message) {
  const thread = threadFor(id);
  thread.messages.push(message);
  if (id === state.activeId) {
    const chat = $("#chat-messages");
    chat.appendChild(bubbleEl(message));
    chat.scrollTop = chat.scrollHeight;
  }
}

function setBotStatus(id, text, statusState) {
  const thread = threadFor(id);
  thread.status = text;
  thread.statusState = statusState;
  if (statusState === "busy") state.busy.add(id);
  else state.busy.delete(id);
  if (id === state.activeId) renderChat();
  renderBots();
}

async function selectBot(id) {
  state.activeId = id;
  setCenterOpen(true);
  renderBots();
  renderChat();
  if (state.mode !== "hermes" || !inTauri()) return;
  const thread = threadFor(id);
  if (thread.loaded || thread.loading) return;
  thread.loading = true;
  setBotStatus(id, "載入對話…", "busy");
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const opened = await invoke("open_bot", { profile: id });
    thread.messages = (opened.messages || []).map(presentMessage);
    thread.loaded = true;
    thread.sessionId = opened.session_id;
    clearConnectionBanner();
    setBotStatus(id, "閒置", "idle");
  } catch (err) {
    thread.loaded = false;
    const message = String(err);
    appendMessage(id, { role: "commentary", text: message });
    setBotStatus(id, "連線錯誤", "error");
    setBanner(message, "error");
  } finally {
    thread.loading = false;
  }
}

function presentMessage(m) {
  if (m.role === "tool") {
    const name = m.tool_name || m.toolName || "tool";
    return { role: "tool", text: `工具 ${name}：${m.text}` };
  }
  return { role: m.role, text: m.text };
}

function ensureLiveBubble(id) {
  const thread = threadFor(id);
  let live = thread.messages[thread.messages.length - 1];
  if (!live || live.role !== "bot" || !live.live) {
    live = { role: "bot", text: "", live: true };
    thread.messages.push(live);
    if (id === state.activeId) {
      const chat = $("#chat-messages");
      const el = bubbleEl(live);
      el.dataset.live = "1";
      chat.appendChild(el);
    }
  }
  return live;
}

function patchLive(id) {
  if (id !== state.activeId) return;
  const thread = threadFor(id);
  const live = [...thread.messages].reverse().find((m) => m.live);
  const nodes = $("#chat-messages").querySelectorAll("[data-live]");
  const node = nodes[nodes.length - 1];
  if (live && node) node.textContent = live.text;
  $("#chat-messages").scrollTop = $("#chat-messages").scrollHeight;
}

function handleHermes(payload) {
  if (!payload || !payload.profile) return;
  const id = payload.profile;
  if (payload.type === "delta") {
    const live = ensureLiveBubble(id);
    live.text += payload.text || "";
    patchLive(id);
    return;
  }
  if (payload.type === "commentary") {
    appendMessage(id, { role: "commentary", text: `過程：${payload.text || ""}` });
    threadFor(id).float = payload.text || null;
    if (id === state.activeId) renderChat();
    return;
  }
  if (payload.type === "tool") {
    const phase = payload.phase === "completed" ? "完成" : payload.phase === "failed" ? "失敗" : "開始";
    const preview = payload.preview ? ` — ${payload.preview}` : "";
    const text = `${phase} ${payload.name || "tool"}${preview}`;
    appendMessage(id, { role: "tool", text });
    threadFor(id).float = text;
    if (id === state.activeId) renderChat();
    return;
  }
  if (payload.type === "status") {
    const label = payload.detail || (payload.state === "busy" ? "思考中…" : "閒置");
    setBotStatus(id, label, payload.state === "busy" ? "busy" : payload.state === "error" ? "error" : "idle");
    return;
  }
  if (payload.type === "done") {
    const thread = threadFor(id);
    thread.float = null;
    const live = [...thread.messages].reverse().find((m) => m.live);
    if (live) live.live = false;
    if (payload.outcome === "completed") clearConnectionBanner();
    if (payload.outcome === "failed" && payload.detail) {
      appendMessage(id, { role: "failure", text: payload.detail });
    }
    setBotStatus(
      id,
      payload.outcome === "failed" ? "回覆失敗" : payload.outcome === "cancelled" ? "已停止" : "閒置",
      payload.outcome === "failed" ? "error" : "idle",
    );
    return;
  }
  if (payload.type === "error") {
    appendMessage(id, { role: "commentary", text: payload.message || "未知錯誤" });
    setBotStatus(id, "連線錯誤", "error");
    setBanner(payload.message || "連線錯誤", "error");
  }
}

async function sendActive() {
  const input = $("#chat-input");
  const text = input.value.trim();
  if (!text || !state.activeId) return;
  if (state.mode === "hermes" && state.busy.has(state.activeId)) return;
  input.value = "";
  appendMessage(state.activeId, { role: "user", text });
  if (state.mode !== "hermes" || !inTauri()) {
    setTimeout(() => {
      appendMessage(state.activeId, {
        role: "bot",
        text: `（示範回覆）收到：「${text}」。未設定 Hermes gateway。`,
      });
    }, 350);
    return;
  }
  setBotStatus(state.activeId, "思考中…", "busy");
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("send_chat", { profile: state.activeId, text });
  } catch (err) {
    const message = String(err);
    appendMessage(state.activeId, { role: "commentary", text: message });
    setBotStatus(state.activeId, "連線錯誤", "error");
    setBanner(message, "error");
  }
}

function botsFromSettings(settings) {
  return (settings.bots || []).map((bot) => ({
    id: bot.profile,
    name: bot.display_name || bot.profile,
    short: shortLabel(bot.display_name || bot.profile),
    color: bot.color || PALETTE[0],
    status: bot.has_key ? "閒置" : "未有金鑰",
    detail: bot.detail || `profile ${bot.profile}`,
    float: null,
    hasKey: bot.has_key,
  }));
}

function useMock(reason) {
  state.mode = "mock";
  state.bots = MOCK_BOTS.map((bot) => ({
    ...bot,
    messages: bot.messages.map((m) => ({ ...m })),
  }));
  state.threads = new Map();
  state.bots.forEach((bot) => {
    threadFor(bot.id).messages = bot.messages.map((m) => ({ ...m }));
    threadFor(bot.id).status = bot.status;
    threadFor(bot.id).loaded = true;
  });
  state.activeId = state.bots[0]?.id || null;
  setBanner(reason, "info");
  renderBots();
  renderChat();
}

function useHermes(settings) {
  state.mode = "hermes";
  state.settings = settings;
  state.bots = botsFromSettings(settings);
  state.threads = new Map();
  state.busy.clear();
  state.activeId = state.bots[0]?.id || null;
  if (settings.keyring_error) {
    setBanner(`鑰匙圈：${settings.keyring_error}`, "error", "keyring");
  } else if (state.bots.length === 0) {
    setBanner("Gateway 已設定，但未有 Bot。打開設定加入 profile 同金鑰。", "info");
  } else {
    setBanner("已連接設定。點頭像載入該 Bot 嘅 Bot Chat。", "ok");
  }
  renderBots();
  renderChat();
  if (state.activeId) selectBot(state.activeId);
}

function rowFromBot(bot = {}) {
  const row = document.createElement("div");
  row.className = "bot-row";
  row.innerHTML = `
    <input type="text" data-field="profile" placeholder="profile" autocomplete="off" />
    <input type="text" data-field="display_name" placeholder="顯示名稱" autocomplete="off" />
    <input type="color" data-field="color" aria-label="顏色" />
    <button type="button" class="icon-btn" data-action="remove">移除</button>
    <input class="span-2" type="text" data-field="detail" placeholder="詳情（可留空）" autocomplete="off" />
    <input class="span-2" type="url" data-field="base_url" placeholder="專用位址（可留空）" autocomplete="off" />
    <input class="span-2" type="password" data-field="key" placeholder="API 金鑰" autocomplete="off" />
  `;
  row.querySelector('[data-field="profile"]').value = bot.profile || "";
  row.querySelector('[data-field="display_name"]').value = bot.display_name || "";
  const existingRows = $("#bot-editor") ? $("#bot-editor").querySelectorAll(".bot-row").length : 0;
  row.querySelector('[data-field="color"]').value = bot.color || colorForIndex(existingRows);
  row.querySelector('[data-field="detail"]').value = bot.detail || "";
  row.querySelector('[data-field="base_url"]').value = bot.base_url || "";
  const key = row.querySelector('[data-field="key"]');
  key.placeholder = bot.has_key ? "已儲存，留空代表保留" : "API 金鑰";
  key.dataset.hasKey = bot.has_key ? "1" : "0";
  row.querySelector('[data-action="remove"]').addEventListener("click", () => row.remove());
  return row;
}

function readRows() {
  return [...$("#bot-editor").querySelectorAll(".bot-row")].map((row) => {
    const value = (field) => row.querySelector(`[data-field="${field}"]`).value.trim();
    const keyInput = row.querySelector('[data-field="key"]');
    return {
      profile: value("profile"),
      display_name: value("display_name"),
      color: row.querySelector('[data-field="color"]').value,
      detail: value("detail"),
      base_url: value("base_url"),
      key: keyInput.value,
      clear_key: false,
      has_key: keyInput.dataset.hasKey === "1",
    };
  });
}

function applyInteraction(raw) {
  const interaction = raw || {};
  state.interaction = {
    modifier: interaction.modifier || "ctrl",
    fadeEnabled: interaction.fade_enabled !== false && interaction.fadeEnabled !== false,
    fadeDistance: Number(interaction.fade_distance ?? interaction.fadeDistance ?? 120),
    minOpacity: Number(interaction.min_opacity ?? interaction.minOpacity ?? 0.18),
    supported: interaction.supported !== false,
  };
  const hint = $("#interact-hint");
  if (hint) {
    const name = modifierLabel(state.interaction.modifier);
    hint.textContent = state.interaction.supported
      ? `按住 ${name}：游標下面嗰個元素先會實色同可點擊。`
      : "呢個環境讀唔到全域游標或修飾鍵，所以保持可點擊，唔會穿透。";
  }
}

function readInteractionForm() {
  return {
    modifier: $("#interaction-modifier").value,
    fade_enabled: $("#interaction-fade").checked,
    fade_distance: Number($("#interaction-distance").value),
    min_opacity: Number($("#interaction-min-opacity").value) / 100,
  };
}

function fillSettings(settings) {
  $("#gateway-url").value = settings?.gateway_base_url || "";
  $("#dashboard-url").value = settings?.dashboard_base_url || "http://127.0.0.1:9119";
  $("#dashboard-token").value = "";
  $("#dashboard-token").placeholder = settings?.has_dashboard_token
    ? "已儲存，留空代表保留"
    : "可留空";
  const editor = $("#bot-editor");
  editor.innerHTML = "";
  const bots = settings?.bots?.length ? settings.bots : [];
  if (bots.length === 0) editor.appendChild(rowFromBot());
  bots.forEach((bot) => editor.appendChild(rowFromBot(bot)));
  const interaction = settings?.interaction || state.interaction;
  $("#interaction-modifier").value = interaction.modifier || "ctrl";
  $("#interaction-fade").checked = interaction.fade_enabled !== false && interaction.fadeEnabled !== false;
  $("#interaction-distance").value = String(interaction.fade_distance ?? interaction.fadeDistance ?? 120);
  const min = interaction.min_opacity ?? interaction.minOpacity ?? 0.18;
  $("#interaction-min-opacity").value = String(Math.round(Number(min) * 100));
  const support = $("#interaction-support");
  const supported = interaction.supported !== false;
    support.textContent = supported
    ? "Windows、macOS、Linux X11 會讀全域游標同修飾鍵。Wayland 冇 X11（DISPLAY）時唔會穿透。"
    : "而家讀唔到全域輸入（常見於純 Wayland）。Overlay 會保持可點擊。";
  const altWarning = $("#interaction-alt-warning");
  if (altWarning) {
    const platform = `${navigator.platform || ""} ${navigator.userAgent || ""}`;
    altWarning.hidden = !linuxAltWarning(platform);
  }
}

function openSettings() {
  window.clearTimeout(blurReleaseTimer);
  blurReleaseTimer = 0;
  state.windowFocused = true;
  fillSettings(state.settings);
  $("#settings").hidden = false;
  syncLatch();
  scheduleHitSync();
  $("#settings-status").textContent = inTauri()
    ? "儲存之後先會用新設定。測試連線讀已儲存嘅金鑰。"
    : "瀏覽器預覽改唔到鑰匙圈。請用 npm run tauri dev。";
  if (!inTauri()) return;
  import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) => getCurrentWindow().setFocus())
    .catch(() => {});
}

function closeSettings() {
  $("#settings").hidden = true;
  syncLatch();
  scheduleHitSync();
}

async function saveSettings(event) {
  event.preventDefault();
  if (!inTauri()) {
    $("#settings-status").textContent = "瀏覽器預覽唔可以儲存。";
    return;
  }
  const bots = readRows().filter((bot) => bot.profile || bot.display_name || bot.key);
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    const settings = await invoke("save_settings", {
      input: {
        gateway_base_url: $("#gateway-url").value.trim(),
        dashboard_base_url: $("#dashboard-url").value.trim(),
        dashboard_token: $("#dashboard-token").value,
        clear_dashboard_token: false,
        interaction: readInteractionForm(),
        bots,
      },
    });
    applyInteraction(settings.interaction);
    state.settings = settings;
    $("#settings-status").textContent = "已儲存。";
    $("#dashboard-token").value = "";
    if (settings.mode === "mock") useMock("未設定 gateway，而家係離線示範模式。");
    else useHermes(settings);
    closeSettings();
  } catch (err) {
    $("#settings-status").textContent = String(err);
  }
}

async function probeSaved() {
  if (!inTauri()) return;
  $("#settings-status").textContent = "測試緊…";
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const report = await invoke("probe_gateway");
    const lines = [
      report.health_ok ? `健康檢查：${report.health_detail}` : `健康檢查失敗：${report.health_detail}`,
      ...(report.bots || []).map((bot) => `${bot.ok ? "可讀" : "失敗"} ${bot.profile}：${bot.detail}`),
    ];
    $("#settings-status").textContent = lines.join("\n");
    if (!report.health_ok) setBanner(report.health_detail, "error");
    else if ((report.bots || []).every((bot) => bot.ok)) setBanner("Gateway 同名單金鑰可用。", "ok");
    else setBanner("Gateway 有回應，但部分 Bot 金鑰或路徑失敗。睇設定入面嘅結果。", "error");
  } catch (err) {
    $("#settings-status").textContent = String(err);
  }
}

async function discoverProfiles() {
  if (!inTauri()) return;
  $("#settings-status").textContent = "實驗匯入中…";
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const found = await invoke("discover_profiles", {
      dashboardBaseUrl: $("#dashboard-url").value.trim(),
      token: $("#dashboard-token").value,
    });
    $("#dashboard-token").value = "";
    const existing = new Map(readRows().filter((b) => b.profile).map((b) => [b.profile, b]));
    for (const bot of found) {
      if (!existing.has(bot.profile)) {
        existing.set(bot.profile, {
          profile: bot.profile,
          display_name: bot.display_name,
          color: bot.color,
          detail: bot.detail,
          base_url: "",
          has_key: false,
        });
      }
    }
    const editor = $("#bot-editor");
    editor.innerHTML = "";
    for (const bot of existing.values()) editor.appendChild(rowFromBot(bot));
    $("#settings-status").textContent = found.length
      ? `匯入 ${found.length} 個 profile。金鑰要自己填，然後儲存。`
      : "Dashboard 冇返回 profile。";
  } catch (err) {
    $("#settings-status").textContent = String(err);
  }
}

async function setupWindowChrome() {
  let win = null;
  if (inTauri()) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      win = getCurrentWindow();
    } catch {
      win = null;
    }
  }
  const pinBtn = $("#btn-pin");
  pinBtn?.addEventListener("click", async () => {
    state.alwaysOnTop = !state.alwaysOnTop;
    pinBtn.setAttribute("aria-pressed", String(state.alwaysOnTop));
    pinBtn.textContent = state.alwaysOnTop ? "置頂" : "取消置頂";
    if (win) {
      try {
        await win.setAlwaysOnTop(state.alwaysOnTop);
      } catch (err) {
        console.warn("setAlwaysOnTop failed", err);
      }
    }
  });
  $("#btn-close")?.addEventListener("click", () => {
    setCenterOpen(false);
  });
}

function setCenterOpen(open) {
  const panel = $("#center-panel");
  if (!panel) return;
  if (!open) {
    const active = document.activeElement;
    if (active && panel.contains(active)) active.blur();
    if (state.pointerHitId === "center") state.pointerHitId = "";
  }
  panel.hidden = !open;
  syncLatch();
  scheduleHitSync();
}

function setupComposer() {
  $("#btn-send").addEventListener("click", sendActive);
  $("#chat-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendActive();
  });
  $("#btn-stop").addEventListener("click", async () => {
    if (!state.activeId || !inTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("stop_chat", { profile: state.activeId });
  });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (state.dropdownOpen) {
      state.dropdownOpen = nextDropdownOpen(state.dropdownOpen, "escape");
      return;
    }
    if (!$("#settings").hidden) {
      closeSettings();
      return;
    }
    if (isTextField(document.activeElement)) {
      document.activeElement.blur();
      syncLatch();
      return;
    }
    $("#btn-close")?.click();
  });
  $("#btn-settings").addEventListener("click", openSettings);
  const modifierSelect = $("#interaction-modifier");
  modifierSelect?.addEventListener("pointerdown", () => {
    state.dropdownOpen = nextDropdownOpen(state.dropdownOpen, "pointerdown");
  });
  modifierSelect?.addEventListener("keydown", (event) => {
    if (selectKeyOpensDropdown(event.key)) {
      state.dropdownOpen = nextDropdownOpen(state.dropdownOpen, "open-key");
    }
    if (event.key === "Escape" && state.dropdownOpen) {
      state.dropdownOpen = nextDropdownOpen(state.dropdownOpen, "escape");
      event.stopPropagation();
    }
  });
  modifierSelect?.addEventListener("change", () => {
    state.dropdownOpen = nextDropdownOpen(state.dropdownOpen, "change");
  });
  modifierSelect?.addEventListener("blur", () => {
    const action = selectBlurAction({
      dropdownOpen: state.dropdownOpen,
      documentFocused: document.hasFocus(),
    });
    if (action === "defer") {
      void queryOsFocus();
      return;
    }
    if (action === "close") state.dropdownOpen = nextDropdownOpen(state.dropdownOpen, "blur");
  });
  $("#btn-settings-close").addEventListener("click", closeSettings);
  $("#settings-form").addEventListener("submit", saveSettings);
  $("#btn-add-bot").addEventListener("click", () => $("#bot-editor").appendChild(rowFromBot()));
  $("#btn-probe").addEventListener("click", probeSaved);
  $("#btn-discover").addEventListener("click", discoverProfiles);
}

function paintOrb(el, color, letter) {
  if (!el) return;
  el.style.background = "";
  el.style.setProperty("--bot-color", color || "var(--neutral)");
  if (letter !== undefined) el.textContent = letter;
}

function isTextField(el) {
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}

function settingsOpen() {
  const layer = $("#settings");
  return !!layer && !layer.hidden;
}

function currentLatchedIds() {
  const active = document.activeElement;
  return latchedElementIds({
    windowFocused: state.windowFocused,
    textFocused: isTextField(active),
    textInSettings: !!(active && active.closest && active.closest("#settings")),
    settingsOpen: settingsOpen(),
    pointerHitId: state.pointerHitId,
  });
}

function syncLatch() {
  const ids = currentLatchedIds();
  state.latchedIds = ids;
  if (inTauri()) {
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("set_interaction_latch", { ids }))
      .catch(() => {});
    return;
  }
  paintLocalProximity();
}

function collectHits() {
  const rects = [];
  const push = (id, el, z = 0, round = false) => {
    if (!el || el.hidden || el.closest("[hidden]")) return;
    const box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    rects.push({ id, x: box.x, y: box.y, w: box.width, h: box.height, z, round });
  };
  push("center", $("#center-panel"), 0);
  push("settings", document.querySelector(".settings-card"), 30);
  push("float", $("#float-bubble"), 10);
  document.querySelectorAll(".bot-btn").forEach((el) => {
    if (el.dataset.hitId) push(el.dataset.hitId, el, 0, true);
  });
  return rects;
}

let hitFrame = 0;
let lastHits = "";

function scheduleHitSync() {
  cancelAnimationFrame(hitFrame);
  hitFrame = requestAnimationFrame(() => {
    const rects = collectHits();
    const key = JSON.stringify(
      rects.map((rect) => ({
        id: rect.id,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.w),
        h: Math.round(rect.h),
        z: rect.z || 0,
        round: !!rect.round,
      })),
    );
    if (key !== lastHits) {
      lastHits = key;
      if (inTauri()) {
        import("@tauri-apps/api/core")
          .then(({ invoke }) => invoke("set_hit_rects", { rects }))
          .catch(() => {});
      }
    }
    if (!inTauri()) paintLocalProximity(rects);
  });
}

function applyFrames(frames, interactiveAll = false) {
  const map = new Map((frames || []).map((item) => [item.id, item]));
  document.querySelectorAll("[data-hit-id]").forEach((el) => {
    const known = map.get(el.dataset.hitId);
    const value = known == null ? 1 : known.opacity;
    el.style.setProperty("--hit-opacity", String(value));
    if (interactiveAll || known?.capture) el.dataset.hitCapture = "1";
    else delete el.dataset.hitCapture;
  });
}

const cursorPoint = { x: -10000, y: -10000 };
let blurReleaseTimer = 0;

function dismissModifierDropdown() {
  const select = $("#interaction-modifier");
  if (!select) return;
  // GTK may already have blurred the select when the popup opened, so blur()
  // alone does not drop the grab. Disabling the control closes it.
  select.blur();
  const disabled = select.disabled;
  select.disabled = true;
  select.disabled = disabled;
}

function finishInteractiveRelease() {
  window.clearTimeout(blurReleaseTimer);
  blurReleaseTimer = 0;
  const dropdownWasOpen = state.dropdownOpen;
  state.dropdownOpen = false;
  state.windowFocused = false;
  state.pointerHitId = "";
  state.heldKeys.clear();
  const active = document.activeElement;
  if (isTextField(active)) active.blur();
  if (dropdownWasOpen) dismissModifierDropdown();
  syncLatch();
}

function releaseInteractiveLock(source = "webview") {
  const action = focusLossAction({ source, dropdownOpen: state.dropdownOpen });
  if (action === "hold") {
    window.clearTimeout(blurReleaseTimer);
    blurReleaseTimer = 0;
    return;
  }
  if (action === "release") {
    finishInteractiveRelease();
    return;
  }
  window.clearTimeout(blurReleaseTimer);
  blurReleaseTimer = window.setTimeout(() => {
    blurReleaseTimer = 0;
    if (state.dropdownOpen) return;
    finishInteractiveRelease();
  }, BLUR_RELEASE_MS);
}

function noteWindowFocus() {
  window.clearTimeout(blurReleaseTimer);
  blurReleaseTimer = 0;
  state.dropdownOpen = nextDropdownOpen(state.dropdownOpen, "window-focus");
  state.windowFocused = true;
  syncLatch();
}

function openSettingsFromShortcut() {
  state.dropdownOpen = false;
  openSettings();
}

function applyOsFocus(owner) {
  const action = osFocusAction(owner);
  if (action === "release") {
    finishInteractiveRelease();
    return;
  }
  if (action === "hold" && state.dropdownOpen && !state.windowFocused) {
    state.windowFocused = true;
    syncLatch();
  }
}

function queryOsFocus() {
  if (!inTauri()) return Promise.resolve();
  return import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("focus_owner"))
    .then((owner) => {
      if (owner === "own") applyOsFocus(owner);
    })
    .catch(() => {});
}

function paintLocalProximity(rects) {
  const list = rects || collectHits();
  const cfg = state.interaction;
  const held = [...state.heldKeys].some((key) => modifierMatches(state.interaction.modifier, key));
  const frames = elementStates({
    held,
    latchedIds: state.latchedIds,
    cursor: { x: cursorPoint.x, y: cursorPoint.y },
    rects: list,
    fadeDistance: cfg.fadeDistance,
    minOpacity: cfg.minOpacity,
    fadeEnabled: cfg.fadeEnabled,
  });
  applyFrames(frames);
}

function setupProximity() {
  document.addEventListener("pointerdown", (event) => {
    const hit = event.target.closest?.("[data-hit-id]");
    if (hit) state.pointerHitId = hit.dataset.hitId || "";
    else {
      state.pointerHitId = "";
      if (isTextField(document.activeElement)) document.activeElement.blur();
    }
    syncLatch();
  });
  document.addEventListener("pointerup", () => {
    state.pointerHitId = "";
    syncLatch();
  });
  document.addEventListener("focusin", () => syncLatch());
  document.addEventListener("focusout", () => setTimeout(syncLatch, 0));
  window.addEventListener("blur", () => {
    if (inTauri()) return;
    releaseInteractiveLock("webview");
  });
  window.addEventListener("focus", noteWindowFocus);
  window.addEventListener("resize", scheduleHitSync);
  if (inTauri()) {
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().onFocusChanged(({ payload: focused }) => {
          if (focused) noteWindowFocus();
          else releaseInteractiveLock("tauri-window");
        }),
      )
      .catch(() => {});
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("overlay-interaction", (event) => {
        const payload = event.payload || {};
        if (payload.supported === false) {
          state.interaction.supported = false;
          applyInteraction({ ...state.interaction, fade_enabled: state.interaction.fadeEnabled, supported: false });
          applyFrames([], true);
          return;
        }
        if (payload.focus_owner) applyOsFocus(payload.focus_owner);
        applyFrames(payload.opacities || []);
      });
    });
    return;
  }
  document.documentElement.classList.add("overlay-passthrough");
  window.addEventListener("mousemove", (event) => {
    cursorPoint.x = event.clientX;
    cursorPoint.y = event.clientY;
    paintLocalProximity();
  });
  window.addEventListener("keydown", (event) => {
    state.heldKeys.add(event.key);
    paintLocalProximity();
  });
  window.addEventListener("keyup", (event) => {
    state.heldKeys.delete(event.key);
    paintLocalProximity();
  });
  paintLocalProximity();
}

async function boot() {
  setupComposer();
  setupWindowChrome();
  setupProximity();
  applyInteraction(state.interaction);
  if (!inTauri()) {
    useMock("瀏覽器預覽：離線示範。Gateway 同金鑰只喺桌面版可用。");
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");
    await listen("hermes", (event) => handleHermes(event.payload));
    await listen("overlay-ui", (event) => {
      if (event.payload?.type === "open-settings") openSettingsFromShortcut();
    });
    const settings = await invoke("get_settings");
    state.settings = settings;
    applyInteraction(settings.interaction);
    if (settings.mode === "mock") useMock("未設定 gateway，而家係離線示範模式。");
    else useHermes(settings);
    if (settings.keyring_error) {
      setBanner(`鑰匙圈：${settings.keyring_error}`, "error", "keyring");
    }
  } catch (err) {
    useMock(`讀唔到設定，改用示範模式：${err}`);
  }
}

if (linuxAltWarning(`${navigator.platform || ""} ${navigator.userAgent || ""}`)) {
  document.documentElement.classList.add("platform-linux");
}

window.addEventListener("DOMContentLoaded", boot);
