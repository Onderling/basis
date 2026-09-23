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
/**
 * Comments come out before anything is matched. `lint-content-classification` learned this the hard way on
 * 2026-09-23 (prose apostrophes opening fake string literals); here the risk is the opposite — a comment that
 * NAMES the retired road, explaining why it is gone, reading as the road itself.
 */
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

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

  it('neither painter can be handed anything but a SEALED ref — the refusal lives in the shared decision', () => {
    // A bare URL would turn painting a row into a request to somebody else's server that says who is reading
    // it and when; an unsealed ref would be plaintext where a sealed pointer belongs. Both shells rely on
    // `faceOf` for that, so the check belongs there and nowhere else.
    const shared = read('apps/basis/src/v2/memberFace.js');
    expect(shared).toMatch(/isSealedMediaRef\(/);
  });

  it('and there is only ONE picture road — the persona attribute, never a second inline field', () => {
    // A second road existed for part of 2026-09-23 (`said.avatarThumb`, its own op and its own picker) and was
    // removed. This is the check that it does not come back: the decision reads `profilePicture`, and nothing
    // in either shell's paint path knows another name for a face.
    expect(code('apps/basis/src/v2/memberFace.js')).toMatch(/profilePicture/);
    for (const p of ['apps/basis/src/v2/memberFace.js', WEB.painter, MOBILE.painter, ...WEB.sites, ...MOBILE.sites]) {
      expect(code(p), `${p} must not name a second face field`).not.toMatch(/avatarThumb/);
    }
  });
});
