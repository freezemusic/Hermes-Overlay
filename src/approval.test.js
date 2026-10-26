import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  APPROVAL_STALE,
  EXECUTE_CODE_BLOCKED_LINE,
  approvalFailure,
  approvalPost,
  plainToolText,
  renderApprovalCard,
  showApprovalBadge,
  statusAfterResponded,
  textIsExecuteCodeBlocked,
} from "./approval.js";

const { document } = new JSDOM("<!doctype html><body></body>").window;

test("an approval request posts once or deny with the run and request ids", () => {
  const once = approvalPost("mt-coder", "run_abc", "req_1", "once");
  assert.equal(once.path, "/p/mt-coder/v1/runs/run_abc/approval");
  assert.deepEqual(once.body, { choice: "once", request_id: "req_1" });
  assert.equal(once.runId, "run_abc");
  const deny = approvalPost("mt-coder", "run_abc", "req_1", "deny");
  assert.equal(deny.body.choice, "deny");
  assert.equal(approvalPost("mt-coder", "run_abc", "req_1", "session"), null);
  assert.equal(approvalPost("mt-coder", "run_abc", "req_1", "always"), null);
  assert.equal(statusAfterResponded("once"), "approved");
  assert.equal(statusAfterResponded("deny"), "denied");
  assert.deepEqual(approvalFailure("呢個批准已經過時"), { status: "stale", notice: APPROVAL_STALE });
  assert.equal(approvalFailure("批准未送出（500）。").notice, "批准未送出。");
});

test("the approval card shows the redacted command and only two buttons", () => {
  let picked = "";
  const card = renderApprovalCard(document, {
    description: "list files",
    command: "ls <redacted>",
    status: "pending",
  }, (choice) => {
    picked = choice;
  });
  assert.equal(card.querySelector(".approval-description").textContent, "list files");
  assert.equal(card.querySelector(".approval-command").textContent, "ls <redacted>");
  assert.equal(card.querySelectorAll("button").length, 2);
  assert.equal(card.querySelector("[data-choice=once]").textContent, "批准（一次）");
  assert.equal(card.querySelector("[data-choice=deny]").textContent, "拒絕");
  card.querySelector("[data-choice=once]").click();
  assert.equal(picked, "once");
  const hostile = renderApprovalCard(document, {
    description: "x",
    command: "<script>alert(1)</script>",
    status: "pending",
  }, () => {});
  assert.equal(hostile.querySelector(".approval-command").textContent, "<script>alert(1)</script>");
  assert.equal(hostile.querySelector("script"), null);
  const sending = renderApprovalCard(document, { description: "x", command: "ls", status: "sending" }, () => {});
  assert.equal(sending.querySelectorAll("button:disabled").length, 2);
  const approved = renderApprovalCard(document, { description: "x", status: "approved" }, () => {});
  assert.equal(approved.querySelector(".approval-result").textContent, "已批准");
  assert.equal(approved.querySelector("button"), null);
  const denied = renderApprovalCard(document, { description: "x", status: "denied" }, () => {});
  assert.equal(denied.querySelector(".approval-result").textContent, "已拒絕");
  const stale = renderApprovalCard(document, { description: "x", status: "stale" }, () => {});
  assert.equal(stale.querySelector(".approval-result").textContent, APPROVAL_STALE);
});

test("a blocked execute_code result becomes the plain line and the closed orb shows a badge", () => {
  const raw = "BLOCKED execute_code: unattended deny";
  assert.equal(textIsExecuteCodeBlocked(raw), true);
  assert.equal(plainToolText(raw), EXECUTE_CODE_BLOCKED_LINE);
  assert.equal(plainToolText("ls README"), "ls README");
  assert.equal(showApprovalBadge(false, true), true);
  assert.equal(showApprovalBadge(true, true), false);
  assert.equal(showApprovalBadge(false, false), false);
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.match(main, /invoke\("respond_approval"/);
  assert.match(main, /approval\.request/);
  assert.match(main, /has-approval/);
  assert.match(css, /\.approval-badge \{[^}]*pointer-events:\s*none/s);
  assert.match(css, /\.bot-btn\.has-approval \.approval-badge/);
  for (const file of ["./approval.js", "./main.js", "../src-tauri/src/hermes.rs", "../src-tauri/src/lib.rs"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /unattended_mode/);
  }
  const rust = readFileSync(new URL("../src-tauri/src/hermes.rs", import.meta.url), "utf8");
  const submit = rust.slice(rust.indexOf("pub async fn submit_approval"), rust.indexOf("fn json_error_reason"));
  assert.match(submit, /\/v1\/runs\/\{run_id\}\/approval/);
  assert.doesNotMatch(submit, /resolve_all|println|eprintln|config::save/);
});
