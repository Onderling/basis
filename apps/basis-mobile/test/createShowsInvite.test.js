/**
 * The create wizard's Review promises "After you create it you get a one-time membership code to share" — and on mobile
 * the wizard closed straight to the launcher with no code (walk 2026-10-09, current build): the launcher's onDispatched
 * dropped the invite it was handed. It now opens the circle's invite through `openCircleInvite`, the ONE invite
 * builder the ⋯ menu uses (relay question, the circle's relay, its policy) — not the wizard's older URL.
 * `src/screens/**` cannot render under vitest; this pins the wiring as source text.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('../src/screens/v2/CircleLauncherScreen.js', import.meta.url)), 'utf8');
const at = SRC.indexOf('<CreateGroupWizardModal');
const block = SRC.slice(at, SRC.indexOf('/>', SRC.indexOf('onDispatched={(r) => {', at)));

describe('a created circle shows its invite', () => {
  it("the create wizard's onDispatched opens the circle's invite through the one builder", () => {
    expect(at).toBeGreaterThan(-1);
    expect(block).toMatch(/onDispatched=\{\(r\) => \{[\s\S]*openCircleInvite\(gid\)/);
  });
});
