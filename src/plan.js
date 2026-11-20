/** Detect a Hermes `/plan` reply and pull a title out of its markdown. */

/** Both separators. A missing slash before `.hermes` (`Workbench.hermes\plans\`) still matches. */
const PLAN_PATH = /\.hermes[\\/]plans[\\/]([^\s)]+?)\.md/;
/** Only used by the sub-orb tail badge (tailSignals), never to open a plan. */
const PLAN_MIN_CHARS = 200;

export function isHermesPlanPath(path) {
  return PLAN_PATH.test(String(path || ""));
}

/** R-PL-10: the lower-case file stem that identifies a plan file, whatever the folder or slash. */
export function planRefBase(path) {
  const match = String(path || "").match(PLAN_PATH);
  if (!match) return "";
  return (match[1].split(/[\\/]/).pop() || "").toLowerCase();
}

/** The `.hermes/plans/<file>.md` form of a path (or "" when it is not one). */
function planRefRelative(path) {
  const match = String(path || "").match(PLAN_PATH);
  if (!match) return "";
  return `.hermes/plans/${match[1].split(/[\\/]/).pop()}.md`;
}

/**
 * R-PL-10 (Devon 2026-11-20 「有 .md 就可以看計劃」): the plan file a bot message
 * refers to, by its own write_file, any tool call on that path (patch, read...)
 * or the path in its text. Only shows the chip; it never opens a plan by itself.
 */
export function planRefFor(message) {
  if (!message || message.role !== "bot" || message.live) return null;
  const candidates = [String(message.plan?.path || ""), ...(Array.isArray(message.plan_refs) ? message.plan_refs : []), String(message.text || "")];
  for (const raw of candidates) {
    const base = planRefBase(raw);
    if (base) return { base, path: planRefRelative(raw) };
  }
  return null;
}

/** Newest write_file content known for this ref, or a notice record when the history has none. */
export function resolvePlanRef(messages, ref) {
  if (!ref) return null;
  const known = plansIn(messages).filter((item) => planRefBase(item.path) === ref.base);
  if (known.length) return { plan: known[known.length - 1], missing: null };
  const title = planFileTitle(ref.path) || "計劃";
  const markdown = `計劃檔內容唔在對話紀錄裡面。\n\n\`${ref.path}\``;
  return { plan: null, missing: { title, markdown, key: `ref:${ref.base}` } };
}

function planRecordFromFile(content, path) {
  const heading = String(content || "").match(/^#{1,3}\s+(.+)$/m);
  const title = heading
    ? heading[1].replace(/[*_`]/g, "").trim()
    : (planFileTitle(path) || planFileTitle(content) || "計劃");
  return {
    title,
    path: String(path || ""),
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

/** Text shape check for the sub-orb tail badge only. It never opens the plan window (R-PL-01). */
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
 * Plan view state for the session on screen (R-PL-01, SPEC §6.7). The main bot
 * thread switches sessions, so seen keys, dismiss and focus live per session id.
 * A sub-orb thread only ever holds one session, so it gets one entry.
 * A fresh thread with no session id yet hands its entry to the first real id.
 */
export function planView(thread) {
  if (!thread) return null;
  if (!(thread.planViews instanceof Map)) thread.planViews = new Map();
  const key = String(thread.sessionId || "");
  let view = thread.planViews.get(key);
  if (!view && key && thread.planViews.has("")) {
    view = thread.planViews.get("");
    thread.planViews.delete("");
    thread.planViews.set(key, view);
  }
  if (!view) {
    view = { based: false, seen: new Set(), focus: "", dismissed: "" };
    thread.planViews.set(key, view);
  }
  return view;
}

/** Read-only peek: no entry is created. */
function peekPlanView(thread) {
  if (!thread || !(thread.planViews instanceof Map)) return null;
  return thread.planViews.get(String(thread.sessionId || "")) || null;
}

/**
 * Note the plans on screen. The first loaded paint of a session only records
 * what is already there: history, a reopened panel, a session switch and a
 * restart never auto-open an older plan. After that, only a new same-turn
 * write_file plan in the latest turn becomes the open plan.
 * Returns whether the focus changed.
 */
export function notePlans(thread, messages = thread?.messages) {
  if (!thread) return false;
  const view = planView(thread);
  const plans = plansIn(messages || []);
  if (!view.based) {
    if (!thread.loaded) return false;
    view.based = true;
    for (const item of plans) view.seen.add(item.key);
    return false;
  }
  const fresh = latestTurnPlan(messages || []);
  let changed = false;
  for (const item of plans) {
    if (view.seen.has(item.key)) continue;
    view.seen.add(item.key);
    if (fresh && item.key === fresh.key) {
      view.focus = item.key;
      view.dismissed = "";
      changed = true;
    }
  }
  return changed;
}

/** Back-compat name used by older callers. */
export function noteNewestPlan(thread) {
  return notePlans(thread);
}

/** 「睇計劃」: open this plan for the session on screen. */
export function focusPlan(thread, key) {
  const view = planView(thread);
  if (!view) return;
  view.focus = String(key || "");
  view.dismissed = "";
  if (view.focus) view.seen.add(view.focus);
}

/** ×: close the open plan for this session only. */
export function dismissPlan(thread) {
  const view = planView(thread);
  if (!view) return;
  view.dismissed = view.focus || "closed";
  view.focus = "";
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

/**
 * Every finished bot plan in order. Only a same-turn write_file to
 * `.hermes/plans/*.md` with content counts (R-PL-01). Chat text never makes a plan:
 * headings, **Goal:**, a plan path, a fence or a `/plan` reply alone do not.
 * Live bubbles are skipped.
 */
export function plansIn(messages) {
  const list = messages || [];
  const found = [];
  let turnBots = [];
  let turnFile = null;
  const flushTurn = () => {
    if (turnFile && turnBots.length) {
      const index = turnBots[turnBots.length - 1];
      found.push({ ...planRecordFromFile(turnFile.content, turnFile.path), index, fromFile: true });
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
  return found;
}

/** The file plan of the latest turn, or null. */
export function latestTurnPlan(messages) {
  const list = messages || [];
  let start = 0;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (list[index] && list[index].role === "user") {
      start = index;
      break;
    }
  }
  const found = plansIn(list).filter((item) => item.index >= start);
  return found.length ? found[found.length - 1] : null;
}

/** Messages from the latest user turn through the end. No user row means the whole list. */
function latestTurn(messages) {
  const list = messages || [];
  let start = 0;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (list[index] && list[index].role === "user") {
      start = index;
      break;
    }
  }
  return list.slice(start);
}

/**
 * The latest turn still has no write_file body. Live tool events do not
 * carry write_file arguments. An older file plan does not cancel a later turn.
 */
export function planNeedsFileCatchUp(messages) {
  const turn = latestTurn(messages);
  if (plansIn(turn).some((item) => item.fromFile)) return false;
  const lastUser = [...turn].reverse().find((item) => item && item.role === "user");
  if (lastUser?.command === "plan") return true;
  return turn.some((item) => item && item.role === "bot" && !item.live && PLAN_PATH.test(String(item.text || "")));
}

/** A quiet reread brought the latest turn's plan file, which the panel does not have yet. */
export function planFileCaughtUp(local, incoming) {
  return planNeedsFileCatchUp(local) && !planNeedsFileCatchUp(incoming);
}

/** Newest bot reply that is a plan. */
export function latestPlan(messages) {
  const found = plansIn(messages);
  return found.length ? found[found.length - 1] : null;
}

/**
 * Keep the open plan for this session so the next open can paint it before the
 * fetch. Tagged with the session id: another session never shows it.
 */
export function rememberPlan(thread) {
  if (!thread) return null;
  const view = peekPlanView(thread);
  const plans = plansIn(thread.messages || []);
  const focus = view?.focus ? plans.find((item) => item.key === view.focus) : null;
  if (!focus || view.dismissed === focus.key) {
    if (thread.loaded) thread.planCache = null;
    return thread.planCache || null;
  }
  thread.planCache = {
    key: focus.key,
    title: focus.title,
    markdown: focus.markdown,
    sessionId: String(thread.sessionId || ""),
  };
  return thread.planCache;
}

/**
 * Plan to show for this open: the session's focused plan, unless dismissed.
 * Nothing opens by itself; notePlans or 「睇計劃」 sets the focus.
 * Before the session loads, only that same session's cached open plan can grow with the clip.
 */
export function planForPanel(thread) {
  if (!thread) return null;
  const view = peekPlanView(thread);
  if (!view || !view.focus || view.dismissed === view.focus) return null;
  const plans = plansIn(thread.messages || []);
  const focus = plans.find((item) => item.key === view.focus);
  if (focus) return focus;
  const missing = thread.refPlans instanceof Map ? thread.refPlans.get(view.focus) : null;
  if (missing) return missing;
  if (thread.loaded) return null;
  const cached = thread.planCache;
  if (!cached || cached.key !== view.focus) return null;
  if (String(cached.sessionId || "") !== String(thread.sessionId || "")) return null;
  return cached;
}
