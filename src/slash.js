/** Slash-menu filtering, history markers, and gateway retry delays. */

export const PLUGIN_HINT = "未裝 overlay-slash，/ 選單唔會出現。";

export const PREVIEW_COMMANDS = [
  {
    name: "/plan",
    kind: "prompt",
    category: "Session",
    description: "寫實作計劃，唔會即刻執行",
    args_hint: "[task]",
    aliases: [],
    enabled: true,
  },
  {
    name: "/new",
    kind: "client",
    category: "Session",
    description: "開一條新 session",
    args_hint: "[name]",
    aliases: ["/reset"],
    enabled: true,
    maps_to: "POST /api/sessions",
  },
  {
    name: "/title",
    kind: "client",
    category: "Session",
    description: "改呢條 session 嘅標題",
    args_hint: "[name]",
    aliases: [],
    enabled: true,
    maps_to: "PATCH /api/sessions/{id}",
  },
  {
    name: "/branch",
    kind: "client",
    category: "Session",
    description: "由而家呢條分支出去",
    args_hint: "[name]",
    aliases: ["/fork"],
    enabled: true,
    maps_to: "POST /api/sessions/{id}/fork",
  },
  {
    name: "/stop",
    kind: "client",
    category: "Session",
    description: "停止呢次回覆",
    args_hint: "",
    aliases: [],
    enabled: true,
    maps_to: "overlay stop",
  },
  {
    name: "/model",
    kind: "client",
    category: "Configuration",
    description: "睇或者切換模型",
    args_hint: "[model]",
    aliases: [],
    enabled: true,
    maps_to: "POST /api/sessions/{id}/model",
  },
  {
    name: "/help",
    kind: "reply",
    category: "Info",
    description: "列出可用指令",
    args_hint: "[filter]",
    aliases: [],
    enabled: true,
  },
  {
    name: "/arxiv",
    kind: "skill",
    category: "research",
    description: "搜尋 arXiv 論文",
    args_hint: "[instruction]",
    aliases: [],
    enabled: true,
  },
  {
    name: "/voice",
    kind: "plugin",
    category: "Plugin commands",
    description: "語音（已停用）",
    args_hint: "",
    aliases: [],
    enabled: false,
  },
];

const CLIENT_CANONICAL = {
  new: "new",
  reset: "new",
  title: "title",
  branch: "branch",
  fork: "branch",
  model: "model",
  stop: "stop",
};

const CLIENT_MAPS = {
  new: "POST /api/sessions",
  title: "PATCH /api/sessions/{id}",
  branch: "POST /api/sessions/{id}/fork",
  model: "POST /api/sessions/{id}/model",
  stop: "overlay stop",
};

export function reconnectDelayMs(attempt) {
  const step = Math.max(0, attempt | 0);
  return Math.min(30_000, 1000 * 2 ** step);
}

export function gatewayDown(message) {
  const text = String(message || "");
  return (
    text.includes("連唔到 Hermes gateway") ||
    text.includes("Hermes gateway 逾時") ||
    text.includes("同 Hermes gateway 嘅連線中斷")
  );
}

export function slashFilterQuery(value) {
  const text = String(value ?? "");
  if (!text.startsWith("/") || text.startsWith("//")) return null;
  if (/\s/.test(text)) return null;
  return text.slice(1);
}

function bare(name) {
  return String(name || "").replace(/^\//, "").toLowerCase();
}

function fuzzy(name, query) {
  let index = 0;
  for (const ch of name) {
    if (ch === query[index]) index += 1;
    if (index === query.length) return true;
  }
  return false;
}

function namesOf(command) {
  return [command.name, ...(command.aliases || [])].map(bare).filter(Boolean);
}

export function filterCommands(commands, query) {
  const q = bare(query);
  return (commands || []).filter((command) => {
    if (!q) return true;
    const names = namesOf(command);
    if (names.some((name) => name.startsWith(q) || fuzzy(name, q))) return true;
    return String(command.description || "").toLowerCase().includes(q);
  });
}

export function moveSlashIndex(items, index, key) {
  const enabled = [];
  (items || []).forEach((item, i) => {
    if (item.enabled !== false) enabled.push(i);
  });
  if (!enabled.length) return -1;
  let pos = enabled.indexOf(index);
  if (pos < 0) pos = 0;
  if (key === "ArrowDown") pos = (pos + 1) % enabled.length;
  if (key === "ArrowUp") pos = (pos - 1 + enabled.length) % enabled.length;
  return enabled[pos];
}

export function completionText(command) {
  const name = String(command?.name || "");
  const slash = name.startsWith("/") ? name : `/${name}`;
  return `${slash} `;
}

export function parseSlashInput(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  const body = trimmed.slice(1);
  const space = body.search(/\s/);
  const name = (space === -1 ? body : body.slice(0, space)).trim();
  const args = space === -1 ? "" : body.slice(space + 1).trim();
  if (!name || name.includes("/")) return null;
  return { name: name.toLowerCase(), args, raw: trimmed };
}

function findCommand(commands, name) {
  const token = bare(name);
  return (commands || []).find((command) => namesOf(command).includes(token)) || null;
}

export function resolveClient(text, commands) {
  const parsed = parseSlashInput(text);
  if (!parsed) return null;
  const listed = commands && commands.length ? findCommand(commands, parsed.name) : null;
  if (listed) {
    if (listed.kind !== "client" || listed.enabled === false) return null;
    const command = CLIENT_CANONICAL[bare(listed.name)] || bare(listed.name);
    return {
      command,
      args: parsed.args,
      mapsTo: listed.maps_to || CLIENT_MAPS[command] || "",
    };
  }
  const command = CLIENT_CANONICAL[parsed.name];
  if (!command) return null;
  if (commands && commands.length) return null;
  return { command, args: parsed.args, mapsTo: CLIENT_MAPS[command] || "" };
}

export function modelFields(args) {
  const parts = String(args || "").trim().split(/\s+/).filter(Boolean);
  let provider = "";
  const tokens = [];
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i] === "--provider" && parts[i + 1]) {
      provider = parts[i + 1];
      i += 1;
      continue;
    }
    if (parts[i].startsWith("--")) continue;
    tokens.push(parts[i]);
  }
  return { model: tokens.join(" "), provider };
}

const MARKER_RE = /^<!--\s*overlay-slash:\s*(\{[\s\S]*\})\s*-->$/;

/** History chip text. The marker stores the command name or skill slug (`arxiv+pdf`), not the `skill:` header. */
export function markerChip(command) {
  return String(command || "").slice(0, 80);
}

export function parseSlashMarker(text) {
  const raw = String(text ?? "");
  const nl = raw.indexOf("\n");
  const first = (nl === -1 ? raw : raw.slice(0, nl)).trim();
  const match = first.match(MARKER_RE);
  if (!match) return null;
  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (!data || typeof data.display !== "string") return null;
  return {
    display: data.display,
    command: markerChip(typeof data.command === "string" ? data.command : ""),
    rest: nl === -1 ? "" : raw.slice(nl + 1),
  };
}
