/**
 * Invite from INSIDE a circle (⋯ → Invite) set `inviteFor` and painted nothing: the invite modal lived only in the
 * launcher list's return, and the open circle returns early (walked 2026-10-09 on an emulator: 22 s of nothing, then the
 * QR the moment `← circles` showed the list). The modal is now ONE element (`inviteModal`) painted in both returns.
 * `src/screens/**` cannot render under vitest; this pins the wiring as source text.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('../src/screens/v2/CircleLauncherScreen.js', import.meta.url)), 'utf8');

describe('the invite modal is painted where the person is', () => {
  it('the open circle paints it', () => {
    const at = SRC.indexOf('  if (selected) {\n    return (');
    const ret = SRC.slice(at, SRC.indexOf('\n    );\n', at));
    expect(at).toBeGreaterThan(-1);
    expect(ret).toMatch(/\{inviteModal\}/);
  });
  it('one element, no second copy of the modal', () => {
    expect((SRC.match(/<Modal visible=\{!!inviteFor\}/g) ?? []).length).toBe(1);
    expect((SRC.match(/\{inviteModal\}/g) ?? []).length).toBe(2);
  });
});
