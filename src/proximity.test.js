import assert from "node:assert/strict";
import test from "node:test";
import {
  colorForIndex,
  distanceToHit,
  distanceToRect,
  elementOpacity,
  elementStates,
  isCloseHit,
  isOrbHit,
  isPanelHit,
  isPillHit,
  focusLossAction,
  osFocusAction,
  selectBlurAction,
  inkFor,
  latchedElementIds,
  linuxAltWarning,
  composerKeyAction,
  ownComposerKey,
  modifierMatches,
  modifierEngages,
  guardPublishedHits,
  MODIFIER_ARM_MS,
  nextOrbPulse,
  nextDropdownOpen,
  pinToggle,
  applyDropdownDismiss,
  invokeFailureMessage,
  settingsQuitAction,
  selectKeyOpensDropdown,
} from "./proximity.js";

test("new bot colours walk the palette", () => {
  assert.notEqual(colorForIndex(0), colorForIndex(1));
  assert.equal(colorForIndex(10), colorForIndex(0));
});

test("forced element stays solid at any distance", () => {
  const fade = { fadeDistance: 120, minOpacity: 0.18, fadeEnabled: true };
  assert.equal(elementOpacity({ solid: true, distance: 0, ...fade }), 1);
  assert.equal(elementOpacity({ solid: true, distance: 5000, ...fade }), 1);
  assert.equal(elementOpacity({ solid: false, distance: 0, ...fade }), 0.18);
  assert.equal(elementOpacity({ solid: false, distance: 120, ...fade }), 1);
  const mid = elementOpacity({ solid: false, distance: 60, ...fade });
  assert.ok(mid > 0.18 && mid < 1);
});

const sampleBots = [
  { id: "bot:a", x: 0, y: 0, w: 40, h: 40, round: true },
  { id: "bot:b", x: 100, y: 0, w: 40, h: 40, round: true },
  { id: "center", x: 0, y: 80, w: 120, h: 40 },
  { id: "toast:1", x: 200, y: 0, w: 40, h: 20 },
];

const fadeOpts = { fadeDistance: 120, minOpacity: 0.18, fadeEnabled: true };

function byId(frames, id) {
  return frames.find((item) => item.id === id);
}

test("cursor near a panel does not fade it", () => {
  const cursor = { x: 1000, y: 1000 };
  const held = elementStates({ held: true, cursor, rects: sampleBots, ...fadeOpts });
  const idle = elementStates({ held: false, cursor, rects: sampleBots, ...fadeOpts });
  assert.ok(held.every((item) => !item.capture));
  assert.ok(idle.every((item) => !item.capture));
  assert.equal(byId(held, "bot:a").opacity, 0.18);
  assert.equal(byId(idle, "bot:a").opacity, 0.18);
  assert.equal(byId(idle, "center").opacity, 1);
  assert.equal(byId(held, "center").opacity, 0.18);

  const outside = { x: 70, y: 20 };
  const near = elementStates({ held: false, cursor: outside, rects: sampleBots, ...fadeOpts });
  assert.equal(byId(near, "bot:a").opacity, 0.18);
  assert.equal(byId(near, "bot:a").capture, false);
  assert.equal(byId(near, "center").opacity, 1);
  assert.equal(byId(near, "center").capture, false);
});

test("orbs stay faded and click-through until the modifier is held over one", () => {
  const overA = elementStates({ held: false, cursor: { x: 20, y: 20 }, rects: sampleBots, ...fadeOpts });
  assert.equal(byId(overA, "bot:a").opacity, 0.18);
  assert.equal(byId(overA, "bot:a").capture, false);
  assert.equal(byId(overA, "bot:b").opacity, 0.18);
  assert.equal(byId(overA, "bot:b").capture, false);
  assert.equal(byId(overA, "center").opacity, 1);
  assert.equal(byId(overA, "center").capture, false);
  assert.equal(overA.filter((item) => item.capture).length, 0);

  const held = elementStates({ held: true, cursor: { x: 20, y: 20 }, rects: sampleBots, ...fadeOpts });
  assert.equal(byId(held, "bot:a").opacity, 1);
  assert.equal(byId(held, "bot:a").capture, true);
  assert.equal(byId(held, "bot:b").opacity, 0.18);
  assert.equal(byId(held, "bot:b").capture, false);
  assert.equal(byId(held, "toast:1").opacity, 1);
  assert.equal(byId(held, "toast:1").capture, false);
  assert.equal(byId(held, "center").opacity, 0.18);
  assert.equal(byId(held, "center").capture, false);
  assert.equal(isOrbHit({ id: "bot:settings", round: true }), true);
  assert.equal(isOrbHit({ id: "bot:kanban" }), true);
  assert.equal(isPanelHit({ id: "center" }), true);

  const overCenter = elementStates({
    held: false,
    cursor: { x: 40, y: 100 },
    rects: sampleBots,
    ...fadeOpts,
  });
  assert.equal(byId(overCenter, "center").opacity, 1);
  assert.equal(byId(overCenter, "center").capture, true);
  assert.equal(byId(overCenter, "bot:a").capture, false);
});

test("distance is zero inside a rect", () => {
  const rect = { x: 10, y: 10, w: 20, h: 20 };
  assert.equal(distanceToRect(15, 15, rect), 0);
  assert.equal(distanceToRect(10, 0, rect), 10);
});

test("round avatar ignores bounding-box corners", () => {
  const orb = { id: "bot", x: 0, y: 0, w: 100, h: 100, round: true };
  assert.equal(distanceToHit(50, 50, orb), 0);
  assert.ok(Math.abs(distanceToHit(110, 50, orb) - 10) < 0.001);
  assert.ok(distanceToHit(100, 100, orb) > 12);
  const frames = elementStates({
    held: false,
    cursor: { x: 100, y: 100 },
    rects: [orb],
    ...fadeOpts,
  });
  assert.equal(frames[0].capture, false);
  assert.equal(frames[0].opacity, 0.18);
  const rim = elementStates({
    held: false,
    cursor: { x: 110, y: 50 },
    rects: [orb],
    ...fadeOpts,
  });
  assert.equal(rim[0].capture, false);
  assert.equal(rim[0].opacity, 0.18);
  const heldRim = elementStates({
    held: true,
    cursor: { x: 110, y: 50 },
    rects: [orb],
    ...fadeOpts,
  });
  assert.equal(heldRim[0].capture, true);
  assert.equal(heldRim[0].opacity, 1);
  const square = elementStates({
    held: false,
    cursor: { x: 100, y: 100 },
    rects: [{ ...orb, round: false }],
    ...fadeOpts,
  });
  assert.equal(square[0].capture, true);
  assert.equal(square[0].opacity, 1);
  const heldSquare = elementStates({
    held: true,
    cursor: { x: 50, y: 50 },
    rects: [{ ...orb, round: false }],
    ...fadeOpts,
  });
  assert.equal(heldSquare[0].capture, false);
  assert.ok(heldSquare[0].opacity < 1);
  assert.equal(isPanelHit(orb), false);
  assert.equal(isPanelHit({ id: "center" }), true);
  assert.equal(isPanelHit({ id: "toast:1" }), false);
  assert.equal(isPillHit({ id: "pill:a" }), true);
  assert.equal(isOrbHit({ id: "pill:a", round: true }), false);
  assert.equal(isPanelHit({ id: "pill:a" }), false);
});

test("the close button passes through while the modifier is held", () => {
  const rects = [
    { id: "panel:a", x: 0, y: 0, w: 420, h: 560, z: 4 },
    { id: "close:a", x: 300, y: 8, w: 100, h: 80, z: 44 },
  ];
  assert.equal(isCloseHit(rects[1]), true);
  assert.equal(isPanelHit(rects[1]), false);
  assert.equal(isOrbHit({ id: "close:a", round: true }), false);
  const over = { x: 340, y: 40 };
  const held = elementStates({ held: true, cursor: over, rects, ...fadeOpts });
  assert.equal(byId(held, "close:a").opacity, 1);
  assert.equal(byId(held, "close:a").capture, false);
  assert.equal(byId(held, "panel:a").capture, false);
  assert.equal(byId(held, "panel:a").opacity, 0.18);
  const idle = elementStates({ held: false, cursor: over, rects, ...fadeOpts });
  assert.equal(byId(idle, "close:a").capture, true);
  assert.equal(byId(idle, "panel:a").capture, false);
  const away = elementStates({ held: true, cursor: { x: 20, y: 200 }, rects, ...fadeOpts });
  assert.equal(byId(away, "close:a").capture, false);
  assert.equal(byId(away, "panel:a").capture, false);
});

test("a message preview pill stays solid and click-through until the modifier is held", () => {
  const rects = [
    { id: "pill:a", x: 0, y: 0, w: 320, h: 44 },
    { id: "bot:b", x: 400, y: 0, w: 44, h: 44, round: true },
    { id: "panel:a", x: 0, y: 80, w: 420, h: 560 },
  ];
  const idle = elementStates({ held: false, cursor: { x: 40, y: 20 }, rects, ...fadeOpts });
  assert.equal(byId(idle, "pill:a").opacity, 1);
  assert.equal(byId(idle, "pill:a").capture, false);
  assert.equal(byId(idle, "bot:b").opacity, 0.18);
  assert.equal(byId(idle, "panel:a").opacity, 1);
  const held = elementStates({ held: true, cursor: { x: 40, y: 20 }, rects, ...fadeOpts });
  assert.equal(byId(held, "pill:a").opacity, 1);
  assert.equal(byId(held, "pill:a").capture, true);
  assert.equal(byId(held, "bot:b").opacity, 0.18);
  assert.equal(byId(held, "bot:b").capture, false);
  assert.equal(byId(held, "panel:a").opacity, 0.18);
  assert.equal(byId(held, "panel:a").capture, false);
});

test("a flush keeps the orb under the cursor while the modifier is held", () => {
  const orb = { id: "bot:a", x: 10, y: 10, w: 44, h: 44, z: 0, round: true };
  const kept = guardPublishedHits({
    rects: [],
    previous: [orb],
    held: true,
    pointerDown: false,
    cursor: { x: 20, y: 20 },
  });
  assert.equal(kept.kept, true);
  assert.equal(kept.rects[0].id, "bot:a");
  const away = guardPublishedHits({
    rects: [],
    previous: [orb],
    held: true,
    pointerDown: false,
    cursor: { x: 400, y: 400 },
  });
  assert.equal(away.kept, false);
  assert.equal(away.rects.length, 0);
  const press = guardPublishedHits({
    rects: [],
    previous: [orb],
    held: false,
    pointerDown: true,
    cursor: { x: 400, y: 400 },
  });
  assert.equal(press.kept, true);
  assert.equal(press.rects[0].id, "bot:a");
  const injected = guardPublishedHits({
    rects: [{ id: "kanban", x: 0, y: 0, w: 400, h: 400, round: false }],
    previous: [],
    held: true,
    pointerDown: false,
    cursor: { x: 20, y: 20 },
    orb,
  });
  assert.equal(injected.kept, false);
  assert.equal(injected.rects.some((rect) => rect.id === "bot:a"), true);
  assert.equal(injected.rects.some((rect) => rect.id === "kanban"), true);
});

test("light swatches use dark ink", () => {
  assert.equal(inkFor("#f2f200"), "#1a1a1a");
  assert.equal(inkFor("#0000f2"), "#f5f5f5");
});

test("a composer keeps the next key after the modifier comes up", () => {
  assert.equal(composerKeyAction({ key: "Control", composerConnected: true }), "remember");
  assert.equal(composerKeyAction({
    key: "a",
    composerConnected: true,
    activeIsComposer: true,
  }), "type");
  assert.equal(composerKeyAction({
    key: "a",
    composerConnected: true,
    activeIsComposer: false,
  }), "insert");
  assert.equal(composerKeyAction({
    key: "a",
    ctrlKey: true,
    composerConnected: true,
    activeIsComposer: false,
  }), "ignore");
  assert.equal(composerKeyAction({ key: "a", composerConnected: false }), "ignore");
  assert.equal(composerKeyAction({
    key: "Enter",
    composerConnected: true,
    activeIsComposer: true,
  }), "send");
  assert.equal(composerKeyAction({
    key: "Enter",
    composerConnected: true,
    activeIsComposer: false,
  }), "send");
  assert.equal(composerKeyAction({ key: "Enter", composerConnected: false }), "ignore");
  assert.equal(composerKeyAction({
    key: "Enter",
    ctrlKey: true,
    composerConnected: true,
  }), "ignore");
  assert.equal(composerKeyAction({ key: "Escape", composerConnected: true }), "ignore");
});

test("a busy open owns composer keys until the seam settles", () => {
  assert.equal(ownComposerKey({ action: "type", busy: true, settling: true }), true);
  assert.equal(ownComposerKey({ action: "insert", busy: true, settling: true }), true);
  assert.equal(ownComposerKey({ action: "send", busy: true, settling: true }), false);
  assert.equal(ownComposerKey({ action: "type", busy: true, settling: false }), false);
  assert.equal(ownComposerKey({ action: "type", busy: false, settling: true }), false);
  assert.equal(ownComposerKey({ action: "ignore", busy: true, settling: true }), false);
});

test("modifier keys", () => {
  assert.equal(modifierMatches("ctrl", "Control"), true);
  assert.equal(modifierMatches("ctrl", "Shift"), false);
  assert.equal(modifierMatches("shift", "Shift"), true);
  assert.equal(modifierMatches("alt", "Alt"), true);
});

test("ctrl+c and ctrl+v do not flash the overlay", () => {
  const copy = modifierEngages({
    modifier: "ctrl",
    keys: ["Control", "c"],
    now: 500,
    armedAt: 0,
    suppressed: false,
  });
  assert.equal(copy.held, false);
  assert.equal(copy.suppressed, true);
  const tail = modifierEngages({
    modifier: "ctrl",
    keys: ["Control"],
    now: 800,
    armedAt: copy.armedAt,
    suppressed: copy.suppressed,
  });
  assert.equal(tail.held, false);
  assert.equal(tail.suppressed, true);
  const up = modifierEngages({
    modifier: "ctrl",
    keys: [],
    now: 900,
    armedAt: tail.armedAt,
    suppressed: tail.suppressed,
  });
  assert.equal(up.held, false);
  assert.equal(up.suppressed, false);

  const early = modifierEngages({ modifier: "ctrl", keys: ["Control"], now: 1000 });
  assert.equal(early.held, false);
  assert.equal(early.armedAt, 1000);
  const armed = modifierEngages({
    modifier: "ctrl",
    keys: ["Control"],
    now: 1000 + MODIFIER_ARM_MS,
    armedAt: early.armedAt,
  });
  assert.equal(armed.held, true);
  const paste = modifierEngages({ modifier: "ctrl", keys: ["Control", "v"], now: 2000, armedAt: 0 });
  assert.equal(paste.held, false);
  const shift = modifierEngages({ modifier: "shift", keys: ["Shift", "c"], now: 200, armedAt: 0 });
  assert.equal(shift.held, true);
});

test("interactive lock names one panel and follows window focus", () => {
  assert.deepEqual(latchedElementIds({ textFocused: true }), ["center"]);
  assert.deepEqual(latchedElementIds({ textFocused: true, slashOpen: true }), ["center", "slash"]);
  assert.deepEqual(latchedElementIds({ settingsOpen: true }), ["settings"]);
  assert.deepEqual(latchedElementIds({ textFocused: true, textInSettings: true }), ["settings"]);
  assert.deepEqual(latchedElementIds({ pointerHitId: "bot:a" }), ["bot:a"]);
  assert.deepEqual(latchedElementIds({ textFocused: true, windowFocused: false }), []);
  assert.deepEqual(latchedElementIds({ settingsOpen: true, windowFocused: false }), []);
  assert.deepEqual(latchedElementIds({}), []);
});

const overlapPanels = [
  { id: "center", x: 0, y: 0, w: 400, h: 500, z: 0 },
  { id: "settings", x: 360, y: 40, w: 420, h: 640, z: 30 },
];

test("overlap prefers latched settings, then higher z-order", () => {
  const cursor = { x: 380, y: 80 };
  const both = elementStates({
    held: false,
    latchedIds: ["center", "settings"],
    cursor,
    rects: overlapPanels,
    ...fadeOpts,
  });
  assert.equal(byId(both, "settings").capture, true);
  assert.equal(byId(both, "center").capture, false);

  const onlySettings = elementStates({
    held: false,
    latchedIds: ["settings"],
    cursor,
    rects: overlapPanels,
    ...fadeOpts,
  });
  assert.equal(byId(onlySettings, "settings").capture, true);
  assert.equal(byId(onlySettings, "center").capture, false);

  const byZ = elementStates({ held: false, latchedIds: [], cursor, rects: overlapPanels, ...fadeOpts });
  assert.equal(byId(byZ, "settings").capture, true);
  assert.equal(byId(byZ, "center").capture, false);
  assert.equal(byId(byZ, "settings").opacity, 1);

  const passed = elementStates({ held: true, latchedIds: [], cursor, rects: overlapPanels, ...fadeOpts });
  assert.ok(passed.every((item) => !item.capture));
  assert.ok(passed.every((item) => item.opacity < 1));

  const latchedCenter = elementStates({
    held: false,
    latchedIds: ["center"],
    cursor,
    rects: overlapPanels,
    ...fadeOpts,
  });
  assert.equal(byId(latchedCenter, "center").capture, true);
  assert.equal(byId(latchedCenter, "settings").capture, false);
});

test("dropdown flag holds the lock only while the menu is open", () => {
  assert.equal(nextDropdownOpen(false, "pointerdown"), true);
  assert.equal(nextDropdownOpen(false, "open-key"), true);
  assert.equal(selectKeyOpensDropdown("ArrowDown"), true);
  assert.equal(selectKeyOpensDropdown(" "), true);
  assert.equal(selectKeyOpensDropdown("Enter"), true);
  assert.equal(selectKeyOpensDropdown("a"), false);
  assert.equal(nextDropdownOpen(true, "change"), false);
  assert.equal(nextDropdownOpen(true, "blur"), false);
  assert.equal(nextDropdownOpen(true, "escape"), false);
  assert.equal(nextDropdownOpen(true, "window-focus"), false);
  assert.equal(nextDropdownOpen(false, "change"), false);

  assert.equal(focusLossAction({ source: "tauri-window", dropdownOpen: true }), "hold");
  assert.equal(focusLossAction({ source: "webview", dropdownOpen: true }), "hold");
  assert.equal(focusLossAction({ source: "tauri-window", dropdownOpen: false }), "release");
  assert.equal(focusLossAction({ source: "webview", dropdownOpen: false }), "debounce");
  assert.equal(focusLossAction({ dropdownOpen: true, focusOwner: "own" }), "hold");
  assert.equal(focusLossAction({ dropdownOpen: true, focusOwner: "other" }), "release");
  assert.equal(osFocusAction("own"), "hold");
  assert.equal(osFocusAction("other"), "release");
  assert.equal(osFocusAction("unknown"), "ignore");
});

test("select blur while the page is unfocused does not close the dropdown flag", () => {
  assert.equal(selectBlurAction({ dropdownOpen: true, documentFocused: false }), "defer");
  assert.equal(selectBlurAction({ dropdownOpen: true, documentFocused: true }), "close");
  assert.equal(selectBlurAction({ dropdownOpen: false, documentFocused: false }), "ignore");
});

test("selected orb pulses only after the first known selection changes", () => {
  const first = nextOrbPulse(undefined, "planner");
  assert.equal(first.pulseId, null);
  assert.equal(first.rendered, "planner");
  const same = nextOrbPulse(first.rendered, "planner");
  assert.equal(same.pulseId, null);
  const changed = nextOrbPulse(same.rendered, "coder");
  assert.equal(changed.pulseId, "coder");
  const cleared = nextOrbPulse(changed.rendered, null);
  assert.equal(cleared.pulseId, null);
  assert.equal(cleared.rendered, null);
});

test("linux alt modifier shows a warning", () => {
  assert.equal(linuxAltWarning("Linux x86_64"), true);
  assert.equal(linuxAltWarning("X11; Linux x86_64"), true);
  assert.equal(linuxAltWarning("MacIntel"), false);
  assert.equal(linuxAltWarning("Win32"), false);
  assert.equal(linuxAltWarning("Linux; Android 14"), false);
});

test("forced dropdown close clears the flag and does not disable the select", () => {
  const state = { dropdownOpen: true };
  const action = applyDropdownDismiss(state);
  assert.equal(state.dropdownOpen, false);
  assert.equal(action.blur, true);
  assert.equal(action.disable, false);
});

test("pin toggle flips the label and does not quit", () => {
  const off = pinToggle(true);
  assert.equal(off.alwaysOnTop, false);
  assert.equal(off.label, "取消置頂");
  assert.equal(off.pressed, false);
  assert.equal(off.quits, false);
  assert.equal(off.armsCloseGuard, true);
  const on = pinToggle(false);
  assert.equal(on.alwaysOnTop, true);
  assert.equal(on.label, "置頂");
  assert.equal(on.pressed, true);
  assert.equal(on.quits, false);
  assert.equal(on.armsCloseGuard, true);
});

test("settings quit uses the app exit command", () => {
  const action = settingsQuitAction();
  assert.equal(action.command, "quit_app");
  assert.equal(action.exitCode, 0);
});

test("invoke failures name the action for the error banner", () => {
  assert.equal(invokeFailureMessage("結束程式", "command not allowed"), "結束程式失敗：command not allowed");
  const denied = new Error("denied");
  assert.equal(invokeFailureMessage("置頂保護", denied), "置頂保護失敗：denied");
});
