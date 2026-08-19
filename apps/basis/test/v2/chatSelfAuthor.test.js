/**
 * Regression: after a relaunch, your own messages came back as strangers.
 *
 * The optimistic append stamps `actor: 'me'`; storage records the AUTHOR, so the rehydrator
 * re-inserted your own lines with someone-else's attribution — left-aligned, sender-labelled,
 * with a "report this message" affordance on your own sentence.
 */
import { describe, it, expect, vi } from 'vitest';
import { createSelfAuthorCheck } from '../../src/v2/chatSelfAuthor.js';

const envelope = (over = {}) => ({
  subtype: 'circle-chat-message', circleId: 'miep', msgId: 'm1',
  text: 'zie ik je zaterdag?', ts: 1735_000_000_000, fromActor: 'webid:anne', ...over,
});

describe('createSelfAuthorCheck — "am I the author" is a PER-CIRCLE question', () => {
  const addresses = { miep: 'addr-in-miep', boi: 'addr-in-boi' };
  const check = () => createSelfAuthorCheck({
    whoAmI: async () => ({ webid: 'webid:me', pubKey: 'pk-me', stableId: 'sid-me' }),
    circleAddressFor: (cid) => addresses[cid] ?? null,
  });

  it('recognises this device\'s address IN THAT circle', async () => {
    const isSelf = check();
    expect(await isSelf(envelope({ circleId: 'miep', fromActor: 'addr-in-miep' }))).toBe(true);
  });

  it('does NOT recognise my address from a DIFFERENT circle (the addresses are unlinkable)', async () => {
    const isSelf = check();
    expect(await isSelf(envelope({ circleId: 'miep', fromActor: 'addr-in-boi' }))).toBe(false);
  });

  it('recognises the canonical identifiers too — webid, pubKey, stableId', async () => {
    const isSelf = check();
    // The shipped local mirror stamps stoop\'s caller webid, so this is the case that repairs
    // history already on disk.
    expect(await isSelf(envelope({ fromActor: 'webid:me' }))).toBe(true);
    expect(await isSelf(envelope({ fromActor: 'pk-me' }))).toBe(true);
    expect(await isSelf(envelope({ fromActor: 'sid-me' }))).toBe(true);
  });

  it('reads the older `fromWebid` spelling when `fromActor` is absent', async () => {
    const isSelf = check();
    expect(await isSelf({ circleId: 'miep', fromWebid: 'webid:me' })).toBe(true);
  });

  it('says no for another member, and for an unauthored envelope', async () => {
    const isSelf = check();
    expect(await isSelf(envelope({ fromActor: 'webid:anne' }))).toBe(false);
    expect(await isSelf(envelope({ fromActor: null }))).toBe(false);
    expect(await isSelf(envelope({ fromActor: '' }))).toBe(false);
  });

  it('resolves my identity ONCE and caches the per-circle address', async () => {
    const whoAmI = vi.fn(async () => ({ webid: 'webid:me' }));
    const circleAddressFor = vi.fn(() => 'addr-in-miep');
    const isSelf = createSelfAuthorCheck({ whoAmI, circleAddressFor });
    await isSelf(envelope({ fromActor: 'webid:anne' }));
    await isSelf(envelope({ fromActor: 'webid:me' }));
    await isSelf(envelope({ fromActor: 'webid:me' }));
    expect(whoAmI).toHaveBeenCalledTimes(1);
    expect(circleAddressFor).toHaveBeenCalledTimes(1);
  });

  it('a blank identity read is NOT cached — it retries rather than mis-attribute the session', async () => {
    const whoAmI = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ webid: 'webid:me' });
    const isSelf = createSelfAuthorCheck({ whoAmI });
    expect(await isSelf(envelope({ fromActor: 'webid:me' }))).toBe(false);
    expect(await isSelf(envelope({ fromActor: 'webid:me' }))).toBe(true);
  });

  it('degrades to "not mine" — never to a wrong answer — when a seam is missing or throws', async () => {
    expect(await createSelfAuthorCheck()(envelope({ fromActor: 'webid:me' }))).toBe(false);
    const throwing = createSelfAuthorCheck({
      whoAmI: async () => { throw new Error('agent down'); },
      circleAddressFor: () => { throw new Error('no seed'); },
    });
    expect(await throwing(envelope({ fromActor: 'webid:me' }))).toBe(false);
  });
});
