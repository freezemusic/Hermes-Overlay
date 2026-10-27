/** Consecutive tool events collapse into one chat row. Result bodies stay out of the main flow. */

import {
  EXECUTE_CODE_BLOCKED_LINE,
  omitRepeatedBlockedLine,
  plainToolText,
  textIsExecuteCodeBlocked,
} from "./approval.js";

export const TOOL_LINE_MAX = 120;

export function oneLine(text, max = TOOL_LINE_MAX) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  if (!flat) return "";
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

export function toolRunSummary(run) {
  const tools = run?.tools || [];
  if (run?.running) {
    const current = [...tools].reverse().find((tool) => tool.status === "running") || tools[tools.length - 1];
    return `執行緊 ${current?.name || "tool"}…`;
  }
  const counts = new Map();
  const order = [];
  for (const tool of tools) {
    const name = tool?.name || "tool";
    if (!counts.has(name)) order.push(name);
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const listed = order.map((name) => {
    const count = counts.get(name);
    return count > 1 ? `${name} ×${count}` : name;
  }).join(", ");
  const n = tools.length;
  return listed ? `用咗 ${n} 個工具 · ${listed}` : `用咗 ${n} 個工具`;
}

export function toolCallLine(tool) {
  const name = tool?.name || "tool";
  const label = oneLine(tool?.label || "");
  if (label) return `${name}  ${label}`;
  if (tool?.status === "failed") return `${name}  失敗`;
  return name;
}

export function toolRunDomSig(run) {
  const tools = run?.tools || [];
  const body = tools.map((tool) => {
    const result = String(tool?.result || "");
    return [
      tool?.name || "",
      tool?.label || "",
      tool?.status || "",
      tool?.openResult ? 1 : 0,
      result.length,
      result.slice(-12),
    ].join(":");
  }).join("|");
  return [
    toolRunSummary(run),
    run?.open ? 1 : 0,
    run?.blockedLine ? 1 : 0,
    run?.running ? 1 : 0,
    body,
  ].join("~");
}

function blankRun(detail) {
  return {
    role: "tool-run",
    text: "",
    tools: [],
    running: false,
    open: !!detail,
    blockedLine: false,
  };
}

function copyTool(tool) {
  return {
    name: tool?.name || "tool",
    label: oneLine(tool?.label || ""),
    result: String(tool?.result || ""),
    status: tool?.status || "done",
    openResult: !!tool?.openResult,
  };
}

function seal(run) {
  run.running = (run.tools || []).some((tool) => tool.status === "running");
  run.text = toolRunSummary(run);
  return run;
}

function blockedPreview(name, preview) {
  const raw = String(preview || "");
  return raw === EXECUTE_CODE_BLOCKED_LINE || textIsExecuteCodeBlocked(`${name} ${raw}`);
}

function pushHistoryTool(run, message) {
  const name = message?.name || message?.tool_name || "tool";
  const result = plainToolText(message?.text || "");
  run.tools.push({
    name,
    label: "",
    result,
    status: "done",
    openResult: false,
  });
  run.running = false;
}

/** Group consecutive tool rows that sit between text, cards, and errors. */
export function foldToolRuns(messages, options = {}) {
  const detail = !!options.detail;
  const out = [];
  let run = null;
  const flush = () => {
    if (!run) return;
    out.push(seal(run));
    run = null;
  };
  for (const message of messages || []) {
    if (!message) continue;
    if (message.role === "tool-run") {
      if (!run) {
        run = blankRun(detail);
        run.open = typeof message.open === "boolean" ? message.open : !!detail;
        run.tools = (message.tools || []).map(copyTool);
        run.running = !!message.running;
      } else {
        for (const tool of message.tools || []) run.tools.push(copyTool(tool));
        run.running = run.running || !!message.running;
      }
      continue;
    }
    if (message.role === "tool") {
      if (!run) run = blankRun(detail);
      pushHistoryTool(run, message);
      continue;
    }
    flush();
    out.push(message);
  }
  flush();
  return omitRepeatedBlockedLine(out);
}

/**
 * Fold one live tool event into the trailing run.
 * A start/progress/finish updates that run in place until a text message lands.
 */
export function absorbToolEvent(messages, event, options = {}) {
  const list = messages || [];
  const name = String(event?.name || "tool").trim() || "tool";
  const phase = event?.phase || "started";
  const blocked = blockedPreview(name, event?.preview);
  const preview = blocked ? EXECUTE_CODE_BLOCKED_LINE : String(event?.preview || "");
  let run = list[list.length - 1];
  let created = false;
  if (!run || run.role !== "tool-run") {
    run = blankRun(!!options.detail);
    list.push(run);
    created = true;
  }
  if (phase === "progress") {
    const current = [...run.tools].reverse().find((tool) => tool.status === "running" && tool.name === name)
      || [...run.tools].reverse().find((tool) => tool.status === "running");
    if (current && !blocked && preview) current.label = oneLine(preview);
    else if (!current) {
      run.tools.push({
        name,
        label: blocked ? "" : oneLine(preview),
        result: blocked ? EXECUTE_CODE_BLOCKED_LINE : "",
        status: "running",
        openResult: false,
      });
    }
    run.running = true;
  } else if (phase === "completed" || phase === "failed") {
    const status = phase === "failed" ? "failed" : "done";
    const match = run.tools.find((tool) => tool.status === "running" && tool.name === name);
    if (match) {
      match.status = status;
      if (blocked) {
        match.result = EXECUTE_CODE_BLOCKED_LINE;
        match.label = "";
      } else if (preview && preview !== match.label) {
        match.result = preview;
      }
    } else {
      run.tools.push({
        name,
        label: "",
        result: blocked ? EXECUTE_CODE_BLOCKED_LINE : preview,
        status,
        openResult: false,
      });
    }
    run.running = run.tools.some((tool) => tool.status === "running");
  } else {
    run.tools.push({
      name,
      label: blocked ? "" : oneLine(preview),
      result: blocked ? EXECUTE_CODE_BLOCKED_LINE : "",
      status: "running",
      openResult: false,
    });
    run.running = true;
  }
  seal(run);
  const settled = omitRepeatedBlockedLine(list);
  if (settled.length !== list.length || settled.some((item, index) => item !== list[index])) {
    list.splice(0, list.length, ...settled);
  }
  return { run, created };
}

function chevronEl(doc) {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "tool-chevron");
  svg.setAttribute("width", "10");
  svg.setAttribute("height", "10");
  svg.setAttribute("viewBox", "0 0 10 10");
  svg.setAttribute("aria-hidden", "true");
  const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M3.2 1.8 L7 5 L3.2 8.2");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}

/** Paint one compact row. Result text is added only after the second expand. */
export function paintToolRun(bubble, run, hooks = {}) {
  const doc = bubble.ownerDocument;
  const sig = toolRunDomSig(run);
  bubble.className = `bubble tool-run${run?.open ? " is-open" : ""}`;
  if (run?.running) bubble.dataset.running = "1";
  else delete bubble.dataset.running;
  if (bubble.dataset.toolSig === sig && bubble.querySelector(".tool-run-toggle")) return bubble;
  bubble.dataset.toolSig = sig;
  bubble.replaceChildren();

  const toggle = doc.createElement("button");
  toggle.type = "button";
  toggle.className = "tool-run-toggle";
  toggle.setAttribute("aria-expanded", run?.open ? "true" : "false");
  const label = doc.createElement("span");
  label.className = "tool-run-label";
  label.textContent = toolRunSummary(run);
  toggle.append(chevronEl(doc), label);
  toggle.addEventListener("click", () => {
    run.open = !run.open;
    paintToolRun(bubble, run, hooks);
    hooks.onChange?.(run);
  });
  bubble.appendChild(toggle);

  if (!run?.open) {
    if (run?.blockedLine) {
      const note = doc.createElement("p");
      note.className = "tool-blocked";
      note.textContent = EXECUTE_CODE_BLOCKED_LINE;
      bubble.appendChild(note);
    }
    return bubble;
  }

  const body = doc.createElement("div");
  body.className = "tool-run-body";
  (run?.tools || []).forEach((tool, index) => {
    const row = doc.createElement("div");
    row.className = `tool-call${tool.openResult ? " is-open" : ""}`;
    const line = doc.createElement("span");
    line.className = "tool-call-line";
    line.textContent = toolCallLine(tool);
    const hasResult = !!String(tool.result || "").trim();
    if (hasResult) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "tool-call-toggle";
      button.setAttribute("aria-expanded", tool.openResult ? "true" : "false");
      button.append(chevronEl(doc), line);
      button.addEventListener("click", () => {
        const current = run.tools[index];
        if (!current) return;
        current.openResult = !current.openResult;
        paintToolRun(bubble, run, hooks);
        hooks.onChange?.(run);
      });
      row.appendChild(button);
      if (tool.openResult) {
        const pre = doc.createElement("pre");
        pre.className = "tool-result";
        pre.textContent = tool.result;
        row.appendChild(pre);
      }
    } else {
      row.appendChild(line);
    }
    body.appendChild(row);
  });
  bubble.appendChild(body);

  if (run?.blockedLine) {
    const note = doc.createElement("p");
    note.className = "tool-blocked";
    note.textContent = EXECUTE_CODE_BLOCKED_LINE;
    bubble.appendChild(note);
  }
  return bubble;
}
