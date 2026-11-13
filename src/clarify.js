import { historyNoticeSealed } from "./sessions.js";

/** Hand answers for Hermes clarify. The overlay never answers a card by itself. */

export const CLARIFY_HEADING = "要你答";
export const CLARIFY_RECOMMENDED = "推薦";
export const CLARIFY_SKIP = "跳過";
export const CLARIFY_SEND = "送出";
export const CLARIFY_OTHER = "其他（自己打）";
export const CLARIFY_STALE = "呢條問題已經過時";
export const CLARIFY_TIMEOUT = "時間到，個 bot 會自己繼續";
export const CLARIFY_WAIT_LABEL = "等你答";
export const CLARIFY_ANSWERED = "已答";
export const CLARIFY_SKIPPED = "已跳過";
export const CLARIFY_SEND_FAIL = "答案未送出。";
export const CLARIFY_NOT_DELIVERED = "呢句送唔到做答案。";
export const CLARIFY_TIMEOUT_S = 600;

export function clarifyPending(message) {
  return message?.role === "clarify" && (message.status === "pending" || message.status === "sending");
}

/** Pending work stays across a history reload. A stale card is closed and stays closed. */
export function clarifyKept(message) {
  return message?.role === "clarify" && ["pending", "sending", "timeout"].includes(message.status);
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
  if (message?.status === "answered") {
    const answer = String(message.postedAnswer ?? "").trim();
    return answer ? `${CLARIFY_ANSWERED}：${answer}` : CLARIFY_ANSWERED;
  }
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
      box.addEventListener("change", () => {
        onToggle(choice, box.checked);
        const live = Array.isArray(message.selected) ? message.selected : [];
        send.disabled = message.status !== "pending" || live.length === 0;
      });
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
      const live = Array.isArray(message.selected) ? message.selected : [];
      onAnswer(clarifyAnswerValue({ choices, multi: true, selected: live }));
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
  // Hermes always offers an "Other" free-text row when there are choices.
  if (open && choices.length > 0) {
    const label = doc.createElement("p");
    label.className = "clarify-other-label";
    label.textContent = CLARIFY_OTHER;
    actions.appendChild(label);
    const field = doc.createElement("textarea");
    field.className = "clarify-text clarify-other";
    field.value = message?.draft || "";
    field.disabled = message.status !== "pending";
    field.addEventListener("input", () => {
      onDraft(field.value);
      const sendOther = actions.querySelector(".clarify-other-send");
      if (sendOther) sendOther.disabled = message.status !== "pending" || !String(field.value || "").trim();
    });
    actions.appendChild(field);
    const sendOther = doc.createElement("button");
    sendOther.type = "button";
    sendOther.className = "clarify-primary clarify-other-send";
    sendOther.textContent = CLARIFY_SEND;
    sendOther.disabled = message.status !== "pending" || !String(message?.draft || "").trim();
    sendOther.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (sendOther.disabled) return;
      onAnswer(String(message.draft || "").trim());
    });
    actions.appendChild(sendOther);
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

/** Server request id for a batch clarify prompt (`srq-…~q0` → `srq-…`). */
export function clarifyRequestId(promptId) {
  const text = String(promptId || "");
  const at = text.indexOf("~");
  return at === -1 ? text : text.slice(0, at);
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
  // Keep every pending clarify card. A 9119 batch sends 1–5 questions in one
  // server request; each qid is its own card and every one must be locked.
  return out;
}

function noticePayload(message) {
  try {
    return JSON.parse(String(message?.text || ""));
  } catch {
    return {};
  }
}

function noticeIsWait(message) {
  return message?.role === "notice" && (message.tool_name === "clarify" || message.tool_name === "approval");
}

/** Clock from a history clarify notice, so a recovered card counts down from when Hermes asked. */
export function noticeClarifyClock(messages, nowMs = Date.now()) {
  for (const message of messages || []) {
    if (message?.role !== "notice" || message.tool_name !== "clarify") continue;
    const payload = noticePayload(message);
    const timeout = Number(payload.timeout_s);
    const asked = Number(payload.asked_at);
    const askedAt = asked > 1e12 ? asked : asked > 0 ? asked * 1000 : 0;
    return {
      timeout_s: Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : undefined,
      askedAt: askedAt || nowMs,
    };
  }
  return null;
}

/**
 * Snapshot cards replace a history notice of the same kind.
 * Empty controls leave the notice in place.
 */
export function absorbRecoveredControls(messages, controls, runId, options = {}) {
  const list = Array.isArray(controls) ? controls : [];
  const nowMs = options.now || Date.now();
  const clock = noticeClarifyClock(messages, nowMs);
  const stamped = list.map((item) => {
    if (item?.kind !== "clarify" || item.timeout_s != null || clock?.timeout_s == null) return item;
    return { ...item, timeout_s: clock.timeout_s };
  });
  const merged = mergePendingControls(messages, stamped, runId, {
    ...options,
    now: clock?.askedAt || nowMs,
  });
  const kinds = new Set(list.map((item) => item?.kind).filter((kind) => kind === "clarify" || kind === "approval"));
  const out = [];
  for (const message of merged) {
    if (kinds.size && noticeIsWait(message) && kinds.has(message.tool_name)) continue;
    if (message?.role === "clarify" && message.status === "pending") {
      const left = clarifySecondsLeft(message, nowMs);
      if (left != null && !Number.isInteger(message.remain)) message.remain = left;
    }
    out.push(message);
  }
  return out;
}

/** Composer routing while a clarify may be waiting. `recover` means try the live run first.
 *  A sealed notice is history: Desktop does not park a request on it, so Send is a normal message. */
export function clarifyComposerRoute(messages) {
  const live = (messages || []).find((message) => clarifyPending(message) && message.status === "pending");
  if (live) return { action: "answer", card: live };
  const recoverable = (messages || []).some((message) => (
    message?.role === "notice" && message.tool_name === "clarify" && !historyNoticeSealed(message)
  ));
  if (recoverable) return { action: "recover" };
  return { action: "send" };
}

/** Recovery said the run is gone. A notice that is still marked recover must not block Send. */
export function clarifyRouteAfterRecover(route, outcome) {
  if (route?.action === "answer") return route;
  if (outcome === "gone") return { action: "send" };
  return route || { action: "send" };
}
