/** Detect a Hermes `/plan` reply and pull a title out of its markdown. */

const PLAN_PATH = /\.hermes\/plans\/[^\s)]+\.md/;

function hasHeading(body) {
  return /^#{1,3}\s+\S/m.test(body);
}

function strictPlan(body) {
  if (/implementation plan/i.test(body) && hasHeading(body)) return true;
  if (PLAN_PATH.test(body) && hasHeading(body)) return true;
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
  return title || "計劃";
}

/** Task text after `/plan`, or null when the message is not that command. */
export function planTask(text) {
  const match = String(text || "").trim().match(/^\/plan\b\s*(.*)$/i);
  if (!match) return null;
  return match[1].trim();
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
