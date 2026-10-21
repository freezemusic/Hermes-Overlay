import assert from "node:assert/strict";
import test from "node:test";
import { latestPlan, looksLikePlan, noteNewestPlan, planBodyLead, planDemoMarkdown, planForPanel, planSource, plansIn, planTask, planTitle, rememberPlan, unwrapPlan } from "./plan.js";

test("plan markdown is recognized and a short ack is not", () => {
  const body = planDemoMarkdown("整理設定");
  assert.equal(looksLikePlan(body), true);
  assert.equal(planTitle(body), "整理設定 Implementation Plan");
  assert.equal(planBodyLead(body, "計劃"), body);
  assert.equal(planBodyLead(body, planTitle(body)), body);
  assert.equal(planBodyLead("正文", "v25 replace test"), "# v25 replace test\n\n正文");
  assert.equal(looksLikePlan("收到，我再諗。"), false);
  assert.equal(looksLikePlan("# 筆記\n\n**Goal:** 對齊面板"), true);
  assert.equal(looksLikePlan("# 已寫\n\n`.hermes/plans/2026-10-15_120000-setup.md`"), true);
  assert.equal(planTask("/plan 整理設定"), "整理設定");
  assert.equal(planTask("/planet"), null);
  assert.equal(planTask("hello"), null);
});

test("latest plan is the newest bot reply, including a /plan turn", () => {
  const older = planDemoMarkdown("舊");
  const newer = "呢份計劃會先改設定畫面，再核對每個 profile 嘅圓球顏色、光暈同預覽面板。";
  const found = latestPlan([
    { role: "user", text: "/plan 舊", command: "plan" },
    { role: "bot", text: older },
    { role: "user", text: "/plan 新", command: "plan" },
    { role: "bot", text: newer },
    { role: "bot", text: "# 未完成", live: true },
  ]);
  assert.equal(found.markdown, newer);
  assert.equal(found.title, "計劃");
  assert.equal(latestPlan([{ role: "user", text: "hi" }, { role: "bot", text: "ok" }]), null);
  const listed = plansIn([
    { role: "user", text: "/plan 舊", command: "plan" },
    { role: "bot", text: older },
    { role: "bot", text: "# 未完成", live: true },
    { role: "user", text: "/plan 新", command: "plan" },
    { role: "bot", text: newer },
  ]);
  assert.equal(listed.length, 2);
  assert.equal(listed[0].markdown, older);
  assert.equal(listed[1].markdown, newer);
  assert.equal(plansIn([{ role: "bot", text: "# 未完成", live: true }]).length, 0);
});

test("a fenced markdown or plan block is the plan, and a new plan replaces the open one", () => {
  const fenced = ["```markdown", "# 整理設定 Implementation Plan", "", "**Goal:** 對齊面板", "```"].join("\n");
  assert.equal(looksLikePlan(fenced), true);
  assert.match(unwrapPlan(fenced), /^# 整理設定/);
  assert.equal(planTitle(planSource(fenced)), "整理設定 Implementation Plan");
  assert.doesNotMatch(planSource(fenced), /```/);
  const planFence = ["```plan", "# 只得標題", "", "下一步", "```"].join("\n");
  assert.equal(looksLikePlan(planFence), true);
  assert.equal(planTitle(planSource(planFence)), "只得標題");
  assert.equal(looksLikePlan("```js\n# 唔算\n```"), false);
  const found = plansIn([{ role: "bot", text: fenced }]);
  assert.equal(found.length, 1);
  assert.equal(found[0].title, "整理設定 Implementation Plan");
  assert.doesNotMatch(found[0].markdown, /```/);
  const thread = { seenPlanKey: "old", planFocus: "old", planDismissed: "old" };
  assert.equal(noteNewestPlan(thread, [{ key: "old" }, { key: "new" }]), true);
  assert.equal(thread.planFocus, "new");
  assert.equal(thread.planDismissed, "");
  assert.equal(thread.seenPlanKey, "new");
  assert.equal(noteNewestPlan(thread, [{ key: "old" }, { key: "new" }]), false);
  thread.planFocus = "old";
  assert.equal(noteNewestPlan(thread, [{ key: "old" }, { key: "new" }]), false);
  assert.equal(thread.planFocus, "old");
});

test("the last plan is cached per bot and used only before the session loads", () => {
  const markdown = planDemoMarkdown("快取");
  const thread = { messages: [{ role: "bot", text: markdown }], planDismissed: "" };
  const cached = rememberPlan(thread, thread.messages);
  assert.equal(cached.markdown, markdown);
  assert.equal(planForPanel(thread).key, cached.key);
  thread.messages = [];
  thread.loaded = false;
  assert.equal(planForPanel(thread).markdown, markdown);
  thread.planDismissed = cached.key;
  assert.equal(planForPanel(thread), null);
  thread.planDismissed = "";
  thread.loaded = true;
  assert.equal(planForPanel(thread), null);
  thread.loaded = false;
  thread.messages = [{ role: "bot", text: planDemoMarkdown("新") }];
  noteNewestPlan(thread, plansIn(thread.messages));
  assert.equal(planForPanel(thread).markdown, thread.messages[0].text);
});

test("睇計劃 clears a dismiss so the same plan shows again", () => {
  const markdown = planDemoMarkdown("再開");
  const thread = {
    messages: [{ role: "bot", text: markdown }],
    loaded: true,
    planDismissed: "",
    planFocus: "",
  };
  const plan = planForPanel(thread);
  assert.ok(plan);
  thread.planFocus = plan.key;
  thread.planDismissed = plan.key;
  thread.seenPlanKey = plan.key;
  assert.equal(planForPanel(thread), null);
  assert.equal(noteNewestPlan(thread, plansIn(thread.messages)), false);
  assert.equal(thread.planDismissed, plan.key);
  assert.equal(planForPanel(thread), null);
  thread.planDismissed = "";
  thread.planFocus = plan.key;
  assert.equal(planForPanel(thread).key, plan.key);
});
