import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeOpenPanels, openPanelsKey, openPanelsSnapshot, OPEN_PANELS_CAP, restoredBoxPoint, restoreStep } from "./panel-restore.js";

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

test("startup (boot) runs the restore once; a settings save does not", () => {
  const boot = main.slice(main.indexOf("async function boot() {"));
  assert.match(boot, /await connectHermes\(settings\);\s*void restoreOpenPanels\(settings\.open_panels\);/);
  assert.equal(main.split("void restoreOpenPanels(").length - 1, 1);
});

test("a listed sub-orb waits for its rail slot before it opens, then opens anyway after the place wait", () => {
  const entry = { id: "suborb:field:side-task" };
  assert.equal(restoreStep(entry, ctx({ placed: () => false })), "wait");
  assert.equal(restoreStep(entry, ctx({ placed: () => false, placeTimedOut: true })), "open");
  assert.equal(restoreStep(entry, ctx({ placed: () => true })), "open");
  const restore = main.slice(main.indexOf("// R-PN-10: chat panels that were open"), main.indexOf("// R-PN-10 end"));
  assert.match(restore, /dataset\.homeX/);
  assert.match(restore, /RESTORE_SETTLE_MS/);
});


// R-PN-10 position: a restart puts each panel back where its box was.
test("a saved panel box position survives normalising; half or wild ones are dropped", () => {
  const list = normalizeOpenPanels([
    { id: "suborb:field:left", x: 0, y: 31 },
    { id: "suborb:field:right", x: 1425.4, y: -12 },
    { id: "suborb:field:half", x: 5 },
    { id: "suborb:field:wild", x: 1e9, y: 0 },
    { id: "suborb:field:text", x: "a", y: 1 },
  ]);
  assert.deepEqual(list[0], { id: "suborb:field:left", session: "", explicit: false, x: 0, y: 31 });
  assert.deepEqual(list[1], { id: "suborb:field:right", session: "", explicit: false, x: 1425, y: -12 });
  for (const row of list.slice(2)) assert.equal("x" in row || "y" in row, false, row.id);
});

test("the snapshot carries each open panel's own box, and moving a panel changes the save key", () => {
  const boxes = { "suborb:field:a": { x: 0, y: 40 }, "suborb:field:b": { x: 1425, y: 20 } };
  const ids = ["suborb:field:a", "suborb:field:b"];
  const list = openPanelsSnapshot(ids, { botIds: ["field"], boxOf: (id) => boxes[id] });
  assert.deepEqual(list.map((row) => [row.id, row.x, row.y]), [["suborb:field:a", 0, 40], ["suborb:field:b", 1425, 20]]);
  boxes["suborb:field:b"] = { x: 1400, y: 20 };
  const moved = openPanelsSnapshot(ids, { botIds: ["field"], boxOf: (id) => boxes[id] });
  assert.notEqual(openPanelsKey(list), openPanelsKey(moved));
  // Old call sites without boxOf behave as before.
  assert.deepEqual(openPanelsSnapshot(ids, { botIds: ["field"] }).map((row) => "x" in row), [false, false]);
});

test("two restored panels keep their left and right places and do not overlap", () => {
  const w = 474, h = 560, sw = 1920, sh = 1080;
  const left = restoredBoxPoint({ x: 0, y: 330 }, w, h, sw, sh);
  const right = restoredBoxPoint({ x: 1425, y: 215 }, w, h, sw, sh);
  assert.deepEqual(left, { x: 0, y: 330 });
  assert.deepEqual(right, { x: 1425, y: 215 });
  assert.ok(left.x + w <= right.x, "no overlap");
  // A smaller screen than before keeps the box inside the screen.
  assert.deepEqual(restoredBoxPoint({ x: 1425, y: 900 }, w, h, 1280, 800), { x: 806, y: 240 });
  assert.equal(restoredBoxPoint({ id: "x" }, w, h, sw, sh), null);
});

test("main.js applies a restored box once, before the cascade, for sub-orb and bot panels", () => {
  const sub = body("placeSuborbShell");
  assert.match(sub, /takeRestoredBox\(shell, cascade\.width, cascade\.height\)/);
  assert.match(sub, /restoredAt \? \{ \.\.\.cascade, left: restoredAt\.x, top: restoredAt\.y \}/);
  assert.match(sub, /if \(restoredAt\) shell\.dataset\.dragged = "1"/);
  const bot = body("placeShellElement");
  assert.match(bot, /takeRestoredBox\(shell, placed\.width, placed\.height\)/);
  const take = body("takeRestoredBox");
  assert.match(take, /delete state\.restoreBoxes\[id\]/);
  assert.match(take, /dataset\.opening !== "panel"/);
  const restore = main.slice(main.indexOf("async function restoreOpenPanels"), main.indexOf("// R-PN-10 end"));
  assert.match(restore, /state\.restoreBoxes\[entry\.id\] = /);
  assert.ok(restore.indexOf("state.restoreBoxes[entry.id]") < restore.indexOf("openSuborbPanel(entry.id)"));
  assert.match(body("layoutShells"), /scheduleOpenPanelsSave\(\)/);
  assert.match(body("openPanelBoxOf"), /style\.left/);
});
