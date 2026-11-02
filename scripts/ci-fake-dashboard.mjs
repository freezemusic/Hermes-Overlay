// Fake Hermes Dashboard (`hermes serve`, 0.22.5) for scripts/windows-clickthrough.ps1.
// Serves only what HermesClient calls at startup and when the field panel opens:
//   REST  GET /api/health, /api/profiles, /api/sessions, /api/sessions/{id}/messages,
//         /api/cron/jobs; POST /api/auth/ws-ticket
//   WS    /api/ws?ticket=… (JSON-RPC 2.0): gateway.ready, then client.capabilities,
//         ping, session.list, session.resume, complete.slash.
// No login (an open loopback dashboard). Everything else answers 404 / RPC 4004.
// Each request is logged as one line ("GET /api/sessions", "RPC session.resume")
// so the harness can assert what the app did. No dependencies: plain node:http
// plus a minimal RFC 6455 text-frame server.
//
// Usage: node scripts/ci-fake-dashboard.mjs <port> <logfile>
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";

const port = Number(process.argv[2] || 9119);
const logFile = process.argv[3] || "hermes-fake-dashboard.log";
const log = (line) => appendFileSync(logFile, `${line}\n`);

// Same transcript the 8642 fake served: a /plan turn whose reply is a plan,
// so the field panel hosts the plan window (plan-close-at / plan-chip-at).
const PLAN_MESSAGES = [
  { id: 1, role: "user", content: "/plan ship", timestamp: 1 },
  {
    id: 2,
    role: "assistant",
    content:
      "# Ship Implementation Plan\n\n**Goal:** keep click-through honest.\n\n- leave the plan rect\n- reopen from the chip\n\nFile: `.hermes/plans/ship.md`",
    timestamp: 2,
  },
];
// Same three rows as the 8642 fake. `bot-chat` is the Bot Chat the panel opens.
const SESSIONS = [
  { id: "bot-chat", title: "Bot Chat", source: "api_server", last_active: 40, started_at: 1 },
  { id: "saved-field", title: "notes", source: "api_server", last_active: 10, started_at: 1 },
  { id: "newest", title: "System Architect", source: "api_server", last_active: 900, started_at: 1 },
];

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const path = url.pathname;
  log(`${req.method} ${path}`);
  req.resume();
  if (req.method === "GET" && path === "/api/health") {
    return send(res, 200, { status: "ok", version: "0.22.5", displayVersion: "0.22.5 (ci fake)" });
  }
  if (req.method === "POST" && path === "/api/auth/ws-ticket") {
    return send(res, 200, { ticket: "ci-ticket", expires_in: 30 });
  }
  if (req.method === "GET" && path === "/api/profiles") {
    return send(res, 200, { profiles: [{ name: "field", is_default: false }] });
  }
  if (req.method === "GET" && path === "/api/cron/jobs") {
    return send(res, 200, { jobs: [] });
  }
  if (req.method === "GET" && path === "/api/sessions") {
    return send(res, 200, { sessions: SESSIONS, total: SESSIONS.length, limit: 100, offset: 0 });
  }
  const messages = path.match(/^\/api\/sessions\/([^/]+)\/messages$/);
  if (req.method === "GET" && messages) {
    const offset = Number(url.searchParams.get("offset") || 0);
    const rows = offset > 0 ? [] : PLAN_MESSAGES;
    return send(res, 200, {
      session_id: decodeURIComponent(messages[1]),
      messages: rows,
      pagination: { offset, limit: 500, returned: rows.length, total: PLAN_MESSAGES.length, has_more: false },
    });
  }
  return send(res, 404, { detail: "Not Found" });
});

// ---- WebSocket (RFC 6455, text frames only) ---------------------------------
function frame(text) {
  const data = Buffer.from(text, "utf8");
  let head;
  if (data.length < 126) {
    head = Buffer.from([0x81, data.length]);
  } else if (data.length < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x81;
    head[1] = 126;
    head.writeUInt16BE(data.length, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x81;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(data.length), 2);
  }
  return Buffer.concat([head, data]);
}

function control(opcode, payload = Buffer.alloc(0)) {
  return Buffer.concat([Buffer.from([0x80 | opcode, payload.length]), payload]);
}

function rpc(method, params) {
  switch (method) {
    case "client.capabilities":
      return { ok: true };
    case "ping":
      return { pong: true };
    case "session.list":
      return { sessions: [] };
    case "session.resume": {
      const stored = String(params?.session_id || "");
      return { session_id: `live-${stored}`, stored_session_id: stored, message_count: PLAN_MESSAGES.length };
    }
    case "complete.slash":
      return {
        items: [
          { text: "new", display: "/new", meta: "Start a new session (usage: /new [name])", kind: "command" },
          { text: "plan", display: "/plan", meta: "Plan first", kind: "command" },
        ],
      };
    default:
      return undefined;
  }
}

server.on("upgrade", (req, socket) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const key = req.headers["sec-websocket-key"];
  if (url.pathname !== "/api/ws" || !url.searchParams.get("ticket") || !key) {
    log(`WS refused ${url.pathname}`);
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return;
  }
  const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  log("WS open");
  socket.write(frame(JSON.stringify({ jsonrpc: "2.0", method: "event", params: { type: "gateway.ready", payload: {} } })));
  let buf = Buffer.alloc(0);
  let parts = [];
  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let at = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        at = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        at = 10;
      }
      const maskAt = at;
      if (masked) at += 4;
      if (buf.length < at + len) return;
      const payload = Buffer.from(buf.subarray(at, at + len));
      if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= buf[maskAt + (i % 4)];
      buf = buf.subarray(at + len);
      if (opcode === 0x8) {
        log("WS close");
        socket.end(control(0x8));
        return;
      }
      if (opcode === 0x9) {
        socket.write(control(0xa, payload));
        continue;
      }
      if (opcode === 0x1 || opcode === 0x0) {
        parts.push(payload);
        if (!fin) continue;
        const text = Buffer.concat(parts).toString("utf8");
        parts = [];
        let msg;
        try {
          msg = JSON.parse(text);
        } catch {
          continue;
        }
        if (!msg.method || msg.id === undefined) continue; // replies to server requests
        log(`RPC ${msg.method}`);
        const result = rpc(msg.method, msg.params);
        const reply =
          result === undefined
            ? { jsonrpc: "2.0", id: msg.id, error: { code: 4004, message: `ci fake: ${msg.method} not served` } }
            : { jsonrpc: "2.0", id: msg.id, result };
        socket.write(frame(JSON.stringify(reply)));
      }
    }
  });
  socket.on("error", () => {});
  socket.on("close", () => log("WS gone"));
});

server.listen(port, "127.0.0.1", () => {
  writeFileSync(logFile, `listening ${port}\n`);
});
