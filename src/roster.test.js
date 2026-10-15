import assert from "node:assert/strict";
import test from "node:test";
import { isProfileEnabled, profilesNeedingKeys } from "./roster.js";

test("missing enabled stays visible and false hides", () => {
  assert.equal(isProfileEnabled({ profile: "a" }), true);
  assert.equal(isProfileEnabled({ enabled: true }), true);
  assert.equal(isProfileEnabled({ enabled: false }), false);
  assert.equal(isProfileEnabled(null), false);
});

test("only newly discovered profiles without a key are prompted", () => {
  const before = [
    { profile: "planner", has_key: false, enabled: true },
    { profile: "coder", has_key: true, enabled: true },
  ];
  const after = [
    ...before,
    { profile: "research", has_key: false, enabled: true },
    { profile: "writer", has_key: true, enabled: true },
    { profile: "hidden", has_key: false, enabled: false },
  ];
  assert.deepEqual(
    profilesNeedingKeys(before, after).map((bot) => bot.profile),
    ["research"],
  );
});
