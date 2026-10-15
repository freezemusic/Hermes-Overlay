import assert from "node:assert/strict";
import test from "node:test";
import { mostRecentSession, resolveSession, sessionLabel } from "./sessions.js";

const sessions = [
  { id: "visible", title: "Bot Chat", last_active: 50, hidden: false },
  { id: "split", title: "_splitLot", last_active: 10, hidden: true },
  { id: "desktop", title: "System Architect", last_active: 99, hidden: false },
];

test("latest session is not limited to the Bot Chat title", () => {
  assert.equal(mostRecentSession(sessions).id, "desktop");
  assert.equal(resolveSession(sessions, { id: "split", explicit: false, anchor: 10 }).id, "desktop");
  const pinned = resolveSession(sessions, { id: "split", explicit: true, anchor: 99 });
  assert.equal(pinned.id, "split");
  assert.equal(pinned.explicit, true);
  const newer = resolveSession(sessions, { id: "split", explicit: true, anchor: 40 });
  assert.equal(newer.id, "desktop");
  assert.equal(newer.explicit, false);
  assert.equal(newer.anchor, 99);
  assert.equal(resolveSession([], { id: "split", explicit: true, anchor: 1 }), null);
  assert.equal(sessionLabel(sessions[1]), "_splitLot（隱藏）");
});
