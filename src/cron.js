/** Scheduled-job rows for the Cron orb. Reads stay read-only. */

export const CRON_POLL_MS = 5_000;
export const CRON_EMPTY = "未有排程工作。";
export const CRON_NONE = "未有排程";
export const CRON_UNAVAILABLE = "呢個 Bot 未有排程。";

export function scheduleLabel(job) {
  if (!job) return "";
  if (typeof job.schedule === "string" && job.schedule.trim()) return job.schedule.trim();
  const display = String(job.schedule_display || "").trim();
  if (display) return display;
  const schedule = job.schedule && typeof job.schedule === "object" ? job.schedule : {};
  return String(schedule.display || schedule.expression || schedule.expr || "").trim();
}

export function parseRunTime(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) return parseRunTime(Number(text));
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 24-hour clock. A later day keeps the date in front so it never becomes 下午09:42. */
export function nextRunLabel(value, now = new Date()) {
  const date = parseRunTime(value);
  if (!date) return "";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const clock = `${hh}:${mm}`;
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  if (sameDay) return clock;
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day} ${clock}`;
}

function executionStatus(job) {
  const status = job?.latest_execution?.status;
  return String(status || "").trim().toLowerCase();
}

/** A live Hermes fire claim means this job is in a run, even while `state` stays `scheduled`. */
export function fireClaimLive(value) {
  if (!value || typeof value !== "object") return false;
  const claim = value.fire_claim;
  if (claim && typeof claim === "object") return Object.keys(claim).length > 0;
  return typeof claim === "string" && claim.trim().length > 0;
}

export function jobRunning(job) {
  if (job?.running === true) return true;
  if (String(job?.state || "").toLowerCase() === "running") return true;
  if (fireClaimLive(job) || fireClaimLive(job?.latest_execution)) return true;
  const status = executionStatus(job);
  return status === "running" || status === "claimed";
}

/** A finish inside the poll gap still counts, so a short run is not invisible until the next idle poll. */
export function recentRun(job, now = new Date(), windowMs = CRON_POLL_MS) {
  const date = parseRunTime(lastRunValue(job));
  if (!date) return false;
  const age = now.getTime() - date.getTime();
  return age <= windowMs && age >= -windowMs;
}

export function cronOrbActive(groups, now = new Date(), windowMs = CRON_POLL_MS) {
  return (groups || []).some((group) => (group?.jobs || []).some((job) => (
    jobRunning(job) || recentRun(job, now, windowMs)
  )));
}

/** Empty lists stay on the panel. A missing cron API is a different sentence. */
export function cronGroupNote(group) {
  if (!group) return "";
  if (group.unavailable) return group.message || CRON_UNAVAILABLE;
  if (!(group.jobs || []).length) return CRON_NONE;
  return "";
}

/** Last run is `last_run_at`, then `last_run`, then the latest execution. */
export function lastRunValue(job) {
  if (!job) return "";
  if (job.last_run_at) return job.last_run_at;
  if (job.last_run) return job.last_run;
  const exec = job.latest_execution || {};
  return exec.finished_at || exec.started_at || "";
}

export function anyJobRunning(groups) {
  return (groups || []).some((group) => (group?.jobs || []).some((job) => jobRunning(job)));
}

export function jobFailed(job) {
  const status = String(job?.status || job?.latest_execution?.status || job?.state || "").trim().toLowerCase();
  return status === "failed" || status === "error" || status === "failure";
}

function runStartValue(job) {
  if (!job) return "";
  if (job.started_at) return job.started_at;
  return job.latest_execution?.started_at || "";
}

/** Fraction of a known run, or null when the duration cannot be computed. */
export function cronProgress(job, now = new Date()) {
  if (!jobRunning(job)) return null;
  const start = parseRunTime(runStartValue(job));
  const next = parseRunTime(job?.next_run_at);
  if (!start || !next) return null;
  const span = next.getTime() - start.getTime();
  if (!(span > 1000)) return null;
  const p = (now.getTime() - start.getTime()) / span;
  if (!Number.isFinite(p) || p < 0) return null;
  return Math.max(0, Math.min(1, p));
}

/** 「行緊 00:42」 from the current run's start. */
export function runningLabel(job, now = new Date()) {
  const start = parseRunTime(runStartValue(job));
  const elapsed = start ? Math.max(0, now.getTime() - start.getTime()) : 0;
  const total = Math.floor(elapsed / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `行緊 ${mm}:${ss}`;
}

export function soonestNextLabel(groups, now = new Date()) {
  let best = null;
  (groups || []).forEach((group) => {
    (group?.jobs || []).forEach((job) => {
      if (!job?.enabled || jobRunning(job)) return;
      const date = parseRunTime(job.next_run_at);
      if (!date) return;
      if (!best || date < best) best = date;
    });
  });
  return best ? nextRunLabel(best, now) : "";
}

/** Idle tick, a static arc, a spinning segment, or a failed arc. */
export function cronOrbFace(groups, now = new Date()) {
  const jobs = (groups || []).flatMap((group) => group?.jobs || []);
  const running = jobs.find((job) => jobRunning(job));
  if (running) {
    const p = cronProgress(running, now);
    return {
      mode: p == null ? "spin" : "progress",
      p: p == null ? 0 : p,
      label: runningLabel(running, now),
    };
  }
  const failed = jobs.find((job) => jobFailed(job));
  if (failed) return { mode: "failed", p: 1, label: soonestNextLabel(groups, now) };
  return { mode: "idle", p: 0, label: soonestNextLabel(groups, now) };
}

function jobEnabled(raw) {
  if (typeof raw?.enabled === "boolean") return raw.enabled;
  return String(raw?.state || "").toLowerCase() !== "paused";
}

function jobFrom(raw, index) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || raw.name || index);
  const name = String(raw.name || raw.id || "未命名").trim() || "未命名";
  return {
    id,
    name,
    schedule: scheduleLabel(raw),
    enabled: jobEnabled(raw),
    next_run_at: raw.next_run_at ?? raw.next_run ?? "",
    last_run_at: lastRunValue(raw),
    started_at: raw.latest_execution?.started_at || raw.started_at || "",
    status: executionStatus(raw) || String(raw.state || "").trim().toLowerCase(),
    running: jobRunning(raw),
  };
}

/** One profile block from `GET /api/jobs` or the overlay command. */
export function normalizeCronGroup(payload, fallback = {}) {
  const profile = String(payload?.profile || fallback.profile || "");
  const name = String(payload?.name || fallback.name || profile || "Bot");
  if (payload?.cron_unavailable || payload?.unavailable) {
    return {
      profile,
      name,
      jobs: [],
      unavailable: true,
      message: payload?.message || CRON_UNAVAILABLE,
    };
  }
  const source = Array.isArray(payload) ? payload : payload?.jobs || [];
  return {
    profile,
    name,
    jobs: source.map(jobFrom).filter(Boolean),
    unavailable: false,
    message: "",
  };
}
