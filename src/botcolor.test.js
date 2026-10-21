import assert from "node:assert/strict";
import test from "node:test";
import { INK, PALETTE, contrastRatio, textOnBotFill, textPairsForBot } from "./botcolor.js";

test("every bot colour keeps text contrast at 4.5", () => {
  for (const hex of ["#f2f200", "#00f2f2", "#79f200"]) {
    assert.equal(textOnBotFill(hex), INK);
  }
  assert.equal(textOnBotFill("#0000f2"), "#ffffff");
  for (const light of ["#f2f200", "#00f2f2", "#79f200"]) {
    for (const pair of textPairsForBot(light)) {
      assert.notEqual(pair.fg.toLowerCase(), light, `${light} ${pair.name} uses the bot colour as text`);
    }
  }
  for (const hex of PALETTE) {
    for (const pair of textPairsForBot(hex)) {
      const ratio = contrastRatio(pair.fg, pair.bg);
      assert.ok(ratio >= 4.5, `${hex} ${pair.name} ${pair.fg} on ${pair.bg} = ${ratio}`);
    }
  }
});
