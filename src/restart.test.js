import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { restartConfirmText, unsentPanels } from "./restart.js";

const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");

test("R-SY-13 only panels with unsent text or attachments need a confirm", () => {
  assert.equal(restartConfirmText([{ text: "", attachments: 0 }, { text: "  ", attachments: 0 }]), "");
  assert.equal(unsentPanels([{ text: "hi" }, { text: "", attachments: 2 }, { text: "" }]).length, 2);
  assert.match(restartConfirmText([{ text: "hi" }]), /1 個面板/);
});

test("R-SY-13 the page flushes open_panels, then restarts the process (no reload)", () => {
  const fn = main.slice(main.indexOf("async function restartOverlay()"), main.indexOf("function openSettingsFromShortcut()"));
  assert.ok(fn.indexOf("await saveOpenPanels()") > 0);
  assert.ok(fn.indexOf('invoke("restart_app")') > fn.indexOf("await saveOpenPanels()"));
  assert.match(fn, /window\.confirm\(ask\)/);
  assert.doesNotMatch(fn, /location\.reload/);
  assert.match(main, /payload\?\.type === "restart"\) void restartOverlay\(\)/);
});
