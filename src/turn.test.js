import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");

test("a busy send steers, and a rejected steer is queued out loud", () => {
  const send = main.slice(main.indexOf("async function sendActive"), main.indexOf("function botsFromSettings"));
  assert.doesNotMatch(send, /sendBlockedWhileBusy/);
  assert.match(send, /action\?\.command !== "stop"/);
  assert.match(send, /sendWhileBusy/);
  const busy = main.slice(main.indexOf("async function sendWhileBusy"), main.indexOf("async function stopActive"));
  assert.match(busy, /steer_run/);
  assert.match(busy, /已加入呢一輪/);
  assert.match(busy, /排隊中，等佢講完就會行/);
  assert.match(busy, /send_chat/);
  assert.match(busy, /queue: true/);
  assert.match(busy, /lockIfPermissionDenied/);
  assert.doesNotMatch(busy, /create_session|create_bot_chat/);
});

test("stop waits for the gateway and a reopened panel still catches up", () => {
  const stop = main.slice(main.indexOf("async function stopActive"), main.indexOf("function measureInputText"));
  assert.match(stop, /stop_chat/);
  assert.match(stop, /runId: thread\.runId/);
  assert.match(stop, /result === "not_active"/);
  assert.match(stop, /noteStopped/);
  assert.match(stop, /catchUpSession/);
  assert.match(stop, /停止未送到。/);
  assert.doesNotMatch(stop, /已停止呢次回覆/);
  const command = main.slice(main.indexOf("async function sendClientCommand"), main.indexOf("function useMock"));
  assert.match(command, /command === "stop"/);
  assert.doesNotMatch(command, /已停止呢次回覆/);
  const noted = main.slice(main.indexOf("function noteStopped"), main.indexOf("function mergeCaughtUp"));
  assert.match(noted, /已停止呢次回覆。/);
  assert.match(main, /if \(thread\.loaded\) void catchUpSession\(id\)/);
  assert.match(main, /thread\.watchReply/);
  const rustStop = lib.slice(lib.indexOf("async fn request_stop"), lib.indexOf("async fn steer_run"));
  assert.match(rustStop, /stop_run/);
  assert.doesNotMatch(rustStop, /abort\.store/);
});
