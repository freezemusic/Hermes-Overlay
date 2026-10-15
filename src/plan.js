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

/**
 * Newest bot reply that is a plan. A preceding user `/plan` counts when the
 * reply is long enough to be the plan body. Live bubbles are skipped.
 */
export function latestPlan(messages) {
  const list = messages || [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const message = list[i];
    if (!message || message.role !== "bot" || message.live) continue;
    const text = String(message.text || "").trim();
    if (!text) continue;
    const previous = [...list.slice(0, i)].reverse().find((item) => item && item.role === "user");
    const fromCommand = previous?.command === "plan" && text.length >= 40;
    if (!looksLikePlan(text) && !fromCommand) continue;
    return {
      title: planTitle(text),
      markdown: text,
      key: `${planTitle(text)}\n${text.length}\n${text.slice(0, 80)}`,
    };
  }
  return null;
}
