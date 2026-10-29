/** Sub-orbs for task sessions, and the 「開新 session」 title rules.
 *  Discovery compares session-list stamps. Tails are fetched only after a stamp moves.
 */

import { PLAN_EASE, PLAN_GROW_MS } from "./morph.js";
import { looksLikePlan } from "./plan.js";

export const BOT_CHAT_TITLE = "Bot Chat";
export const GATEWAY_FORK_TITLE = "Continue previous conversation";
/** Visible task orbs. The next slot is 「+N」 when more qualify (R-SO-02). */
export const SUBORB_CAP = 5;
export const SUBORB_DISMISS_MS = 3000;
export const SUBORB_MIN_OPACITY = 0.18;
export const SUBORB_FADE_MS = PLAN_GROW_MS;
export const SUBORB_FADE_EASE = PLAN_EASE;
export const SUBORB_SIZE_RATIO = 0.45;
export const SUBORB_MIN_PX = 14;
export const SUBORB_GAP_PX = 6;

const RENEW_ARCHIVE = /_(?:\d{12}|\d{14})$/;

export function isRenewArchiveTitle(title) {
  return RENEW_ARCHIVE.test(String(title || "").trim());
}

export function suborbSizePx(parentPx = 44) {
  const raw = Number(parentPx) * SUBORB_SIZE_RATIO;
  if (!Number.isFinite(raw)) return SUBORB_MIN_PX;
  return Math.max(SUBORB_MIN_PX, raw);
}

export function suborbPanelId(profile, sessionId) {
  return `suborb:${profile}:${sessionId}`;
}

export function parseSuborbId(id) {
  const text = String(id || "");
  if (!text.startsWith("suborb:")) return null;
  const rest = text.slice("suborb:".length);
  const cut = rest.indexOf(":");
  if (cut <= 0 || cut === rest.length - 1) return null;
  return { profile: rest.slice(0, cut), sessionId: rest.slice(cut + 1) };
}

export function isSuborbId(id) {
  return !!parseSuborbId(id);
}

/** Ctrl-click and the rehearsal stand-in both come through here.
 *  `suborb:` opens that session. `suborb-more:` opens the parent picker.
 *  Anything else stays on the normal bot path. */
export function dispatchOrbClick(id, hooks = {}) {
  const key = String(id || "");
  if (!key) return "ignore";
  if (key === "settings") {
    hooks.settings?.();
    return "settings";
  }
  if (key === "kanban") {
    hooks.kanban?.();
    return "kanban";
  }
  if (key === "cron") {
    hooks.cron?.();
    return "cron";
  }
  if (key.startsWith("suborb-more:")) {
    hooks.picker?.(key.slice("suborb-more:".length));
    return "picker";
  }
  if (isSuborbId(key)) {
    hooks.suborb?.(key);
    return "suborb";
  }
  hooks.bot?.(key);
  return "bot";
}

/** A closed or unstyled sub-orb panel must not publish its card as a hit. */
export function suborbPublishesPanel({
  state = "",
  hidden = false,
  open = false,
  opening = "",
  morphing = false,
} = {}) {
  if (hidden && opening !== "panel" && !morphing) return false;
  if (state !== "panel" && opening !== "panel") return false;
  if (!open && !morphing && opening !== "panel") return false;
  return true;
}

export function gatewayProfile(id) {
  return parseSuborbId(id)?.profile || id;
}

/** Never surface the gateway fork title or a closed-session suffix. */
export function suborbLabel(row) {
  const title = String(row?.kept_title || row?.title || "").trim();
  if (!title || title === GATEWAY_FORK_TITLE) return "任務";
  return title;
}

export function defaultTaskTitle(botName, date = new Date()) {
  const name = String(botName || "").trim() || "Bot";
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${name} 任務 ${stamp}`;
}

export function normalizeTaskTitle(raw, botName, date = new Date()) {
  const typed = String(raw || "").replaceAll("（已閂）", "").trim();
  if (!typed || typed === GATEWAY_FORK_TITLE || isRenewArchiveTitle(typed)) {
    return defaultTaskTitle(botName, date);
  }
  return typed;
}

export function eligibleSuborb(row, mainId = "") {
  if (!row?.id) return false;
  if (row.archived) return false;
  if (isRenewArchiveTitle(row.title) || isRenewArchiveTitle(row.kept_title)) return false;
  if (String(row.title || "") === BOT_CHAT_TITLE) return false;
  if (mainId && row.id === mainId) return false;
  return true;
}

export function suborbChannels({ running = false, waiting = false, failed = false, plan = false, unread = false } = {}) {
  let badge = "";
  if (waiting) badge = "waiting";
  else if (failed) badge = "failed";
  else if (plan) badge = "plan";
  else if (unread) badge = "unread";
  return { activity: running ? "running" : "idle", badge };
}

export function orderSuborbRows(rows, pinned = []) {
  const pinAt = new Map(pinned.map((id, index) => [id, index]));
  return [...rows].sort((a, b) => {
    const ap = pinAt.has(a.id) ? 0 : 1;
    const bp = pinAt.has(b.id) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    if (ap === 0) return pinAt.get(a.id) - pinAt.get(b.id);
    const as = Number(a.started_at) || Number(a.last_active) || 0;
    const bs = Number(b.started_at) || Number(b.last_active) || 0;
    if (as !== bs) return as - bs;
    return String(a.id).localeCompare(String(b.id));
  });
}

export function emptySuborbModel() {
  return {
    seen: false,
    baseline: {},
    previous: {},
    read: {},
    retired: {},
    forced: {},
    dismissAt: {},
    settled: {},
    plans: {},
    waiting: {},
    failed: {},
    localBusy: {},
    peeked: {},
  };
}

function stampOf(row) {
  const count = row?.message_count == null ? null : Number(row.message_count);
  return {
    message_count: Number.isFinite(count) ? count : null,
    last_active: Number(row?.last_active) || 0,
  };
}

function stampKey(stamp) {
  return `${stamp.message_count ?? "x"}:${stamp.last_active}`;
}

function stampMoved(prev, next) {
  if (!prev) return false;
  return prev.message_count !== next.message_count || prev.last_active !== next.last_active;
}

/**
 * Which task sessions are on the orb, and which ids need a tail fetch.
 * The first list is a baseline: historical rows stay hidden unless pinned or forced.
 * A later new id, or a stamp that moved, becomes a sub-orb.
 * Unpinned rows leave SUBORB_DISMISS_MS after the task is finished and read.
 */
export function reconcileSuborbs(model, {
  sessions = [],
  mainId = "",
  pinned = [],
  openIds = [],
  now = 0,
} = {}) {
  const next = {
    seen: !!model?.seen,
    baseline: { ...(model?.baseline || {}) },
    previous: { ...(model?.previous || {}) },
    read: { ...(model?.read || {}) },
    retired: { ...(model?.retired || {}) },
    forced: { ...(model?.forced || {}) },
    dismissAt: { ...(model?.dismissAt || {}) },
    settled: { ...(model?.settled || {}) },
    plans: { ...(model?.plans || {}) },
    waiting: { ...(model?.waiting || {}) },
    failed: { ...(model?.failed || {}) },
    localBusy: { ...(model?.localBusy || {}) },
  };
  if (!next.seen) {
    for (const row of sessions || []) {
      if (!row?.id || next.baseline[row.id]) continue;
      next.baseline[row.id] = stampOf(row);
    }
    next.seen = true;
  }
  const open = new Set(openIds);
  const pin = new Set(pinned);
  const peek = [];
  const live = [];
  for (const row of sessions || []) {
    if (!eligibleSuborb(row, mainId)) continue;
    const stamp = stampOf(row);
    const key = stampKey(stamp);
    const prev = next.previous[row.id];
    const base = next.baseline[row.id];
    if (next.retired[row.id] && next.retired[row.id] !== key) delete next.retired[row.id];
    const isNew = !base;
    const moved = !!(base && stampMoved(base, stamp));
    const forced = !!next.forced[row.id];
    const pinnedHere = pin.has(row.id);
    const wanted = pinnedHere || forced || isNew || moved;
    if (!wanted || next.retired[row.id] === key) {
      next.previous[row.id] = stamp;
      continue;
    }
    const count = stamp.message_count ?? 0;
    const countGrew = !!(
      prev
      && stamp.message_count != null
      && (prev.message_count == null || stamp.message_count > prev.message_count)
    );
    const activeOnly = !!(
      prev
      && stamp.last_active !== prev.last_active
      && stamp.message_count === prev.message_count
    );
    if (countGrew || (isNew && count > 0)) peek.push(row.id);
    if (countGrew) next.settled[row.id] = false;
    const awaitingReply = next.settled[row.id] === false && count > 0 && !row.ended;
    const running = !!(
      next.localBusy[row.id]
      || row.busy
      || activeOnly
      || awaitingReply
      || (countGrew && next.settled[row.id] !== true)
    );
    const waiting = !!(next.waiting[row.id] || row.pending);
    const failed = !!(next.failed[row.id] || row.failed);
    const plan = !!next.plans[row.id];
    if (open.has(row.id)) next.read[row.id] = count;
    const hasRead = next.read[row.id] != null && next.read[row.id] >= count;
    const settled = next.settled[row.id] !== false;
    const finished = !running && !waiting && (row.ended || (count > 0 && settled && !countGrew));
    if (!pinnedHere && finished && hasRead) {
      if (!next.dismissAt[row.id]) next.dismissAt[row.id] = now + SUBORB_DISMISS_MS;
      if (now >= next.dismissAt[row.id]) {
        next.retired[row.id] = key;
        delete next.forced[row.id];
        delete next.dismissAt[row.id];
        next.previous[row.id] = stamp;
        continue;
      }
    } else {
      delete next.dismissAt[row.id];
    }
    const channels = suborbChannels({
      running,
      waiting,
      failed,
      plan,
      unread: finished && !hasRead && count > 0,
    });
    live.push({
      id: row.id,
      title: suborbLabel(row),
      pinned: pinnedHere,
      running,
      finished,
      channels,
      started_at: row.started_at,
      last_active: stamp.last_active,
      message_count: stamp.message_count,
    });
    next.previous[row.id] = stamp;
  }
  const ordered = orderSuborbRows(live, pinned);
  return {
    model: next,
    shown: ordered.slice(0, SUBORB_CAP),
    overflow: ordered.slice(SUBORB_CAP),
    peek,
  };
}

export function suborbPositions({
  edge = "right",
  x = 0,
  y = 0,
  parent = 44,
  count = 0,
  size = 20,
  gap = SUBORB_GAP_PX,
  screenW = 1280,
  screenH = 800,
} = {}) {
  const slots = [];
  const step = size + gap;
  const horizontal = edge === "top" || edge === "bottom";
  let sign = 1;
  if (horizontal) {
    const roomRight = screenW - (x + parent / 2);
    const roomLeft = x - parent / 2;
    sign = roomRight >= roomLeft ? 1 : -1;
  } else {
    const roomDown = screenH - (y + parent / 2);
    const roomUp = y - parent / 2;
    sign = roomDown >= roomUp ? 1 : -1;
  }
  for (let i = 0; i < count; i += 1) {
    const delta = parent / 2 + gap + size / 2 + i * step;
    let sx = x;
    let sy = y;
    if (horizontal) sx = x + sign * delta;
    else sy = y + sign * delta;
    const margin = size / 2 + 4;
    sx = Math.min(screenW - margin, Math.max(margin, sx));
    sy = Math.min(screenH - margin, Math.max(margin, sy));
    slots.push({ x: sx - size / 2, y: sy - size / 2, size });
  }
  return slots;
}

/** Tail text from one changed page. Not a whole transcript. */
export function tailSignals(messages = []) {
  const list = messages || [];
  const last = list[list.length - 1];
  const plan = list.some((message) => looksLikePlan(message?.text || ""));
  const role = String(last?.role || "");
  const settled = !last || role === "bot" || role === "assistant";
  return { plan, settled };
}
