import assert from "node:assert/strict";
import test from "node:test";
import {
  CRON_UNAVAILABLE,
  anyJobRunning,
  nextRunLabel,
  normalizeCronGroup,
  scheduleLabel,
} from "./cron.js";

test("schedule text prefers a string, then a display, then the expression", () => {
  assert.equal(scheduleLabel({ schedule: "每日 09:00", schedule_display: "ignored" }), "每日 09:00");
  assert.equal(scheduleLabel({ schedule_display: "每小時" }), "每小時");
  assert.equal(scheduleLabel({ schedule: { display: "每日 09:00", expr: "0 9 * * *" } }), "每日 09:00");
  assert.equal(scheduleLabel({ schedule: { expression: "0 9 * * *" } }), "0 9 * * *");
});

test("next run stays on a 24-hour clock", () => {
  const now = new Date(2026, 9, 16, 15, 4, 0);
  const same = new Date(2026, 9, 16, 21, 42, 0);
  const later = new Date(2026, 9, 17, 9, 5, 0);
  assert.equal(nextRunLabel(same.getTime() / 1000, now), "21:42");
  assert.equal(nextRunLabel(later.getTime() / 1000, now), "2026-10-17 09:05");
  assert.equal(nextRunLabel("", now), "");
  assert.doesNotMatch(`${nextRunLabel(same.getTime() / 1000, now)} ${nextRunLabel(later.getTime() / 1000, now)}`, /下午|上午/);
});

test("groups stay read-only and a missing cron API is empty", () => {
  const missing = normalizeCronGroup({ cron_unavailable: true, profile: "planner", name: "計劃助手" });
  assert.equal(missing.unavailable, true);
  assert.equal(missing.message, CRON_UNAVAILABLE);
  assert.deepEqual(missing.jobs, []);
  const group = normalizeCronGroup({
    jobs: [
      { id: "a", name: "每日摘要", schedule: "每日 09:00", state: "scheduled" },
      { id: "b", name: "整理看板", state: "paused" },
      { name: "檢查測試", schedule: { expr: "*/30 * * * *" }, state: "running" },
    ],
  }, { profile: "coder", name: "程式夥伴" });
  assert.equal(group.unavailable, false);
  assert.equal(group.jobs[0].enabled, true);
  assert.equal(group.jobs[0].running, false);
  assert.equal(group.jobs[1].enabled, false);
  assert.equal(group.jobs[2].running, true);
  assert.equal(group.jobs[2].schedule, "*/30 * * * *");
  assert.equal(anyJobRunning([missing, group]), true);
  assert.equal(anyJobRunning([missing]), false);
});
