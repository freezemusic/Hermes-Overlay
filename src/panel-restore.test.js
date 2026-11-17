import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeOpenPanels, openPanelsKey, openPanelsSnapshot, OPEN_PANELS_CAP, restoreStep } from "./panel-restore.js";

const threads = {
  field: { sessionId: "saved-field", sessionExplicit: true },
  writer: { sessionId: "bot-chat", sessionExplicit: false },
};
const ctx = (over = {}) => ({
  botIds: ["field", "writer"],
  loaded: () => true,
  listReady: () => true,
  shownSession: (id) => threads[id]?.sessionId || "",
  hasSession: (profile, id) => profile === "field" && id === "side-task",
  timedOut: false,
  ...over,
});

test("snapshot keeps roster chat panels and sub-orbs in open order with the shown session", () => {
  const list = openPanelsSnapshot(
    ["writer", "kanban", "settings", "suborb:field:side-task", "field", "ghost", "suborb:ghost:x"],
    { botIds: ["field", "writer"], threadOf: (id) => threads[id] },
  );
  assert.deepEqual(list, [
    { id: "writer", session: "bot-chat", explicit: false },
    { id: "suborb:field:side-task", session: "", explicit: false },
    { id: "field", session: "saved-field", explicit: true },
  ]);
});

test("normalize drops junk and duplicates, caps the list, and never trusts a sub-orb session field", () => {
  const raw = [
    { id: "field", session: "a", explicit: true },
    { id: "field", session: "b" },
    "writer",
    { id: "a:b" },
    { id: "suborb:field:side-task", session: "x", explicit: true },
    { id: "" },
    7,
    null,
  ];
  assert.deepEqual(normalizeOpenPanels(raw), [
    { id: "field", session: "a", explicit: true },
    { id: "writer", session: "", explicit: false },
    { id: "suborb:field:side-task", session: "", explicit: false },
  ]);
  assert.deepEqual(normalizeOpenPanels({}), []);
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `b${i}` }));
  assert.equal(normalizeOpenPanels(many).length, OPEN_PANELS_CAP);
  assert.equal(openPanelsKey([{ id: "field" }]), openPanelsKey([{ id: "field", session: "" }]));
  assert.notEqual(openPanelsKey([{ id: "field", session: "a" }]), openPanelsKey([{ id: "field", session: "b" }]));
});

test("restore opens a Bot Chat panel at once and a picked session only once it came back", () => {
  assert.equal(restoreStep({ id: "writer", session: "bot-chat", explicit: false }, ctx({ loaded: () => false })), "open");
  assert.equal(restoreStep({ id: "field", session: "saved-field", explicit: true }, ctx({ loaded: () => false })), "wait");
  assert.equal(restoreStep({ id: "field", session: "saved-field", explicit: true }, ctx()), "open");
});

test("restore skips a panel whose bot or picked session no longer exists", () => {
  assert.equal(restoreStep({ id: "gone-bot" }, ctx()), "skip:bot-gone");
  assert.equal(restoreStep({ id: "suborb:gone-bot:s1" }, ctx()), "skip:bot-gone");
  assert.equal(restoreStep({ id: "field", session: "deleted", explicit: true }, ctx()), "skip:session-gone");
  assert.equal(restoreStep({ id: "field", session: "saved-field", explicit: true }, ctx({ loaded: () => false, timedOut: true })), "skip:not-loaded");
});

test("a sub-orb opens when its session is listed and is probed when it is not", () => {
  assert.equal(restoreStep({ id: "suborb:field:side-task" }, ctx()), "open");
  assert.equal(restoreStep({ id: "suborb:field:old" }, ctx({ listReady: () => false })), "wait");
  assert.equal(restoreStep({ id: "suborb:field:old" }, ctx({ listReady: () => false, timedOut: true })), "probe");
  assert.equal(restoreStep({ id: "suborb:field:old" }, ctx()), "probe");
});

const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
function body(name) {
  const start = main.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} missing`);
  const next = main.indexOf("\nfunction ", start + 10);
  const nextAsync = main.indexOf("\nasync function ", start + 10);
  const end = [next, nextAsync].filter((n) => n > 0).reduce((a, b) => Math.min(a, b), main.length);
  return main.slice(start, end);
}

test("main.js saves through set_open_panels only after restore and only in Tauri hermes mode", () => {
  const save = body("saveOpenPanels");
  assert.match(save, /state\.openPanelsReady/);
  assert.match(save, /state\.mode !== "hermes" \|\| !inTauri\(\)/);
  assert.match(save, /invoke\("set_open_panels"/);
  assert.doesNotMatch(save, /set_suborb_pin|select_session/);
  assert.match(body("renderBots"), /scheduleOpenPanelsSave\(\)/);
});

test("restore reopens through the ordinary open paths and never through a pin or session write", () => {
  const restore = main.slice(main.indexOf("// R-PN-10: chat panels that were open"), main.indexOf("// R-PN-10 end"));
  assert.ok(restore.length > 100);
  assert.match(restore, /selectBot\(/);
  assert.match(restore, /openSuborbPanel\(/);
  assert.match(restore, /fetch_pinned_session/);
  assert.doesNotMatch(restore, /set_suborb_pin|select_session|openPlanWindow|focusPlan/);
  assert.match(restore, /state\.openPanelsReady = true/);
});
