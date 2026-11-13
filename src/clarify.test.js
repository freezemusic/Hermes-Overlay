import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { sealUnrecoverableNotice } from "./sessions.js";
import {
  CLARIFY_HEADING,
  CLARIFY_SEND_FAIL,
  CLARIFY_STALE,
  CLARIFY_TIMEOUT,
  CLARIFY_TIMEOUT_S,
  CLARIFY_WAIT_LABEL,
  CLARIFY_OTHER,
  clarifyAnswerValue,
  clarifyBudget,
  clarifyCardFromControl,
  clarifyFailure,
  clarifyKept,
  clarifyPost,
  clarifyRequestId,
  clarifyResultText,
  absorbRecoveredControls,
  clarifyComposerRoute,
  clarifyRouteAfterRecover,
  clarifyTick,
  mergePendingControls,
  renderClarifyCard,
  CLARIFY_NOT_DELIVERED,
} from "./clarify.js";

const { document } = new JSDOM("<!doctype html><body></body>").window;

test("a single choice posts the choice text and labels the first one 推薦", () => {
  let posted = "";
  const card = renderClarifyCard(document, {
    question: "邊個？",
    choices: ["甲", "乙"],
    status: "pending",
    timeoutS: 600,
    remain: 600,
  }, {
    onAnswer(answer) {
      posted = answer;
    },
  });
  assert.equal(card.querySelector(".clarify-heading").textContent, CLARIFY_HEADING);
  assert.equal(card.querySelector(".clarify-question").textContent, "邊個？");
  const buttons = [...card.querySelectorAll("button")];
  assert.match(buttons[0].textContent, /推薦/);
  assert.equal(buttons[0].dataset.choice, "甲");
  assert.equal(buttons[1].dataset.choice, "乙");
  assert.equal(buttons.at(-1).textContent, "跳過");
  buttons[0].click();
  assert.equal(posted, "甲");
  assert.equal(posted.includes("推薦"), false);
  const post = clarifyPost("mt-coder", "run_abc", "p1", 4, posted);
  assert.equal(post.path, "/p/mt-coder/v1/runs/run_abc/clarify");
  assert.deepEqual(post.body, { request_id: "p1", execution_generation: 4, answer: "甲" });
  assert.equal(Object.keys(post.body).length, 3);
  assert.equal(clarifyPost("mt-coder", "run_abc", "p1", undefined, "甲"), null);
});

test("multi select posts a JSON array and free text or skip posts a string", () => {
  const message = {
    question: "揀邊啲？",
    choices: ["甲", "乙", "丙"],
    multiSelect: true,
    status: "pending",
    selected: [],
    timeoutS: 0,
  };
  let posted = "";
  const handlers = {
    onToggle(choice, checked) {
      message.selected = checked
        ? [...message.selected, choice]
        : message.selected.filter((item) => item !== choice);
    },
    onAnswer(answer) {
      posted = answer;
    },
  };
  const first = renderClarifyCard(document, message, handlers);
  assert.equal(first.querySelector(".clarify-countdown"), null);
  const boxes = [...first.querySelectorAll("input[type=checkbox]")];
  assert.match(boxes[0].parentElement.textContent, /推薦/);
  assert.equal(boxes[0].dataset.choice, "甲");
  boxes[0].checked = true;
  boxes[0].dispatchEvent(new document.defaultView.Event("change"));
  boxes[2].checked = true;
  boxes[2].dispatchEvent(new document.defaultView.Event("change"));
  assert.equal(clarifyAnswerValue({ choices: message.choices, multi: true, selected: ["丙", "甲"] }), "[\"甲\",\"丙\"]");
  const send = [...first.querySelectorAll("button")].find((button) => button.textContent === "送出");
  assert.equal(send.disabled, false);
  send.click();
  assert.equal(posted, "[\"甲\",\"丙\"]");
  assert.equal(clarifyAnswerValue({ choices: [], text: "自己講" }), "自己講");
  assert.equal(clarifyAnswerValue({ choices: ["甲"], skip: true, selected: "甲" }), "");
  const skipped = clarifyPost("mt-coder", "run_abc", "p1", 4, "");
  assert.equal(skipped.body.answer, "");
});

test("free text needs a draft, and stale or timeout closes the card without posting", () => {
  const message = { question: "講多少少", choices: [], status: "pending", draft: "", timeoutS: 600, remain: 12 };
  let posts = 0;
  const card = renderClarifyCard(document, message, {
    onDraft(value) {
      message.draft = value;
    },
    onAnswer() {
      posts += 1;
    },
  });
  const send = [...card.querySelectorAll("button")].find((button) => button.textContent === "送出");
  assert.equal(send.disabled, true);
  const field = card.querySelector("textarea");
  field.value = "自己講";
  field.dispatchEvent(new document.defaultView.Event("input"));
  assert.equal(message.draft, "自己講");
  const skip = [...card.querySelectorAll("button")].find((button) => button.textContent === "跳過");
  skip.click();
  assert.equal(posts, 1);
  const stale = renderClarifyCard(document, { question: "舊", choices: ["甲"], status: "stale" }, { onAnswer() { posts += 1; } });
  assert.equal(stale.querySelector(".clarify-result").textContent, CLARIFY_STALE);
  assert.equal(stale.querySelector("button"), null);
  const timed = renderClarifyCard(document, { question: "舊", choices: ["甲"], status: "timeout" }, { onAnswer() { posts += 1; } });
  assert.equal(timed.querySelector(".clarify-result").textContent, CLARIFY_TIMEOUT);
  assert.equal(timed.querySelector("button"), null);
  assert.equal(posts, 1);
  assert.deepEqual(clarifyFailure(CLARIFY_STALE), { status: "stale", notice: CLARIFY_STALE });
  assert.equal(clarifyFailure("答案未送出（500）。").notice, CLARIFY_SEND_FAIL);
});

test("the countdown reaches timeout and does not build a post", () => {
  const message = { role: "clarify", status: "pending", askedAt: 1_000, timeoutS: 2, remain: 2 };
  clarifyTick(message, 1_000);
  assert.equal(message.status, "pending");
  assert.equal(message.remain, 2);
  clarifyTick(message, 3_500);
  assert.equal(message.status, "timeout");
  assert.equal(message.remain, 0);
  const unbounded = { role: "clarify", status: "pending", timeoutS: 0, askedAt: 0 };
  clarifyTick(unbounded, 999_999);
  assert.equal(unbounded.status, "pending");
  assert.equal(clarifyBudget({}), CLARIFY_TIMEOUT_S);
  assert.equal(clarifyBudget({ timeoutS: -1 }), null);
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const clock = main.slice(main.indexOf("function armClarifyClock"), main.indexOf("function releaseClarifyWait"));
  assert.match(clock, /clarifyTick/);
  assert.doesNotMatch(clock, /respond_clarify|clarifyPost/);
});

test("settled and recovery keep every pending card and the same pin as approvals", () => {
  const now = 50_000;
  const pending = clarifyCardFromControl({
    kind: "clarify",
    prompt_id: "p1",
    question: "邊個？",
    choices: ["甲"],
    execution_generation: 4,
    timeout_s: 600,
  }, "run_abc", now);
  assert.equal(pending.executionGeneration, 4);
  const replaced = mergePendingControls(
    [pending, { role: "user", text: "keep" }],
    [{ kind: "clarify", prompt_id: "p2", question: "下一條", choices: [], execution_generation: 4 }],
    "run_abc",
    { dropMissing: true, now },
  );
  // dropMissing retires p1 (absent from snapshot); p2 is added. Batch siblings stay.
  assert.equal(replaced.some((message) => message.promptId === "p1"), false);
  assert.equal(replaced.filter((message) => message.role === "clarify").length, 1);
  assert.equal(replaced.find((message) => message.role === "clarify").promptId, "p2");
  const batch = mergePendingControls(
    [],
    [
      { kind: "clarify", prompt_id: "srq-1~q0", question: "一", choices: ["A"], execution_generation: 1 },
      { kind: "clarify", prompt_id: "srq-1~q1", question: "二", choices: ["B"], execution_generation: 1 },
      { kind: "clarify", prompt_id: "srq-1~q2", question: "三", choices: ["C"], execution_generation: 1 },
    ],
    "run_abc",
    { dropMissing: true, now },
  );
  assert.equal(batch.filter((message) => message.role === "clarify").length, 3);
  assert.equal(clarifyRequestId("srq-1~q2"), "srq-1");
  const kept = mergePendingControls(
    [{ role: "clarify", promptId: "p9", status: "sending", question: "等" }],
    [],
    "run_abc",
    { dropMissing: true, now },
  );
  assert.equal(kept[0].status, "sending");
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.match(main, /invoke\("respond_clarify"/);
  assert.match(main, /invoke\("load_run_controls"/);
  assert.match(main, /clarify\.request/);
  assert.match(main, /clarify\.settled/);
  assert.equal(CLARIFY_WAIT_LABEL, "等你答");
  const openBot = main.slice(main.indexOf("function openBotPanel"), main.indexOf("function closeBotPanel"));
  assert.match(openBot, /clarifyPending/);
  assert.match(openBot, /pinChat\(id\)/);
  assert.match(css, /\.clarify-heading \{[^}]*font:[^}]*11px/s);
  assert.equal(clarifyKept({ role: "clarify", status: "stale" }), false);
  assert.equal(clarifyKept({ role: "clarify", status: "pending" }), true);
  assert.equal(clarifyKept({ role: "clarify", status: "timeout" }), true);
  const keptFn = readFileSync(new URL("./clarify.js", import.meta.url), "utf8");
  const keptSrc = keptFn.slice(keptFn.indexOf("export function clarifyKept"), keptFn.indexOf("export function clarifyBudget"));
  assert.doesNotMatch(keptSrc, /stale/);
  const recover = main.slice(main.indexOf("async function recoverRunControls"), main.indexOf("function handleHermes"));
  assert.match(recover, /APPROVAL_WAIT_LABEL/);
  assert.match(recover, /CLARIFY_WAIT_LABEL/);
  const asking = main.slice(main.indexOf('payload.type === "clarify.request"'), main.indexOf('payload.type === "clarify.settled"'));
  assert.match(asking, /APPROVAL_WAIT_LABEL/);
  assert.match(asking, /CLARIFY_WAIT_LABEL/);
  for (const file of ["./clarify.js", "./main.js", "../src-tauri/src/hermes.rs", "../src-tauri/src/lib.rs"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /unattended_mode/);
  }
});

test("a choice card offers 其他 free text and keeps the typed answer on the settled card", () => {
  const message = {
    question: "出生地？",
    choices: ["香港", "廣州"],
    status: "pending",
    draft: "",
    timeoutS: 0,
  };
  let posted = "";
  const card = renderClarifyCard(document, message, {
    onDraft(value) {
      message.draft = value;
    },
    onAnswer(answer) {
      posted = answer;
    },
  });
  assert.equal(card.querySelector(".clarify-other-label").textContent, CLARIFY_OTHER);
  const field = card.querySelector("textarea.clarify-other");
  const send = card.querySelector(".clarify-other-send");
  assert.equal(send.disabled, true);
  field.value = "台北";
  field.dispatchEvent(new document.defaultView.Event("input"));
  assert.equal(message.draft, "台北");
  assert.equal(send.disabled, false);
  send.click();
  assert.equal(posted, "台北");
  assert.equal(clarifyResultText({ status: "answered", postedAnswer: "台北" }), "已答：台北");
  assert.equal(clarifyResultText({ status: "answered", postedAnswer: "" }), "已答");
});

test("a history notice becomes a live card only when the run snapshot has that control", () => {
  const asked = 1_000;
  const now = (asked + 120) * 1000;
  const clarifyNotice = {
    role: "notice",
    tool_name: "clarify",
    tool_call_id: "c1",
    text: JSON.stringify({ text: "下一組？", timeout_s: 3600, asked_at: asked, tool_call_id: "c1" }),
  };
  const approvalNotice = {
    role: "notice",
    tool_name: "approval",
    tool_call_id: "a1",
    text: JSON.stringify({ text: "rm tmp", timeout_s: 600, asked_at: asked, tool_call_id: "a1" }),
  };
  assert.equal(clarifyComposerRoute([clarifyNotice]).action, "recover");
  assert.equal(clarifyComposerRoute([approvalNotice]).action, "send");
  const recovered = absorbRecoveredControls(
    [clarifyNotice, approvalNotice],
    [
      {
        kind: "clarify",
        prompt_id: "srq-c~q0",
        question: "下一組？",
        choices: ["甲"],
        execution_generation: 0,
      },
      {
        kind: "approval",
        prompt_id: "srq-a",
        description: "list",
        command: "rm tmp",
      },
    ],
    "run_ws_ab12_0",
    { dropMissing: true, now },
  );
  assert.equal(recovered.some((message) => message.role === "notice"), false);
  const clarify = recovered.find((message) => message.role === "clarify");
  assert.equal(clarify.promptId, "srq-c~q0");
  assert.equal(clarify.executionGeneration, 0);
  assert.equal(clarify.runId, "run_ws_ab12_0");
  assert.equal(clarify.status, "pending");
  assert.equal(clarify.timeoutS, 3600);
  assert.ok(clarify.remain < 3600);
  const approval = recovered.find((message) => message.role === "approval");
  assert.equal(approval.requestId, "srq-a");
  assert.equal(approval.status, "pending");
  assert.equal(clarifyComposerRoute(recovered).action, "answer");
  const stayed = absorbRecoveredControls(
    [clarifyNotice, approvalNotice],
    [],
    "run_ws_ab12_0",
    { dropMissing: false, now },
  );
  assert.equal(stayed.filter((message) => message.role === "notice").length, 2);
  assert.equal(clarifyComposerRoute(stayed).action, "recover");
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const send = main.slice(main.indexOf("async function sendActive"), main.indexOf("async function continueApiSession"));
  const answerAt = send.indexOf("answerClarify(id, pendingClarify");
  const blockedAt = send.indexOf("CLARIFY_NOT_DELIVERED");
  const queueAt = send.indexOf("sendWhileBusy");
  assert.ok(answerAt > 0 && blockedAt > answerAt && queueAt > blockedAt);
  assert.match(send, /clarifyComposerRoute/);
  assert.equal(CLARIFY_NOT_DELIVERED, "呢句送唔到做答案。");
  const opened = main.slice(main.indexOf("function applyOpened"), main.indexOf("function beginBotHistory"));
  assert.match(opened, /noteOpenedRun/);
  assert.match(opened, /queueControlRecovery/);
  const refresh = main.slice(main.indexOf("function mergeCaughtUp"), main.indexOf("async function catchUpSession"));
  assert.match(refresh, /noteOpenedRun/);
  assert.match(refresh, /queueControlRecovery/);
  const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const openBot = lib.slice(lib.indexOf("async fn open_bot"), lib.indexOf("async fn open_explicit_session"));
  assert.match(openBot, /bind_live_run/);
});

test("a sealed clarify notice sends, recovery gone sends, and a live card still answers", () => {
  const sealed = {
    role: "notice",
    tool_name: "clarify",
    text: JSON.stringify({ text: "邊隻色？", unrecoverable: true }),
  };
  assert.equal(clarifyComposerRoute([sealed]).action, "send");
  const open = {
    role: "notice",
    tool_name: "clarify",
    text: JSON.stringify({ text: "邊隻色？", timeout_s: 600, asked_at: 1 }),
  };
  assert.equal(clarifyComposerRoute([open]).action, "recover");
  assert.equal(sealUnrecoverableNotice(open), true);
  assert.equal(clarifyComposerRoute([open]).action, "send");
  assert.equal(clarifyRouteAfterRecover({ action: "recover" }, "gone").action, "send");
  const live = { role: "clarify", status: "pending", question: "邊隻色？", promptId: "q0" };
  const answered = clarifyComposerRoute([sealed, live]);
  assert.equal(answered.action, "answer");
  assert.equal(answered.card, live);
  assert.equal(clarifyRouteAfterRecover(answered, "gone").action, "answer");
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const active = main.slice(main.indexOf("async function sendActive"), main.indexOf("async function continueApiSession"));
  const sub = main.slice(main.indexOf("async function sendSuborb("), main.indexOf("async function sendSuborbBusy"));
  for (const [name, send] of [["sendActive", active], ["sendSuborb", sub]]) {
    const goneAt = send.indexOf("clarifyRouteAfterRecover");
    const answerAt = send.indexOf("answerClarify");
    const blockedAt = send.indexOf("CLARIFY_NOT_DELIVERED");
    assert.ok(goneAt > 0 && answerAt > goneAt && blockedAt > answerAt, name);
  }
});

test("main.js keeps batch clarify siblings and routes composer text to the open card", () => {
  const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const close = main.slice(main.indexOf("function closeOtherClarifies"), main.indexOf("async function answerApproval"));
  assert.match(close, /clarifyRequestId/);
  assert.doesNotMatch(close, /message\.promptId !== promptId && \(clarifyPending/);
  const send = main.slice(main.indexOf("async function sendActive"), main.indexOf("async function continueApiSession"));
  assert.match(send, /pendingClarify/);
  assert.match(send, /answerClarify\(id, pendingClarify/);
  const mergeSrc = readFileSync(new URL("./clarify.js", import.meta.url), "utf8");
  assert.doesNotMatch(mergeSrc, /seenPending/);
});
