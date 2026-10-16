/** Detect a Hermes `/plan` reply and pull a title out of its markdown. */

const PLAN_PATH = /\.hermes\/plans\/[^\s)]+\.md/;

export function looksLikePlan(text) {
  const body = String(text || "").trim();
  if (!body) return false;
  const hasHeading = /^#{1,3}\s+\S/m.test(body);
  if (/implementation plan/i.test(body) && hasHeading) return true;
  if (PLAN_PATH.test(body) && hasHeading) return true;
  if (hasHeading && /\*\*Goal:\*\*/i.test(body)) return true;
  return false;
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
    found.push({ ...planRecord(text), index });
  }
  return found;
}

/** Newest bot reply that is a plan. */
export function latestPlan(messages) {
  const found = plansIn(messages);
  return found.length ? found[found.length - 1] : null;
}
