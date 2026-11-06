/** Hand approval. The overlay posts `once` or `deny` and does not enable automatic approval. */

export const EXECUTE_CODE_BLOCKED_LINE = "呢個 bot 想行 Python（execute_code），經 Overlay 唔允許，叫佢改用 terminal 指令";
export const APPROVAL_STALE = "呢個批准已經過時";
export const APPROVAL_APPROVED = "已批准";
export const APPROVAL_DENIED = "已拒絕";
export const APPROVAL_HEADING = "要你批准";
export const APPROVAL_WAIT_LABEL = "等緊批准";
export const APPROVE_ONCE_LABEL = "批准（一次）";
export const DENY_LABEL = "拒絕";

export function textIsExecuteCodeBlocked(text) {
  const value = String(text || "").toLowerCase();
  return value.includes("execute_code") && value.includes("blocked");
}

export function plainToolText(text) {
  const value = String(text ?? "");
  return textIsExecuteCodeBlocked(value) ? EXECUTE_CODE_BLOCKED_LINE : value;
}

function toolRunHasBlocked(message) {
  if (message?.role !== "tool-run") return false;
  let hit = false;
  for (const tool of message.tools || []) {
    const result = String(tool?.result || "");
    const label = String(tool?.label || "");
    const raw = textIsExecuteCodeBlocked(result)
      || textIsExecuteCodeBlocked(`${tool?.name || ""} ${label}`)
      || result === EXECUTE_CODE_BLOCKED_LINE;
    if (!raw) continue;
    tool.result = EXECUTE_CODE_BLOCKED_LINE;
    if (textIsExecuteCodeBlocked(label)) tool.label = "";
    hit = true;
  }
  return hit;
}

/** Keep the first exact blocked sentence. A later tool or bot bubble must not repeat it. */
export function omitRepeatedBlockedLine(messages) {
  let seen = false;
  const kept = [];
  for (const message of messages || []) {
    if (message?.role === "tool-run") {
      const hit = toolRunHasBlocked(message);
      if (hit && !seen) {
        message.blockedLine = true;
        seen = true;
      } else {
        message.blockedLine = false;
      }
      kept.push(message);
      continue;
    }
    if (message?.text === EXECUTE_CODE_BLOCKED_LINE) {
      if (seen) continue;
      seen = true;
    }
    kept.push(message);
  }
  return kept;
}

export function approvalPost(profile, runId, requestId, choice, executionGeneration) {
  if (choice !== "once" && choice !== "deny") return null;
  const body = { choice, request_id: requestId };
  if (Number.isInteger(executionGeneration)) body.execution_generation = executionGeneration;
  return {
    profile,
    runId,
    requestId,
    choice,
    executionGeneration: Number.isInteger(executionGeneration) ? executionGeneration : undefined,
    path: `/p/${profile}/v1/runs/${runId}/approval`,
    body,
  };
}

export function statusAfterResponded(choice) {
  const value = String(choice || "").trim();
  if (!value) return "";
  return value === "deny" ? "denied" : "approved";
}

export function approvalFailure(message) {
  const text = String(message || "");
  if (text.includes(APPROVAL_STALE)) return { status: "stale", notice: APPROVAL_STALE };
  return { status: "error", notice: "批准未送出。" };
}

export function showApprovalBadge(panelOpen, pending) {
  return !!pending && !panelOpen;
}

export function approvalPending(message) {
  return message?.role === "approval" && (message.status === "pending" || message.status === "sending");
}

export function approvalResultText(message) {
  if (message?.status === "denied") return APPROVAL_DENIED;
  if (message?.status === "stale") return APPROVAL_STALE;
  if (message?.status === "error") return message.notice || "批准未送出。";
  return APPROVAL_APPROVED;
}

export function renderApprovalCard(doc, message, onChoice) {
  const root = doc.createElement("div");
  root.className = "approval-card";
  const heading = doc.createElement("p");
  heading.className = "approval-heading";
  heading.textContent = APPROVAL_HEADING;
  root.appendChild(heading);
  const description = doc.createElement("p");
  description.className = "approval-description";
  description.textContent = message?.description || "";
  root.appendChild(description);
  if (message?.command) {
    const command = doc.createElement("pre");
    command.className = "approval-command";
    command.textContent = message.command;
    root.appendChild(command);
  }
  const actions = doc.createElement("div");
  actions.className = "approval-actions";
  if (message?.status === "pending" || message?.status === "sending") {
    for (const [choice, label] of [["once", APPROVE_ONCE_LABEL], ["deny", DENY_LABEL]]) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = choice === "once" ? "approval-primary" : "approval-secondary";
      button.dataset.choice = choice;
      button.textContent = label;
      button.disabled = message.status !== "pending";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (message.status !== "pending") return;
        onChoice(choice);
      });
      actions.appendChild(button);
    }
  } else {
    const result = doc.createElement("p");
    result.className = "approval-result";
    result.textContent = approvalResultText(message);
    actions.appendChild(result);
  }
  root.appendChild(actions);
  return root;
}
