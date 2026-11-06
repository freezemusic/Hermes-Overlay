import assert from "node:assert/strict";
import test from "node:test";
import { INK, PALETTE, TEXT_BLUE, botInk, contrastRatio, lightBotColor, textOnBotFill, textPairsForBot } from "./botcolor.js";

test("every bot colour keeps text contrast at 4.5", () => {
  for (const hex of ["#f2f200", "#00f2f2", "#79f200"]) {
    assert.equal(textOnBotFill(hex), INK);
  }
  assert.ok(contrastRatio(TEXT_BLUE, "#f7f8f8") >= 4.5);
  assert.ok(contrastRatio(INK, "#f2f200") >= 4.5);
  assert.ok(contrastRatio(INK, "#edff45") >= 4.5);
  assert.ok(contrastRatio(INK, "#00f2f2") >= 4.5);
  assert.ok(contrastRatio("#ffffff", TEXT_BLUE) >= 4.5);
  assert.equal(textOnBotFill("#0000f2"), "#ffffff");
  assert.equal(botInk("#f2f200"), "#6b6b00");
  assert.equal(botInk("#00f2f2"), "#006b6b");
  assert.equal(botInk("#0000f2"), "");
  assert.equal(botInk("#616191"), "");
  for (const hex of ["#edff45", "#79f200", "#f27900", "#ff8442"]) {
    const ink = botInk(hex);
    assert.notEqual(ink, "", hex);
    assert.ok(contrastRatio(hex, "#ffffff") < 3, hex);
    assert.ok(contrastRatio(ink, "#ffffff") >= 4.5, `${hex} ink ${ink}`);
    assert.equal(lightBotColor(hex), true);
  }
  assert.equal(lightBotColor("#0000f2"), false);
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
