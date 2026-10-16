/** Scheduled-job rows for the Cron orb. Reads stay read-only. */

export const CRON_POLL_MS = 5_000;
export const CRON_EMPTY = "未有排程工作。";
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

export function jobRunning(job) {
  return String(job?.state || "").toLowerCase() === "running" || job?.running === true;
}

export function anyJobRunning(groups) {
  return (groups || []).some((group) => (group?.jobs || []).some((job) => jobRunning(job)));
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
    running: jobRunning(raw),
  };
}

/** One profile block from `GET /api/crons` or the overlay command. */
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
