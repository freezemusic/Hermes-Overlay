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
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `${name} 任務 ${stamp}`;
}

/** A second default title in the same second gets ` (2)`, then ` (3)`. */
export function uniqueTaskTitle(title, taken = []) {
  const base = String(title || "").trim();
  if (!base) return base;
  const used = new Set((taken || []).map((item) => String(item || "").trim()).filter(Boolean));
  if (!used.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const next = `${base} (${n})`;
    if (!used.has(next)) return next;
  }
  return `${base} (${used.size + 2})`;
}

export function sessionCreateError(err) {
  const text = typeof err === "string" ? err : (err?.message || err?.error || "");
  const line = String(text || "").trim();
  if (!line || line === "[object Object]") return "開唔到新對話。";
  return line;
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
    closedAt: {},
    known: {},
    settled: {},
    plans: {},
    waiting: {},
    failed: {},
    localBusy: {},
    peeked: {},
  };
}

/** Focus or typed text keeps an unpinned sub-orb on the rail. */
export function composerHoldsSuborb({ value = "", focused = false } = {}) {
  return !!focused || String(value || "").length > 0;
}

/**
 * Visible discs. A just-created or open session stays on the rail.
 * Extra pins past the cap still overflow. A new reserved disc may pass the
 * cap when every other disc is pinned. The oldest idle unpinned disc overflows first.
 */
export function capSuborbs(ordered, cap = SUBORB_CAP, reservedIds = []) {
  const reserve = new Set(reservedIds);
  const pins = [];
  const reserved = [];
  const flex = [];
  for (const row of ordered || []) {
    if (reserve.has(row.id)) reserved.push(row);
    else if (row.pinned) pins.push(row);
    else flex.push(row);
  }
  const pinShown = reserved.length ? pins : pins.slice(0, cap);
  const pinOver = reserved.length ? [] : pins.slice(cap);
  const room = Math.max(0, cap - pinShown.length - reserved.length);
  const dropFirst = [
    ...flex.filter((row) => !row.running),
    ...flex.filter((row) => row.running),
  ];
  const dropCount = Math.max(0, flex.length - Math.min(flex.length, room));
  const dropped = new Set(dropFirst.slice(0, dropCount).map((row) => row.id));
  const keep = new Set([
    ...pinShown.map((row) => row.id),
    ...reserved.map((row) => row.id),
    ...flex.filter((row) => !dropped.has(row.id)).map((row) => row.id),
  ]);
  return {
    shown: (ordered || []).filter((row) => keep.has(row.id)),
    overflow: [...pinOver, ...dropFirst.filter((row) => dropped.has(row.id))],
  };
}

/**
 * Place one open sub-orb panel inside the work area at the full card height.
 * Later panels step 36px down. A step that would leave the work area, or
 * shorten the card, starts again at the top of the next column.
 * Every open panel must pass the same left/top (the cascade origin from
 * suborbCascadeOrigin), so each one is a full 36px step from the last (S23).
 */
export function placeSuborbCascade({
  left = 0,
  top = 0,
  width = 420,
  height = 560,
  index = 0,
  screenW = 1280,
  screenH = 800,
  panelW = 420,
  panelH = 560,
  step = 36,
  insetTop = 0,
  insetRight = 0,
  insetBottom = 0,
  insetLeft = 0,
} = {}) {
  const minX = Math.max(0, Number(insetLeft) || 0);
  const minY = Math.max(0, Number(insetTop) || 0);
  const maxX = screenW > 0 ? screenW - Math.max(0, Number(insetRight) || 0) : 0;
  const maxY = screenH > 0 ? screenH - Math.max(0, Number(insetBottom) || 0) : 0;
  const spanW = maxX > minX ? maxX - minX : (screenW || panelW);
  const spanH = maxY > minY ? maxY - minY : (screenH || panelH);
  const w = Math.min(panelW, spanW > 0 ? spanW : panelW);
  const h = Math.min(panelH, spanH > 0 ? spanH : panelH);
  const clamp = (value, lo, hi) => Math.min(Math.max(lo, value), Math.max(lo, hi));
  let baseLeft = clamp(Number(left) || 0, minX, maxX > 0 ? maxX - w : minX);
  let baseTop = clamp(Number(top) || 0, minY, maxY > 0 ? maxY - h : minY);
  const xSign = screenW > 0 && baseLeft + w / 2 > screenW / 2 ? -1 : 1;
  let col = 0;
  let row = 0;
  const count = Math.max(0, Number(index) || 0);
  const fitsX = (x) => x >= minX - 0.5 && (maxX <= 0 || x + w <= maxX + 0.5);
  const fitsY = (y) => y >= minY - 0.5 && (maxY <= 0 || y + h <= maxY + 0.5);
  // col is a signed column offset in steps. Columns go away from the screen edge
  // first; when that side is used up they continue on the other side of the base.
  let dir = xSign;
  let flipped = false;
  for (let i = 0; i < count; i += 1) {
    const downTop = baseTop + (row + 1) * step;
    const downLeft = baseLeft + col * step;
    if (fitsY(downTop) && fitsX(downLeft)) {
      row += 1;
      continue;
    }
    let nextCol = col + dir;
    if (!fitsX(baseLeft + nextCol * step)) {
      if (flipped) break;
      flipped = true;
      dir = -dir;
      nextCol = dir;
      if (!fitsX(baseLeft + nextCol * step)) break;
    }
    col = nextCol;
    row = 0;
  }
  return {
    left: baseLeft + col * step,
    top: baseTop + row * step,
    width: w,
    height: h,
  };
}

/**
 * The shell whose disc home anchors the cascade: the first open sub-orb panel.
 * Using each panel's own disc home made the step drift by the disc spacing
 * (+62px one way, about -10px after the side flips; S23).
 */
export function suborbCascadeOrigin(open = [], shell = null) {
  const list = Array.isArray(open) ? open.filter(Boolean) : [];
  return list.length ? list[0] : shell;
}

/** Drop the plan host, the panel, and the shell together. */
export function releaseSuborbNodes(shell) {
  if (!shell) return;
  const host = shell._planHost;
  if (host?.remove) host.remove();
  shell._planHost = null;
  const doc = shell.ownerDocument;
  doc?.querySelectorAll?.(".plan-hit-host")?.forEach((node) => {
    const owner = node._planShell;
    if (!owner || owner === shell || owner.isConnected === false) node.remove();
  });
  shell.remove?.();
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
 * An unpinned row leaves only after its panel is closed, the task is finished
 * and read, and SUBORB_DISMISS_MS has passed since that close.
 */
export function reconcileSuborbs(model, {
  sessions = [],
  mainId = "",
  pinned = [],
  openIds = [],
  holdIds = [],
  listedIds = null,
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
    closedAt: { ...(model?.closedAt || {}) },
    known: { ...(model?.known || {}) },
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
  const hold = new Set(holdIds);
  const pin = new Set(pinned);
  const dropIds = new Set();
  const unpin = [];
  for (const row of sessions || []) {
    if (row?.id && row.archived) dropIds.add(row.id);
  }
  if (Array.isArray(listedIds) && listedIds.length) {
    const listed = new Set(listedIds.filter(Boolean));
    for (const id of listed) next.known[id] = true;
    for (const id of Object.keys(next.known)) {
      if (!listed.has(id)) dropIds.add(id);
    }
  }
  for (const id of dropIds) {
    delete next.forced[id];
    delete next.dismissAt[id];
    delete next.closedAt[id];
    if (pin.has(id)) unpin.push(id);
  }
  const peek = [];
  const live = [];
  for (const row of sessions || []) {
    if (!row?.id || dropIds.has(row.id) || !eligibleSuborb(row, mainId)) continue;
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
    const panelOpen = open.has(row.id);
    const held = hold.has(row.id);
    if (panelOpen) {
      delete next.closedAt[row.id];
      delete next.dismissAt[row.id];
    } else if (!pinnedHere && finished && hasRead && !held) {
      if (!next.closedAt[row.id]) next.closedAt[row.id] = now;
      const due = next.closedAt[row.id] + SUBORB_DISMISS_MS;
      if (now >= due) {
        next.retired[row.id] = key;
        delete next.forced[row.id];
        delete next.dismissAt[row.id];
        delete next.closedAt[row.id];
        next.previous[row.id] = stamp;
        continue;
      }
      next.dismissAt[row.id] = due;
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
  const reserved = [...open, ...Object.keys(next.forced).filter((id) => next.forced[id])];
  const capped = capSuborbs(ordered, SUBORB_CAP, reserved);
  return {
    model: next,
    shown: capped.shown,
    overflow: capped.overflow,
    peek,
    unpin,
    drop: [...dropIds],
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
