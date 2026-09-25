/**
 * A CONTACT A PERSON ADDS IS ASKED ABOUT FIRST (L125, Frits 2026-09-24) — what they will see of you, persona and
 * level, prefilled. The shells add through the sheet (`addContactWithSheet` on web, `useContactLensSheet` on
 * mobile); a direct `addContactFromQr` call in a shell is allowed only where NOBODY is present to ask — a card
 * that arrived with a message — or as the sheet's own fallback for a payload it cannot read.
 *
 * Counted per file with comments stripped, so a new direct call anywhere fails here and has to say why.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { code } from '../../../../scripts/shell-seams.mjs';

const ROOT = path.resolve(__dirname, '../../../..');
const count = (rel) => (code(readFileSync(path.join(ROOT, rel), 'utf8')).match(/'addContactFromQr'/g) ?? []).length;

const ALLOWED = {
  // `contactCardArrived` (a card that rode a message: nobody to ask) + the sheet's fallback for an unreadable payload
  'apps/basis/web/v2/circleApp.js': 2,
  // `onCard`, the contact channel's card-on-a-message hook
  'apps/basis-mobile/src/core/agentBundle.js': 1,
  'apps/basis-mobile/src/screens/v2/ContactsScreen.js': 0,
  'apps/basis-mobile/src/screens/ChatScreen.js': 0,
};

describe('fitness — a person\'s add goes through the sheet', () => {
  for (const [rel, n] of Object.entries(ALLOWED)) {
    it(`${rel}: ${n} direct add(s), each where nobody is present`, () => {
      expect(count(rel)).toBe(n);
    });
  }
});
