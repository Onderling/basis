import { describe, it, expect, vi } from 'vitest';
import { quickCreateCircle } from '../../src/v2/circleCreate.js';

/**
 * A circle's id comes from its FOUNDER, not from what they typed.
 *
 * It used to be `slugify(name)`, and the cost showed up twenty minutes into the first session with a
 * person on the real UI: two peers each made a circle called "Proeftuin", both devices called it
 * `proeftuin`, and the one that learned of both MERGED them — one roster, two unrelated groups.
 * Membership is meant to have exactly one door; a name-derived id adds a second, and names are public.
 */
const okCall = (extra = {}) => vi.fn(async (app, op, args) => {
  if (op === 'whoAmI') return { webid: 'webid:founder' };
  return { groupId: args.groupId, code: 'X', ...extra };
});

describe('quickCreateCircle', () => {
  it('dispatches createGroupV2 with the typed name and a derived id', async () => {
    const callSkill = okCall();
    const res = await quickCreateCircle({ callSkill, name: 'Selwerd Circle!', founderPubKey: 'webid:founder' });
    const args = callSkill.mock.calls.at(-1)[2];
    expect(args.name, 'the name is what people read and is kept verbatim').toBe('Selwerd Circle!');
    expect(args.groupId).not.toBe('selwerd-circle');
    expect(args.groupId, 'the id must not be derivable from the name').not.toMatch(/selwerd/i);
    expect(res.groupId).toBe(args.groupId);
  });

  it('THE FINDING: two people naming a circle the same thing get different circles', async () => {
    const a = okCall(); const b = okCall();
    await quickCreateCircle({ callSkill: a, name: 'Proeftuin', founderPubKey: 'webid:anna' });
    await quickCreateCircle({ callSkill: b, name: 'Proeftuin', founderPubKey: 'webid:bram' });
    expect(a.mock.calls.at(-1)[2].groupId).not.toBe(b.mock.calls.at(-1)[2].groupId);
  });

  it('…and so do one person\'s two circles of the same name', async () => {
    // The nonce carries this: without it a founder would collide with themselves, which is the same
    // failure one layer in.
    const c = okCall();
    await quickCreateCircle({ callSkill: c, name: 'Thuis', founderPubKey: 'webid:anna' });
    const first = c.mock.calls.at(-1)[2].groupId;
    await quickCreateCircle({ callSkill: c, name: 'Thuis', founderPubKey: 'webid:anna' });
    expect(c.mock.calls.at(-1)[2].groupId).not.toBe(first);
  });

  it('asks the app who it is when the caller does not say', async () => {
    const callSkill = okCall();
    await quickCreateCircle({ callSkill, name: 'Buurt' });
    expect(callSkill.mock.calls[0][1]).toBe('whoAmI');
    expect(callSkill.mock.calls.at(-1)[2].groupId).toBeTruthy();
  });

  it('REFUSES rather than falling back to the name when it cannot learn the founder', async () => {
    // The quiet fallback is the whole bug: an id a stranger can also produce.
    const callSkill = vi.fn(async () => ({}));
    await expect(quickCreateCircle({ callSkill, name: 'Buurt' })).rejects.toThrow(/founder/);
  });

  it('still pins a SYSTEM circle, where every device must reach the same id', async () => {
    const callSkill = okCall();
    await quickCreateCircle({ callSkill, name: 'Help', id: 'cc-help' });
    expect(callSkill.mock.calls.at(-1)[2].groupId).toBe('cc-help');
  });

  it('rejects an empty name', async () => {
    await expect(quickCreateCircle({ callSkill: okCall(), name: '  ' })).rejects.toThrow(/name/);
  });

  it('throws when the substrate returns an error', async () => {
    const callSkill = vi.fn(async (app, op) => (op === 'whoAmI' ? { webid: 'w' } : { error: 'nope' }));
    await expect(quickCreateCircle({ callSkill, name: 'X' })).rejects.toThrow('nope');
  });
});
