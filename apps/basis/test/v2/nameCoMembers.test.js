/**
 * A nameless contact met in a shared circle is named by their HANDLE there — never by a pair circle's roster: the pair
 * roster carries a DERIVED placeholder ("p" + the key's first characters) for someone who has no handle, which must
 * never become anyone's name (the 2026-09-21 "pjy8n7fq" bug, back for a day through this reader on 2026-10-22).
 */
import { describe, it, expect } from 'vitest';
import { nameCoMembersFromCircles } from '../../src/v2/contactsSource.js';
import { pairCircleIdFor } from '../../src/v2/pairCircleId.js';

const KEY = 'VM6Qo3copBNTabcdefghijklmnopqrstuvwxyz01234';
const row = { contactId: KEY, name: KEY };
const pair = pairCircleIdFor('me-webid', KEY);

describe('nameCoMembersFromCircles', () => {
  it('a shared circle names the row by the handle there', async () => {
    const out = await nameCoMembersFromCircles([row], {
      circleIds: async () => ['circle-1'],
      membersOf: async () => [{ webid: KEY, handle: 'anna' }],
    });
    expect(out[0]).toMatchObject({ name: 'anna', namedBy: 'circle' });
  });
  it("a pair circle's roster never names the row (its handle may be the derived placeholder)", async () => {
    const out = await nameCoMembersFromCircles([row], {
      circleIds: async () => [pair],
      membersOf: async () => [{ webid: KEY, handle: 'pvm6qo3c' }],
    });
    expect(out[0].name).toBe(KEY);
  });
});
