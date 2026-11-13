/** Which history command a panel id may call.
 *  A sub-orb id is `suborb:<profile>:<session id>`. It is not a roster profile,
 *  so `open_bot` rejects it. Live tool events omit write_file arguments, and
 *  the turn-end reread has to use the session that owns the plan (R-PL-01). */

import { planNeedsFileCatchUp } from "./plan.js";
import { parseSuborbId } from "./suborb.js";

export function historyOpenCall(id, { quiet = false } = {}) {
  const sub = parseSuborbId(id);
  if (sub) {
    return {
      command: "open_suborb",
      args: { profile: sub.profile, sessionId: sub.sessionId },
    };
  }
  return { command: "open_bot", args: { profile: id, quiet } };
}

export async function openHistory(invoke, id, options = {}) {
  const call = historyOpenCall(id, options);
  return invoke(call.command, call.args);
}

/** A quiet refresh that failed. Callers log this; they do not drop it. */
export function quietRefreshFailure(id, err) {
  const message = String(err ?? "");
  return {
    event: "refresh-quiet-error",
    detail: `id=${id} ${message}`,
    message,
  };
}

export function logQuietRefreshFailure(id, err, sinks = {}) {
  const failure = quietRefreshFailure(id, err);
  sinks.debug?.(failure.event, failure.detail);
  if (sinks.gatewayDown?.(failure.message) !== true) {
    sinks.warn?.(`${failure.event} ${failure.detail}`);
  }
  return failure;
}

/**
 * After a finished turn, reread history when the latest turn still has no
 * plan-file body. `reload` is the quiet refresh (it must open a sub-orb
 * with open_suborb). Returns false when this turn does not need a reread.
 */
export function schedulePlanFileCatchUp({
  id,
  messages,
  sessionId,
  busy,
  enabled,
  schedule,
  reload,
  log = () => {},
  delayMs = 1200,
}) {
  if (!planNeedsFileCatchUp(messages())) return false;
  const pinned = sessionId();
  schedule(() => {
    if (!enabled()) return undefined;
    if (sessionId() !== pinned || busy()) return undefined;
    if (!planNeedsFileCatchUp(messages())) return undefined;
    log(id);
    return reload(id);
  }, delayMs);
  return true;
}
