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

test("avatars are translucent orbs with tunable glow", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.match(css, /--avatar-radius:\s*50%/);
  assert.match(css, /--orb-opacity:\s*0\.48/);
  assert.match(css, /--orb-glow-radius:\s*18px/);
  assert.match(css, /--orb-glow-alpha:\s*0\.5/);
  assert.match(css, /--panel-bg:\s*rgba\(7,\s*8,\s*28,\s*0\.76\)/);
  assert.match(css, /--panel-bg-solid:\s*rgba\(8,\s*8,\s*20,\s*0\.80\)/);
  assert.match(css, /--panel-blur:\s*18px/);
  assert.match(css, /\.bot-status::before \{[^}]*border-radius:\s*50%/s);
  assert.match(css, /backdrop-filter:\s*blur\(var\(--panel-blur\)\)/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
  const pulse = css.slice(css.indexOf("@keyframes orb-pulse"), css.indexOf("@keyframes orb-busy"));
  assert.match(pulse, /transform:\s*scale\(1\.06\)/);
  assert.doesNotMatch(pulse, /box-shadow|filter:|blur\(/);
  const busy = css.slice(css.indexOf("@keyframes orb-busy"), css.indexOf("@media (prefers-reduced-motion"));
  assert.match(busy, /opacity:/);
  assert.doesNotMatch(busy, /box-shadow|filter:|blur\(/);
  assert.doesNotMatch(css, /\.bot-btn\.error \{[^}]*box-shadow/s);
  assert.doesNotMatch(css, /@keyframes bot-pulse/);
});
