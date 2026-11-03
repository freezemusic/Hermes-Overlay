/**
 * Text size and interface language (R-LK-01, R-LK-02).
 *
 * Text size scales panel text only. Orbs, glyphs, orb names and panel boxes
 * keep their size, so hit areas and morph geometry do not move.
 *
 * Language: zh-HK is the source text in index.html and main.js. English swaps
 * whole UI strings by exact match through a MutationObserver. The observer is
 * only connected while English is on, so zh-HK runs exactly as before.
 * Chat, plans, kanban cards, session titles and other Hermes data are never
 * translated.
 */

export const TEXT_SIZES = Object.freeze([
  Object.freeze({ id: "s", scale: 0.9, glyph: "A", tip: "細字" }),
  Object.freeze({ id: "m", scale: 1, glyph: "A", tip: "標準字" }),
  Object.freeze({ id: "l", scale: 1.15, glyph: "A", tip: "大字" }),
  Object.freeze({ id: "xl", scale: 1.3, glyph: "A", tip: "特大字" }),
]);

export const DEFAULT_TEXT_SIZE = "m";

export const UI_LANGUAGES = Object.freeze([
  Object.freeze({ code: "zh-HK", glyph: "繁", tip: "繁體中文（香港）" }),
  Object.freeze({ code: "en", glyph: "EN", tip: "English" }),
]);

export const DEFAULT_LANGUAGE = "zh-HK";

/** Unknown or blank is the standard size. */
export function normalizeTextSize(raw) {
  const id = String(raw ?? "").trim().toLowerCase();
  return TEXT_SIZES.some((step) => step.id === id) ? id : DEFAULT_TEXT_SIZE;
}

export function textScale(raw) {
  const id = normalizeTextSize(raw);
  return TEXT_SIZES.find((step) => step.id === id).scale;
}

/** Unknown or blank is zh-HK. `en-GB`, `EN` and `english` are English. */
export function normalizeLanguage(raw) {
  const text = String(raw ?? "").trim().toLowerCase();
  if (text === "en" || text.startsWith("en-") || text.startsWith("en_") || text === "english") return "en";
  return DEFAULT_LANGUAGE;
}

/** The value settings save sends. The default is "" so the file keeps no key. */
export function storedTextSize(raw) {
  const id = normalizeTextSize(raw);
  return id === DEFAULT_TEXT_SIZE ? "" : id;
}

export function storedLanguage(raw) {
  const code = normalizeLanguage(raw);
  return code === DEFAULT_LANGUAGE ? "" : code;
}

/** `<html data-text-size>` drives the CSS. Standard size removes it. */
export function applyTextSize(doc, raw) {
  const root = doc?.documentElement;
  if (!root) return DEFAULT_TEXT_SIZE;
  const id = normalizeTextSize(raw);
  if (id === DEFAULT_TEXT_SIZE) {
    delete root.dataset.textSize;
    root.style.removeProperty("--text-scale");
  } else {
    root.dataset.textSize = id;
    root.style.setProperty("--text-scale", String(textScale(id)));
  }
  return id;
}

/** zh-HK source -> English. Whole strings only; nothing is matched inside a sentence. */
export const EN = Object.freeze({
  // Panel chrome
  "關閉": "Close",
  "收起呢個面板": "Collapse this panel",
  "載入中…": "Loading…",
  "準備就緒": "Ready",
  "閒置": "Idle",
  "思考中…": "Thinking…",
  "思考中": "Thinking",
  "等緊批准": "Waiting for approval",
  "等你答": "Waiting for your answer",
  "排隊中": "Queued",
  "排隊中，等佢講完就會行": "Queued: runs when the current reply ends",
  "手機嗰邊行緊，排緊隊": "Running on the phone, queued",
  "已停止": "Stopped",
  "已停止呢次回覆。": "Stopped this reply.",
  "停止未送到。": "Stop was not sent.",
  "回覆失敗": "Reply failed",
  "連線錯誤": "Connection error",
  "對話已關閉": "Session closed",
  "只可以睇": "Read only",
  "面板分頁": "Panel tabs",
  "對話": "Chat",
  "呢個 Bot": "This bot",
  "揀一個對話": "Pick a session",
  "未有對話": "No sessions yet",
  "顯示名稱": "Display name",
  "詳情": "Details",
  "呢個 Bot 嘅 SOUL.md": "This bot's SOUL.md",
  "儲存呢個 Bot": "Save this bot",
  "喺 API 對話繼續": "Continue in an API session",
  "轉去 Bot Chat": "Go to Bot Chat",
  "斜線指令": "Slash commands",
  "撰寫模式": "Compose mode",
  "一般": "Normal",
  "旁問": "Aside",
  "輸入訊息給呢個 Bot…": "Message this bot…",
  "停止": "Stop",
  "傳送": "Send",
  "開新 session": "New session",
  "新 session 標題": "New session title",
  "標題（可留空）": "Title (optional)",
  "釘住": "Pin",
  "取消釘住": "Unpin",
  "拎出做子光球": "Pop out as a sub-orb",
  "隱藏呢個 Bot": "Hide this bot",
  "Bot 列表": "Bot list",
  // Plan
  "計劃": "Plan",
  "計劃顯示": "Plan view",
  "預覽": "Preview",
  "原文": "Source",
  "關閉計劃視窗": "Close the plan window",
  "睇計劃": "View plan",
  // Approvals and clarify (wording only; choices are unchanged)
  "要你批准": "Needs your approval",
  "批准（一次）": "Approve (once)",
  "拒絕": "Deny",
  "已批准": "Approved",
  "已拒絕": "Denied",
  "跳過": "Skip",
  "複製": "Copy",
  // Kanban and schedule
  "看板": "Kanban",
  "要登入 Kanban": "Sign in to Kanban",
  "登入之後先睇到呢塊板。": "Sign in to see this board.",
  "登入": "Sign in",
  "連唔到 Kanban。": "Can't reach Kanban.",
  "看板有更新": "Board updated",
  "看板通知": "Kanban notifications",
  "未有看板通知": "No kanban notifications yet",
  "全部已讀": "Mark all read",
  "啱啱": "Just now",
  "卡片": "Card",
  "返回": "Back",
  "看板更新失敗。": "Board update failed.",
  "排程工作": "Scheduled jobs",
  "只供查看。開關留喺 Hermes。": "View only. Turn jobs on or off in Hermes.",
  "未有排程": "No scheduled jobs",
  "停用": "Off",
  // Settings
  "保持置頂": "Keep on top",
  "置頂": "On top",
  "呢度先係 Hermes Overlay 同連線設定。每個 Bot 嘅 SOUL.md 喺佢自己嘅面板。": "Hermes Overlay and connection settings. Each bot's SOUL.md is in its own panel.",
  "登入資料只會寫入系統鑰匙圈，唔會放喺設定檔或者網頁。": "Sign-in details go only into the system keyring, never into the config file or the page.",
  "帳號": "Username",
  "密碼": "Password",
  "填帳號密碼就用密碼登入。兩格都留空就開系統瀏覽器登入。": "Fill in username and password to sign in with a password. Leave both blank to sign in in the system browser.",
  "登入 Kanban": "Sign in to Kanban",
  "Bot 名單": "Bot roster",
  "加入": "Add",
  "「顯示」決定邊個 profile 出圓球。右鍵圓球可以隱藏，喺呢度剔返就顯示。移除之後，下次發現會再出現。": "“Show” picks which profiles get an orb. Right-click an orb to hide it; tick it here to bring it back. A removed profile comes back on the next discovery.",
  "顯示": "Show",
  "移除": "Remove",
  "詳情（可留空）": "Details (optional)",
  "可留空": "Optional",
  "實驗：由 dashboard 匯入名單": "Experimental: import the roster from the dashboard",
  "Dashboard 位址": "Dashboard address",
  "匯入名單": "Import roster",
  "游標同穿透": "Cursor and click-through",
  "修飾鍵": "Modifier key",
  "光球平時透明度（%），數字愈大愈透": "Orb transparency at rest (%), higher is more see-through",
  "面板平時透明度（%），數字愈大愈透": "Panel transparency at rest (%), higher is more see-through",
  "揸住 Ctrl 時面板透明度（%），數字愈大愈透": "Panel transparency while Ctrl is held (%), higher is more see-through",
  "0 係實色。平時最多 80%，等字仲睇得清、光球仲搵得到。游標行近光球時，光球會再淡（最少 70% 透），揸住 Ctrl 就返實色可以撳。": "0 is solid. At rest the most is 80%, so text stays readable and orbs stay findable. Near the cursor an orb fades further (at least 70% see-through); hold Ctrl to make it solid and clickable.",
  "Windows、macOS、Linux X11 會讀全域游標同修飾鍵。Wayland 冇 X11（DISPLAY）時唔會穿透。": "Windows, macOS and Linux X11 read the global cursor and modifier keys. Without X11 (DISPLAY), Wayland does not click through.",
  "而家讀唔到全域輸入（常見於純 Wayland）。Overlay 會保持可點擊。": "Global input can't be read right now (common on pure Wayland). The overlay stays clickable.",
  "Linux 視窗管理員常用 Alt 拖移視窗（xfwm4 預設，GNOME／KDE 都常見）。揀 Alt 之後，Alt+click 可能去唔到呢個程式，設定就開唔返。可以用快捷鍵 Ctrl+Shift+Alt+H，或者系統匣選單「設定」。": "Linux window managers often use Alt to drag windows (xfwm4 by default, common on GNOME/KDE too). With Alt, Alt+click may not reach this app and settings won't open again. Use Ctrl+Shift+Alt+H, or Settings in the tray menu.",
  "線上": "Online",
  "線上 · 可互動": "Online · interactive",
  "線上 · 程式碼模式": "Online · code mode",
  "永遠顯示員工名": "Always show bot names",
  "顯示工具細節": "Show tool details",
  "結束程式": "Quit the app",
  "結束": "Quit",
  "測試已儲存連線": "Test the saved connection",
  "儲存": "Save",
  "已儲存。": "Saved.",
  "儲存之後先會用新設定。": "New settings apply after you save.",
  "填 Kanban server 同登入，然後儲存。": "Fill in the Kanban server and sign in, then save.",
  "測試緊…": "Testing…",
  "登入緊…": "Signing in…",
  "已登入，留空代表保留": "Signed in; leave blank to keep it",
  "已儲存，留空代表保留": "Saved; leave blank to keep it",
  // R-LK controls
  "外觀": "Look",
  "文字大小": "Text size",
  "介面語言": "Interface language",
  "細字": "Small text",
  "標準字": "Standard text",
  "大字": "Large text",
  "特大字": "Extra large text",
  "文字大小同介面語言即時試睇，撳「儲存」先記住；唔儲存就關，會返原本。": "Text size and language preview at once. Press Save to keep them; closing without saving puts them back.",
});

/** Whole strings with one number in them (R-LK-02 addendum, R-KB-10). Still whole-string:
 *  the pattern is anchored at both ends, so nothing inside a longer sentence changes. */
export const EN_PATTERNS = Object.freeze([
  Object.freeze([/^(\d+) 分鐘前$/, (n) => `${n} min ago`]),
  Object.freeze([/^看板通知（(\d+\+?) 個未讀）$/, (n) => `Kanban notifications (${n} unread)`]),
  Object.freeze([/^優先度 (-?\d+(?:\.\d+)?)：數字愈大，Hermes 愈早派$/, (n) => `Priority ${n}. Higher numbers are picked up first.`]),
]);

const DICTS = Object.freeze({ en: EN });
const PATTERNS = Object.freeze({ en: EN_PATTERNS });

/** One UI string in `lang`. Anything not in the table is returned unchanged. */
export function translate(text, lang) {
  const code = normalizeLanguage(lang);
  if (code === DEFAULT_LANGUAGE) return text;
  const raw = String(text ?? "");
  const key = raw.trim();
  if (!key) return raw;
  let hit = DICTS[code]?.[key];
  if (!hit) {
    for (const [pattern, make] of PATTERNS[code] || []) {
      const m = pattern.exec(key);
      if (m) {
        hit = make(m[1]);
        break;
      }
    }
  }
  if (!hit) return raw;
  return raw.replace(key, hit);
}

/** Hermes data and user text. Never translated. */
export const NO_TRANSLATE = [
  ".chat-messages",
  ".plan-body",
  ".plan-source",
  ".kanban-card",
  ".kanban-detail",
  ".kanban-col-head",
  ".kanban-crumb-profile",
  ".kanban-bell-title",
  ".kanban-bell-change",
  ".cron-name",
  ".session-menu",
  ".session-select",
  ".orb-names",
  ".orb-name",
  ".orb-glyph",
  ".bot-label",
  "[data-role=\"name\"]",
  ".toast-text",
  ".conn-banner",
  "textarea",
  "script",
  "style",
  "code",
  "pre",
  "[data-no-translate]",
].join(", ");

const ATTRS = ["title", "placeholder", "aria-label"];

function skipped(node) {
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  if (!el) return true;
  return Boolean(el.closest?.(NO_TRANSLATE));
}

/**
 * Keeps the DOM in one language. `setLanguage("en")` translates what is there
 * and watches for new UI text; `setLanguage("zh-HK")` puts back every string
 * it changed (unless the app has since written something else) and stops.
 */
export function createTranslator(doc, Observer = globalThis.MutationObserver) {
  const original = new WeakMap(); // Text node -> zh-HK source
  const attrOriginal = new WeakMap(); // Element -> { attr: source }
  const touched = new Set();
  let lang = DEFAULT_LANGUAGE;
  let observer = null;

  function textNode(node) {
    if (skipped(node)) return;
    const now = node.nodeValue;
    const known = original.get(node);
    const source = known !== undefined && now === translate(known, lang) ? known : now;
    const next = translate(source, lang);
    if (next === now) return;
    original.set(node, source);
    touched.add(new WeakRef(node));
    node.nodeValue = next;
  }

  function attrs(el) {
    if (el.nodeType !== 1 || el.closest?.(NO_TRANSLATE)) return;
    for (const name of ATTRS) {
      if (!el.hasAttribute(name)) continue;
      const now = el.getAttribute(name);
      const saved = attrOriginal.get(el) || {};
      const known = saved[name];
      const source = known !== undefined && now === translate(known, lang) ? known : now;
      const next = translate(source, lang);
      if (next === now) continue;
      saved[name] = source;
      attrOriginal.set(el, saved);
      touched.add(new WeakRef(el));
      el.setAttribute(name, next);
    }
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) {
      textNode(root);
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 11) return;
    if (root.nodeType === 1) {
      if (root.closest?.(NO_TRANSLATE)) return;
      attrs(root);
    }
    const walker = doc.createTreeWalker(root, 0x1 | 0x4, {
      acceptNode(node) {
        if (node.nodeType === 1 && node.matches?.(NO_TRANSLATE)) return 2; // reject subtree
        return 1;
      },
    });
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === 3) textNode(node);
      else attrs(node);
      node = walker.nextNode();
    }
  }

  function restore() {
    for (const ref of touched) {
      const node = ref.deref();
      if (!node) continue;
      if (node.nodeType === 3) {
        const source = original.get(node);
        if (source !== undefined && node.nodeValue === translate(source, "en")) node.nodeValue = source;
        original.delete(node);
      } else {
        const saved = attrOriginal.get(node) || {};
        for (const [name, source] of Object.entries(saved)) {
          if (node.getAttribute(name) === translate(source, "en")) node.setAttribute(name, source);
        }
        attrOriginal.delete(node);
      }
    }
    touched.clear();
  }

  function onMutations(records) {
    for (const record of records) {
      if (record.type === "characterData") textNode(record.target);
      else if (record.type === "attributes") attrs(record.target);
      else record.addedNodes.forEach((node) => walk(node));
    }
  }

  return {
    get language() {
      return lang;
    },
    setLanguage(raw) {
      const next = normalizeLanguage(raw);
      const root = doc.documentElement;
      if (next === lang) return lang;
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (lang !== DEFAULT_LANGUAGE) restore();
      lang = next;
      if (root) root.lang = lang;
      if (lang === DEFAULT_LANGUAGE) return lang;
      walk(doc.body);
      if (Observer) {
        observer = new Observer(onMutations);
        observer.observe(doc.body, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: ATTRS,
        });
      }
      return lang;
    },
    /** Tests: run pending observer records now. */
    flush() {
      if (observer) onMutations(observer.takeRecords());
    },
  };
}
