import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  KANBAN_BELL_EMPTY,
  KANBAN_EVENT_CAP,
  KANBAN_UPDATED,
  kanbanBadgeText,
  kanbanChangeLine,
  kanbanEventChange,
  kanbanEvents,
  kanbanEventTime,
  markKanbanEventsRead,
  normalizeBoard,
  pushKanbanEvents,
  unreadKanbanCount,
} from "./kanban.js";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");

function board(tasks, slug = "mt4") {
  return normalizeBoard({ board: slug, columns: [{ name: "todo", tasks }] });
}
const t = (id, title, status, extra = {}) => ({ id, title, status, assignee: "", priority: "", updated_at: "", ...extra });

test("each added and each moved card is its own event; nothing else changed is one 看板有更新 (R-KB-09)", () => {
  const before = board([t("a", "A", "todo"), t("b", "B", "todo")]);
  const after = board([t("a", "A", "ready"), t("b", "B", "blocked"), t("c", "C", "triage"), t("d", "D", "todo")]);
  const events = kanbanEvents(before, after, 1000);
  assert.deepEqual(
    events.map((e) => [e.kind, e.taskId, e.title, e.from, e.to]).sort((x, y) => x[1].localeCompare(y[1])),
    [
      ["moved", "a", "A", "todo", "ready"],
      ["moved", "b", "B", "todo", "blocked"],
      ["added", "c", "C", "", "triage"],
      ["added", "d", "D", "", "todo"],
    ],
  );
  assert.ok(events.every((e) => e.at === 1000 && e.read === false && e.id));
  assert.equal(new Set(events.map((e) => e.id)).size, 4);
  // The 5 s capsule still gets its single summary line (R-KB-02 unchanged).
  assert.equal(kanbanChangeLine(before, after), "新增 2 張卡片");
  const retitled = board([t("a", "A2", "todo"), t("b", "B", "todo")]);
  const generic = kanbanEvents(before, retitled, 2000);
  assert.equal(generic.length, 1);
  assert.equal(generic[0].kind, "updated");
  assert.equal(generic[0].title, KANBAN_UPDATED);
  assert.equal(generic[0].taskId, "");
  assert.deepEqual(kanbanEvents(before, board([t("a", "A", "todo"), t("b", "B", "todo")])), []);
});

test("first snapshot, login, unavailable and a board switch stay quiet", () => {
  const live = board([t("a", "A", "todo")]);
  assert.deepEqual(kanbanEvents(null, live), []);
  assert.deepEqual(kanbanEvents(normalizeBoard({ needs_login: true }), live), []);
  assert.deepEqual(kanbanEvents(live, normalizeBoard({ unavailable: true })), []);
  assert.deepEqual(kanbanEvents(live, board([t("z", "Z", "todo")], "deskrpg")), []);
});

test("the list is newest first, capped at 50, and opening it reads everything", () => {
  let list = [];
  for (let i = 0; i < 60; i += 1) {
    list = pushKanbanEvents(list, [{ id: `e${i}`, at: i, read: false }]);
  }
  assert.equal(KANBAN_EVENT_CAP, 50);
  assert.equal(list.length, 50);
  assert.equal(list[0].id, "e59");
  assert.equal(list.at(-1).id, "e10");
  const batch = pushKanbanEvents([{ id: "old", read: true }], [{ id: "first" }, { id: "second" }]);
  assert.deepEqual(batch.map((e) => e.id), ["second", "first", "old"]);
  assert.equal(unreadKanbanCount(list), 50);
  const read = markKanbanEventsRead(list);
  assert.equal(unreadKanbanCount(read), 0);
  assert.equal(unreadKanbanCount(list), 50, "pure: the old list is not mutated");
});

test("badge text is blank, 1–9, then 9+", () => {
  assert.equal(kanbanBadgeText(0), "");
  assert.equal(kanbanBadgeText(1), "1");
  assert.equal(kanbanBadgeText(9), "9");
  assert.equal(kanbanBadgeText(10), "9+");
  assert.equal(kanbanBadgeText(51), "9+");
  assert.equal(kanbanBadgeText(undefined), "");
});

test("rows show relative or HH:MM time and the status change", () => {
  const now = new Date(2026, 10, 3, 16, 40, 0).getTime();
  assert.equal(kanbanEventTime(now - 5_000, now), "啱啱");
  assert.equal(kanbanEventTime(now - 7 * 60_000, now), "7 分鐘前");
  assert.equal(kanbanEventTime(new Date(2026, 10, 3, 9, 5).getTime(), now), "09:05");
  assert.equal(kanbanEventChange({ kind: "moved", from: "todo", to: "ready" }), "todo → ready");
  assert.equal(kanbanEventChange({ kind: "added", to: "triage" }), "新增 → triage");
  assert.equal(kanbanEventChange({ kind: "updated" }), "");
  assert.equal(KANBAN_BELL_EMPTY, "未有看板通知");
});

test("events stay in memory: nothing in main.js writes them to config", () => {
  assert.match(main, /events: \[\],/);
  assert.doesNotMatch(main, /invoke\([^)]*kanban_events/);
  assert.doesNotMatch(main, /store_kanban_events|kanban_events:/);
  const commit = main.slice(main.indexOf("function commitKanban("), main.indexOf("function mockKanban("));
  assert.match(commit, /kanbanEvents\(state\.kanban\.board, board, Date\.now\(\)\)/);
  assert.match(commit, /pushKanbanEvents\(state\.kanban\.events, events\)/);
  assert.match(commit, /showToast\("kanban"/, "the 5 s capsule is unchanged");
});

test("the panel header has a compact bell with a tooltip and an empty list host", () => {
  const doc = new JSDOM(html).window.document;
  const bell = doc.getElementById("btn-kanban-bell");
  assert.ok(bell);
  assert.equal(bell.title, "看板通知");
  assert.equal(bell.getAttribute("aria-label"), "看板通知");
  assert.equal(bell.closest(".panel-actions")?.querySelector("#btn-kanban-close") !== null, true);
  assert.ok(bell.querySelector("svg"), "icon, not a text button");
  assert.equal(bell.textContent.trim(), "");
  const list = doc.getElementById("kanban-bell-list");
  assert.ok(list?.hidden);
  assert.match(css, /\.icon-btn\.kanban-bell \{[^}]*width:\s*24px[^}]*height:\s*24px/s);
});

test("the orb count badge is pointer-events none and absolutely placed, so the 44px hit disc is unchanged (R-CT)", () => {
  const rule = css.match(/\.orb--kanban \.kanban-count \{([^}]*)\}/s)?.[1] || "";
  assert.match(rule, /position:\s*absolute/);
  assert.match(rule, /pointer-events:\s*none/);
  assert.match(css, /\.orb--kanban\.has-count \.kanban-count \{ display: block; \}/);
  assert.match(css, /\.orb--kanban\.has-count \.unread-dot \{ display: none; \}/);
  // Orb hit rects come from the .morph-orb button box, never from the badge.
  assert.match(main, /shell\.querySelector\("\.morph-orb"\)\?\.getBoundingClientRect\(\)/);
  assert.doesNotMatch(main, /kanban-count[^\n]*getBoundingClientRect/);
});

test("opening the bell marks read, a row opens its card, Esc closes the list first", () => {
  const open = main.slice(main.indexOf("function openKanbanBell()"), main.indexOf("function closeKanbanBell()"));
  assert.match(open, /markKanbanEventsRead/);
  assert.match(open, /renderKanbanOrb\(\)/);
  const paint = main.slice(main.indexOf("function paintKanbanBell()"), main.indexOf("function openKanbanBell()"));
  assert.match(paint, /openKanbanDetail\(entry\.taskId\)/);
  assert.match(paint, /KANBAN_BELL_EMPTY/);
  const esc = main.slice(main.indexOf('if (event.key !== "Escape" || event.repeat) return;'));
  assert.match(esc.slice(0, 200), /closeKanbanBell\(\)/);
});
