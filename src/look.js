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
 * translated. Overlay chrome that sits inside those areas (approval and clarify
 * cards, the tool line, code copy, the card detail back button) is listed in
 * `UI_IN_DATA` and is translated; the Hermes text around it is not.
 */

export const TEXT_SIZES = Object.freeze([
  Object.freeze({ id: "s", scale: 0.9, glyph: "A", tip: "細" }),
  Object.freeze({ id: "m", scale: 1, glyph: "A", tip: "標準" }),
  Object.freeze({ id: "l", scale: 1.15, glyph: "A", tip: "大" }),
  Object.freeze({ id: "xl", scale: 1.3, glyph: "A", tip: "特大" }),
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
  "1 分鐘內": "Under 1 min",
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
  "細": "Small",
  "標準": "Default",
  "大": "Large",
  "特大": "Extra large",
  "文字大小同介面語言即時試睇，撳「儲存」先記住；唔儲存就關，會返原本。": "Text size and language preview at once. Press Save to keep them; closing without saving puts them back.",
  // Approval card (R-LK-02 sweep; rendered inside chat, see UI_IN_DATA)
  "呢個批准已經過時": "This approval has expired",
  "批准未送出。": "Approval was not sent.",
  "呢個 bot 想行 Python（execute_code），經 Overlay 唔允許，叫佢改用 terminal 指令": "This bot wants to run Python (execute_code). The overlay doesn't allow it; ask it to use a terminal command instead.",
  // Clarify card
  "要你答": "Needs your answer",
  "推薦": "Recommended",
  "送出": "Send",
  "其他（自己打）": "Other (type your own)",
  "呢條問題已經過時": "This question has expired",
  "時間到，個 bot 會自己繼續": "Time's up; the bot will carry on by itself",
  "已答": "Answered",
  "已跳過": "Skipped",
  "答案未送出。": "Answer was not sent.",
  // History notices (approval / clarify asked elsewhere)
  "呢度答唔到。": "Can't answer here.",
  // Chat chrome
  "收起完整提示": "Hide full prompt",
  "顯示完整提示": "Show full prompt",
  "未送出": "Not sent",
  "已複製": "Copied",
  "工具": "Tool",
  "未知錯誤": "Unknown error",
  // Orbs and sub-orbs
  "設定": "Settings",
  "排程": "Schedule",
  "Hermes 設定": "Hermes settings",
  "排程工作進行中": "Scheduled job running",
  "排程工作失敗": "Scheduled job failed",
  "子光球": "Sub-orbs",
  "任務": "Task",
  "停止未送到": "Stop was not sent",
  "開唔到新對話。": "Couldn't open a new session.",
  "示範模式冇連 Hermes，開唔到新 session。": "Demo mode isn't connected to Hermes, so it can't open a new session.",
  "建立": "Create",
  // Kanban and schedule (sweep)
  "未裝 overlay-slash kanban，看板唔會出現。": "overlay-slash kanban isn't installed, so the board won't appear.",
  "呢部 Hermes 未有看板。伺服器冇提供看板功能。": "This Hermes has no Kanban board. The server doesn't offer one.",
  "看板拒絕呢次移動。": "The board refused this move.",
  "未有排程工作。": "No scheduled jobs yet.",
  "呢個 Bot 未有排程。": "This bot has no scheduled jobs.",
  "上次失敗": "Last run failed",
  "進行中": "Running",
  "啟用": "On",
  "未命名": "Untitled",
  "瀏覽器預覽唔可以登入。": "Sign-in isn't available in the browser preview.",
  "開緊瀏覽器登入…": "Opening the browser to sign in…",
  "已登入 Hermes Dashboard": "Signed in to Hermes Dashboard",
  // Settings (sweep)
  "顏色": "Colour",
  "置頂保護": "Keep-on-top guard",
  "瀏覽器預覽改唔到鑰匙圈。請用 npm run tauri dev。": "The browser preview can't change the keyring. Use npm run tauri dev.",
  "瀏覽器預覽唔可以儲存。": "The browser preview can't save.",
  "Hermes Dashboard 同名單可用。": "Hermes Dashboard and the roster are reachable.",
  "Hermes Dashboard 有回應，但部分 Bot 讀唔到。睇設定入面嘅結果。": "Hermes Dashboard answered, but some bots couldn't be read. See the results in Settings.",
  "實驗匯入中…": "Importing (experimental)…",
  "Dashboard 冇返回 profile。": "The dashboard returned no profiles.",
  "示範模式：已記喺呢個視窗。": "Demo mode: kept in this window only.",
  "已儲存呢個 Bot。": "Saved this bot.",
  "示範模式（--demo），冇連 Hermes。": "Demo mode (--demo), not connected to Hermes.",
  "未裝 overlay-slash，/ 選單唔會出現。": "overlay-slash isn't installed, so the / menu won't appear.",
  "呢個環境讀唔到全域游標或修飾鍵，所以保持可點擊，唔會穿透。": "This environment can't read the global cursor or modifier keys, so the overlay stays clickable and never clicks through.",
  // Settings help (index.html). Inline <code> splits these into separate text nodes;
  // each piece is still a whole text node, matched end to end.
  "第一次用：Kanban server 填 hermes serve 嘅位址（留空就係": "First run: set Kanban server to your hermes serve address (blank means",
  "），登入，然後儲存。": "), sign in, then save.",
  "對話、看板同 Bot 名單都經 hermes serve（Hermes Dashboard）。留空就用": "Chat, Kanban and the bot roster all go through hermes serve (Hermes Dashboard). Blank uses",
  "。帳號密碼同登入資料只寫入呢個程式自己嘅鑰匙圈，唔會寫入設定檔，亦唔會改其他程式嘅登入。": ". Usernames, passwords and sign-ins go only into this app's own keyring, never into the config file, and never change another app's sign-in.",
  "光球（包括設定、看板同排程）預設實色，滑鼠穿透，唔會接點擊或 hover。游標行近嗰粒先淡出。按住修飾鍵時，游標下面嗰粒光球返實色、可以點；右鍵隱藏都只喺按住修飾鍵時先有效。放開就回復穿透。新訊息會由光球向畫面中心橫向展開成膠囊，顯示 5 秒之後收回。膠囊唔使按修飾鍵都睇到，但要按住先至點得入去。面板預設實色，游標喺面板上面就可以拖同點。按住修飾鍵時，面板變透明並穿透。輸入框聚焦唔使按住修飾鍵。": "Orbs (Settings, Kanban and Schedule too) are solid by default and let the mouse through: no clicks or hover. The orb nearest the cursor fades. Hold the modifier key and the orb under the cursor turns solid and clickable; right-click to hide also needs the modifier held. Let go and clicks pass through again. A new message unfolds from its orb towards the screen centre as a capsule for 5 seconds. You can see the capsule without the modifier, but you need to hold it to click in. Panels are solid by default; with the cursor over a panel you can drag and click. Hold the modifier and the panel turns see-through and lets clicks through. A focused input box doesn't need the modifier.",
  "連上 Hermes Dashboard 時會自動發現 profile 並寫入設定：本機 Hermes 目錄（": "Profiles are found and written to settings when you connect to Hermes Dashboard: the local Hermes folder (",
  "或": "or",
  "），同埋 Dashboard 嘅": "), and the dashboard's",
  "（用你嘅登入，或者已存嘅 dashboard session token）。新 profile 會出圓球。圓球顏色讀 profile.yaml 嘅": "(with your sign-in, or a saved dashboard session token). A new profile gets an orb. The orb colour comes from profile.yaml",
  "（或 dashboard 同欄位）；冇顏色先用預設色。下面個掣只係再匯入到呢個表，仍然要儲存。": "(or the same dashboard field); with no colour it uses the default. The button below only re-imports into this list; you still need to save.",
  "手動匯入用 Hermes dashboard 嘅": "Manual import uses the Hermes dashboard's",
  "（預設": "(default",
  "）。匯入只填名稱同描述。Dashboard 即使係 localhost 都要 session token，否則 401。Token 係 dashboard 頁面嘅": "). Import fills only names and descriptions. The dashboard needs a session token even on localhost, otherwise 401. The token is the dashboard page's",
  "，存喺鑰匙圈。": ", kept in the keyring.",
  // Built-in slash commands (slash.js); plugin commands keep Hermes' own text.
  "寫實作計劃，唔會即刻執行": "Write an implementation plan without running it",
  "開一條新 session": "Start a new session",
  "改呢條 session 嘅標題": "Rename this session",
  "由而家呢條分支出去": "Branch off from here",
  "停止呢次回覆": "Stop this reply",
  "睇或者切換模型": "View or switch the model",
  "列出可用指令": "List the available commands",
  "搜尋 arXiv 論文": "Search arXiv papers",
  "語音（已停用）": "Voice (off)",
  "其他": "Other",
  "等候中": "Waiting",
  "取消置頂": "Not on top",
  // Fallback words inside numbered strings (EN_PATTERNS)
  "一個指令": "a command",
  "一條問題": "a question",
  "呢個 bot": "This bot",
});

/** Whole strings with one number in them (R-LK-02 addendum, R-KB-10). Still whole-string:
 *  the pattern is anchored at both ends, so nothing inside a longer sentence changes. */
export const EN_PATTERNS = Object.freeze([
  Object.freeze([/^(\d+) 分鐘前$/, (n) => `${n} min ago`]),
  Object.freeze([/^看板通知（(\d+\+?) 個未讀）$/, (n) => `Kanban notifications (${n} unread)`]),
  Object.freeze([/^優先度 (-?\d+(?:\.\d+)?)：數字愈大，Hermes 愈早派$/, (n) => `Priority ${n}. Higher numbers are picked up first.`]),
  // Tool line (tools.js toolRunSummary / toolCallLine). Tool names stay as they are.
  Object.freeze([/^執行緊 ([\s\S]+)…$/, (name) => `Running ${name}…`]),
  Object.freeze([/^用咗 (\d+) 個工具 · ([\s\S]+)$/, (n, list) => `Used ${n} ${n === "1" ? "tool" : "tools"} · ${list}`]),
  Object.freeze([/^用咗 (\d+) 個工具$/, (n) => `Used ${n} ${n === "1" ? "tool" : "tools"}`]),
  Object.freeze([/^([\s\S]+?)  失敗$/, (name) => `${name}  failed`]),
  // Clarify card. The answer and the choice are the user's / Hermes' own words.
  Object.freeze([/^已答：([\s\S]+)$/, (answer) => `Answered: ${answer}`]),
  Object.freeze([/^仲有 (\d+) 秒$/, (n) => `${n}s left`]),
  Object.freeze([/^推薦 ([\s\S]+)$/, (choice) => `Recommended: ${choice}`]),
  // History notices (sessions.js historyNoticeCopy).
  Object.freeze([/^([\s\S]+?) 等緊你批准：([\s\S]+)$/, (who, what) => `${word(who)} is waiting for your approval: ${word(what)}`]),
  Object.freeze([/^([\s\S]+?) 等緊你答：([\s\S]+)$/, (who, what) => `${word(who)} is waiting for your answer: ${word(what)}`]),
  Object.freeze([/^呢度答唔到。大約 (\d+) 分鐘後逾時。$/, (n) => `Can't answer here. Times out in about ${n} min.`]),
  Object.freeze([/^呢度答唔到。逾時時間已過，等歷史更新。$/, () => "Can't answer here. The timeout has passed; waiting for the history to update."]),
  // Orb tooltips / aria-labels.
  Object.freeze([/^([\s\S]+)，有工具等緊批准$/, (name) => `${name}, a tool is waiting for approval`]),
  Object.freeze([/^([\s\S]+)，有問題等你答$/, (name) => `${name}, a question is waiting for your answer`]),
  Object.freeze([/^([\s\S]+)，已釘住$/, (name) => `${word(name)}, pinned`]),
  Object.freeze([/^仲有 (\d+) 個$/, (n) => `${n} more`]),
  Object.freeze([/^仲有 (\d+) 個子光球$/, (n) => `${n} more sub-orbs`]),
  Object.freeze([/^(\d+) 個子光球，揸住 Ctrl 展開$/, (n) => `${n} sub-orbs, hold Ctrl to expand`]),
  // Schedule panel.
  Object.freeze([/^(\d+) 個上次失敗$/, (n) => `${n} failed last run`]),
  Object.freeze([/^下次 ([\d:\- ]+)$/, (when) => `Next ${when}`]),
  Object.freeze([/^上次 ([\d:\- ]+)$/, (when) => `Last ${when}`]),
  Object.freeze([/^行緊 (\d+:\d\d)$/, (t) => `Running ${t}`]),
  Object.freeze([/^優先度：([\s\S]+)$/, (text) => `Priority: ${text}`]),
  // Bot panel hint (main.js hintText), with the modifier key name three times.
  Object.freeze([
    /^光球預設實色同穿透。游標行近先淡出；按住 (Ctrl|Alt|Shift)，游標下嗰粒返實色、可以點同右鍵隱藏。新訊息會由光球橫向展開成膠囊 5 秒，唔使按 \1 都睇到，但要按住先至點得。面板預設實色，可以拖同點；按住 \1 就變透明並穿透。$/,
    (key) => `Orbs are solid and let clicks through by default. They fade as the cursor gets close; hold ${key} and the orb under the cursor turns solid, clickable and right-click hides it. A new message unfolds from its orb as a capsule for 5 seconds; you can see it without ${key}, but hold it to click. Panels are solid by default and can be dragged and clicked; hold ${key} to make them see-through and let clicks through.`,
  ]),
  // Kanban move errors; the reason is the server's own text.
  Object.freeze([/^看板拒絕呢次移動：([\s\S]+)$/, (why) => `The board refused this move: ${why}`]),
  Object.freeze([/^看板更新失敗：([\s\S]+)$/, (why) => `Board update failed: ${why}`]),
  // Settings: dashboard import and missing API keys.
  Object.freeze([/^匯入 (\d+) 個 profile，然後儲存。$/, (n) => `Imported ${n} ${n === "1" ? "profile" : "profiles"}. Now save.`]),
  Object.freeze([/^([\s\S]+) 未有 API 金鑰，請喺設定填寫。金鑰唔會自動產生。$/, (names) => `${names.replaceAll("、", ", ")}: no API key yet. Add it in Settings. Keys are never generated for you.`]),
]);

/** A fallback word inside a pattern ("呢個 bot", "一個指令"); anything else is data and stays. */
function word(text) {
  return EN[text] || text;
}

/**
 * Overlay chrome inside a `NO_TRANSLATE` area. These nodes are still translated
 * whole-string, but only while no closer `NO_TRANSLATE` element (a `code`, a
 * `pre`, a `textarea`) sits between them and the text.
 */
export const UI_IN_DATA = [
  ".approval-heading",
  ".approval-actions button",
  ".approval-result",
  ".clarify-heading",
  ".clarify-countdown",
  ".clarify-other-label",
  ".clarify-actions button:not([data-choice])",
  ".clarify-actions button[data-choice=\"\"]",
  ".clarify-actions button.clarify-primary[data-choice]",
  ".clarify-actions .clarify-option:first-child",
  ".clarify-result",
  ".history-notice-title",
  ".history-notice-detail",
  ".tool-run-label",
  ".tool-call-line",
  ".tool-blocked",
  ".plan-chip",
  ".cmd-chip",
  ".unsent-mark",
  ".prompt-toggle",
  ".code-copy",
  ".kanban-detail-back",
].join(", ");

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
        hit = make(...m.slice(1));
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
  const data = el.closest?.(NO_TRANSLATE);
  if (!data) return false;
  // Chrome inside a data area: translated only if the nearest data element
  // holds the chrome node (so a `code` inside the chrome still stays as it is).
  const ui = el.closest?.(UI_IN_DATA);
  return !(ui && data.contains(ui));
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
    if (el.nodeType !== 1 || skipped(el)) return;
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

  /** Only the `UI_IN_DATA` chrome inside a data subtree. */
  function walkChrome(root) {
    const hits = root.matches?.(UI_IN_DATA) ? [root] : [];
    root.querySelectorAll?.(UI_IN_DATA).forEach((el) => hits.push(el));
    for (const el of hits) {
      attrs(el);
      const inner = doc.createTreeWalker(el, 0x1 | 0x4);
      let node = inner.nextNode();
      while (node) {
        if (node.nodeType === 3) textNode(node);
        else attrs(node);
        node = inner.nextNode();
      }
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
      if (skipped(root)) {
        walkChrome(root);
        return;
      }
      attrs(root);
    }
    const data = [];
    const walker = doc.createTreeWalker(root, 0x1 | 0x4, {
      acceptNode(node) {
        if (node.nodeType === 1 && node.matches?.(NO_TRANSLATE) && skipped(node)) {
          data.push(node);
          return 2; // reject subtree
        }
        return 1;
      },
    });
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === 3) textNode(node);
      else attrs(node);
      node = walker.nextNode();
    }
    data.forEach(walkChrome);
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
