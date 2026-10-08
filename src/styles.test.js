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
  assert.match(css, /--orb-glow-radius:\s*10px/);
  assert.match(css, /--orb-glow-alpha:\s*0\.18/);
  assert.match(css, /--orb-selected-glow-radius:\s*26px/);
  assert.match(css, /--orb-selected-glow-alpha:\s*0\.45/);
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
  const orb = css.slice(css.indexOf(".bot-btn {"), css.indexOf(".bot-btn::before"));
  assert.match(orb, /will-change:\s*opacity/);
  assert.match(orb, /contain:\s*layout style/);
  assert.doesNotMatch(orb, /box-shadow/);
  assert.match(css, /\.bot-btn::after,\s*\.active-avatar::after,\s*\.float-avatar::after \{[^}]*radial-gradient\(/s);
  assert.doesNotMatch(
    css.slice(css.indexOf(".bot-btn::after"), css.indexOf(".bot-btn:hover")),
    /box-shadow|filter:/,
  );
  assert.match(css, /\.bot-btn\.active::after \{[^}]*radial-gradient\(/s);
  assert.match(css, /transparent calc\(var\(--orb-disc\) \/ 2\)/);
  assert.match(css, /rgba\(255,\s*255,\s*255,\s*0\.72\)/);
  const selectedGlow = css.slice(css.indexOf(".bot-btn.active::after"), css.indexOf(".bot-btn.active::before"));
  assert.match(selectedGlow, /transparent calc\(var\(--orb-disc\) \/ 2\)/);
  assert.match(selectedGlow, /inset:\s*calc\(-1 \* var\(--orb-selected-glow-radius\)\)/);
  assert.match(selectedGlow, /var\(--orb-selected-glow-alpha\)/);
  assert.match(selectedGlow, /var\(--orb-selected-glow-radius\)/);
  assert.doesNotMatch(selectedGlow, /0\.85|1\.35/);
  const idleHalo = css.slice(css.indexOf(".bot-btn::after"), css.indexOf(".bot-btn:hover"));
  assert.match(idleHalo, /var\(--orb-glow-alpha\)/);
  assert.doesNotMatch(idleHalo, /--orb-selected-glow/);
  assert.match(css, /\.center-panel\[hidden\]\s*\{[^}]*display:\s*none/s);
  assert.match(css, /\.center-panel \{[^}]*translateZ\(0\)/s);
  assert.doesNotMatch(css.slice(css.indexOf(".center-panel {"), css.indexOf(".center-panel::after")), /var\(--shadow\)/);
  assert.match(css, /html\.platform-linux \.center-panel[\s\S]*backdrop-filter:\s*none/);
  assert.doesNotMatch(css, /\.bot-btn\.active::before \{[^}]*animation:/s);
  assert.match(css, /\.bot-btn\.orb-enter::before,\s*\.bot-btn\.orb-enter\.busy::before \{[^}]*orb-pulse[^;]*\b2\b/s);
  assert.match(css, /html\.platform-linux \{[^}]*--panel-bg:\s*rgba\(7,\s*8,\s*28,\s*0\.90\)/s);
  assert.match(css, /html\.platform-linux \{[^}]*--panel-bg-solid:\s*rgba\(8,\s*8,\s*20,\s*0\.90\)/s);
});
