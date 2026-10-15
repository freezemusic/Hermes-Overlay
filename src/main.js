/**
 * Hermes Overlay — perimeter bots + center chat.
 * UI labels: Traditional Chinese (zh-HK).
 * Gateway keys stay in the Rust process; this file only sees has_key.
 */

import { formatToastClock, orbMotion, reduceActivity, statusAfterWatchdog, toastAnchor, TOAST_MS } from "./activity.js";
import { closePanel, fromOrbDelta, openPanel, panelStackOffset } from "./panels.js";
import { applyBotColor, NOUS } from "./botcolor.js";
import {
  KANBAN_BOARD,
  KANBAN_EMPTY,
  KANBAN_POLL_MS,
  boardFingerprint,
  kanbanErrorText,
  moveTask,
  normalizeBoard,
  ownerColor,
} from "./kanban.js";
import { createLivePainter, decorateCodeBlocks, isSafeLink, renderAssistantMarkdown } from "./markdown.js";
import { SETUP_BANNER, setupHintVisible, shouldAutoOpenSettings } from "./setup.js";
import {
  PREVIEW_COMMANDS,
  completionText,
  filterCommands,
  gatewayDown,
  groupByCategory,
  inlineArgsHint,
  modelFields,
  moveSlashIndex,
  orderSlashCommands,
  parseSlashMarker,
  reconnectDelayMs,
  resolveClient,
  sendBlockedWhileBusy,
  shouldRefreshCatalog,
  slashEnterSubmits,
  slashFilterQuery,
} from "./slash.js";
import {
  PALETTE,
  applyDropdownDismiss,
  colorForIndex,
  elementStates,
  focusLossAction,
  latchedElementIds,
  osFocusAction,
  pinToggle,
  invokeFailureMessage,
  settingsQuitAction,
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
    float: "Esc 會收起中間面板。結束程式用設定入面嘅「結束」，或者系統匣。",
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

function panelFor(id) {
  if (!id) return null;
  return document.querySelector(`.bot-panel[data-bot-id="${cssEscape(id)}"]`);
}

function role(panel, name) {
  return panel?.querySelector(`[data-role="${name}"]`) || null;
}

function chatOf(id) {
  return role(panelFor(id), "chat");
}

function hintText() {
  const name = modifierLabel(state.interaction.modifier);
  return state.interaction.supported
    ? `按住 ${name}：面板變透明，滑鼠穿透。放開就實色，可以拖同點。`
    : "呢個環境讀唔到全域游標或修飾鍵，所以保持可點擊，唔會穿透。";
}

const panelMotion = new WeakMap();

function beginMotion(panel) {
  const token = (panelMotion.get(panel) || 0) + 1;
  panelMotion.set(panel, token);
  return token;
}

function orbForPanel(panel) {
  if (!panel) return null;
  if (panel.id === "settings") return document.querySelector(".orb--settings");
  if (panel.id === "kanban-panel") return document.querySelector(".orb--kanban");
  return document.querySelector(`.bot-btn[data-bot-id="${cssEscape(panel.dataset.botId || "")}"]`);
}

function runMotion(panel, mode) {
  const token = beginMotion(panel);
  panel.classList.remove("is-opening", "is-closing");
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const orbEl = orbForPanel(panel);
  if (orbEl && !reduce) {
    const orb = orbEl.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    const delta = fromOrbDelta(
      { x: orb.x, y: orb.y, w: orb.width, h: orb.height },
      { x: box.x, y: box.y, w: box.width, h: box.height },
    );
    panel.style.setProperty("--from-x", `${Math.round(delta.x)}px`);
    panel.style.setProperty("--from-y", `${Math.round(delta.y)}px`);
  } else {
    panel.style.setProperty("--from-x", "0px");
    panel.style.setProperty("--from-y", "0px");
  }
  const cls = mode === "close" ? "is-closing" : "is-opening";
  return new Promise((resolve) => {
    let settled = false;
    let timer = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      panel.removeEventListener("animationend", onEnd);
      window.clearTimeout(timer);
      if (panelMotion.get(panel) !== token) {
        resolve(false);
        return;
      }
      panel.classList.remove(cls);
      resolve(true);
    };
    const onEnd = (event) => {
      if (event.target !== panel) return;
      finish();
    };
    panel.addEventListener("animationend", onEnd);
    void panel.offsetWidth;
    panel.classList.add(cls);
    timer = window.setTimeout(finish, reduce ? 30 : 700);
  });
}

function rememberPanel(panel) {
  const key = panel?.dataset.panelKey || panel?.dataset.hitId;
  if (!key) return;
  const box = panel.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return;
  state.panelPos[key] = { left: box.left, top: box.top };
}

function placePanel(panel, key, fallback = {}) {
  panel.style.right = "auto";
  panel.style.bottom = "auto";
  const saved = state.panelPos[key];
  if (saved) {
    panel.style.left = `${saved.left}px`;
    panel.style.top = `${saved.top}px`;
    return;
  }
  const index = state.openIds.indexOf(key);
  const shift = panelStackOffset(index < 0 ? state.openIds.length : index);
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 800;
  panel.style.left = `${Math.round(vw * (fallback.leftRatio ?? 0.12) + shift.x)}px`;
  panel.style.top = `${Math.round(vh * (fallback.topRatio ?? 0.1) + shift.y)}px`;
}

function raisePanel(panel) {
  if (!panel) return;
  state.panelZ += 1;
  panel.style.zIndex = String(state.panelZ);
  scheduleHitSync();
}

function bindPanelDrag(panel) {
  const header = panel.querySelector(".panel-header, .settings-head");
  if (!header || header.dataset.dragBound) return;
  header.dataset.dragBound = "1";
  header.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target.closest("button, input, textarea, select, a, label")) return;
    event.preventDefault();
    state.dragHitId = panel.dataset.hitId || "";
    raisePanel(panel);
    flushHits();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = panel.getBoundingClientRect();
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.left = `${origin.left}px`;
    panel.style.top = `${origin.top}px`;
    const move = (ev) => {
      if (ev.pointerId !== event.pointerId) return;
      panel.style.left = `${origin.left + ev.clientX - startX}px`;
      panel.style.top = `${origin.top + ev.clientY - startY}px`;
      scheduleHitSync();
    };
    const up = (ev) => {
      if (ev.pointerId !== event.pointerId) return;
      header.removeEventListener("pointermove", move);
      header.removeEventListener("pointerup", up);
      header.removeEventListener("pointercancel", up);
      state.dragHitId = "";
      rememberPanel(panel);
      flushHits();
    };
    header.addEventListener("pointermove", move);
    header.addEventListener("pointerup", up);
    header.addEventListener("pointercancel", up);
    try {
      header.setPointerCapture(event.pointerId);
    } catch {
      /* The drag listeners stay on the header when the pointer id is synthetic. */
    }
  });
}

function removeBotPanels() {
  document.querySelectorAll(".bot-panel").forEach((panel) => panel.remove());
  state.openIds = [];
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
  catalog: null,
  catalogHint: "",
  catalogProfile: "",
  slashIndex: 0,
  slashArgsHint: "",
  reconnectToken: 0,
  reconnectTimer: 0,
  openIds: [],
  panelPos: {},
  panelZ: 4,
  slashPanelId: "",
  dragHitId: "",
  souls: new Map(),
  kanbanOpen: false,
  kanban: { board: null, fingerprint: "", unread: false, saving: false, dragging: false },
  kanbanTimer: 0,
  toastSeq: 0,
};

function threadFor(id) {
  if (!state.threads.has(id)) {
    state.threads.set(id, {
      messages: [],
      status: "閒置",
      activity: { thinking: false, streaming: false, deadline: null },
      unread: false,
    });
  }
  return state.threads.get(id);
}

function showActionError(message) {
  console.warn(message);
  setBanner(message, "error");
  const status = $("#settings-status");
  if (status && settingsOpen()) status.textContent = message;
}

function setBanner(text, kind = "error", sticky = "", action = "") {
  const banner = $("#conn-banner");
  banner.classList.remove("ok", "info", "danger");
  banner.dataset.sticky = sticky || "";
  banner.replaceChildren();
  delete banner.dataset.hitId;
  if (!text) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  if (kind === "ok" || kind === "info") banner.classList.add(kind);
  else banner.classList.add("danger");
  if (action === "settings") {
    banner.dataset.hitId = "banner";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "banner-action";
    button.dataset.action = "settings";
    button.textContent = text;
    banner.appendChild(button);
    return;
  }
  banner.textContent = text;
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
  rail.querySelectorAll(".bot-btn:not(.orb--kanban):not(.orb--settings)").forEach((el) => {
    if (!keep.has(el.dataset.botId)) el.remove();
    else existing.set(el.dataset.botId, el);
  });
  document.querySelectorAll(".bot-panel").forEach((panel) => {
    if (keep.has(panel.dataset.botId)) return;
    state.openIds = closePanel(state.openIds, panel.dataset.botId);
    panel.remove();
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
        if (event.animationName === "ping") event.target.remove();
      });
      fillOrb(btn);
      const label = document.createElement("span");
      label.className = "bot-label";
      btn.appendChild(label);
    }
    const thread = threadFor(bot.id);
    const keepEnter = btn.classList.contains("orb-enter") && bot.id === state.activeId;
    const classes = ["bot-btn"];
    if (state.openIds.includes(bot.id)) classes.push("active");
    const motion = orbMotion(thread.activity, thread.statusState);
    if (motion === "spin") classes.push("is-thinking");
    if (motion === "wait") classes.push("is-waiting");
    if (thread.unread) classes.push("has-unread");
    if (thread.statusState === "error") classes.push("error");
    if (bot.id === pulseId || keepEnter) classes.push("orb-enter");
    btn.className = classes.join(" ");
    btn.style.background = "";
    btn.style.top = "";
    btn.style.right = "";
    btn.style.bottom = "";
    btn.style.left = "";
    btn.style.transform = "";
    applyBotColor(btn, bot.color);
    Object.assign(btn.style, positions[i].style);
    btn.setAttribute("aria-label", bot.name);
    btn.title = bot.name;
    btn.querySelector(".orb-glyph").textContent = bot.short || "";
    btn.querySelector(".bot-label").textContent = bot.name;
    rail.appendChild(btn);
  });
  renderKanbanOrb();
  renderSettingsOrb();
  scheduleHitSync();
}

function renderSettingsOrb() {
  const rail = $("#bot-rail");
  let btn = rail.querySelector(".orb--settings");
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.botId = "settings";
    btn.dataset.hitId = "bot:settings";
    btn.addEventListener("click", () => focusSettings());
    fillOrb(btn);
    const label = document.createElement("span");
    label.className = "bot-label";
    label.textContent = "設定";
    btn.appendChild(label);
    btn.querySelector(".orb-glyph").textContent = "設";
    rail.appendChild(btn);
  }
  btn.className = ["bot-btn", "orb--settings", settingsOpen() ? "active" : ""].filter(Boolean).join(" ");
  applyBotColor(btn, NOUS.blue);
  btn.style.top = "auto";
  btn.style.right = "calc(var(--edge-pad) + 152px)";
  btn.style.bottom = "var(--edge-pad)";
  btn.style.left = "auto";
  btn.style.transform = "none";
  btn.setAttribute("aria-label", "Hermes 設定");
  btn.title = "Hermes 設定";
}

function fillOrb(btn) {
  const hit = document.createElement("span");
  hit.className = "bot-hit";
  hit.setAttribute("aria-hidden", "true");
  const core = document.createElement("span");
  core.className = "orb-core";
  const glyph = document.createElement("span");
  glyph.className = "orb-glyph";
  const spinner = document.createElement("span");
  spinner.className = "spinner";
  spinner.setAttribute("aria-hidden", "true");
  const unread = document.createElement("span");
  unread.className = "unread-dot";
  btn.append(hit, core, glyph, spinner, unread);
}

function renderKanbanOrb() {
  const rail = $("#bot-rail");
  let btn = rail.querySelector(".orb--kanban");
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.botId = "kanban";
    btn.dataset.hitId = "bot:kanban";
    btn.addEventListener("click", () => toggleKanban());
    btn.addEventListener("animationend", (event) => {
      if (event.animationName === "ping") event.target.remove();
    });
    fillOrb(btn);
    const label = document.createElement("span");
    label.className = "bot-label";
    label.textContent = "看板";
    btn.appendChild(label);
    btn.querySelector(".orb-glyph").textContent = "▥";
    rail.appendChild(btn);
  }
  btn.className = ["bot-btn", "orb--kanban", state.kanbanOpen ? "active" : "", state.kanban.unread ? "has-unread" : ""]
    .filter(Boolean)
    .join(" ");
  applyBotColor(btn, NOUS.neutral);
  btn.style.top = "auto";
  btn.style.right = "calc(var(--edge-pad) + 76px)";
  btn.style.bottom = "var(--edge-pad)";
  btn.style.left = "auto";
  btn.style.transform = "none";
  btn.setAttribute("aria-label", "看板");
  btn.title = "看板";
}

function renderChat(id = state.activeId) {
  const panel = panelFor(id);
  if (!panel) return;
  const bot = state.bots.find((b) => b.id === id);
  const chat = role(panel, "chat");
  if (!bot || !chat) return;
  chat.innerHTML = "";
  const thread = threadFor(bot.id);
  const title = role(panel, "name");
  if (title) title.textContent = bot.name;
  const statusEl = role(panel, "status");
  setStatusText(id, thread.status || bot.status || "閒置");
  if (statusEl) statusEl.dataset.state = thread.statusState || "idle";
  const nameInput = role(panel, "display-name");
  if (nameInput && nameInput.dataset.dirty !== "1" && document.activeElement !== nameInput) {
    nameInput.value = bot.name || "";
  }
  const detailInput = role(panel, "detail");
  if (detailInput && detailInput.dataset.dirty !== "1" && document.activeElement !== detailInput) {
    detailInput.value = bot.detail || "";
  }
  const hint = role(panel, "hint");
  if (hint) hint.textContent = hintText();
  paintOrb(role(panel, "avatar"), bot.color, bot.short || "");
  applyBotColor(panel, bot.color);
  thread.messages.forEach((m) => chat.appendChild(bubbleEl(m)));
  chat.scrollTop = chat.scrollHeight;
  const stop = role(panel, "stop");
  const send = role(panel, "send");
  if (stop) stop.hidden = !(state.mode === "hermes" && state.busy.has(bot.id));
  if (send) send.disabled = state.mode === "hermes" && state.busy.has(bot.id);
  syncActivityChrome(id);
  scheduleHitSync();
}

function setStatusText(id, text) {
  const node = role(panelFor(id), "status-text");
  if (node) node.textContent = text;
}

function bubbleEl(m) {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${m.role === "user" ? "user" : m.role === "bot" ? "bot" : m.role}`;
  if (m.role === "bot") paintBotBubble(bubble, m.text);
  else if (m.role === "user") paintUserBubble(bubble, m);
  else bubble.textContent = m.text;
  if (m.live) bubble.dataset.live = "1";
  return bubble;
}

function paintUserBubble(bubble, message) {
  const line = document.createElement("span");
  line.className = "user-line";
  line.textContent = message.text || "";
  bubble.appendChild(line);
  if (message.command) {
    const chip = document.createElement("span");
    chip.className = "cmd-chip";
    chip.textContent = message.command;
    bubble.appendChild(chip);
  }
  if (!message.full) return;
  const full = document.createElement("div");
  full.className = "full-prompt";
  full.hidden = !message.expanded;
  full.textContent = message.full;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "prompt-toggle";
  toggle.textContent = message.expanded ? "收起完整提示" : "顯示完整提示";
  toggle.addEventListener("click", () => {
    message.expanded = !message.expanded;
    full.hidden = !message.expanded;
    toggle.textContent = message.expanded ? "收起完整提示" : "顯示完整提示";
  });
  bubble.append(toggle, full);
}

function paintBotBubble(el, text) {
  const html = renderAssistantMarkdown(text);
  if (el.dataset.md === html) return;
  el.dataset.md = html;
  el.innerHTML = html;
  decorateCodeBlocks(el);
}

const livePainters = new Map();

function painterFor(id) {
  let painter = livePainters.get(id);
  if (painter) return painter;
  painter = createLivePainter({
    delay: 50,
    paint() {
      paintLiveNow(id);
    },
  });
  livePainters.set(id, painter);
  return painter;
}

async function openExternal(url) {
  if (!isSafeLink(url)) return;
  if (inTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function appendMessage(id, message) {
  const thread = threadFor(id);
  thread.messages.push(message);
  const chat = chatOf(id);
  if (!chat) return;
  chat.appendChild(bubbleEl(message));
  chat.scrollTop = chat.scrollHeight;
}

function setBotStatus(id, text, statusState) {
  const thread = threadFor(id);
  thread.status = text;
  thread.statusState = statusState;
  if (statusState === "busy") state.busy.add(id);
  else state.busy.delete(id);
  if (panelFor(id)) renderChat(id);
  renderBots();
}

function cancelReconnect() {
  state.reconnectToken += 1;
  window.clearTimeout(state.reconnectTimer);
  state.reconnectTimer = 0;
}

async function loadBotHistory(id, token) {
  const { invoke } = await import("@tauri-apps/api/core");
  const opened = await invoke("open_bot", { profile: id });
  if (token !== state.reconnectToken || state.mode !== "hermes") return false;
  const thread = threadFor(id);
  thread.messages = (opened.messages || []).map(presentMessage);
  thread.loaded = true;
  thread.sessionId = opened.session_id;
  thread.loading = false;
  clearConnectionBanner();
  setBotStatus(id, "閒置", "idle");
  return true;
}

function armReconnect(id, attempt, token) {
  window.clearTimeout(state.reconnectTimer);
  state.reconnectTimer = window.setTimeout(() => {
    if (token !== state.reconnectToken) return;
    retryHistory(id, attempt, token);
  }, reconnectDelayMs(attempt));
}

async function retryHistory(id, attempt, token) {
  if (token !== state.reconnectToken || state.mode !== "hermes") return;
  try {
    await loadBotHistory(id, token);
  } catch (err) {
    if (token !== state.reconnectToken) return;
    if (gatewayDown(String(err))) armReconnect(id, attempt + 1, token);
  }
}

async function selectBot(id) {
  clearUnread(id);
  if (state.catalogProfile && state.catalogProfile !== id) {
    state.catalog = null;
    state.catalogProfile = "";
  }
  state.activeId = id;
  state.slashPanelId = id;
  const existing = panelFor(id);
  if (existing) {
    existing.hidden = false;
    beginMotion(existing);
    existing.classList.remove("is-closing");
    if (!state.openIds.includes(id)) state.openIds = openPanel(state.openIds, id);
    raisePanel(existing);
    renderBots();
    return;
  }
  openBotPanel(id);
  renderBots();
  renderChat(id);
  if (state.mode !== "hermes" || !inTauri()) return;
  const thread = threadFor(id);
  if (thread.loaded || thread.loading) return;
  cancelReconnect();
  const token = state.reconnectToken;
  thread.loading = true;
  setBotStatus(id, "載入對話…", "busy");
  try {
    await loadBotHistory(id, token);
  } catch (err) {
    thread.loaded = false;
    const message = String(err);
    if (gatewayDown(message)) {
      setBotStatus(id, "連線錯誤", "error");
      setBanner(message, "error");
      armReconnect(id, 0, token);
    } else {
      appendMessage(id, { role: "commentary", text: message });
      setBotStatus(id, "連線錯誤", "error");
      setBanner(message, "error");
    }
  } finally {
    thread.loading = false;
  }
}

function openBotPanel(id) {
  const tpl = document.getElementById("bot-panel-template");
  const panel = tpl.content.firstElementChild.cloneNode(true);
  panel.dataset.botId = id;
  panel.dataset.hitId = `panel:${id}`;
  panel.dataset.panelKey = id;
  const slash = role(panel, "slash");
  if (slash) slash.dataset.hitId = `slash:${id}`;
  state.openIds = openPanel(state.openIds, id);
  $("#panel-host").appendChild(panel);
  placePanel(panel, id, { leftRatio: 0.12, topRatio: 0.1 });
  raisePanel(panel);
  bindPanelDrag(panel);
  wireBotPanel(panel, id);
  void runMotion(panel, "open");
  void loadSoul(id);
  scheduleHitSync();
  return panel;
}

function closeBotPanel(id) {
  const panel = panelFor(id);
  state.openIds = closePanel(state.openIds, id);
  if (state.activeId === id) state.activeId = state.openIds.at(-1) || null;
  if (state.slashPanelId === id) state.slashPanelId = state.activeId || "";
  if (state.pointerHitId === `panel:${id}`) state.pointerHitId = "";
  if (panel) {
    rememberPanel(panel);
    const active = document.activeElement;
    if (active && panel.contains(active)) active.blur();
    void finishClose(panel);
  }
  renderBots();
}

async function finishClose(panel) {
  const closed = await runMotion(panel, "close");
  if (!closed || !panel.isConnected) return;
  panel.remove();
  syncLatch();
  scheduleHitSync();
}

function wireBotPanel(panel, id) {
  role(panel, "close")?.addEventListener("click", () => closeBotPanel(id));
  role(panel, "send")?.addEventListener("click", () => sendActive(id));
  role(panel, "stop")?.addEventListener("click", () => stopActive(id));
  role(panel, "save")?.addEventListener("click", () => saveBotPanel(id));
  role(panel, "chat")?.addEventListener("click", (event) => {
    const anchor = event.target.closest?.("a");
    const chat = role(panel, "chat");
    if (!anchor || !chat?.contains(anchor)) return;
    event.preventDefault();
    const href = anchor.getAttribute("href") || "";
    if (!isSafeLink(href)) return;
    openExternal(href);
  });
  for (const field of ["display-name", "detail", "soul"]) {
    role(panel, field)?.addEventListener("input", (event) => {
      event.target.dataset.dirty = "1";
    });
  }
  const input = role(panel, "input");
  input?.addEventListener("focus", () => {
    state.activeId = id;
    state.slashPanelId = id;
    closeSlashExcept(id);
  });
  input?.addEventListener("input", () => {
    state.activeId = id;
    state.slashPanelId = id;
    state.slashIndex = 0;
    syncSlashGhost();
    refreshSlash();
  });
  input?.addEventListener("keyup", syncSlashGhost);
  input?.addEventListener("click", syncSlashGhost);
  input?.addEventListener("keydown", (event) => {
    state.activeId = id;
    state.slashPanelId = id;
    if (slashPopupOpen()) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const items = activeSlashItems();
        state.slashIndex = moveSlashIndex(items, state.slashIndex, event.key);
        renderSlashPopup();
        return;
      }
      if (event.key === "Tab" || event.key === "Enter") {
        const items = activeSlashItems();
        const picked = items[state.slashIndex];
        if (picked && picked.enabled !== false) {
          event.preventDefault();
          const submit = event.key === "Enter" && slashEnterSubmits(picked);
          completeSlash(picked);
          if (submit) sendActive(id);
          return;
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeSlash();
        return;
      }
    }
    if (event.key === "Enter") sendActive(id);
  });
}

async function loadSoul(id) {
  const panel = panelFor(id);
  const field = role(panel, "soul");
  if (!field || field.dataset.dirty === "1") return;
  if (!inTauri()) {
    field.value = state.souls.get(id) || "";
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const text = await invoke("read_soul", { profile: id });
    const current = role(panelFor(id), "soul");
    if (!current || current.dataset.dirty === "1") return;
    current.value = text || "";
  } catch (err) {
    const status = role(panelFor(id), "save-status");
    if (status) status.textContent = String(err);
  }
}

async function saveBotPanel(id) {
  const panel = panelFor(id);
  if (!panel) return;
  const name = role(panel, "display-name")?.value.trim() || "";
  const detail = role(panel, "detail")?.value.trim() || "";
  const soul = role(panel, "soul")?.value ?? "";
  const status = role(panel, "save-status");
  const bot = state.bots.find((item) => item.id === id);
  if (bot) {
    if (name) bot.name = name;
    bot.detail = detail;
    bot.short = shortLabel(bot.name);
  }
  state.souls.set(id, soul);
  role(panel, "display-name").dataset.dirty = "";
  role(panel, "detail").dataset.dirty = "";
  role(panel, "soul").dataset.dirty = "";
  renderBots();
  renderChat(id);
  if (!inTauri()) {
    if (status) status.textContent = "示範模式：已記喺呢個視窗。";
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("write_soul", { profile: id, text: soul });
    if (state.mode === "hermes") {
      const saved = await invoke("save_bot_meta", {
        input: { profile: id, display_name: name, detail },
      });
      const row = state.settings?.bots?.find((item) => item.profile === id);
      if (row && saved) {
        row.display_name = saved.display_name;
        row.detail = saved.detail;
      }
    }
    if (status) status.textContent = "已儲存呢個 Bot。";
  } catch (err) {
    if (status) status.textContent = String(err);
  }
}

function presentMessage(m) {
  if (m.role === "tool") {
    const name = m.tool_name || m.toolName || "tool";
    return { role: "tool", text: `工具 ${name}：${m.text}` };
  }
  if (m.role === "user") {
    const marker = parseSlashMarker(m.text);
    if (marker) {
      return {
        role: "user",
        text: marker.display,
        command: marker.command,
        full: marker.rest,
        expanded: false,
      };
    }
  }
  return { role: m.role, text: m.text };
}

function ensureLiveBubble(id) {
  const thread = threadFor(id);
  let live = thread.messages[thread.messages.length - 1];
  if (!live || live.role !== "bot" || !live.live) {
    live = { role: "bot", text: "", live: true };
    thread.messages.push(live);
    const chat = chatOf(id);
    if (chat) {
      const el = bubbleEl(live);
      el.dataset.live = "1";
      chat.appendChild(el);
    }
  }
  return live;
}

function paintLiveNow(id) {
  const chat = chatOf(id);
  if (!chat) return;
  const thread = threadFor(id);
  const live = [...thread.messages].reverse().find((m) => m.live);
  const nodes = chat.querySelectorAll("[data-live]");
  const node = nodes[nodes.length - 1];
  if (live && node) paintBotBubble(node, live.text);
  const gap = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
  if (gap < 80) chat.scrollTop = chat.scrollHeight;
}

function patchLive(id) {
  if (!panelFor(id)) return;
  painterFor(id).schedule();
}

function handleHermes(payload) {
  if (!payload || !payload.profile) return;
  const id = payload.profile;
  if (payload.type === "run.started") {
    noteActivity(id, { type: "run.started" });
    return;
  }
  if (payload.type === "delta") {
    noteActivity(id, { type: "delta" });
    const live = ensureLiveBubble(id);
    live.text += payload.text || "";
    patchLive(id);
    return;
  }
  if (payload.type === "command") {
    const user = [...threadFor(id).messages].reverse().find((item) => item.role === "user");
    if (user && payload.command) {
      user.command = payload.command;
      if (panelFor(id)) renderChat(id);
    }
    return;
  }
  if (payload.type === "commentary") {
    appendMessage(id, { role: "commentary", text: `過程：${payload.text || ""}` });
    if (panelFor(id)) renderChat(id);
    return;
  }
  if (payload.type === "tool") {
    const preview = payload.preview ? ` — ${payload.preview}` : "";
    const text = `${payload.name || "tool"}${preview}`;
    if (payload.phase === "progress") {
      noteActivity(id, { type: "tool.progress", name: payload.name || "", text });
      return;
    }
    noteActivity(id, { type: "tool" });
    const phase = payload.phase === "completed" ? "完成" : payload.phase === "failed" ? "失敗" : "開始";
    appendMessage(id, { role: "tool", text: `${phase} ${text}` });
    if (panelFor(id)) renderChat(id);
    return;
  }
  if (payload.type === "status") {
    const label = payload.detail || (payload.state === "busy" ? "思考中…" : "閒置");
    setBotStatus(id, label, payload.state === "busy" ? "busy" : payload.state === "error" ? "error" : "idle");
    return;
  }
  if (payload.type === "done") {
    const thread = threadFor(id);
    const live = [...thread.messages].reverse().find((m) => m.live);
    painterFor(id).flush();
    if (live) live.live = false;
    const outcome = payload.outcome === "failed" ? "failed" : payload.outcome === "cancelled" ? "cancelled" : "completed";
    noteActivity(id, { type: outcome, text: outcome === "completed" ? live?.text || "" : payload.detail || "" });
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
    noteActivity(id, { type: "failed", text: payload.message || "未知錯誤" });
    appendMessage(id, { role: "commentary", text: payload.message || "未知錯誤" });
    setBotStatus(id, "連線錯誤", "error");
    setBanner(payload.message || "連線錯誤", "error");
  }
}

async function sendActive(id = state.activeId) {
  const panel = panelFor(id);
  const input = role(panel, "input");
  const text = input?.value.trim() || "";
  if (!text || !id) return;
  state.activeId = id;
  state.slashPanelId = id;
  const busy = state.mode === "hermes" && state.busy.has(id);
  if (sendBlockedWhileBusy(text, state.catalog || [], busy)) return;
  closeSlash();
  input.value = "";
  input.placeholder = "輸入訊息給呢個 Bot…";
  state.slashArgsHint = "";
  syncSlashGhost();
  const action = resolveClient(text, state.catalog || []);
  if (action) {
    await sendClientCommand(id, text, action);
    return;
  }
  appendMessage(id, { role: "user", text });
  const sentId = id;
  noteActivity(sentId, { type: "send" });
  if (state.mode !== "hermes" || !inTauri()) {
    setTimeout(() => {
      const reply = `（示範回覆）收到：「${text}」。未設定 Hermes gateway。`;
      appendMessage(sentId, { role: "bot", text: reply });
      noteActivity(sentId, { type: "completed", text: reply });
    }, 350);
    return;
  }
  setBotStatus(sentId, "思考中…", "busy");
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("send_chat", { profile: sentId, text });
  } catch (err) {
    const message = String(err);
    noteActivity(sentId, { type: "failed", text: message });
    appendMessage(sentId, { role: "commentary", text: message });
    setBotStatus(sentId, "連線錯誤", "error");
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

async function sendClientCommand(id, text, action) {
  appendMessage(id, { role: "user", text, command: action.command });
  if (action.command === "stop") {
    await stopActive(id);
    if (!state.busy.has(id)) {
      appendMessage(id, { role: "commentary", text: "已停止呢次回覆。" });
      setBotStatus(id, "已停止", "idle");
    }
    return;
  }
  if (state.mode !== "hermes" || !inTauri()) {
    appendMessage(id, { role: "commentary", text: `（示範）${action.mapsTo || action.command}` });
    return;
  }
  const fields = action.command === "model" ? modelFields(action.args) : { model: "", provider: "" };
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke("client_command", {
      input: {
        profile: id,
        command: action.command,
        args: action.args,
        model: fields.model,
        provider: fields.provider,
      },
    });
    const thread = threadFor(id);
    if (result.session_id) thread.sessionId = result.session_id;
    if (action.command === "new" || action.command === "branch") {
      thread.messages = [{ role: "user", text, command: action.command }];
      if (result.notice) thread.messages.push({ role: "commentary", text: result.notice });
      renderChat(id);
      return;
    }
    if (result.options?.length) {
      appendMessage(id, { role: "commentary", text: result.options.join("\n") });
    } else if (result.notice) {
      appendMessage(id, { role: "commentary", text: result.notice });
    }
  } catch (err) {
    const message = String(err);
    appendMessage(id, { role: "commentary", text: message });
    setBanner(message, "error");
  }
}

function useMock(reason, bannerAction = "") {
  cancelReconnect();
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
  removeBotPanels();
  state.activeId = state.bots[0]?.id || null;
  state.slashPanelId = state.activeId || "";
  setBanner(reason, "info", "", bannerAction);
  renderBots();
  if (state.activeId) void selectBot(state.activeId);
}

function useHermes(settings) {
  cancelReconnect();
  state.catalog = null;
  state.catalogProfile = "";
  state.mode = "hermes";
  state.settings = settings;
  state.bots = botsFromSettings(settings);
  state.threads = new Map();
  state.busy.clear();
  removeBotPanels();
  state.activeId = state.bots[0]?.id || null;
  state.slashPanelId = state.activeId || "";
  if (settings.keyring_error) {
    setBanner(`鑰匙圈：${settings.keyring_error}`, "error", "keyring");
  } else if (state.bots.length === 0) {
    setBanner("Gateway 已設定，但未有 Bot。打開設定加入 profile 同金鑰。", "info");
  } else {
    setBanner("已連接設定。點頭像載入該 Bot 嘅 Bot Chat。", "ok");
  }
  renderBots();
  if (state.activeId) void selectBot(state.activeId);
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
  document.querySelectorAll(".interact-hint").forEach((hint) => {
    hint.textContent = hintText();
  });
}

function readInteractionForm() {
  return {
    modifier: $("#interaction-modifier").value,
    fade_enabled: false,
    fade_distance: 120,
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
  const setupHint = $("#setup-hint");
  if (setupHint) setupHint.hidden = !setupHintVisible($("#gateway-url").value);
}

function focusSettings() {
  const panel = $("#settings");
  if (settingsOpen() && panel && !panel.classList.contains("is-closing")) {
    raisePanel(panel);
    renderSettingsOrb();
    return;
  }
  openSettings();
}

function openSettings() {
  window.clearTimeout(blurReleaseTimer);
  blurReleaseTimer = 0;
  state.windowFocused = true;
  fillSettings(state.settings);
  const panel = $("#settings");
  if (!panel) return;
  const opening = panel.hidden || panel.classList.contains("is-closing");
  panel.hidden = false;
  panel.classList.remove("is-closing");
  if (opening) {
    placePanel(panel, "settings", { leftRatio: 0.46, topRatio: 0.08 });
    raisePanel(panel);
    bindPanelDrag(panel);
    void runMotion(panel, "open");
  } else {
    raisePanel(panel);
  }
  renderSettingsOrb();
  syncLatch();
  scheduleHitSync();
  const firstRun = shouldAutoOpenSettings(state.settings);
  $("#settings-status").textContent = firstRun
    ? "填上面嘅 Gateway 位址同 API 金鑰，然後儲存。"
    : inTauri()
      ? "儲存之後先會用新設定。測試連線讀已儲存嘅金鑰。"
      : "瀏覽器預覽改唔到鑰匙圈。請用 npm run tauri dev。";
  if (setupHintVisible($("#gateway-url").value)) $("#gateway-url").focus();
  if (!inTauri()) return;
  import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) => getCurrentWindow().setFocus())
    .catch(() => {});
}

function closeSettings() {
  const panel = $("#settings");
  if (!panel || panel.hidden || panel.classList.contains("is-closing")) return;
  rememberPanel(panel);
  const active = document.activeElement;
  if (active && panel.contains(active)) active.blur();
  if (state.pointerHitId === "settings") state.pointerHitId = "";
  void (async () => {
    const closed = await runMotion(panel, "close");
    if (!closed) return;
    panel.hidden = true;
    renderSettingsOrb();
    syncLatch();
    scheduleHitSync();
  })();
  renderSettingsOrb();
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
    if (settings.mode === "mock") useMock("未設定 gateway，而家係離線示範模式。", "settings");
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
  pinBtn?.addEventListener("click", async (event) => {
    event.stopPropagation();
    const next = pinToggle(state.alwaysOnTop);
    state.alwaysOnTop = next.alwaysOnTop;
    pinBtn.setAttribute("aria-pressed", String(next.pressed));
    pinBtn.textContent = next.label;
    if (next.armsCloseGuard && inTauri()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("arm_pin_close_guard");
      } catch (err) {
        showActionError(invokeFailureMessage("置頂保護", err));
      }
    }
    if (win) {
      try {
        await win.setAlwaysOnTop(next.alwaysOnTop);
      } catch (err) {
        console.warn("setAlwaysOnTop failed", err);
      }
    }
  });
  bindPanelDrag($("#settings"));
  bindPanelDrag($("#kanban-panel"));
}

function slashPanel() {
  return panelFor(state.slashPanelId || state.activeId);
}

function slashInput() {
  return role(slashPanel(), "input");
}

function slashPopup() {
  return role(slashPanel(), "slash");
}

function closeSlashExcept(id) {
  document.querySelectorAll(".bot-panel").forEach((panel) => {
    if (panel.dataset.botId === id) return;
    const popup = role(panel, "slash");
    if (!popup || popup.hidden) return;
    popup.hidden = true;
    popup.replaceChildren();
  });
}

function slashPopupOpen() {
  const popup = slashPopup();
  return !!popup && !popup.hidden;
}

function closeSlash() {
  const popup = slashPopup();
  if (!popup) return;
  popup.hidden = true;
  popup.replaceChildren();
  syncLatch();
  scheduleHitSync();
}

function activeSlashItems() {
  const query = slashFilterQuery(slashInput()?.value || "");
  if (query == null) return [];
  return orderSlashCommands(filterCommands(state.catalog || [], query));
}

async function stopActive(id) {
  const profile = id || state.activeId;
  if (!profile || state.mode !== "hermes" || !inTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("stop_chat", { profile });
}

function measureInputText(text, style) {
  const canvas = measureInputText.canvas || (measureInputText.canvas = document.createElement("canvas"));
  const ctx = canvas.getContext("2d");
  ctx.font = style.font;
  return ctx.measureText(text).width;
}

function syncSlashGhost() {
  const input = slashInput();
  const ghost = role(slashPanel(), "ghost");
  if (!input || !ghost) return;
  const hint = inlineArgsHint(input.value, state.slashArgsHint);
  if (!hint) {
    ghost.hidden = true;
    ghost.textContent = "";
    return;
  }
  ghost.hidden = false;
  ghost.textContent = hint;
  const style = getComputedStyle(input);
  const caret = input.selectionStart ?? input.value.length;
  const width = measureInputText(input.value.slice(0, caret), style);
  const pad = Number.parseFloat(style.paddingLeft) || 0;
  ghost.style.left = `${input.offsetLeft + pad + width - input.scrollLeft}px`;
  ghost.style.top = `${input.offsetTop}px`;
  ghost.style.height = `${input.offsetHeight}px`;
  ghost.style.font = style.font;
}

async function ensureCatalog() {
  if (!inTauri() || state.mode !== "hermes" || !state.activeId) {
    state.catalog = PREVIEW_COMMANDS;
    state.catalogHint = "";
    state.catalogProfile = state.activeId || "";
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke("list_commands", { profile: state.activeId });
    state.catalog = result.commands || [];
    state.catalogHint = result.hint || "";
    state.catalogProfile = state.activeId;
  } catch (err) {
    state.catalog = [];
    state.catalogHint = String(err);
    state.catalogProfile = state.activeId;
  }
}

function renderSlashPopup() {
  const popup = slashPopup();
  const input = slashInput();
  if (!popup || !input) return;
  const query = slashFilterQuery(input.value);
  if (query == null) {
    closeSlash();
    return;
  }
  const items = activeSlashItems();
  if (!items.length && !(state.catalogHint && !(state.catalog || []).length)) {
    closeSlash();
    return;
  }
  if (state.slashIndex >= items.length) state.slashIndex = 0;
  popup.replaceChildren();
  if (!items.length) {
    const hint = document.createElement("p");
    hint.className = "slash-hint";
    hint.textContent = state.catalogHint || "未裝 overlay-slash，/ 選單唔會出現。";
    popup.appendChild(hint);
  }
  let index = 0;
  groupByCategory(items).forEach((group) => {
    const label = document.createElement("div");
    label.className = "slash-cat";
    label.textContent = group.category;
    if (/^[\x00-\x7F]+$/.test(group.category || "")) label.lang = "en";
    popup.appendChild(label);
    group.items.forEach((command) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `slash-item${index === state.slashIndex ? " active" : ""}${command.enabled === false ? " disabled" : ""}`;
    button.disabled = command.enabled === false;
    button.setAttribute("role", "option");
    const name = document.createElement("span");
    name.className = "slash-name";
    name.lang = "en";
    name.textContent = command.name;
    const desc = document.createElement("span");
    desc.className = "slash-desc";
    desc.textContent = command.description || "";
    button.append(name, desc);
    button.addEventListener("click", () => completeSlash(command));
    popup.appendChild(button);
    index += 1;
    });
  });
  popup.hidden = false;
  const active = popup.querySelector(".slash-item.active");
  active?.scrollIntoView({ block: "nearest" });
  syncLatch();
  scheduleHitSync();
}

function completeSlash(command) {
  if (!command || command.enabled === false) return;
  const input = slashInput();
  if (!input) return;
  input.value = completionText(command);
  input.placeholder = "輸入訊息給呢個 Bot…";
  state.slashArgsHint = String(command.args_hint || "");
  input.focus();
  const end = input.value.length;
  input.setSelectionRange(end, end);
  closeSlash();
  syncSlashGhost();
}

async function refreshSlash() {
  const query = slashFilterQuery(slashInput()?.value || "");
  if (query == null) {
    closeSlash();
    return;
  }
  const alreadyOpen = slashPopupOpen();
  const sameProfile = state.catalog != null && state.catalogProfile === state.activeId;
  if (shouldRefreshCatalog(alreadyOpen, sameProfile)) await ensureCatalog();
  if (slashFilterQuery(slashInput()?.value || "") == null) return;
  renderSlashPopup();
}

function topOpenPanel() {
  const panels = [...document.querySelectorAll(".center-panel")].filter(
    (el) => !el.hidden && !el.classList.contains("is-closing"),
  );
  panels.sort((a, b) => (Number(b.style.zIndex) || 0) - (Number(a.style.zIndex) || 0));
  return panels[0] || null;
}

function setupComposer() {
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (state.dropdownOpen) {
      state.dropdownOpen = nextDropdownOpen(state.dropdownOpen, "escape");
      return;
    }
    if (slashPopupOpen()) {
      closeSlash();
      return;
    }
    if (isTextField(document.activeElement)) {
      document.activeElement.blur();
      syncLatch();
      return;
    }
    const top = topOpenPanel();
    if (!top) return;
    if (top.id === "settings") closeSettings();
    else if (top.id === "kanban-panel") closeKanban();
    else if (top.dataset.botId) closeBotPanel(top.dataset.botId);
  });
  $("#conn-banner")?.addEventListener("click", (event) => {
    if (event.target.closest?.("[data-action='settings']")) openSettings();
  });
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
  $("#btn-quit")?.addEventListener("click", async () => {
    const action = settingsQuitAction();
    if (!inTauri()) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke(action.command);
    } catch (err) {
      showActionError(invokeFailureMessage("結束程式", err));
    }
  });
  $("#settings-form").addEventListener("submit", saveSettings);
  $("#btn-add-bot").addEventListener("click", () => $("#bot-editor").appendChild(rowFromBot()));
  $("#btn-probe").addEventListener("click", probeSaved);
  $("#btn-discover").addEventListener("click", discoverProfiles);
}

function paintOrb(el, color, letter) {
  if (!el) return;
  el.style.background = "";
  applyBotColor(el, color || NOUS.neutral);
  const glyph = el.querySelector?.(".orb-glyph");
  if (glyph && letter !== undefined) glyph.textContent = letter;
  else if (letter !== undefined && !glyph) el.textContent = letter;
}

function isTextField(el) {
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}

function settingsOpen() {
  const layer = $("#settings");
  return !!layer && !layer.hidden && !layer.classList.contains("is-closing");
}

function currentLatchedIds() {
  const active = document.activeElement;
  return latchedElementIds({
    windowFocused: state.windowFocused,
    textFocused: isTextField(active),
    textInSettings: !!(active && active.closest && active.closest("#settings")),
    settingsOpen: settingsOpen(),
    pointerHitId: state.pointerHitId,
    slashOpen: slashPopupOpen(),
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
    // [hidden] drops the rect even before layout. display:none makes the box empty too.
    if (!el || el.hidden || el.closest("[hidden]")) return;
    if (id && id === state.dragHitId) {
      rects.push({
        id,
        x: 0,
        y: 0,
        w: window.innerWidth,
        h: window.innerHeight,
        z: 1000,
        round: false,
      });
      return;
    }
    const box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    rects.push({ id, x: box.x, y: box.y, w: box.width, h: box.height, z, round });
  };
  document.querySelectorAll(".bot-panel, #settings, #kanban-panel").forEach((el) => {
    if (el.classList.contains("is-closing")) return;
    const z = Number.parseInt(el.style.zIndex, 10);
    const level = Number.isFinite(z) ? z : 1;
    push(el.dataset.hitId, el, level);
    const slash = role(el, "slash");
    if (slash?.dataset.hitId) push(slash.dataset.hitId, slash, level + 20);
  });
  const banner = $("#conn-banner");
  if (banner?.dataset.hitId === "banner") push("banner", banner, 5);
  document.querySelectorAll(".toast").forEach((el) => push(el.dataset.hitId, el, 40));
  document.querySelectorAll(".bot-btn").forEach((el) => {
    if (el.dataset.hitId) push(el.dataset.hitId, el, 0, true);
  });
  return rects;
}

let hitFrame = 0;
let lastHits = "";

function publishHits() {
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
}

function scheduleHitSync() {
  cancelAnimationFrame(hitFrame);
  hitFrame = requestAnimationFrame(publishHits);
}

function flushHits() {
  cancelAnimationFrame(hitFrame);
  publishHits();
}

function applyFrames(frames, interactiveAll = false) {
  const map = new Map((frames || []).map((item) => [item.id, item]));
  document.querySelectorAll("[data-hit-id]").forEach((el) => {
    const known = map.get(el.dataset.hitId);
    const nested = !!el.parentElement?.closest?.("[data-hit-id]");
    const value = known == null || nested ? 1 : known.opacity;
    el.style.setProperty("--hit-opacity", String(value));
    if (interactiveAll || known?.capture) el.dataset.hitCapture = "1";
    else delete el.dataset.hitCapture;
  });
}

const cursorPoint = { x: -10000, y: -10000 };
let blurReleaseTimer = 0;

function dismissModifierDropdown() {
  const select = $("#interaction-modifier");
  const action = applyDropdownDismiss(state);
  if (action.blur) select?.blur();
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
    const panel = event.target.closest?.(".center-panel");
    if (panel && !panel.classList.contains("is-closing")) raisePanel(panel);
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

const watchdogs = new Map();

function cssEscape(value) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function applyOrbMotion(btn, thread) {
  const motion = orbMotion(thread?.activity, thread?.statusState);
  btn?.classList.toggle("is-thinking", motion === "spin");
  btn?.classList.toggle("is-waiting", motion === "wait");
}

function syncActivityChrome(id = state.activeId) {
  const panel = panelFor(id);
  if (!panel) return;
  const activity = threadFor(id).activity;
  panel.classList.toggle("is-thinking", !!activity?.thinking);
  role(panel, "chat")?.classList.toggle("streaming", !!activity?.streaming);
}

function paintActivity(id) {
  const thread = threadFor(id);
  const btn = document.querySelector(`.bot-btn[data-bot-id="${cssEscape(id)}"]`);
  applyOrbMotion(btn, thread);
  btn?.classList.toggle("has-unread", !!thread.unread);
  if (panelFor(id)) syncActivityChrome(id);
}

function clearUnread(id) {
  const thread = threadFor(id);
  if (!thread.unread) return;
  thread.unread = false;
  paintActivity(id);
}

function noteActivity(id, event) {
  const thread = threadFor(id);
  const step = reduceActivity(thread.activity, event, Date.now());
  thread.activity = step.state;
  if (event.type === "watchdog") {
    const next = statusAfterWatchdog(thread.status);
    if (next !== thread.status) {
      thread.status = next;
      if (panelFor(id)) setStatusText(id, next);
    }
  }
  if (step.unread) thread.unread = true;
  paintActivity(id);
  if (step.state.deadline) armWatchdog(id, step.state.deadline);
  else clearWatchdog(id);
  if (step.toast) showToast(id, step.toast);
  if (step.unread) pingOrb(id);
}

function armWatchdog(id, deadline) {
  clearWatchdog(id);
  const delay = Math.max(0, deadline - Date.now());
  const timer = window.setTimeout(() => noteActivity(id, { type: "watchdog" }), delay);
  watchdogs.set(id, timer);
}

function clearWatchdog(id) {
  const timer = watchdogs.get(id);
  if (timer) window.clearTimeout(timer);
  watchdogs.delete(id);
}

function pingOrb(id) {
  const btn = document.querySelector(`.bot-btn[data-bot-id="${cssEscape(id)}"]`);
  if (!btn) return;
  btn.querySelector(".orb-ping")?.remove();
  const ping = document.createElement("span");
  ping.className = "orb-ping";
  btn.appendChild(ping);
}

function showToast(id, toast) {
  const stack = $("#toast-stack");
  if (!stack) return;
  const existing = [...stack.querySelectorAll(".toast")];
  while (existing.length >= 3) {
    existing.shift().remove();
  }
  const bot = state.bots.find((item) => item.id === id);
  const button = document.createElement("button");
  button.type = "button";
  button.className = `toast${toast.kind === "error" ? " toast-error" : ""}`;
  button.dataset.botId = id;
  button.dataset.hitId = `toast:${++state.toastSeq}`;
  button.dataset.side = "right";
  const kicker = document.createElement("span");
  kicker.className = "toast-kicker";
  const name = document.createElement("span");
  name.className = "toast-name";
  name.textContent = bot?.name || (id === "kanban" ? "看板" : id);
  if (bot?.name && /^[\x00-\x7F]+$/.test(bot.name)) name.lang = "en";
  const time = document.createElement("time");
  time.dateTime = new Date().toISOString();
  time.textContent = formatToastClock(new Date());
  kicker.append(name, time);
  const body = document.createElement("span");
  body.className = "toast-body";
  body.textContent = toast.text || "";
  button.append(kicker, body);
  applyBotColor(button, bot?.color || NOUS.blue);
  button.addEventListener("mouseenter", () => {
    button.remaining = Math.max(0, (button.deadline || Date.now()) - Date.now());
    window.clearTimeout(button.timer);
  });
  button.addEventListener("mouseleave", () => scheduleToastDismiss(button, button.remaining ?? TOAST_MS));
  button.addEventListener("click", () => {
    dismissToast(button);
    if (id === "kanban") openKanban();
    else selectBot(id);
  });
  stack.appendChild(button);
  layoutToasts();
  scheduleToastDismiss(button, TOAST_MS);
  scheduleHitSync();
}

function scheduleToastDismiss(button, delay) {
  button.deadline = Date.now() + delay;
  window.clearTimeout(button.timer);
  button.timer = window.setTimeout(() => dismissToast(button), delay);
}

function dismissToast(button) {
  if (!button?.isConnected || button.classList.contains("is-leaving")) return;
  window.clearTimeout(button.timer);
  button.classList.add("is-leaving");
  window.setTimeout(() => {
    button.remove();
    scheduleHitSync();
  }, 200);
}

function layoutToasts() {
  const groups = new Map();
  document.querySelectorAll(".toast").forEach((toast) => {
    const list = groups.get(toast.dataset.botId) || [];
    list.push(toast);
    groups.set(toast.dataset.botId, list);
  });
  groups.forEach((list, id) => {
    const orb = document.querySelector(`.bot-btn[data-bot-id="${cssEscape(id)}"]`);
    const box = orb ? orb.getBoundingClientRect() : { x: 24, y: 24, width: 52, height: 52 };
    const rect = { x: box.x, y: box.y, w: box.width, h: box.height };
    list.forEach((toast, index) => {
      const place = toastAnchor(rect, { width: window.innerWidth, height: window.innerHeight }, index);
      toast.dataset.side = place.side;
      toast.style.left = `${place.x}px`;
      toast.style.top = `${place.y}px`;
    });
  });
}

function toggleKanban() {
  const panel = $("#kanban-panel");
  if (state.kanbanOpen && panel && !panel.classList.contains("is-closing")) {
    raisePanel(panel);
    return;
  }
  openKanban();
}

function openKanban() {
  state.kanbanOpen = true;
  state.kanban.unread = false;
  const panel = $("#kanban-panel");
  if (panel) {
    const opening = panel.hidden || panel.classList.contains("is-closing");
    panel.hidden = false;
    panel.classList.remove("is-closing");
    applyBotColor(panel, NOUS.neutral);
    if (opening) {
      placePanel(panel, "kanban", { leftRatio: 0.08, topRatio: 0.08 });
      raisePanel(panel);
      bindPanelDrag(panel);
      void runMotion(panel, "open");
    } else {
      raisePanel(panel);
    }
  }
  renderBots();
  refreshKanban();
  startKanbanPoll();
}

function closeKanban() {
  state.kanbanOpen = false;
  stopKanbanPoll();
  if (kanbanDrag) {
    kanbanDrag.ghost?.remove();
    kanbanDrag.card?.classList.remove("is-dragging");
    kanbanDrag = null;
    state.kanban.dragging = false;
  }
  setKanbanError("");
  const panel = $("#kanban-panel");
  if (panel && !panel.hidden && !panel.classList.contains("is-closing")) {
    rememberPanel(panel);
    void (async () => {
      const closed = await runMotion(panel, "close");
      if (!closed) return;
      panel.hidden = true;
      syncLatch();
      scheduleHitSync();
    })();
  }
  renderBots();
  scheduleHitSync();
}

function startKanbanPoll() {
  stopKanbanPoll();
  state.kanbanTimer = window.setInterval(() => {
    if (!state.kanbanOpen || document.hidden) return;
    refreshKanban();
  }, KANBAN_POLL_MS);
}

function stopKanbanPoll() {
  window.clearInterval(state.kanbanTimer);
  state.kanbanTimer = 0;
}

async function refreshKanban() {
  if (state.kanban.saving || state.kanban.dragging) return;
  let payload;
  if (state.mode !== "hermes" || !inTauri()) {
    payload = state.kanban.board || mockKanban();
  } else {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      payload = await invoke("get_kanban_board", { board: KANBAN_BOARD });
    } catch (err) {
      payload = { unavailable: true, message: String(err) };
    }
  }
  const board = normalizeBoard(payload);
  const fingerprint = boardFingerprint(board);
  if (state.kanban.fingerprint && fingerprint !== state.kanban.fingerprint) {
    state.kanban.unread = true;
    pingOrb("kanban");
    renderKanbanOrb();
  }
  state.kanban.fingerprint = fingerprint;
  state.kanban.board = board;
  paintKanban(board);
}

function mockKanban() {
  return {
    board: KANBAN_BOARD,
    columns: [
      { name: "triage", tasks: [{ id: "demo-1", title: "整理今日待辦", assignee: "計劃助手", status: "triage", priority: "high", updated_at: "" }] },
      { name: "ready", tasks: [{ id: "demo-2", title: "對一下看板欄位", assignee: "程式夥伴", status: "ready", priority: "normal", updated_at: "" }] },
    ],
  };
}

function paintKanban(board) {
  const empty = $("#kanban-empty");
  const root = $("#kanban-board");
  const title = $("#kanban-title");
  if (title) title.textContent = board.board || "Board";
  if (!root || !empty) return;
  if (board.unavailable) {
    empty.hidden = false;
    empty.textContent = board.message || KANBAN_EMPTY;
    root.replaceChildren();
    scheduleHitSync();
    return;
  }
  empty.hidden = true;
  root.replaceChildren();
  board.columns.forEach((column) => {
    const col = document.createElement("section");
    col.className = "kanban-col";
    col.dataset.status = column.name;
    const head = document.createElement("header");
    head.className = "kanban-col-head";
    head.lang = "en";
    const name = document.createElement("span");
    name.lang = "en";
    name.textContent = column.name;
    const count = document.createElement("small");
    count.textContent = String(column.tasks.length);
    head.append(name, count);
    const list = document.createElement("div");
    column.tasks.forEach((task) => list.appendChild(kanbanCard(task)));
    col.append(head, list);
    root.appendChild(col);
  });
  scheduleHitSync();
}

function kanbanCard(task) {
  const card = document.createElement("article");
  card.className = "kanban-card";
  card.dataset.taskId = task.id;
  card.style.setProperty("--owner", ownerColor(task.assignee, state.bots));
  const title = document.createElement("p");
  title.className = "kanban-title";
  title.textContent = task.title || task.id;
  const meta = document.createElement("div");
  meta.className = "kanban-meta";
  if (task.assignee) {
    const who = document.createElement("span");
    who.textContent = task.assignee;
    meta.appendChild(who);
  }
  if (task.priority) {
    const chip = document.createElement("span");
    chip.className = "kanban-priority";
    chip.textContent = task.priority;
    chip.lang = "en";
    meta.appendChild(chip);
  }
  card.append(title, meta);
  card.addEventListener("pointerdown", (event) => startKanbanPointer(event, card, task.id));
  return card;
}

function setKanbanError(text) {
  const node = $("#kanban-error");
  if (!node) return;
  const message = String(text || "").trim();
  node.hidden = !message;
  node.textContent = message;
}

let kanbanDrag = null;

function columnAt(x, y) {
  const stack = document.elementsFromPoint?.(x, y) || [];
  for (const el of stack) {
    const col = el.closest?.(".kanban-col");
    if (col) return col;
  }
  return null;
}

function clearKanbanTargets() {
  document.querySelectorAll(".kanban-col.is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
}

function startKanbanPointer(event, card, taskId) {
  if (event.button !== 0 || kanbanDrag) return;
  kanbanDrag = {
    id: taskId,
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    moved: false,
    card,
    ghost: null,
  };
  card.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function moveKanbanPointer(event) {
  const drag = kanbanDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 6) return;
  if (!drag.moved) {
    drag.moved = true;
    state.kanban.dragging = true;
    drag.card.classList.add("is-dragging");
    const ghost = drag.card.cloneNode(true);
    ghost.classList.add("kanban-ghost");
    ghost.style.position = "fixed";
    ghost.style.width = `${drag.card.offsetWidth}px`;
    ghost.style.pointerEvents = "none";
    ghost.style.zIndex = "50";
    ghost.style.margin = "0";
    document.body.appendChild(ghost);
    drag.ghost = ghost;
  }
  drag.ghost.style.left = `${event.clientX + 8}px`;
  drag.ghost.style.top = `${event.clientY + 8}px`;
  const col = columnAt(event.clientX, event.clientY);
  clearKanbanTargets();
  col?.classList.add("is-drop-target");
}

function resyncKanbanHover(point) {
  if (point) {
    cursorPoint.x = point.x;
    cursorPoint.y = point.y;
  }
  // The board is rebuilt after the pointer grab lets go. Publish rects again
  // and, in the browser preview, paint fade from this pointer immediately.
  scheduleHitSync();
  if (!inTauri()) paintLocalProximity();
}

function endKanbanPointer(event) {
  const drag = kanbanDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const drop = event.type !== "pointercancel" && drag.moved;
  const col = drop ? columnAt(event.clientX, event.clientY) : null;
  const status = col?.dataset.status || "";
  const taskId = drag.id;
  const point = { x: event.clientX, y: event.clientY };
  kanbanDrag = null;
  state.kanban.dragging = false;
  drag.card.classList.remove("is-dragging");
  drag.ghost?.remove();
  clearKanbanTargets();
  try {
    drag.card.releasePointerCapture?.(event.pointerId);
  } catch {
    /* capture already released */
  }
  // Replacing the capture target inside pointerup leaves the GTK grab held,
  // so the board stays at the near-cursor fade until the next Ctrl hover.
  if (status) {
    requestAnimationFrame(() => {
      dropKanban(taskId, status);
      resyncKanbanHover(point);
    });
  } else {
    resyncKanbanHover(point);
  }
}

async function dropKanban(taskId, status) {
  const previous = state.kanban.board;
  if (!previous || previous.unavailable) return;
  const current = (previous.columns || []).flatMap((column) => column.tasks || []).find((task) => task.id === taskId);
  if (current && current.status === status) return;
  const next = moveTask(previous, taskId, status);
  state.kanban.board = next;
  state.kanban.fingerprint = boardFingerprint(next);
  setKanbanError("");
  paintKanban(next);
  if (state.mode !== "hermes" || !inTauri()) return;
  state.kanban.saving = true;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("patch_kanban_task", { id: taskId, patch: { status } });
  } catch (err) {
    state.kanban.board = previous;
    state.kanban.fingerprint = boardFingerprint(previous);
    paintKanban(previous);
    setKanbanError(kanbanErrorText(err));
  } finally {
    state.kanban.saving = false;
    resyncKanbanHover();
  }
}

async function boot() {
  setupComposer();
  setupWindowChrome();
  setupProximity();
  $("#btn-kanban-close")?.addEventListener("click", () => closeKanban());
  window.addEventListener("pointermove", moveKanbanPointer);
  window.addEventListener("pointerup", endKanbanPointer);
  window.addEventListener("pointercancel", endKanbanPointer);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopKanbanPoll();
    else if (state.kanbanOpen) {
      refreshKanban();
      startKanbanPoll();
    }
  });
  window.addEventListener("resize", layoutToasts);
  applyInteraction(state.interaction);
  if (!inTauri()) {
    useMock("瀏覽器預覽：離線示範。Gateway 同金鑰只喺桌面版可用。", "settings");
    if (new URLSearchParams(location.search).has("setup")) {
      state.settings = { needs_setup: true, mode: "mock", gateway_base_url: "" };
      openSettings();
    }
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
    if (settings.needs_setup) {
      useMock(SETUP_BANNER, "settings");
      openSettings();
    } else if (settings.mode === "mock") useMock("未設定 gateway，而家係離線示範模式。", "settings");
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
