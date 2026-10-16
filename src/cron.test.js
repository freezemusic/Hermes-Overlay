import assert from "node:assert/strict";
import test from "node:test";
import {
  CRON_NONE,
  CRON_POLL_MS,
  CRON_UNAVAILABLE,
  anyJobRunning,
  cronGroupNote,
  cronOrbActive,
  jobRunning,
  lastRunValue,
  nextRunLabel,
  normalizeCronGroup,
  recentRun,
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

test("a claimed execution counts as running and keeps the last run", () => {
  const claimed = {
    id: "tests",
    name: "檢查測試",
    state: "scheduled",
    enabled: true,
    latest_execution: { status: "claimed", started_at: "2026-10-16T11:30:00Z" },
  };
  assert.equal(jobRunning(claimed), true);
  assert.equal(lastRunValue(claimed), "2026-10-16T11:30:00Z");
  const finished = {
    state: "scheduled",
    last_run_at: "2026-10-16T09:00:00Z",
    latest_execution: { status: "completed", finished_at: "2026-10-16T09:01:00Z" },
  };
  assert.equal(jobRunning(finished), false);
  assert.equal(lastRunValue(finished), "2026-10-16T09:00:00Z");
  const group = normalizeCronGroup({ jobs: [claimed, finished] });
  assert.equal(group.jobs[0].running, true);
  assert.equal(group.jobs[0].last_run_at, "2026-10-16T11:30:00Z");
  assert.equal(group.jobs[1].running, false);
  assert.equal(group.jobs[1].last_run_at, "2026-10-16T09:00:00Z");
  assert.equal(anyJobRunning([group]), true);
});

test("a scheduled job with latest_execution.status running lights the orb", () => {
  const now = new Date("2026-10-16T12:00:13Z");
  const live = {
    id: "live",
    name: "進行中",
    state: "scheduled",
    enabled: true,
    fire_claim: { at: "2026-10-16T12:00:00Z", by: "host:abc" },
    latest_execution: { status: "running", started_at: "2026-10-16T12:00:01Z" },
  };
  assert.equal(jobRunning(live), true);
  const group = normalizeCronGroup({ profile: "coder", name: "程式夥伴", jobs: [live] });
  assert.equal(group.jobs[0].running, true);
  assert.equal(cronOrbActive([group], now), true);
  const finished = normalizeCronGroup({
    jobs: [{
      id: "short",
      name: "短工作",
      state: "scheduled",
      last_run_at: new Date(now.getTime() - 2000).toISOString(),
      latest_execution: { status: "completed", finished_at: new Date(now.getTime() - 2000).toISOString() },
    }],
  });
  assert.equal(finished.jobs[0].running, false);
  assert.equal(recentRun(finished.jobs[0], now, CRON_POLL_MS), true);
  assert.equal(cronOrbActive([finished], now), true);
  const idle = normalizeCronGroup({
    jobs: [{
      id: "old",
      name: "舊工作",
      state: "scheduled",
      last_run_at: new Date(now.getTime() - 60_000).toISOString(),
      latest_execution: { status: "completed" },
    }],
  });
  assert.equal(cronOrbActive([idle], now), false);
  const empty = normalizeCronGroup({ profile: "quiet", name: "靜音", jobs: [] });
  assert.equal(empty.unavailable, false);
  assert.equal(cronGroupNote(empty), CRON_NONE);
  assert.equal(cronGroupNote({ unavailable: true, jobs: [], message: CRON_UNAVAILABLE }), CRON_UNAVAILABLE);
  assert.equal(cronGroupNote(group), "");
});
