/**
 * WHICH PERSONA A CONTACT SEES YOU AS — "dit contact ziet je als …", not "this contact knows a different you".
 *
 * Fable's correction of 2026-09-24: today ONE identity runs. Every `deriveAgentSeed(` in the running agent
 * says `'default'`, the join records its membership under `'default'` whatever persona was chosen, and a pair
 * circle is always `pairCircleIdFor(default.webid, other)`. A persona is a DISCLOSURE LENS over that one
 * identity — which name, face and properties a given circle or contact receives. A persona as a separate
 * person on the wire is designed and NOT built (ledger L123, after the runtime arc).
 *
 * So this is the lens: same identity, same address, same pair id, different release.
 */
import { describe, it, expect } from 'vitest';
import { personaOfContact, backfillContactPersonas, DEFAULT_PERSONA } from '../../src/v2/contactPersona.js';
import { pairCircleIdFor } from '../../src/v2/pairCircleId.js';

const ME = 'webid-me';
const THEM = 'webid-them';

describe('personaOfContact — the profile a contact was made through', () => {
  it('reads the row\'s own persona when it has one', () => {
    expect(personaOfContact({ contactId: 'c1', persona: 'buurt' })).toBe('buurt');
  });

  it('REFUSES to invent one for a row that has none — a missing value is not a default', () => {
    // The `mijLoader` lesson, and Fable's ruling: no silent "missing means default" read path. A fallback
    // that quietly supplies a value is how the persona picker stayed broken for weeks — the code looked
    // right because the hole was filled before anyone could see it.
    expect(personaOfContact({ contactId: 'c1' })).toBeNull();
    expect(personaOfContact({ contactId: 'c1', persona: '' })).toBeNull();
    expect(personaOfContact(null)).toBeNull();
  });
});

describe('backfillContactPersonas — an explicit one-time write, and it is CHECKABLE', () => {
  it('writes `default` onto rows that predate the field, and proves it by the pair id', async () => {
    // Not a guess: a contact made before this shipped holds the DEFAULT identity's card, so its pair circle
    // is `pairCircleIdFor(default.webid, them)`. That is a fact the backfill can verify, and it does.
    const rows = [{ contactId: THEM, pairCircleId: pairCircleIdFor(ME, THEM) }];
    const written = [];
    const r = await backfillContactPersonas({
      rows, selfWebid: ME, setPersona: async (id, persona) => { written.push([id, persona]); },
    });
    expect(written).toEqual([[THEM, DEFAULT_PERSONA]]);
    expect(r).toMatchObject({ written: 1, skipped: 0, mismatched: 0 });
  });

  it('does NOT write onto a row whose pair id does not match the default identity — it reports it', async () => {
    // If the pair id is not the default's, the premise is false for that row and writing `default` onto it
    // would record something untrue. Say so instead; that is the whole point of checking rather than assuming.
    const rows = [{ contactId: THEM, pairCircleId: 'kp-deadbeefdeadbeefdeadbeef' }];
    const written = [];
    const r = await backfillContactPersonas({ rows, selfWebid: ME, setPersona: async (...a) => { written.push(a); } });
    expect(written, 'nothing written for a row that cannot be proved').toEqual([]);
    expect(r).toMatchObject({ written: 0, mismatched: 1 });
  });

  it('leaves a row that already has a persona alone, and one with no pair circle yet', async () => {
    const rows = [
      { contactId: 'a', persona: 'buurt', pairCircleId: pairCircleIdFor(ME, 'a') },
      { contactId: 'b' },                                    // card-only: no pair circle exists yet
    ];
    const written = [];
    const r = await backfillContactPersonas({ rows, selfWebid: ME, setPersona: async (...a) => { written.push(a); } });
    expect(written).toEqual([]);
    expect(r).toMatchObject({ written: 0, skipped: 2 });
  });

  it('is idempotent — a second run writes nothing', async () => {
    const rows = [{ contactId: THEM, pairCircleId: pairCircleIdFor(ME, THEM) }];
    const write = async (id, persona) => { rows.find((x) => x.contactId === id).persona = persona; };
    await backfillContactPersonas({ rows, selfWebid: ME, setPersona: write });
    const second = [];
    await backfillContactPersonas({ rows, selfWebid: ME, setPersona: async (...a) => { second.push(a); } });
    expect(second).toEqual([]);
  });
});
