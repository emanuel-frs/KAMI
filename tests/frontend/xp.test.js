import test from "node:test";
import assert from "node:assert/strict";
import { levelFromXp, xpForLevel } from "../../frontend/js/components/xp.js";

test("xpForLevel calcula o XP necessário para o próximo nível", () => {
  assert.equal(xpForLevel(1), 100);
  assert.equal(xpForLevel(2), 246);
});

test("levelFromXp calcula nível, progresso e XP restante", () => {
  assert.deepEqual(levelFromXp(0), { level: 1, pct: 0, remaining: 0, need: 100 });
  assert.deepEqual(levelFromXp(100), { level: 2, pct: 0, remaining: 0, need: 246 });
  assert.deepEqual(levelFromXp(150), { level: 2, pct: 20, remaining: 50, need: 246 });
});
