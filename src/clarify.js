/** Hand answers for Hermes clarify. The overlay never answers a card by itself. */

export const CLARIFY_HEADING = "要你答";
export const CLARIFY_RECOMMENDED = "推薦";
export const CLARIFY_SKIP = "跳過";
export const CLARIFY_SEND = "送出";
export const CLARIFY_STALE = "呢條問題已經過時";
export const CLARIFY_TIMEOUT = "時間到，個 bot 會自己繼續";
export const CLARIFY_WAIT_LABEL = "等你答";
export const CLARIFY_ANSWERED = "已答";
export const CLARIFY_SKIPPED = "已跳過";
export const CLARIFY_SEND_FAIL = "答案未送出。";
export const CLARIFY_TIMEOUT_S = 600;

export function clarifyPending(message) {
  return message?.role === "clarify" && (message.status === "pending" || message.status === "sending");
}

export function clarifyKept(message) {
  return message?.role === "clarify" && ["pending", "sending", "timeout", "stale"].includes(message.status);
}

/** Omitted timeout uses the gateway default. Zero or negative means no countdown. */
export function clarifyBudget(message) {
  if (message?.timeoutS == null) return CLARIFY_TIMEOUT_S;
  const value = Number(message.timeoutS);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

export function clarifySecondsLeft(message, now) {
  const budget = clarifyBudget(message);
  if (budget == null) return null;
  const asked = Number(message?.askedAt) || now;
  return Math.max(0, budget - Math.floor((now - asked) / 1000));
}

/** Flip a pending card to timeout when the countdown hits zero. Does not post. */
export function clarifyTick(message, now) {
  if (!message || message.role !== "clarify" || message.status !== "pending") return message;
  const left = clarifySecondsLeft(message, now);
  if (left == null) return message;
  message.remain = left;
  if (left === 0) message.status = "timeout";
  return message;
}

export function clarifyAnswerValue({ choices, multi, selected, text, skip }) {
  if (skip) return "";
  const list = Array.isArray(choices) ? choices : [];
  if (list.length === 0) return String(text ?? "");
  if (multi) {
    const picked = Array.isArray(selected) ? selected : [];
    return JSON.stringify(list.filter((choice) => picked.includes(choice)));
  }
  return String(selected ?? "");
}

export function clarifyPost(profile, runId, promptId, executionGeneration, answer) {
  if (!Number.isInteger(executionGeneration)) return null;
  return {
    profile,
    runId,
    promptId,
    executionGeneration,
    path: `/p/${profile}/v1/runs/${runId}/clarify`,
    body: {
      request_id: promptId,
      execution_generation: executionGeneration,
      answer: String(answer ?? ""),
    },
  };
}

export function clarifyFailure(message) {
  const text = String(message || "");
  if (text.includes(CLARIFY_STALE)) return { status: "stale", notice: CLARIFY_STALE };
  return { status: "error", notice: CLARIFY_SEND_FAIL };
}

export function clarifyResultText(message) {
  if (message?.status === "stale") return CLARIFY_STALE;
  if (message?.status === "timeout") return CLARIFY_TIMEOUT;
  if (message?.status === "skipped") return CLARIFY_SKIPPED;
  if (message?.status === "error") return message.notice || CLARIFY_SEND_FAIL;
  if (message?.status === "answered") return CLARIFY_ANSWERED;
  return "";
}

function choiceLabel(choice, index) {
  if (index !== 0) return choice;
  return choice === CLARIFY_RECOMMENDED ? CLARIFY_RECOMMENDED : `${CLARIFY_RECOMMENDED} ${choice}`;
}

export function renderClarifyCard(doc, message, handlers) {
  const onAnswer = handlers?.onAnswer || (() => {});
  const onDraft = handlers?.onDraft || (() => {});
  const onToggle = handlers?.onToggle || (() => {});
  const root = doc.createElement("div");
  root.className = "clarify-card";
  const heading = doc.createElement("p");
  heading.className = "clarify-heading";
  heading.textContent = CLARIFY_HEADING;
  root.appendChild(heading);
  const question = doc.createElement("p");
  question.className = "clarify-question";
  question.textContent = message?.question || "";
  root.appendChild(question);
  const choices = Array.isArray(message?.choices) ? message.choices : [];
  const open = message?.status === "pending" || message?.status === "sending";
  if (open && clarifyBudget(message) != null) {
    const clock = doc.createElement("p");
    clock.className = "clarify-countdown";
    const remain = Number.isInteger(message.remain) ? message.remain : clarifyBudget(message);
    clock.textContent = `仲有 ${remain} 秒`;
    root.appendChild(clock);
  }
  const actions = doc.createElement("div");
  actions.className = "clarify-actions";
  if (open && choices.length === 0) {
    const field = doc.createElement("textarea");
    field.className = "clarify-text";
    field.value = message?.draft || "";
    field.disabled = message.status !== "pending";
    field.addEventListener("input", () => onDraft(field.value));
    actions.appendChild(field);
    const send = doc.createElement("button");
    send.type = "button";
    send.className = "clarify-primary";
    send.textContent = CLARIFY_SEND;
    send.disabled = message.status !== "pending" || !String(message?.draft || "").trim();
    send.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (send.disabled) return;
      onAnswer(clarifyAnswerValue({ choices, text: message.draft }));
    });
    actions.appendChild(send);
  } else if (open && message?.multiSelect) {
    const selected = Array.isArray(message.selected) ? message.selected : [];
    choices.forEach((choice, index) => {
      const label = doc.createElement("label");
      label.className = "clarify-option";
      const box = doc.createElement("input");
      box.type = "checkbox";
      box.dataset.choice = choice;
      box.checked = selected.includes(choice);
      box.disabled = message.status !== "pending";
      box.addEventListener("change", () => onToggle(choice, box.checked));
      label.appendChild(box);
      label.append(choiceLabel(choice, index));
      actions.appendChild(label);
    });
    const send = doc.createElement("button");
    send.type = "button";
    send.className = "clarify-primary";
    send.textContent = CLARIFY_SEND;
    send.disabled = message.status !== "pending" || selected.length === 0;
    send.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (send.disabled) return;
      onAnswer(clarifyAnswerValue({ choices, multi: true, selected }));
    });
    actions.appendChild(send);
  } else if (open) {
    choices.forEach((choice, index) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = index === 0 ? "clarify-primary" : "clarify-secondary";
      button.dataset.choice = choice;
      button.textContent = choiceLabel(choice, index);
      button.disabled = message.status !== "pending";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (button.disabled) return;
        onAnswer(choice);
      });
      actions.appendChild(button);
    });
  }
  if (open) {
    const skip = doc.createElement("button");
    skip.type = "button";
    skip.className = "clarify-secondary";
    skip.dataset.choice = "";
    skip.textContent = CLARIFY_SKIP;
    skip.disabled = message.status !== "pending";
    skip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (skip.disabled) return;
      onAnswer("");
    });
    actions.appendChild(skip);
  }
  const result = clarifyResultText(message);
  if (!open && result) {
    const line = doc.createElement("p");
    line.className = message.status === "timeout" ? "clarify-result clarify-timeout" : "clarify-result";
    line.textContent = result;
    actions.appendChild(line);
  }
  root.appendChild(actions);
  return root;
}

export function controlPromptId(item) {
  return String(item?.prompt_id || item?.request_id || "");
}

export function clarifyCardFromControl(item, runId, now) {
  const timeoutS = Number.isInteger(item?.timeout_s) ? item.timeout_s : item?.timeout_s == null ? undefined : Number(item.timeout_s);
  return {
    role: "clarify",
    runId: runId || item?.run_id || "",
    promptId: controlPromptId(item),
    question: item?.question || "",
    choices: Array.isArray(item?.choices) ? item.choices.map((choice) => String(choice)) : [],
    multiSelect: !!item?.multi_select,
    executionGeneration: Number.isInteger(item?.execution_generation) ? item.execution_generation : undefined,
    timeoutS,
    askedAt: now,
    status: "pending",
    draft: "",
    selected: [],
  };
}

export function approvalCardFromControl(item, runId) {
  return {
    role: "approval",
    runId: runId || item?.run_id || "",
    requestId: controlPromptId(item),
    description: item?.description || "",
    command: item?.command || "",
    executionGeneration: Number.isInteger(item?.execution_generation) ? item.execution_generation : undefined,
    status: "pending",
  };
}

/**
 * Put snapshot cards back after a dropped stream or a reopened panel.
 * `dropMissing` is only for a live run (`started` / `running` / `waiting_for_approval`).
 */
export function mergePendingControls(messages, controls, runId, { dropMissing = false, now = 0 } = {}) {
  const list = Array.isArray(controls) ? controls : [];
  const prompts = new Set(list.map(controlPromptId).filter(Boolean));
  const out = [];
  for (const message of messages || []) {
    if (dropMissing && message?.status === "pending") {
      const id = message.role === "clarify" ? message.promptId : message.role === "approval" ? message.requestId : "";
      if (id && (message.role === "clarify" || message.role === "approval") && !prompts.has(id)) continue;
    }
    out.push(message);
  }
  for (const item of list) {
    const kind = item?.kind;
    const promptId = controlPromptId(item);
    if (!promptId) continue;
    if (kind === "clarify") {
      if (out.some((message) => message.role === "clarify" && message.promptId === promptId)) continue;
      out.push(clarifyCardFromControl(item, runId, now));
    } else if (kind === "approval") {
      if (out.some((message) => message.role === "approval" && message.requestId === promptId)) continue;
      out.push(approvalCardFromControl(item, runId));
    }
  }
  let seenPending = false;
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const message = out[i];
    if (message.role !== "clarify" || !clarifyPending(message)) continue;
    if (seenPending) out.splice(i, 1);
    else seenPending = true;
  }
  return out;
}
