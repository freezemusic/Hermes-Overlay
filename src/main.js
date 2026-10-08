/**
 * Hermes Overlay — interactive perimeter bots + center chat/detail panel
 * UI labels: Traditional Chinese (zh-HK)
 */

const BOTS = [
  {
    id: "planner",
    name: "計劃助手",
    short: "計",
    color: "#5b6cff",
    status: "線上 · 可互動",
    detail:
      "幫你拆解任務、排優先次序，同埋跟進每日進度。適合長時 overlay 置頂使用。",
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
    color: "#2dd4bf",
    status: "線上 · 程式碼模式",
    detail: "跨平台桌面／網頁開發助手。而家呢個骨架就係用 Tauri 2 整出嚟。",
    messages: [
      { role: "bot", text: "透明窗 + alwaysOnTop 已開。要唔要加系統托盤？" },
      { role: "user", text: "稍後先。而家想確認 bot 邊框互動。" },
      { role: "bot", text: "點選邊框頭像就會切換中間面板內容。" },
    ],
    float: "建議下一步：接真 Hermes Agent 通道。",
  },
  {
    id: "research",
    name: "資料搜查",
    short: "查",
    color: "#f59e0b",
    status: "待命",
    detail: "負責搜尋、摘要同來源整理。呢個版本用 mock 內容示範版面。",
    messages: [
      { role: "bot", text: "你想查邊個主題？我可以先出重點摘要。" },
    ],
    float: null,
  },
  {
    id: "writer",
    name: "文案助手",
    short: "文",
    color: "#f472b6",
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
    color: "#94a3b8",
    status: "觀察中",
    detail: "預留位置顯示 CPU／網路／agent 狀態。目前係 stub。",
    messages: [
      { role: "bot", text: "監控面板尚未接真數據——骨架已就位。" },
    ],
    float: null,
  },
  {
    id: "voice",
    name: "語音 Bot",
    short: "聲",
    color: "#a78bfa",
    status: "靜音",
    detail: "語音輸入／輸出預留。點選可睇 mock 對話。",
    messages: [
      { role: "bot", text: "語音通道未接上。你可以先用文字試 overlay。" },
    ],
    float: null,
  },
  {
    id: "memory",
    name: "記憶庫",
    short: "憶",
    color: "#34d399",
    status: "本地 stub",
    detail: "記住偏好同跨 session 上下文（未實作持久化）。",
    messages: [
      { role: "bot", text: "而家只係記憶示範字串，重開 app 會重置。" },
    ],
    float: null,
  },
  {
    id: "security",
    name: "安全守門",
    short: "安",
    color: "#fb7185",
    status: "守護中",
    detail: "提示敏感操作、權限同 click-through 風險。",
    messages: [
      { role: "bot", text: "全螢幕透明 overlay 要小心誤觸；空白位穿透仍屬實驗功能。" },
    ],
    float: "Esc 可以快速關閉（開發用）。",
  },
];

/** Place N bots around the frame edges (matches wireframe: scattered on perimeter). */
function edgePositions(count) {
  // Normalized path around the rectangle: top → right → bottom → left
  const pads = {
    top: 0.08,
    right: 0.08,
    bottom: 0.08,
    left: 0.08,
  };
  // Weight edges similar to the sketch (more on right/bottom)
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
  // If rounding left extras, put on right
  while (remaining > 0) {
    slots.push({ edge: "right", t: 0.5 });
    remaining--;
  }

  return slots.map(({ edge, t }) => {
    const inset = `var(--edge-pad)`;
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

let activeId = BOTS[0].id;
let alwaysOnTop = true;

function $(sel) {
  return document.querySelector(sel);
}

function renderBots() {
  const rail = $("#bot-rail");
  rail.innerHTML = "";
  const positions = edgePositions(BOTS.length);
  BOTS.forEach((bot, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bot-btn" + (bot.id === activeId ? " active" : "");
    btn.style.setProperty("--bot-color", bot.color);
    btn.dataset.botId = bot.id;
    btn.setAttribute("aria-label", bot.name);
    btn.title = bot.name;
    Object.assign(btn.style, positions[i].style);
    btn.textContent = bot.short;
    const label = document.createElement("span");
    label.className = "bot-label";
    label.textContent = bot.name;
    btn.appendChild(label);
    btn.addEventListener("click", () => selectBot(bot.id));
    rail.appendChild(btn);
  });
}

function selectBot(id) {
  activeId = id;
  const bot = BOTS.find((b) => b.id === id);
  if (!bot) return;

  document.querySelectorAll(".bot-btn").forEach((el) => {
    el.classList.toggle("active", el.dataset.botId === id);
  });

  $("#bot-name").textContent = bot.name;
  $("#bot-status").textContent = bot.status;
  $("#bot-detail").textContent = bot.detail;
  $("#active-avatar").style.setProperty("--bot-color", bot.color);
  $("#active-avatar").style.background = bot.color;

  const chat = $("#chat-messages");
  chat.innerHTML = "";
  bot.messages.forEach((m) => {
    const bubble = document.createElement("div");
    bubble.className = `bubble ${m.role === "user" ? "user" : "bot"}`;
    bubble.textContent = m.text;
    chat.appendChild(bubble);
  });
  chat.scrollTop = chat.scrollHeight;

  const float = $("#float-bubble");
  if (bot.float) {
    float.hidden = false;
    $("#float-text").textContent = bot.float;
    $("#float-avatar").style.background = bot.color;
  } else {
    float.hidden = true;
  }
}

function appendLocalMessage(text, role) {
  const bot = BOTS.find((b) => b.id === activeId);
  if (!bot) return;
  bot.messages.push({ role, text });
  const chat = $("#chat-messages");
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role === "user" ? "user" : "bot"}`;
  bubble.textContent = text;
  chat.appendChild(bubble);
  chat.scrollTop = chat.scrollHeight;
}

async function getCurrentWindow() {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow();
  } catch {
    return null;
  }
}

async function setupWindowChrome() {
  const win = await getCurrentWindow();
  const pinBtn = $("#btn-pin");
  const closeBtn = $("#btn-close");

  pinBtn?.addEventListener("click", async () => {
    alwaysOnTop = !alwaysOnTop;
    pinBtn.setAttribute("aria-pressed", String(alwaysOnTop));
    pinBtn.textContent = alwaysOnTop ? "置頂" : "取消置頂";
    if (win) {
      try {
        await win.setAlwaysOnTop(alwaysOnTop);
      } catch (e) {
        console.warn("setAlwaysOnTop failed", e);
      }
    }
  });

  closeBtn?.addEventListener("click", async () => {
    if (win) {
      await win.close();
    } else {
      window.close();
    }
  });

  // Click-through (setIgnoreCursorEvents) is stubbed OFF by default.
  // Enabling it globally blocks receiving hover on empty areas, so toggles
  // need a hotkey or native hit-test. See README "Known limitations".
  // Example (manual): if (win) await win.setIgnoreCursorEvents(true);
}

function setupComposer() {
  const input = $("#chat-input");
  const send = $("#btn-send");
  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
    appendLocalMessage(text, "user");
    input.value = "";
    // Stub bot reply
    setTimeout(() => {
      appendLocalMessage("（示範回覆）收到：「" + text + "」。之後會接真 Hermes Agent 通道。", "bot");
    }, 350);
  };
  send.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      $("#btn-close")?.click();
    }
  });
}

window.addEventListener("DOMContentLoaded", () => {
  renderBots();
  selectBot(activeId);
  setupComposer();
  setupWindowChrome();
});
