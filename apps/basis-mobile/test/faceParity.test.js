/**
 * WEB ≡ MOBILE for the face: both shells ask the SAME question and only draw differently.
 *
 * The rule this pins is not "both files mention a face" — it is that neither shell works out picture-or-initial
 * for itself. That decision is `faceOf` in the basis app, shared; a shell that reimplemented it would drift the
 * first time the rule changed, which is exactly how one contact came to look like two people on two screens.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(HERE, '..', '..', '..', p), 'utf8');

const WEB = {
  painter: 'apps/basis/web/v2/faceView.js',
  sites: ['apps/basis/web/v2/contactsRoster.js', 'apps/basis/web/v2/contactThread.js', 'apps/basis/web/v2/circleAdminPanel.js'],
};
const MOBILE = {
  painter: 'apps/basis-mobile/src/screens/v2/FaceView.js',
  sites: [
    'apps/basis-mobile/src/screens/v2/ContactsScreen.js',
    'apps/basis-mobile/src/screens/v2/ContactThreadScreen.js',
    'apps/basis-mobile/src/screens/v2/CircleAdminPanelScreen.js',
  ],
};

describe('the face is painted the same way on both shells', () => {
  it('each shell has ONE painter, and it is the only place that asks `faceOf`', () => {
    for (const shell of [WEB, MOBILE]) {
      expect(read(shell.painter), `${shell.painter} asks the shared question`).toMatch(/faceOf\(/);
      for (const site of shell.sites) {
        expect(read(site), `${site} must not decide picture-or-initial for itself`).not.toMatch(/faceOf\(/);
      }
    }
  });

  it('all three sites on BOTH shells paint through that painter — an empty grep here is a finding, not a pass', () => {
    for (const site of WEB.sites) expect(read(site), `${site} paints a face`).toMatch(/paintFace\(/);
    for (const site of MOBILE.sites) expect(read(site), `${site} paints a face`).toMatch(/<FaceView\b/);
  });

  it('neither painter can be handed a fetchable URL — the refusal lives in the shared decision', () => {
    // A `src` pointing at somebody else's server would turn painting a row into a request that says who is
    // reading it and when. Both shells rely on `faceOf` for that, so the check belongs there and nowhere else.
    const shared = read('apps/basis/src/v2/memberFace.js');
    expect(shared).toMatch(/startsWith\('data:image\/'\)/);
  });
});
