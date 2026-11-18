/** R-PN-10: chat panels that were open reopen after an overlay restart.
 *  The list lives in config.json `open_panels` (set_open_panels splices only
 *  that key; pins are never written). Main bots carry the session they showed
 *  and whether the user had picked it; a sub-orb id already names its session. */

import { parseSuborbId } from "./suborb.js";

export const OPEN_PANELS_CAP = 24;

function botSet(botIds) {
  return botIds instanceof Set ? botIds : new Set(Array.isArray(botIds) ? botIds : []);
}

const COORD_LIMIT = 20000;

/** A saved box position: both coordinates finite and sane, else none. */
function boxPoint(item) {
  const x = Number(item?.x);
  const y = Number(item?.y);
  if (item?.x == null || item?.y == null) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (Math.abs(x) > COORD_LIMIT || Math.abs(y) > COORD_LIMIT) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

/** Clean a saved or live list: known shape, no duplicates, capped. */
export function normalizeOpenPanels(raw) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(raw) ? raw : []) {
    const id = typeof item === "string" ? item.trim() : String(item?.id || "").trim();
    if (!id || seen.has(id) || /\s/.test(id)) continue;
    const sub = parseSuborbId(id);
    if (!sub && id.includes(":")) continue;
    const session = sub ? "" : String((typeof item === "object" && item?.session) || "").trim();
    seen.add(id);
    const row = { id, session, explicit: !sub && !!session && !!item?.explicit };
    const at = typeof item === "object" ? boxPoint(item) : null;
    if (at) Object.assign(row, at);
    out.push(row);
    if (out.length >= OPEN_PANELS_CAP) break;
  }
  return out;
}

/** The open chat panels to save: roster bots and their sub-orbs, in open order.
 *  Kanban, cron and settings are not chat panels and are not saved. */
export function openPanelsSnapshot(openIds, { botIds, threadOf = () => null, boxOf = () => null } = {}) {
  const bots = botSet(botIds);
  const rows = [];
  for (const id of Array.isArray(openIds) ? openIds : []) {
    const sub = parseSuborbId(id);
    if (sub) {
      if (bots.has(sub.profile)) rows.push({ id, ...(boxOf(id) || {}) });
      continue;
    }
    if (!bots.has(id)) continue;
    const thread = threadOf(id);
    const session = String(thread?.sessionId || "");
    rows.push({ id, session, explicit: !!(thread?.sessionExplicit && session), ...(boxOf(id) || {}) });
  }
  return normalizeOpenPanels(rows);
}

export function openPanelsKey(list) {
  return JSON.stringify(normalizeOpenPanels(list).map((row) => [row.id, row.session, row.explicit ? 1 : 0, row.x ?? null, row.y ?? null]));
}

/**
 * What to do with one saved entry now.
 *  - "skip:<reason>": the bot or session is gone (or not known yet past the wait).
 *  - "wait": its session list / history has not arrived yet.
 *  - "open": reopen it.
 *  - "probe": a sub-orb session outside the list; ask the server if it still exists.
 * `ctx`: botIds, loaded(profile) (main history loaded), listReady(profile),
 * shownSession(profile) (the session the main panel resolved to),
 * hasSession(profile, id), placed(id) (a sub-orb disc has its rail slot),
 * timedOut, placeTimedOut.
 */
export function restoreStep(entry, ctx) {
  const bots = botSet(ctx?.botIds);
  const sub = parseSuborbId(entry?.id);
  if (sub) {
    if (!bots.has(sub.profile)) return "skip:bot-gone";
    if (ctx.hasSession?.(sub.profile, sub.sessionId)) {
      // Its disc must be laid out on the rail first: the panel cascades from
      // that spot. Opened before the fan has a slot it lands at 0,0 over the
      // orbs and the free space (Windows CI restore-empty, 2026-11-17).
      if (ctx.placed && !ctx.placed(entry.id) && !ctx.placeTimedOut) return "wait";
      return "open";
    }
    if (!ctx.listReady?.(sub.profile)) return ctx.timedOut ? "probe" : "wait";
    return "probe";
  }
  const id = String(entry?.id || "");
  if (!bots.has(id)) return "skip:bot-gone";
  if (!entry.explicit) return "open";
  // The saved pin brings a picked session back on its own (open_bot); only
  // check that it did. A gone session falls back to Bot Chat: skip the panel.
  if (!ctx.loaded?.(id)) return ctx.timedOut ? "skip:not-loaded" : "wait";
  return ctx.shownSession?.(id) === entry.session ? "open" : "skip:session-gone";
}

/** Where a saved panel box goes on this screen: the saved left/top, kept
 *  inside the viewport. null when the entry has no saved position. */
export function restoredBoxPoint(entry, width, height, screenW, screenH) {
  const at = boxPoint(entry);
  if (!at) return null;
  const clamp = (value, size, screen) => (screen > 0 && size < screen ? Math.min(Math.max(0, value), screen - size) : 0);
  return { x: clamp(at.x, width, screenW), y: clamp(at.y, height, screenH) };
}
