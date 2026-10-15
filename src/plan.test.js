import assert from "node:assert/strict";
import test from "node:test";
import { latestPlan, looksLikePlan, planDemoMarkdown, planTask, planTitle } from "./plan.js";

test("plan markdown is recognized and a short ack is not", () => {
  const body = planDemoMarkdown("整理設定");
  assert.equal(looksLikePlan(body), true);
  assert.equal(planTitle(body), "整理設定 Implementation Plan");
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
});
