import assert from "node:assert/strict";
import test from "node:test";
import {
  colorForIndex,
  distanceToHit,
  distanceToRect,
  elementOpacity,
  elementStates,
  focusLossAction,
  osFocusAction,
  selectBlurAction,
  inkFor,
  latchedElementIds,
  linuxAltWarning,
  modifierMatches,
  nextOrbPulse,
  nextDropdownOpen,
  pinToggle,
  applyDropdownDismiss,
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
  { id: "a", x: 0, y: 0, w: 40, h: 40 },
  { id: "b", x: 100, y: 0, w: 40, h: 40 },
  { id: "center", x: 0, y: 80, w: 120, h: 40 },
];

const fadeOpts = { fadeDistance: 120, minOpacity: 0.18, fadeEnabled: true };

function byId(frames, id) {
  return frames.find((item) => item.id === id);
}

test("modifier far from elements changes nothing and does not capture", () => {
  const cursor = { x: 1000, y: 1000 };
  const held = elementStates({ held: true, cursor, rects: sampleBots, ...fadeOpts });
  const idle = elementStates({ held: false, cursor, rects: sampleBots, ...fadeOpts });
  assert.deepEqual(held, idle);
  assert.ok(held.every((item) => !item.capture));
  assert.ok(held.every((item) => item.opacity === 1));

  const outside = { x: 70, y: 20 };
  const near = elementStates({ held: true, cursor: outside, rects: sampleBots, ...fadeOpts });
  const faded = elementStates({ held: false, cursor: outside, rects: sampleBots, ...fadeOpts });
  assert.deepEqual(near, faded);
  assert.ok(byId(near, "a").opacity < 1);
  assert.equal(byId(near, "a").capture, false);
});

test("modifier solids only the element under the cursor", () => {
  const overA = elementStates({ held: true, cursor: { x: 20, y: 20 }, rects: sampleBots, ...fadeOpts });
  assert.equal(byId(overA, "a").opacity, 1);
  assert.equal(byId(overA, "a").capture, true);
  assert.ok(byId(overA, "b").opacity < 1);
  assert.equal(byId(overA, "b").capture, false);
  assert.ok(byId(overA, "center").opacity < 1);
  assert.equal(byId(overA, "center").capture, false);
  assert.equal(overA.filter((item) => item.capture).length, 1);

  const overB = elementStates({ held: true, cursor: { x: 120, y: 20 }, rects: sampleBots, ...fadeOpts });
  assert.ok(byId(overB, "a").opacity < 1);
  assert.equal(byId(overB, "a").capture, false);
  assert.equal(byId(overB, "b").opacity, 1);
  assert.equal(byId(overB, "b").capture, true);
  assert.equal(overB.filter((item) => item.capture).length, 1);
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
    held: true,
    cursor: { x: 100, y: 100 },
    rects: [orb],
    ...fadeOpts,
  });
  assert.equal(frames[0].capture, false);
  const rim = elementStates({
    held: true,
    cursor: { x: 110, y: 50 },
    rects: [orb],
    ...fadeOpts,
  });
  assert.equal(rim[0].capture, true);
  assert.equal(rim[0].opacity, 1);
  const square = elementStates({
    held: true,
    cursor: { x: 100, y: 100 },
    rects: [{ ...orb, round: false }],
    ...fadeOpts,
  });
  assert.equal(square[0].capture, true);
});

test("light swatches use dark ink", () => {
  assert.equal(inkFor("#edff45"), "#1a1a1a");
  assert.equal(inkFor("#0000f2"), "#f5f5f5");
});

test("modifier keys", () => {
  assert.equal(modifierMatches("ctrl", "Control"), true);
  assert.equal(modifierMatches("ctrl", "Shift"), false);
  assert.equal(modifierMatches("shift", "Shift"), true);
  assert.equal(modifierMatches("alt", "Alt"), true);
});

test("interactive lock names one panel and follows window focus", () => {
  assert.deepEqual(latchedElementIds({ textFocused: true }), ["center"]);
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

  const byZ = elementStates({ held: true, latchedIds: [], cursor, rects: overlapPanels, ...fadeOpts });
  assert.equal(byId(byZ, "settings").capture, true);
  assert.equal(byId(byZ, "center").capture, false);

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
