/**
 * Invite from INSIDE a circle (⋯ → Invite) set `inviteFor` and painted nothing: the invite modal lived only in the
 * launcher list's return, and the open circle returns early (walked 2026-10-09 on an emulator: 22 s of nothing, then the
 * QR the moment `← circles` showed the list). The modal is now ONE element (`inviteModal`) painted beside every view.
 * `src/screens/**` cannot render under vitest; this pins the wiring as source text.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('../src/screens/v2/CircleLauncherScreen.js', import.meta.url)), 'utf8');

// The final return paints the page AND, beside it, the modals any view can open: so a modal opened anywhere shows,
// whichever view is up. (It was painted in the list and the open circle only; Vandaag's "Make a circle" then opened a
// wizard that was not on screen either — walked on the emulator 2026-10-22.)
const finalReturn = () => SRC.slice(SRC.lastIndexOf('      {page}'), SRC.lastIndexOf('    </>'));

describe('the invite modal is painted where the person is', () => {
  it('beside every view: the final return paints it, with the relay question', () => {
    expect(finalReturn()).toMatch(/\{inviteModal\}/);
    expect(finalReturn()).toMatch(/\{relayQuestionModal\}/);
  });
  it('one element, painted once', () => {
    expect((SRC.match(/<Modal visible=\{!!inviteFor\}/g) ?? []).length).toBe(1);
    expect((SRC.match(/\{inviteModal\}/g) ?? []).length).toBe(1);
    expect((SRC.match(/\{relayQuestionModal\}/g) ?? []).length).toBe(1);
  });
  it('the create-circle wizard too: Vandaag\'s "Make a circle" opens it where the person is', () => {
    expect(finalReturn()).toMatch(/<CreateGroupWizardModal/);
    expect((SRC.match(/<CreateGroupWizardModal/g) ?? []).length).toBe(1);
  });
});
