/** Detect a Hermes `/plan` reply and pull a title out of its markdown. */

/** Both separators. A missing slash before `.hermes` (`Workbench.hermes\plans\`) still matches. */
const PLAN_PATH = /\.hermes[\\/]plans[\\/]([^\s)]+?)\.md/;
const PLAN_MIN_CHARS = 200;

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

function planRecord(text) {
  return {
    title: planTitle(text),
    markdown: text,
    key: `${planTitle(text)}\n${text.length}\n${text.slice(0, 80)}`,
  };
}

/**
 * Every finished bot plan in order. A preceding user `/plan` counts when the
 * reply is long enough to be the plan body. Live bubbles are skipped.
 */
export function plansIn(messages) {
  const list = messages || [];
  const found = [];
  for (let index = 0; index < list.length; index += 1) {
    const message = list[index];
    if (!message || message.role !== "bot" || message.live) continue;
    const text = String(message.text || "").trim();
    if (!text) continue;
    const previous = [...list.slice(0, index)].reverse().find((item) => item && item.role === "user");
    const fromCommand = previous?.command === "plan" && text.length >= 40;
    if (!looksLikePlan(text) && !fromCommand) continue;
    const markdown = looksLikePlan(text) ? planSource(text) : text;
    found.push({ ...planRecord(markdown), index });
  }
  return found;
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
