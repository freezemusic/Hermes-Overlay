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
  kanbanSeen,
  kanbanColumnLabel,
  kanbanEventUnread,
  KANBAN_BELL_READ_ALL,
  KANBAN_BELL_TIP,
  markKanbanEventsListed,
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
  // R-KB-10: column-head words, never 新增 mixed with English statuses.
  assert.equal(kanbanEventChange({ kind: "moved", from: "todo", to: "ready" }), "TODO → READY");
  assert.equal(kanbanEventChange({ kind: "added", to: "triage" }), "NEW → TRIAGE");
  assert.doesNotMatch(kanbanEventChange({ kind: "added", to: "triage" }), /[\u3400-\u9fff]/);
  assert.equal(kanbanEventChange({ kind: "updated" }), "");
  assert.equal(KANBAN_BELL_EMPTY, "未有看板通知");
});

test("events stay in memory: nothing in main.js writes them to config", () => {
  assert.match(main, /events: \[\],/);
  assert.doesNotMatch(main, /invoke\([^)]*kanban_events/);
  assert.doesNotMatch(main, /store_kanban_events|kanban_events:/);
  const commit = main.slice(main.indexOf("function commitKanban("), main.indexOf("function mockKanban("));
  assert.match(commit, /kanbanEvents\(state\.kanban\.board, board, Date\.now\(\)\)/);
  assert.match(commit, /pushKanbanEvents\(state\.kanban\.events, shown \? markKanbanEventsRead\(events\) : events\)/);
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
  assert.match(open, /clearKanbanUnread\("bell"\)/);
  assert.match(open, /renderKanbanOrb\(\)/);
  const paint = main.slice(main.indexOf("function paintKanbanBell()"), main.indexOf("function openKanbanBell()"));
  assert.match(paint, /openKanbanDetail\(entry\.taskId\)/);
  assert.match(paint, /KANBAN_BELL_EMPTY/);
  const esc = main.slice(main.indexOf('if (event.key !== "Escape" || event.repeat) return;'));
  assert.match(esc.slice(0, 200), /closeKanbanBell\(\)/);
});

/** Pull one top-level function out of main.js and build it with stubs. */
function lift(name, deps) {
  const start = main.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const end = main.indexOf("\n}\n", start) + 2;
  const keys = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  return new Function(...keys, `${main.slice(start, end)}\nreturn ${name};`)(...keys.map((k) => deps[k]));
}

test("kanbanSeen: open, opening, intent open or the bell list count as seen; a collapsing panel does not", () => {
  assert.equal(kanbanSeen({}), false);
  assert.equal(kanbanSeen({ open: true }), true);
  assert.equal(kanbanSeen({ opening: "panel" }), true);
  assert.equal(kanbanSeen({ intent: "open" }), true);
  assert.equal(kanbanSeen({ intent: "preview" }), false);
  assert.equal(kanbanSeen({ open: true, collapsing: true }), false);
  assert.equal(kanbanSeen({ intent: "open", collapsing: true }), false);
  assert.equal(kanbanSeen({ bell: true, collapsing: true }), true);
});

function orbRig() {
  const dom = new JSDOM(`<div class="morph" data-bot-id="kanban"><button class="bot-btn morph-orb orb--kanban has-unread has-count" data-bot-id="kanban"><span class="unread-dot"></span><span class="kanban-count">3</span><span class="orb-ping"></span></button></div>`);
  const doc = dom.window.document;
  const shell = doc.querySelector(".morph");
  const logs = [];
  const state = {
    kanbanOpen: false,
    kanban: { unread: true, bellOpen: false, board: null, fingerprint: "", events: [{ id: 1, read: false }, { id: 2, read: false }, { id: 3, read: false }] },
  };
  const deps = {
    state,
    shellFor: () => shell,
    paintKanbanBell: () => logs.push("paint-bell"),
    debugLog: (k, v) => logs.push(`${k}:${v}`),
    markKanbanEventsRead,
    unreadKanbanCount,
  };
  return { doc, shell, state, logs, deps };
}

test("clearKanbanUnread drops the dot, the count badge and the ping now, without waiting for renderBots (R-KB-09)", () => {
  const rig = orbRig();
  const clear = lift("clearKanbanUnread", rig.deps);
  clear("open");
  const btn = rig.doc.querySelector(".orb--kanban");
  assert.equal(rig.state.kanban.unread, false);
  assert.equal(unreadKanbanCount(rig.state.kanban.events), 0);
  assert.equal(btn.classList.contains("has-unread"), false);
  assert.equal(btn.classList.contains("has-count"), false);
  assert.equal(btn.querySelector(".kanban-count").textContent, "");
  assert.equal(rig.shell.querySelector(".orb-ping"), null);
  assert.ok(rig.logs.includes("kanban-unread-clear:open"));
});

test("every open route clears through clearKanbanUnread: open, raise (already open / mid-morph) and the bell", () => {
  const toggle = main.slice(main.indexOf("function toggleKanban()"), main.indexOf("function openKanban()"));
  const raise = toggle.slice(toggle.indexOf('action === "raise"'), toggle.indexOf("openKanban();"));
  assert.match(raise, /clearKanbanUnread\("raise"\)/);
  const open = main.slice(main.indexOf("function openKanban()"), main.indexOf("function closeKanban()"));
  assert.match(open, /state\.kanbanOpen = true;\s*clearKanbanUnread\("open"\);/);
  // The open no longer depends on the deferred renderBots repaint alone.
  assert.ok(open.indexOf("clearKanbanUnread") < open.indexOf("runShellMorph"));
  const bell = main.slice(main.indexOf("function openKanbanBell()"), main.indexOf("function closeKanbanBell()"));
  assert.match(bell, /clearKanbanUnread\("bell"\)/);
  // Ctrl+click and a plain click both land in toggleKanban; nothing else opens the panel.
  assert.equal((main.match(/(?<!function )\bopenKanban\(\)/g) || []).length, 1);
  assert.equal((main.match(/kanban: \(\) => toggleKanban\(\)/g) || []).length, 2);
});

function commitRig({ blocked = false, seenNow = false } = {}) {
  const rig = orbRig();
  rig.state.kanban.unread = false;
  rig.state.kanban.events = [];
  rig.state.kanban.board = board([{ id: "a", title: "A", status: "todo" }]);
  rig.state.kanban.fingerprint = "old";
  const pings = [];
  const flags = { blocked, seenNow };
  const commit = lift("commitKanban", {
    state: rig.state,
    backgroundBlocked: () => flags.blocked,
    debugLog: () => {},
    armPresentationFlush: () => {},
    boardFingerprint: (b) => JSON.stringify(b),
    kanbanChangeLine,
    kanbanEvents,
    kanbanSeenNow: () => flags.seenNow,
    pushKanbanEvents,
    markKanbanEventsRead,
    paintKanbanBell: () => {},
    renderKanbanOrb: () => {},
    showToast: () => {},
    pingOrb: (id) => pings.push(id),
    paintKanban: () => {},
  });
  const next = board([{ id: "a", title: "A", status: "todo" }, { id: "b", title: "B", status: "todo" }]);
  return { ...rig, commit, flags, pings, next };
}

test("a change while the panel is closed sets unread, pings and counts", () => {
  const rig = commitRig();
  rig.commit(rig.next);
  assert.equal(rig.state.kanban.unread, true);
  assert.deepEqual(rig.pings, ["kanban"]);
  assert.equal(unreadKanbanCount(rig.state.kanban.events), 1);
});

test("a change while the panel is open or opening never sets unread; its events land already read", () => {
  const rig = commitRig({ seenNow: true });
  rig.commit(rig.next);
  assert.equal(rig.state.kanban.unread, false);
  assert.deepEqual(rig.pings, []);
  assert.equal(rig.state.kanban.events.length, 1);
  assert.equal(unreadKanbanCount(rig.state.kanban.events), 0);
});

test("a deferred commit that arrived while open stays seen when it is flushed after the close", () => {
  const rig = commitRig({ blocked: true, seenNow: true });
  rig.commit(rig.next);
  assert.equal(rig.state.kanbanPending, rig.next);
  assert.equal(rig.state.kanbanPendingSeen, true);
  // Panel closed, morph done: the flush passes the remembered flag along.
  rig.flags.blocked = false;
  rig.flags.seenNow = false;
  const release = main.slice(main.indexOf("if (state.kanbanPending) {"), main.indexOf("} else if (state.kanbanDeferred) {"));
  assert.match(release, /commitKanban\(board, \{ seen \}\)/);
  assert.match(release, /state\.kanbanPendingSeen = false/);
  rig.commit(rig.state.kanbanPending, { seen: rig.state.kanbanPendingSeen });
  assert.equal(rig.state.kanban.unread, false);
  assert.deepEqual(rig.pings, []);
});

test("a deferred commit from a closed board still marks unread when it lands", () => {
  const rig = commitRig({ blocked: true });
  rig.commit(rig.next);
  assert.equal(rig.state.kanbanPendingSeen, false);
  rig.flags.blocked = false;
  rig.commit(rig.state.kanbanPending, { seen: rig.state.kanbanPendingSeen });
  assert.equal(rig.state.kanban.unread, true);
});

test("the ping ring removes itself when its one-shot animation ends", () => {
  const ping = main.slice(main.indexOf("function pingOrb("), main.indexOf("function showToast("));
  assert.match(ping, /addEventListener\("animationend", \(\) => ping\.remove\(\), \{ once: true \}\)/);
});

test("Kanban column heads stay pinned while the board scrolls down (sticky, opaque fill)", () => {
  const head = css.slice(css.indexOf(".kanban-col-head {"), css.indexOf("}", css.indexOf(".kanban-col-head {")));
  assert.match(head, /position: sticky;/);
  assert.match(head, /top: 0;/);
  assert.match(head, /z-index: 1;/);
  assert.match(head, /background: rgb\(247 248 248 \/ \.96\);/);
  // The board itself is the scroller the heads stick to.
  const boardRule = css.slice(css.indexOf(".kanban {"), css.indexOf("}", css.indexOf(".kanban {")));
  assert.match(boardRule, /overflow: auto;/);
  // The bell list floats over the pinned heads.
  const list = css.slice(css.indexOf(".kanban-bell-list {"), css.indexOf("}", css.indexOf(".kanban-bell-list {")));
  assert.match(list, /z-index: 6;/);
});

test("R-KB-10 column labels, unread for this showing, and 全部已讀", () => {
  assert.equal(kanbanColumnLabel("scheduled"), "SCHEDULED");
  assert.equal(kanbanColumnLabel(""), "?");
  const fresh = new Set(["b"]);
  assert.equal(kanbanEventUnread({ id: "a", listed: false }, fresh), true);
  assert.equal(kanbanEventUnread({ id: "b", listed: true }, fresh), true, "new when this showing opened");
  assert.equal(kanbanEventUnread({ id: "c", listed: true }, fresh), false);
  const all = markKanbanEventsListed([{ id: "a" }, { id: "b", read: true, listed: true }]);
  assert.deepEqual(all.map((e) => [e.read, e.listed]), [[true, true], [true, true]]);
  assert.equal(KANBAN_BELL_READ_ALL, "全部已讀");
  assert.equal(KANBAN_BELL_TIP, "看板通知");
});

test("R-KB-10 the bell list paints a 32px head, unread / read rows and a scroller", () => {
  const dom = new JSDOM(`<aside id="kanban-panel"><button id="btn-kanban-bell"></button><span id="kanban-bell-count"></span><div id="kanban-bell-list" hidden></div></aside>`);
  const doc = dom.window.document;
  const now = Date.now();
  const state = {
    kanban: {
      bellOpen: true,
      bellFresh: new Set(["e1"]),
      events: [
        { id: "e1", kind: "moved", taskId: "t1", title: "New one", from: "todo", to: "ready", at: now, read: true, listed: true },
        { id: "e2", kind: "added", taskId: "t2", title: "Older", from: "", to: "triage", at: now - 120_000, read: true, listed: true },
      ],
    },
  };
  const calls = [];
  const paint = lift("paintKanbanBell", {
    $: (sel) => doc.querySelector(sel),
    document: doc,
    state,
    KANBAN_BELL_TIP,
    KANBAN_BELL_READ_ALL,
    KANBAN_BELL_EMPTY,
    kanbanBadgeText,
    unreadKanbanCount,
    kanbanEventUnread,
    kanbanEventTime,
    kanbanEventChange,
    placeKanbanBellList: () => calls.push("place"),
    readAllKanbanBell: () => calls.push("read-all"),
    closeKanbanBell: () => calls.push("close"),
    openKanbanDetail: () => {},
  });
  paint();
  const list = doc.getElementById("kanban-bell-list");
  assert.equal(list.hidden, false);
  assert.deepEqual(calls, ["place"]);
  const head = list.querySelector(":scope > .kanban-bell-head");
  assert.equal(head.querySelector(".kanban-bell-heading").textContent, "看板通知");
  const readAll = head.querySelector("button.kanban-bell-readall");
  assert.equal(readAll.textContent, "全部已讀");
  assert.equal(readAll.disabled, false);
  const rows = [...list.querySelectorAll(":scope > .kanban-bell-rows > .kanban-bell-row")];
  assert.deepEqual(rows.map((r) => r.className), ["kanban-bell-row is-unread", "kanban-bell-row is-read"]);
  assert.deepEqual(rows.map((r) => r.querySelector(".kanban-bell-change").textContent), ["TODO → READY", "NEW → TRIAGE"]);
  readAll.click();
  assert.deepEqual(calls, ["place", "read-all"]);
  // Nothing unread: 全部已讀 is disabled.
  state.kanban.bellFresh = new Set();
  paint();
  assert.equal(list.querySelector(".kanban-bell-readall").disabled, true);
  assert.equal(list.querySelectorAll(".kanban-bell-row.is-read").length, 2);
});

test("R-KB-10 bell list CSS: head 32px, 12px Barlow #0000f2, bars and weights, 360px, 12px bottom, 16px fade", () => {
  const rule = (sel) => {
    const at = css.indexOf(`\n${sel} {`);
    assert.ok(at >= 0, sel);
    return css.slice(at, css.indexOf("}", at));
  };
  assert.match(rule(".kanban-bell-head"), /height:\s*32px/);
  for (const sel of [".kanban-bell-heading", ".kanban-bell-readall"]) {
    assert.match(rule(sel), /font:\s*500 12px\/1 var\(--font-label\)/);
    assert.match(rule(sel), /color:\s*#0000f2/);
  }
  assert.match(css, /--font-label: "Barlow Condensed"/);
  assert.match(rule(".kanban-bell-list"), /max-height:\s*min\(360px/);
  assert.match(rule(".kanban-bell-list"), /overflow:\s*hidden/);
  assert.match(rule(".kanban-bell-rows"), /overflow:\s*auto/);
  assert.match(rule(".kanban-bell-rows"), /padding:\s*4px 4px 12px/);
  assert.match(rule(".kanban-bell-rows.has-more"), /mask-image:\s*linear-gradient\(to bottom, #000 calc\(100% - 16px\), transparent\)/);
  assert.match(rule(".kanban-bell-row"), /border-left:\s*2px solid transparent/);
  assert.match(css, /\.kanban-bell-row\.is-unread \{ border-left-color: #0000f2; \}/);
  assert.match(css, /\.kanban-bell-row\.is-unread \.kanban-bell-title \{ font-weight: 600;/);
  assert.match(css, /\.kanban-bell-row\.is-read \.kanban-bell-title \{ font-weight: 400; color: #616191; \}/);
  // 6px under the bell.
  const place = main.slice(main.indexOf("function placeKanbanBellList("), main.indexOf("function openKanbanBell()"));
  assert.match(place, /b\.bottom - p\.top \+ 6/);
  // Read all keeps the list open and clears through clearKanbanUnread.
  const readAll = main.slice(main.indexOf("function readAllKanbanBell()"), main.indexOf("function closeKanbanBell()"));
  assert.match(readAll, /markKanbanEventsListed/);
  assert.match(readAll, /clearKanbanUnread\("read-all"\)/);
  assert.doesNotMatch(readAll, /closeKanbanBell|bellOpen = false/);
});

test("R-KB-11 the card chip is the Hermes priority: hidden at 0 / blank, else a 12px icon, the number and a tooltip", async () => {
  const { kanbanPriority } = await import("./kanban.js");
  assert.equal(kanbanPriority(0), null);
  assert.equal(kanbanPriority("0"), null);
  assert.equal(kanbanPriority(""), null);
  assert.equal(kanbanPriority(undefined), null);
  assert.deepEqual(kanbanPriority("3"), { text: "3", tip: "優先度 3：數字愈大，Hermes 愈早派" });
  assert.equal(kanbanPriority("high").text, "high");
  const { translate } = await import("./look.js");
  assert.equal(translate(kanbanPriority("3").tip, "en"), "Priority 3. Higher numbers are picked up first.");
  const dom = new JSDOM("<div></div>");
  const doc = dom.window.document;
  const chipOf = lift("kanbanPriorityChip", { document: doc, translate, look: { lang: "zh-HK" } });
  const card = lift("kanbanCard", {
    document: doc,
    state: { bots: [] },
    ownerColor: () => "#0000f2",
    kanbanPriority,
    kanbanPriorityChip: chipOf,
    startKanbanPointer: () => {},
  });
  const without = card({ id: "a", title: "A", assignee: "default", priority: "0" });
  assert.equal(without.querySelector(".kanban-priority"), null, "0 is hidden");
  assert.equal(without.querySelector(".kanban-meta").textContent, "default");
  const withChip = card({ id: "b", title: "B", assignee: "default", priority: "2" });
  const chip = withChip.querySelector(".kanban-priority");
  assert.ok(chip);
  assert.equal(chip.title, "優先度 2：數字愈大，Hermes 愈早派");
  assert.equal(chip.getAttribute("aria-label"), chip.title);
  const icon = chip.querySelector("svg.kanban-priority-icon");
  assert.equal(icon.getAttribute("width"), "12");
  assert.equal(icon.getAttribute("height"), "12");
  assert.equal(chip.querySelector(".kanban-priority-value").textContent, "2");
  const en = lift("kanbanPriorityChip", { document: doc, translate, look: { lang: "en" } })(kanbanPriority("2"));
  assert.equal(en.title, "Priority 2. Higher numbers are picked up first.");
  assert.match(css, /\.kanban-priority-icon \{[^}]*width:\s*12px;[^}]*height:\s*12px/s);
  // Detail meta drops priority 0 too.
  const detail = main.slice(main.indexOf("function paintKanbanDetail("), main.indexOf("async function signInKanban("));
  assert.match(detail, /kanbanPriority\(task\.priority\)\?\.text/);
});

test("R-KB-13 card detail: the card's 2px bar left of the title, 12px under 返回", () => {
  const detail = main.slice(main.indexOf("function paintKanbanDetail("), main.indexOf("async function signInKanban("));
  assert.match(detail, /back\.className = "icon-btn kanban-detail-back"/);
  assert.match(detail, /title\.className = "kanban-detail-title"/);
  assert.match(detail, /title\.style\.setProperty\("--owner", ownerColor\(task\.assignee, state\.bots\)\)/);
  const title = css.slice(css.indexOf(".kanban-detail .kanban-detail-title {"), css.indexOf("}", css.indexOf(".kanban-detail .kanban-detail-title {")));
  assert.match(title, /margin-top:\s*12px/);
  assert.match(title, /border-left:\s*2px solid var\(--owner, var\(--bot\)\)/);
  // The card on the board uses the same bar.
  assert.match(css, /\.kanban-card \{[^}]*border-left:\s*2px solid var\(--owner, var\(--bot\)\)/s);
  assert.match(css, /\.kanban-detail \.kanban-detail-back \{ display: block;/);
});
