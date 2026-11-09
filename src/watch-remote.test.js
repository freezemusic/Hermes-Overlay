import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { finishWatchedRows, isRemoteStreamBubble, unseenMessages } from "./sessions.js";

// Shapes from the System Architect Bot Chat turn of 9 Nov 2026 (text replaced by placeholders):
// user, assistant(text + tool_calls), tool, assistant(empty + tool_calls), tool,
// assistant(text + 2 tool_calls), tool, tool, assistant(final, finish_reason=stop).
const user = { role: "user", text: "[question]" };
const toolRun = (ids) => ({
  role: "tool-run",
  text: `用咗 ${ids.length} 個工具`,
  tools: ids.map((id) => ({ name: "session_search", tool_call_id: id, status: "done", result: "{}" })),
});

test("a stored reply is not matched against the temporary remote bubble (R-CL-03)", () => {
  const remote = { role: "bot", text: "[final answer]", live: true, remote: true };
  assert.equal(isRemoteStreamBubble(remote), true);
  const existing = [user, toolRun(["a", "b"]), remote];
  const { fresh, settled } = unseenMessages(existing, [{ role: "bot", text: "[final answer]" }]);
  assert.equal(settled, null);
  assert.deepEqual(fresh.map((m) => [m.role, m.text]), [["bot", "[final answer]"]]);
});

test("remote.done removing its bubble leaves the stored reply on screen", () => {
  const remote = { role: "bot", text: "[pre-tool text]", live: true, remote: true };
  const existing = [{ role: "user", text: "[hi]" }, { role: "bot", text: "[greeting]" }, user, remote];
  const next = finishWatchedRows(existing, [{ role: "bot", text: "[pre-tool text]" }, toolRun(["td"])]);
  const afterDone = next.filter((m) => !m.remote);
  assert.deepEqual(afterDone.map((m) => m.role), ["user", "bot", "user", "bot", "tool-run"]);
  assert.equal(afterDone[3].text, "[pre-tool text]");
});

test("stored rows still dedupe against stored rows", () => {
  const existing = [user, { role: "bot", text: "[answer]" }];
  const { fresh } = unseenMessages(existing, [{ role: "bot", text: "[answer]" }]);
  assert.equal(fresh.length, 0);
});

test("remote.done re-reads the stored turn; settle never adopts the remote bubble", () => {
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const remote = main.slice(main.indexOf("function deliverRemote"), main.indexOf("function applyReleasedWatch"));
  const done = remote.slice(remote.indexOf('payload.type === "remote.done"'), remote.indexOf('payload.type === "remote.start"'));
  assert.match(done, /catchUpSession\(id\)/);
  assert.match(done, /!state\.busy\.has\(id\)/);
  const cron = main.slice(main.indexOf("function deliverCron"), main.indexOf("function bannerSticky"));
  assert.match(cron, /message\.live && message\.role === "bot" && !message\.remote/);
});

test("watcher keeps the pinned Bot Chat row when one poll misses it", () => {
  const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const rust = readFileSync(new URL("../src-tauri/src/hermes.rs", import.meta.url), "utf8");
  assert.match(lib, /chat\.rows\.retain\(\|id, _\| hermes::keep_watched_row\(id, &ids, &pin\.id\)\)/);
  assert.match(rust, /pub fn keep_watched_row\(id: &str, polled: &\[String\], pinned: &str\) -> bool/);
});

test("a reused chat node drops its bot markdown cache when the row at its index changes role", async () => {
  const { JSDOM } = await import("jsdom");
  const { paintToolRun } = await import("./tools.js");
  const { document } = new JSDOM("<div></div>").window;
  const node = document.createElement("div");
  node.className = "bubble bot";
  node.dataset.md = "<p>[interim text]</p>";
  paintToolRun(node, toolRun(["s2", "s3"]));
  // paintToolRun leaves foreign data alone, so the in-place sync must clear it.
  assert.equal(node.dataset.md, "<p>[interim text]</p>");
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const sync = main.slice(main.indexOf("function syncChatInPlace"), main.indexOf("function mountChat"));
  const toolBranch = sync.slice(sync.indexOf('message.role === "tool-run"'), sync.indexOf("paintToolRun("));
  assert.match(toolBranch, /delete node\.dataset\.md/);
  const roleChange = sync.slice(sync.indexOf("const nextClass"), sync.indexOf('if (message.role === "bot")'));
  assert.match(roleChange, /delete node\.dataset\.md/);
  assert.match(roleChange, /delete node\.dataset\.toolSig/);
});
