/** Sub-orbs for task sessions, and the 「開新 session」 title rules.
 *  Discovery compares session-list stamps. Tails are fetched only after a stamp moves.
 */

import { PLAN_EASE, PLAN_GROW_MS } from "./morph.js";
import { looksLikePlan } from "./plan.js";

export const BOT_CHAT_TITLE = "Bot Chat";
export const GATEWAY_FORK_TITLE = "Continue previous conversation";
/** Visible task orbs (fan draft: 4). The next slot is 「+N」 when more qualify (R-SO-02). */
export const SUBORB_CAP = 4;
export const SUBORB_DISMISS_MS = 3000;
export const SUBORB_MIN_OPACITY = 0.18;
export const SUBORB_FADE_MS = PLAN_GROW_MS;
export const SUBORB_FADE_EASE = PLAN_EASE;
export const SUBORB_SIZE_RATIO = 0.45;
export const SUBORB_MIN_PX = 14;
export const SUBORB_GAP_PX = 6;

/** By-id fetch and list-seed retry: 1s, 2s, 4s, 8s, 16s, then 30s. */
export function pinFetchDelayMs(attempt) {
  const step = Math.max(0, Number(attempt) || 0);
  const shift = Math.min(5, step);
  return Math.min(30_000, 1000 * (2 ** shift));
}

/** One persisted overlay-created row. Junk is dropped so an old config still loads. */
export function normalizeCreatedRow(row) {
  if (!row || typeof row !== "object") return null;
  const id = String(row.id || "").trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
  const count = row.message_count == null ? null : Number(row.message_count);
  const started = Number(row.started_at);
  const active = Number(row.last_active);
  const title = String(row.title || "").trim().slice(0, 120);
  const source = String(row.source || "").trim();
  return {
    id,
    title,
    source: source && source.length <= 64 ? source : "api_server",
    started_at: Number.isFinite(started) ? started : 0,
    last_active: Number.isFinite(active) ? active : (Number.isFinite(started) ? started : 0),
    message_count: Number.isFinite(count) ? count : 0,
    archived: false,
  };
}

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

/** R-SO-10 picker label (icon only; tooltip and aria-label). */
export const PULL_SUBORB_LABEL = "拎出做子光球";

/**
 * R-SO-10: rows the main panel can pull out as a sub-orb. Same rules as
 * eligibleSuborb: no Bot Chat, not the row the main orb is bound to, no
 * archived row, no renew archive title. Newest activity first.
 */
export function pullOutCandidates(sessions = [], mainId = "") {
  return (sessions || [])
    .filter((row) => eligibleSuborb(row, mainId))
    .map((row) => ({ id: row.id, title: suborbLabel(row), last_active: Number(row.last_active) || 0 }))
    .sort((a, b) => b.last_active - a.last_active);
}

/**
 * R-SO-10: rows of the merged session menu. `options` are the picker's own
 * rows ({ id, label }) in picker order; `selectedId` is the row marked as the
 * current session. A row gets the pull-out icon only when pullOutCandidates
 * would list it (no Bot Chat, not the bound row, not archived, no renew copy).
 */
export function sessionMenuEntries(options = [], sessions = [], mainId = "", selectedId = "") {
  const pullable = new Set(pullOutCandidates(sessions, mainId).map((row) => row.id));
  return (options || [])
    .filter((option) => option && String(option.id || ""))
    .map((option) => {
      const id = String(option.id);
      return { id, label: String(option.label || ""), current: id === String(selectedId || ""), pullable: pullable.has(id) };
    });
}

/** Keyboard focus move in the session menu. Returns the new row index. */
export function sessionMenuMove(index, count, key) {
  if (count <= 0) return -1;
  const at = Number.isInteger(index) && index >= 0 && index < count ? index : -1;
  if (key === "Home" || key === "PageUp") return 0;
  if (key === "End" || key === "PageDown") return count - 1;
  if (key === "ArrowDown") return at < 0 ? 0 : Math.min(count - 1, at + 1);
  if (key === "ArrowUp") return at < 0 ? count - 1 : Math.max(0, at - 1);
  return at;
}

export function suborbChannels({ running = false, waiting = false, failed = false, plan = false, unread = false } = {}) {
  let badge = "";
  if (waiting) badge = "waiting";
  else if (failed) badge = "failed";
  else if (plan) badge = "plan";
  else if (unread) badge = "unread";
  return { activity: running ? "running" : "idle", badge };
}

const LIVE_RUN_STATUS = new Set([
  "running",
  "started",
  "waiting_for_approval",
  "working",
  "streaming",
  "starting",
  "busy",
]);

const TERMINAL_RUN_STATUS = new Set([
  "completed",
  "failed",
  "cancelled",
  "canceled",
  "interrupted",
  "expired",
  "gone",
]);

/**
 * Whether a sub-orb that still looks busy can stop.
 * "idle" — the server says the run is over. Clear local busy and settle the tail.
 * "spin" — the session or the run is still active.
 * "recheck" — the list says the session is not busy, but a run id is still open.
 * Ask the server. Do not clear from the list flag alone.
 * A history-notice countdown is not an input. The caller rechecks, then passes
 * the run status it got back.
 */
export function suborbIdleDecision({
  sessionBusy,
  localBusy = false,
  hasRunId = false,
  runStatus = "",
  runGone = false,
  confirmedIdle = false,
} = {}) {
  if (sessionBusy === true) return "spin";
  const status = String(runStatus || "").toLowerCase();
  if (LIVE_RUN_STATUS.has(status)) return "spin";
  if (runGone || TERMINAL_RUN_STATUS.has(status)) return "idle";
  if (sessionBusy !== false) return "spin";
  // A run id still on file has to be asked. The list flag alone is not enough:
  // a stored user line keeps the arc until that reply settles.
  if (hasRunId) return "recheck";
  if (confirmedIdle || localBusy) return "idle";
  return "spin";
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
    serverIdle: {},
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
  goneIds = [],
  // False while the server list has not arrived. An empty preview must not
  // lock the baseline, or the real list is treated as all-new (R-SO-06).
  lockBaseline = true,
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
    serverIdle: { ...(model?.serverIdle || {}) },
  };
  if (!next.seen && lockBaseline !== false) {
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
  for (const id of goneIds || []) {
    if (id) dropIds.add(id);
  }
  if (Array.isArray(listedIds) && listedIds.length) {
    const listed = new Set(listedIds.filter(Boolean));
    for (const id of listed) next.known[id] = true;
    // A pin missing from the recent list is not gone. Fetch it by id first (R-SO-11).
    for (const id of Object.keys(next.known)) {
      if (!listed.has(id) && !pin.has(id)) dropIds.add(id);
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
    if (row.busy === true || next.localBusy[row.id]) delete next.serverIdle[row.id];
    if (countGrew) next.settled[row.id] = false;
    // serverIdle is set only after a run check (or a notice timeout recheck)
    // says this session has no active run. A bare busy:false list row is not
    // that check — a stored user line still waits for the reply.
    const serverIdle = !!next.serverIdle[row.id] && row.busy !== true && !next.localBusy[row.id];
    if (serverIdle) next.settled[row.id] = true;
    const awaitingReply = next.settled[row.id] === false && count > 0 && !row.ended;
    const running = !!(
      next.localBusy[row.id]
      || row.busy
      || (!serverIdle && activeOnly)
      || awaitingReply
      || (countGrew && next.settled[row.id] !== true)
    );
    const waiting = !!(next.waiting[row.id] || row.pending);
    const failed = !!(next.failed[row.id] || row.failed);
    const plan = !!next.plans[row.id];
    if (open.has(row.id)) next.read[row.id] = count;
    const hasRead = next.read[row.id] != null && next.read[row.id] >= count;
    const settled = next.settled[row.id] !== false;
    const finished = !running && !waiting && (row.ended || (count > 0 && settled && (!countGrew || serverIdle)));
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
  const present = new Set();
  for (const row of sessions || []) {
    if (row?.id && !dropIds.has(row.id)) present.add(row.id);
  }
  const missing = [];
  for (const id of pinned || []) {
    if (!id || dropIds.has(id) || present.has(id) || missing.includes(id)) continue;
    missing.push(id);
  }
  return {
    model: next,
    shown: capped.shown,
    overflow: capped.overflow,
    peek,
    unpin,
    drop: [...dropIds],
    missing,
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

/* ---- Fan layout (R-SO-02 draft, 2026-11-04, Art Director proposal) ---- */
/** Visible task orbs on the fan. The next slot is 「+N」. */
export const SUBORB_FAN_CAP = 4;
/** Hit circle per sub-orb, wider than the 0.45× disc. */
export const SUBORB_HIT_PX = 24;
/** Gap from the main disc edge to the sub-orb disc edge on the orbit. */
export const SUBORB_FAN_GAP_PX = 10;
/** Widest arc. More slots than fit at the base orbit push the orbit out. */
export const SUBORB_FAN_MAX_SPAN_DEG = 120;
/** Air between two neighbouring hit circles on the arc. */
export const SUBORB_FAN_HIT_AIR_PX = 2;
/** Round 2 (AD): a slot's disc keeps this much air from a neighbouring main
 *  orb's DISC. Halos may overlap. */
export const SUBORB_NEIGHBOUR_CLEAR_PX = 12;
/** Halo counted around a neighbour disc. 0 since round 2 (disc rule). */
export const SUBORB_NEIGHBOUR_HALO_PX = 0;
/** Parent halo reach while it has a fan: about 1.6× the main orb diameter. */
export const SUBORB_PARENT_HALO_RATIO = 1.6;
/** Keep this much of the work area free around a slot's disc. */
export const SUBORB_WORK_MARGIN_PX = 4;
/** Turns the arc may make, away from a crowded side, before it collapses. */
export const SUBORB_FAN_NUDGE_DEG = [0, 15, -15, 30, -30];
export const SUBORB_FAN_MS = 200;
export const SUBORB_FAN_EASE = "cubic-bezier(.2,.8,.2,1)";

const DEG = Math.PI / 180;

/**
 * Where the arc points: from the main orb toward the work-area centre.
 * An orb sitting on the centre points left (the rail's usual inward side).
 */
export function suborbFanDirection(x, y, work) {
  const cx = work.left + work.width / 2;
  const cy = work.top + work.height / 2;
  const dx = cx - x;
  const dy = cy - y;
  if (Math.hypot(dx, dy) < 1) return Math.PI;
  return Math.atan2(dy, dx);
}

/**
 * Orbit radius and angular step for `count` slots.
 * Base orbit = parent radius + gap + sub-orb radius. Adjacent hit circles
 * keep SUBORB_FAN_HIT_AIR_PX between them. If that needs more than the max
 * span, the step shrinks to fit and the orbit grows instead.
 */
export function suborbFanOrbit(count, { parent = 44, size = 20, hit = SUBORB_HIT_PX, gap = SUBORB_FAN_GAP_PX, maxSpanDeg = SUBORB_FAN_MAX_SPAN_DEG } = {}) {
  const base = parent / 2 + gap + size / 2;
  if (count <= 1) return { radius: base, step: 0 };
  const chord = hit + SUBORB_FAN_HIT_AIR_PX;
  const stepAtBase = 2 * Math.asin(Math.min(1, chord / (2 * base)));
  const maxSpan = maxSpanDeg * DEG;
  if (stepAtBase * (count - 1) <= maxSpan + 1e-9) return { radius: base, step: stepAtBase };
  const step = maxSpan / (count - 1);
  return { radius: Math.max(base, chord / (2 * Math.sin(step / 2))), step };
}

function arcSlots(x, y, count, dir, orbit, size) {
  const start = dir - (orbit.step * (count - 1)) / 2;
  const slots = [];
  for (let i = 0; i < count; i += 1) {
    // Screen y grows down, so a growing angle runs clockwise on screen.
    const angle = start + i * orbit.step;
    const cx = x + orbit.radius * Math.cos(angle);
    const cy = y + orbit.radius * Math.sin(angle);
    slots.push({ x: cx - size / 2, y: cy - size / 2, cx, cy, size, angle });
  }
  return slots;
}

function slotLeavesWork(slot, work, margin) {
  const r = slot.size / 2 + margin;
  return slot.cx - r < work.left
    || slot.cy - r < work.top
    || slot.cx + r > work.left + work.width
    || slot.cy + r > work.top + work.height;
}

/** Smallest air (px) between any slot disc and any neighbour disc, minus halo. */
function slotsClearance(slots, neighbours, halo) {
  let best = Infinity;
  for (const slot of slots) {
    for (const n of neighbours || []) {
      const air = Math.hypot(slot.cx - n.x, slot.cy - n.y) - (Number(n.r) || 22) - halo - slot.size / 2;
      if (air < best) best = air;
    }
  }
  return best;
}

function slotCrowds(slot, neighbours, halo, clear) {
  return slotsClearance([slot], neighbours, halo) < clear - 1e-9;
}

/**
 * Fan of sub-orb slots on the side of the main orb that faces the work-area
 * centre. Slot 0 is the counter-clockwise end; later slots run clockwise
 * (pinned first, then creation time — the caller's order).
 * If no turn in `nudges` keeps every slot inside the work area and clear of
 * every neighbour halo by `clear` px, the fan collapses into one badge
 * at the arc centre (mode "badge"); the caller shows the slots only while
 * the modifier is held.
 */
export function suborbFanLayout({
  x = 0,
  y = 0,
  parent = 44,
  count = 0,
  size = 20,
  hit = SUBORB_HIT_PX,
  work = null,
  screenW = 1280,
  screenH = 800,
  neighbours = [],
  halo = SUBORB_NEIGHBOUR_HALO_PX,
  clear = SUBORB_NEIGHBOUR_CLEAR_PX,
  margin = SUBORB_WORK_MARGIN_PX,
  nudges = SUBORB_FAN_NUDGE_DEG,
} = {}) {
  const area = work || { left: 0, top: 0, width: screenW, height: screenH };
  const dir = suborbFanDirection(x, y, area);
  const orbit = suborbFanOrbit(count, { parent, size, hit });
  const baseRadius = parent / 2 + SUBORB_FAN_GAP_PX + size / 2;
  const badgeAt = (angle) => {
    const cx = x + baseRadius * Math.cos(angle);
    const cy = y + baseRadius * Math.sin(angle);
    return { x: cx - size / 2, y: cy - size / 2, cx, cy, size, angle };
  };
  if (count <= 0) return { mode: "fan", reason: "", dir, turn: 0, radius: orbit.radius, step: orbit.step, slots: [], badge: badgeAt(dir) };
  let firstReason = "";
  let fallback = null;
  for (const turnDeg of nudges && nudges.length ? nudges : [0]) {
    const angle = dir + turnDeg * DEG;
    const slots = arcSlots(x, y, count, angle, orbit, size);
    const out = slots.some((slot) => slotLeavesWork(slot, area, margin));
    const crowd = !out && slots.some((slot) => slotCrowds(slot, neighbours, halo, clear));
    if (!firstReason) firstReason = out ? "work" : crowd ? "neighbour" : "";
    if (!out && !crowd) {
      return { mode: "fan", reason: "", dir: angle, turn: turnDeg, radius: orbit.radius, step: orbit.step, slots, badge: badgeAt(angle) };
    }
    // Ctrl-expanded slots: the in-area turn with the most air from neighbours.
    const air = out ? -Infinity : slotsClearance(slots, neighbours, halo);
    if (!fallback || air > fallback.air) fallback = { air, turn: turnDeg, angle, slots };
  }
  // Collapsed: the best-effort slots still come back so Ctrl can expand them.
  return {
    mode: "badge",
    reason: firstReason,
    dir,
    turn: fallback.turn,
    radius: orbit.radius,
    step: orbit.step,
    slots: fallback.slots,
    badge: badgeAt(dir),
  };
}

/**
 * Round 2: the parent keeps the only halo. Its visible rim sits where the
 * sub-orb discs start (orbit − sub radius), so the discs rest on its outer
 * edge: 32px for ≤4 slots, 40.3px for 5 (≈1.45–1.83×, mean ≈1.6× diameter).
 * A collapsed fan's badge sits on the base orbit.
 */
export function suborbFanRim(fan, { parent = 44, size = 20, collapsed = false } = {}) {
  const base = parent / 2 + SUBORB_FAN_GAP_PX + size / 2;
  const radius = collapsed || !fan ? base : Number(fan.radius) || base;
  return Math.max(parent / 2, radius - size / 2);
}

/** SVG arc path (centre 0,0 shifted by `pad`) through the first and last slot angles. */
export function suborbOrbitPath(fan, pad = 2) {
  const slots = fan?.slots || [];
  if (slots.length < 2) return "";
  const r = Number(fan.radius) || 0;
  const c = r + pad;
  const a0 = slots[0].angle;
  const a1 = slots[slots.length - 1].angle;
  const p = (a) => `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${p(a0)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${large} 1 ${p(a1)}`;
}

/** Which look a sub-orb shell takes on the rail. */
export function suborbFanState({ mode = "fan", held = false, parentOpen = false } = {}) {
  if (parentOpen) return "tucked";
  if (mode !== "badge") return "fan";
  return held ? "expanded" : "collapsed";
}

/** 24px hit circle on a sub-orb disc centre; never smaller than the disc. */
export function suborbHitCircle(disc, hit = SUBORB_HIT_PX) {
  if (!disc || !(disc.w >= 1) || !(disc.h >= 1)) return disc;
  const size = Math.max(hit, Math.min(disc.w, disc.h));
  const cx = disc.x + disc.w / 2;
  const cy = disc.y + disc.h / 2;
  return { x: cx - size / 2, y: cy - size / 2, w: size, h: size };
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
