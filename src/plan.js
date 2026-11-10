/** Detect a Hermes `/plan` reply and pull a title out of its markdown. */

/** Both separators. A missing slash before `.hermes` (`Workbench.hermes\plans\`) still matches. */
const PLAN_PATH = /\.hermes[\\/]plans[\\/]([^\s)]+?)\.md/;
const PLAN_MIN_CHARS = 200;

/** Shown when a path mention opens the panel but the write_file body is not in history. */
export const PLAN_FILE_MISSING_NOTE = "計劃檔內容唔在對話紀錄裡面。";

export function isHermesPlanPath(path) {
  return PLAN_PATH.test(String(path || ""));
}

function inChatPlanBody(text) {
  const body = String(text || "");
  return !!(unwrapPlan(body) || hasHeading(body) || /\*\*Goal:\*\*/i.test(body) || /implementation plan/i.test(body));
}

function planRecordFromFile(content, path) {
  const heading = String(content || "").match(/^#{1,3}\s+(.+)$/m);
  const title = heading
    ? heading[1].replace(/[*_`]/g, "").trim()
    : (planFileTitle(path) || planFileTitle(content) || "計劃");
  return {
    title,
    markdown: content,
    key: `${title}\n${content.length}\n${content.slice(0, 80)}\n${planTextHash(content)}`,
  };
}

function messagePlanFile(message) {
  const content = String(message?.plan?.content || "");
  if (!content) return null;
  const path = String(message.plan.path || "");
  if (path && !isHermesPlanPath(path)) return null;
  return { path, content };
}

function hasHeading(body) {
  return /^#{1,3}\s+\S/m.test(body);
}

function planFileTitle(body) {
  const match = String(body || "").match(PLAN_PATH);
  if (!match) return "";
  const file = match[1].split(/[\\/]/).pop() || "";
  return file.replace(/^\d{4}-\d{2}-\d{2}_\d+-/, "").trim();
}

function strictPlan(body) {
  if (/implementation plan/i.test(body) && hasHeading(body)) return true;
  if (PLAN_PATH.test(body) && (hasHeading(body) || body.length >= PLAN_MIN_CHARS)) return true;
  if (hasHeading(body) && /\*\*Goal:\*\*/i.test(body)) return true;
  return false;
}

/** Inner markdown of a ```markdown or ```plan fence that contains a heading. */
export function unwrapPlan(text) {
  const body = String(text || "");
  const re = /```(?:markdown|plan)[^\n]*\r?\n([\s\S]*?)```/gi;
  let match = re.exec(body);
  while (match) {
    const inner = match[1].trim();
    if (hasHeading(inner) || strictPlan(inner)) return inner;
    match = re.exec(body);
  }
  return "";
}

export function looksLikePlan(text) {
  const body = String(text || "").trim();
  if (!body) return false;
  if (unwrapPlan(body)) return true;
  return strictPlan(body);
}

/** Markdown to render. Fenced plans use the inside, not the fence. */
export function planSource(text) {
  const body = String(text || "").trim();
  return unwrapPlan(body) || body;
}

/**
 * A new plan key always becomes the open plan, even when an older plan is showing.
 * Returns whether the focus changed.
 */
export function noteNewestPlan(thread, plans) {
  const newest = plans?.length ? plans[plans.length - 1] : null;
  if (!thread || !newest || thread.seenPlanKey === newest.key) return false;
  thread.seenPlanKey = newest.key;
  thread.planDismissed = "";
  thread.planFocus = newest.key;
  return true;
}

export function planTitle(markdown) {
  const match = String(markdown || "").match(/^#{1,3}\s+(.+)$/m);
  const title = match ? match[1].replace(/[*_`]/g, "").trim() : "";
  return title || planFileTitle(markdown) || "計劃";
}

/** Header stays 「計劃」. The plan name is the first line of the body. */
export function planBodyLead(markdown, title) {
  const name = String(title || "").replace(/[*_`]/g, "").trim();
  const source = String(markdown || "");
  if (!name || name === "計劃") return source;
  const line = source.split(/\r?\n/).find((item) => item.trim()) || "";
  const shown = line.trim().replace(/^#{1,3}\s+/, "").replace(/[*_`]/g, "").trim();
  if (shown === name) return source;
  return `# ${name}\n\n${source}`;
}

/** Task text after `/plan`, or null when the message is not that command. */
export function planTask(text) {
  const match = String(text || "").trim().match(/^\/plan\b\s*(.*)$/i);
  if (!match) return null;
  return match[1].trim();
}

/** Composer modes. Empty is 「一般」. Debug and yolo are never modes. */
export const COMPOSE_GENERAL = "";
export const COMPOSE_PLAN = "plan";
export const COMPOSE_BTW = "btw";

const COMPOSE_ORDER = [COMPOSE_GENERAL, COMPOSE_PLAN, COMPOSE_BTW];

export function normalizeComposeMode(mode) {
  const value = String(mode || "").trim().toLowerCase();
  if (value === COMPOSE_PLAN) return COMPOSE_PLAN;
  if (value === COMPOSE_BTW) return COMPOSE_BTW;
  return COMPOSE_GENERAL;
}

export function composeModeLabel(mode) {
  const id = normalizeComposeMode(mode);
  if (id === COMPOSE_PLAN) return "Plan";
  if (id === COMPOSE_BTW) return "旁問";
  return "一般";
}

function commandToken(name) {
  return String(name || "").trim().replace(/^\//, "").toLowerCase();
}

/**
 * Which prefixed modes the gateway list offers.
 * A missing list (`exposed` false) keeps both. A listed command with enabled false is hidden.
 */
export function offeredComposeModes(commands, exposed) {
  if (!exposed) return { plan: true, btw: true };
  const names = new Set();
  for (const command of commands || []) {
    if (!command || command.enabled === false) continue;
    names.add(commandToken(command.name));
    for (const alias of command.aliases || []) names.add(commandToken(alias));
  }
  return { plan: names.has("plan"), btw: names.has("btw") };
}

export function effectiveComposeMode(mode, offered) {
  const id = normalizeComposeMode(mode);
  if (id === COMPOSE_PLAN && offered && offered.plan === false) return COMPOSE_GENERAL;
  if (id === COMPOSE_BTW && offered && offered.btw === false) return COMPOSE_GENERAL;
  return id;
}

/**
 * Per-panel compose mode for sub-orb panels (Shift+Tab bug, 2026-11-10).
 * A sub-orb panel starts from its bot's stored `compose_mode` the first time it is read,
 * then keeps its own value in memory. Changing one panel never changes another panel,
 * and a sub-orb change writes nothing to config.json (R-SO-09: no extra key).
 */
export function panelComposeModes() {
  const own = new Map();
  return {
    of(panelId, stored) {
      const key = String(panelId || "");
      if (!key) return normalizeComposeMode(stored);
      if (!own.has(key)) own.set(key, normalizeComposeMode(stored));
      return own.get(key);
    },
    set(panelId, mode) {
      const key = String(panelId || "");
      if (key) own.set(key, normalizeComposeMode(mode));
    },
    has(panelId) {
      return own.has(String(panelId || ""));
    },
  };
}

/** Most saved sub-orb modes per profile; matches SUBORB_MODE_CAP in config.rs. */
export const SUBORB_MODE_CAP = 32;

/**
 * The saved mode for one sub-orb session from settings `suborb_modes`
 * (`{ profile: [[session, mode], ...] }`), or null when nothing valid is saved.
 * "general" is a real choice (一般) and comes back as "".
 */
export function savedSuborbMode(saved, profile, sessionId) {
  const rows = saved && typeof saved === "object" ? saved[profile] : null;
  if (!Array.isArray(rows)) return null;
  let found = null;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 2 || row[0] !== sessionId) continue;
    const mode = row[1];
    if (mode === "general") found = COMPOSE_GENERAL;
    else if (mode === COMPOSE_PLAN || mode === COMPOSE_BTW) found = mode;
  }
  return found;
}

/** Wire value for set_suborb_mode: 一般 is sent as "general" so it is stored, not removed. */
export function suborbModeWire(mode) {
  const id = normalizeComposeMode(mode);
  return id || "general";
}

/** Shift+Tab and the chip advance through the modes the server still offers. */
export function nextComposeMode(mode, offered) {
  const visible = COMPOSE_ORDER.filter((id) => {
    if (id === COMPOSE_PLAN) return !offered || offered.plan !== false;
    if (id === COMPOSE_BTW) return !offered || offered.btw !== false;
    return true;
  });
  const current = effectiveComposeMode(mode, offered);
  const index = Math.max(0, visible.indexOf(current));
  return visible[(index + 1) % visible.length];
}

/**
 * Text the gateway should receive.
 * A line that already starts with `/` (including `/plan`, `/btw`, `/renew`, `/stop`) stays as typed.
 */
export function composeModeWire(text, mode) {
  const line = String(text ?? "").trim();
  const id = normalizeComposeMode(mode);
  if (!line || !id || line.startsWith("/")) return line;
  if (id === COMPOSE_PLAN) return `/plan ${line}`;
  if (id === COMPOSE_BTW) return `/btw ${line}`;
  return line;
}

/** Task text after `/btw`, or null when the message is not that command. */
export function sideQuestionTask(text) {
  const match = String(text || "").trim().match(/^\/btw\b\s*(.*)$/i);
  if (!match) return null;
  return match[1].trim();
}

/** `/btw` is a side question and goes out on its own, even while a turn is running. */
export function composeSkipsBusyQueue(text) {
  return sideQuestionTask(text) !== null;
}

/** Bubble copy. `command` stays `plan` or `btw` so plan linking still matches. */
export function composeBubble(text) {
  const line = String(text ?? "").trim();
  const task = planTask(line);
  if (task !== null) return { text: task, command: "plan" };
  const side = sideQuestionTask(line);
  if (side !== null) return { text: side, command: "btw" };
  return { text: line, command: "" };
}

/** Chip on a user bubble. Plan shows 「Plan」, a side question shows 「旁問」. */
export function planChipText(command) {
  if (command === "plan") return "Plan";
  if (command === "btw") return "旁問";
  return String(command || "");
}

export function planDemoMarkdown(task) {
  const name = String(task || "").trim() || "未命名任務";
  return [
    `# ${name} Implementation Plan`,
    "",
    "**Goal:** 先確認範圍，再拆步驟，唔會即刻執行。",
    "",
    "- 對齊現有面板",
    "- 計劃預覽同對話一齊留低",
    "",
    "檔案：`.hermes/plans/demo-plan.md`",
  ].join("\n");
}

/** FNV-1a of the whole plan, so a later edit with the same opening still refreshes. */
export function planTextHash(text) {
  let hash = 2166136261;
  const value = String(text || "");
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function planRecord(text) {
  return {
    title: planTitle(text),
    markdown: text,
    key: `${planTitle(text)}\n${text.length}\n${text.slice(0, 80)}\n${planTextHash(text)}`,
  };
}

/**
 * Every finished bot plan in order. A preceding user `/plan` counts when the
 * reply is long enough to be the plan body. Live bubbles are skipped.
 */
export function plansIn(messages) {
  const list = messages || [];
  const found = [];
  const used = new Set();

  let turnBots = [];
  let turnFile = null;
  const flushTurn = () => {
    if (turnFile && turnBots.length) {
      const index = turnBots[turnBots.length - 1];
      found.push({ ...planRecordFromFile(turnFile.content, turnFile.path), index, fromFile: true });
      used.add(index);
    }
    turnBots = [];
    turnFile = null;
  };
  for (let index = 0; index < list.length; index += 1) {
    const message = list[index];
    if (!message) continue;
    if (message.role === "user") {
      flushTurn();
      continue;
    }
    if (message.role !== "bot" || message.live) continue;
    turnBots.push(index);
    const file = messagePlanFile(message);
    if (file) turnFile = file;
  }
  flushTurn();

  for (let index = 0; index < list.length; index += 1) {
    if (used.has(index)) continue;
    const message = list[index];
    if (!message || message.role !== "bot" || message.live) continue;
    const text = String(message.text || "").trim();
    if (!text) continue;
    const previous = [...list.slice(0, index)].reverse().find((item) => item && item.role === "user");
    const fromCommand = previous?.command === "plan" && text.length >= 40;
    if (!looksLikePlan(text) && !fromCommand) continue;
    const markdown = looksLikePlan(text) ? planSource(text) : text;
    const record = planRecord(markdown);
    // A summary that only mentions the plan path, with no write_file body,
    // still opens; say the file is not in history. A pasted in-chat plan keeps its body.
    if (PLAN_PATH.test(text) && !inChatPlanBody(text)) {
      record.markdown = `${PLAN_FILE_MISSING_NOTE}\n\n${record.markdown}`;
    }
    found.push({ ...record, index });
  }
  found.sort((left, right) => left.index - right.index);
  return found;
}

/**
 * A finished /plan turn or a path mention whose file body is not on the
 * message yet. Live tool events do not carry write_file arguments.
 */
export function planNeedsFileCatchUp(messages) {
  const list = messages || [];
  if (plansIn(list).some((item) => item.fromFile)) return false;
  const lastUser = [...list].reverse().find((item) => item && item.role === "user");
  if (lastUser?.command === "plan") return true;
  return list.some((item) => item && item.role === "bot" && !item.live && PLAN_PATH.test(String(item.text || "")));
}

/** Newest bot reply that is a plan. */
export function latestPlan(messages) {
  const found = plansIn(messages);
  return found.length ? found[found.length - 1] : null;
}

/** Keep the newest plan for this bot so the next open can paint it before the fetch. */
export function rememberPlan(thread, messages) {
  const newest = latestPlan(messages);
  if (!thread || !newest) return null;
  thread.planCache = {
    key: newest.key,
    title: newest.title,
    markdown: newest.markdown,
  };
  return thread.planCache;
}

/**
 * Plan to show for this open. A loaded session with no plan stays closed.
 * Before that load, the cached plan is the one that can grow with the clip.
 */
export function planForPanel(thread) {
  if (!thread) return null;
  const plans = plansIn(thread.messages || []);
  const newest = plans.at(-1) || null;
  const focus = plans.find((item) => item.key === thread.planFocus) || newest;
  if (focus) return thread.planDismissed === focus.key ? null : focus;
  if (thread.loaded) return null;
  const cached = thread.planCache;
  if (!cached || thread.planDismissed === cached.key) return null;
  return cached;
}
