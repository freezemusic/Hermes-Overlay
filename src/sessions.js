/** Latest session by default. An explicit pick sticks until something is newer than the anchor. */

export function mostRecentSession(sessions) {
  const list = (sessions || []).filter((session) => session && session.id);
  if (!list.length) return null;
  return list.reduce((best, item) => {
    const active = Number(item.last_active) || 0;
    const bestActive = Number(best.last_active) || 0;
    if (active > bestActive) return item;
    if (active < bestActive) return best;
    return item.id < best.id ? item : best;
  });
}

export function resolveSession(sessions, pin = {}) {
  const latest = mostRecentSession(sessions);
  if (!latest) return null;
  const remembered = String(pin.id || "").trim();
  const explicit = pin.explicit === true;
  const anchor = Number(pin.anchor) || 0;
  const picked = explicit && remembered
    ? (sessions || []).find((session) => session.id === remembered)
    : null;
  if (picked) {
    const newest = Number(latest.last_active) || 0;
    if (newest > anchor && latest.id !== picked.id) {
      return { id: latest.id, explicit: false, anchor: newest };
    }
    return { id: picked.id, explicit: true, anchor: Math.max(anchor, newest) };
  }
  return { id: latest.id, explicit: false, anchor: Number(latest.last_active) || 0 };
}

export function sessionLabel(session) {
  const title = String(session?.title || "").trim() || session?.id || "";
  return session?.hidden ? `${title}（隱藏）` : title;
}
