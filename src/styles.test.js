import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("modifier select drops the native white box", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const block = css.slice(css.indexOf("/* WebKitGTK paints a native white select"));
  assert.match(block, /\.field select \{[^}]*appearance:\s*none/s);
  assert.match(block, /-webkit-appearance:\s*none/);
  assert.match(block, /background-color:\s*#12121c/);
  assert.match(block, /\.field select option \{[^}]*background-color:\s*#12121c/s);
  assert.match(block, /color:\s*var\(--paper\)/);
});
