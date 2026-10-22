/** R-SY-08: shared gateway reconnect. Reads only — never creates a session. */

export const RECONNECT_STATUS = "連唔到 Hermes，自動重試中…";
export const RECONNECT_BASES_MS = [5_000, 10_000, 20_000];
export const RECONNECT_CAP_MS = 60_000;

/** 5s, 10s, 20s, then 60s, each multiplied by a factor in [0.8, 1.2]. */
export function reconnectDelayMs(attempt, random = Math.random) {
  const step = Math.max(0, attempt | 0);
  const base = step < RECONNECT_BASES_MS.length ? RECONNECT_BASES_MS[step] : RECONNECT_CAP_MS;
  const roll = typeof random === "function" ? Number(random()) : Number(random);
  const unit = Math.min(1, Math.max(0, Number.isFinite(roll) ? roll : 0.5));
  return Math.round(base * (0.8 + unit * 0.4));
}

export function gatewayDown(message) {
  const text = String(message || "");
  const lower = text.toLowerCase();
  return (
    text.includes("連唔到 Hermes gateway") ||
    text.includes("Hermes gateway 逾時") ||
    text.includes("同 Hermes gateway 嘅連線中斷") ||
    lower.includes("hermes gateway timeout") ||
    lower.includes("gateway timeout") ||
    lower.includes("timed out") ||
    lower.includes("connection refused") ||
    lower.includes("error sending request")
  );
}

/** Calm copy plus the next try. No raw error, no spinner. */
export function reconnectStatus(nextAt, now = Date.now()) {
  const wait = Math.max(0, Number(nextAt) - Number(now));
  const secs = Math.ceil(wait / 1000);
  if (secs <= 0) return `${RECONNECT_STATUS} 即將再試`;
  return `${RECONNECT_STATUS} ${secs} 秒後再試`;
}

/** At most one in-flight probe per key (a profile, or one global reader). */
export function createProbeGate() {
  const held = new Set();
  return {
    tryBegin(profile) {
      const key = String(profile || "");
      if (!key || held.has(key)) return false;
      held.add(key);
      return true;
    },
    end(profile) {
      held.delete(String(profile || ""));
    },
    has(profile) {
      return held.has(String(profile || ""));
    },
  };
}

/**
 * One supervisor. `fail` arms the backoff. `kick` retries immediately
 * (panel open, network online, OS resume). A second fail while a timer
 * or a probe is already running does not start another probe.
 */
export function createReconnect(options = {}) {
  const now = options.now || (() => Date.now());
  const random = options.random || Math.random;
  const setTimer = options.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer || ((id) => clearTimeout(id));
  const onWait = options.onWait || (() => {});
  const onClear = options.onClear || (() => {});
  const lanes = new Map();

  function row(key) {
    let item = lanes.get(key);
    if (!item) {
      item = { attempt: 0, timer: null, inflight: 0, down: false, nextAt: 0, run: null };
      lanes.set(key, item);
    }
    return item;
  }

  function clear(item) {
    if (item.timer != null) clearTimer(item.timer);
    item.timer = null;
  }

  function schedule(key) {
    const item = row(key);
    clear(item);
    const delay = reconnectDelayMs(item.attempt, random);
    item.down = true;
    item.nextAt = now() + delay;
    item.timer = setTimer(() => {
      item.timer = null;
      start(key);
    }, delay);
    return item.nextAt;
  }

  function finish(key, ok) {
    const item = row(key);
    if (ok === true) {
      item.down = false;
      item.attempt = 0;
      item.nextAt = 0;
      clear(item);
      onClear();
      return;
    }
    if (ok !== "busy") item.attempt += 1;
    item.down = true;
    schedule(key);
    onWait();
  }

  function start(key) {
    const item = row(key);
    if (item.inflight || !item.run) return false;
    item.inflight = 1;
    Promise.resolve()
      .then(() => item.run())
      .then((ok) => finish(key, ok))
      .catch((err) => finish(key, gatewayDown(err) ? false : true))
      .finally(() => {
        item.inflight = 0;
      });
    return true;
  }

  return {
    bind(key, run) {
      row(key).run = run;
    },
    fail(key) {
      const item = row(key);
      item.down = true;
      if (item.inflight || item.timer != null) return item.nextAt;
      const at = schedule(key);
      onWait();
      return at;
    },
    kick(key) {
      const item = row(key);
      if (!item.down || item.inflight || !item.run) return false;
      clear(item);
      item.nextAt = now();
      onWait();
      return start(key);
    },
    kickDown() {
      let n = 0;
      for (const key of lanes.keys()) {
        if (this.kick(key)) n += 1;
      }
      return n;
    },
    reset() {
      for (const item of lanes.values()) {
        clear(item);
        item.down = false;
        item.attempt = 0;
        item.nextAt = 0;
        item.inflight = 0;
      }
    },
    status(key, at) {
      const item = lanes.get(key);
      if (!item?.down) return "";
      return reconnectStatus(item.nextAt, at ?? now());
    },
    isDown(key) {
      return !!lanes.get(key)?.down;
    },
    inflight(key) {
      return (lanes.get(key)?.inflight || 0) > 0;
    },
    attempt(key) {
      return lanes.get(key)?.attempt || 0;
    },
  };
}
