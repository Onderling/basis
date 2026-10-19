/**
 * The person key between a person's devices: the ceremony hands the new version to the survivors over the one
 * sibling carry; a landing is admitted only when the ceremony's ROOT REVEAL verifies against the receiver's own
 * commitment, and is stored monotonically. The sender's address decides nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import { createPersonKeySync, routePersonKeySync, PERSON_KEY_CARRY, PERSON_KEY_CATCHUP_SUBTYPES } from '../../src/v2/personKeySync.js';
import { b64encode, Bootstrap, ceremonyCommitment, authorityPubKeyB64Of, signCeremonyReveal, derivePersonKeySeed, personKeyPubKeyB64, personKeyFacts } from '@onderling/core';

const root = Bootstrap.create().bootstrap;
const rootPub = authorityPubKeyB64Of(root.secret);
const ME = 'w:anna';
const profile = root.deriveAgentSeed('default');
const keyAt = (version, circles = ['k1', 'k2'], secret = root.secret) => {
  const seed = derivePersonKeySeed(profile, version);
  const facts = personKeyFacts({ version, pubKey: personKeyPubKeyB64(seed) });
  const reveals = Object.fromEntries(circles.map((c) => [c, signCeremonyReveal(secret, { circleId: c, kind: PERSON_KEY_CARRY, subject: ME, authorRef: ME, facts })]));
  return { version, seed, reveals };
};
const SIBS = ['addr:box', 'addr:laptop'];
const rig = ({ current = keyAt(2), siblings = SIBS, circles = ['k1', 'k2'] } = {}) => {
  const sent = [];
  const stored = [];
  const store = vi.fn(async (k) => { const ok = !stored.length || stored.at(-1).version < k.version; if (ok) stored.push(k); return ok; });
  const refused = [];
  const sync = createPersonKeySync({
    siblings: async () => siblings, sendToPeer: async (to, payload, opts) => { sent.push({ to, payload, opts }); return { delivered: true }; },
    current: () => current, store, selfPubKey: ME,
    ownCommitmentFor: (c) => (circles.includes(c) ? ceremonyCommitment(rootPub, c) : null),
    onRefused: (reason, from) => refused.push([reason, from]),
  });
  return { sync, sent, stored, refused, store };
};
const wire = (k) => ({ subtype: PERSON_KEY_CARRY, subject: ME, version: k.version, seed: b64encode(k.seed), reveals: k.reveals });

describe('the ceremony hands the current key to the survivors', () => {
  it('carryCurrent sends { version, seed, reveals } to every sibling over hold-forward; an exclusion is honoured', async () => {
    const { sync, sent } = rig();
    expect((await sync.carryCurrent()).attempted).toBe(2);
    expect(sent[0].payload).toMatchObject({ subtype: PERSON_KEY_CARRY, version: 2 });
    expect(Object.keys(sent[0].payload.reveals)).toEqual(['k1', 'k2']);
    expect(sent[0].opts).toEqual({ guarantee: 'hold-forward' });
    sent.length = 0;
    expect((await sync.carryCurrent({ exclude: ['addr:box'] })).attempted).toBe(1);
    expect(sent[0].to).toBe('addr:laptop');
  });
  it('the hand-over carries the link key\'s PUBLIC half and never a link seed; a landed one keeps the pub', async () => {
    const k = { ...keyAt(2), linkKeyPub: 'LINK-PUB' };
    const { sync, sent } = rig({ current: k });
    await sync.carryCurrent();
    expect(sent[0].payload.linkKeyPub).toBe('LINK-PUB');
    expect(Object.keys(sent[0].payload).sort()).toEqual(['linkKeyPub', 'links', 'previous', 'reveals', 'seed', 'subject', 'subtype', 'version']);
    const { sync: rx, stored } = rig({ current: keyAt(1) });
    await rx.handlers[PERSON_KEY_CARRY]('addr:box', sent[0].payload);
    expect(stored[0]?.linkKeyPub).toBe('LINK-PUB');
  });
  it('a device with no key, or a re-derived key with no reveals, hands over nothing', async () => {
    expect((await rig({ current: null }).sync.carryCurrent()).skipped).toBe('no-key-or-no-reveals');
    expect((await rig({ current: { version: 1, seed: derivePersonKeySeed(profile, 1), reveals: {} } }).sync.carryCurrent()).skipped).toBe('no-key-or-no-reveals');
  });
});

describe('landing — the root decides, not the address', () => {
  it('a hand-over whose reveal verifies against my commitment lands from ANY address; a higher version supersedes; a lower never lands', async () => {
    const { sync, stored } = rig();
    await sync.handlers[PERSON_KEY_CARRY]('addr:whatever', wire(keyAt(3)));
    await sync.handlers[PERSON_KEY_CARRY]('addr:box', wire(keyAt(2)));
    await sync.handlers[PERSON_KEY_CARRY]('addr:laptop', wire(keyAt(4)));
    expect(stored.map((k) => k.version)).toEqual([3, 4]);
    expect(stored[1].reveals).toEqual(keyAt(4).reveals);
  });
  it('one shared circle suffices — reveals for circles I am not in are simply skipped', async () => {
    const { sync, stored } = rig({ circles: ['k2'] });
    await sync.handlers[PERSON_KEY_CARRY]('addr:box', wire(keyAt(3, ['k1', 'k2'])));
    expect(stored.map((k) => k.version)).toEqual([3]);
  });
  it('refused: no reveal, another root\'s reveal, a reveal for a circle I do not share, a swapped seed, a bumped version, junk', async () => {
    const { sync, stored, refused } = rig();
    const good = keyAt(3);
    await sync.handlers[PERSON_KEY_CARRY]('addr:box', { subtype: PERSON_KEY_CARRY, subject: ME, version: 3, seed: b64encode(good.seed) });
    await sync.handlers[PERSON_KEY_CARRY]('addr:box', wire(keyAt(3, ['k1', 'k2'], Bootstrap.create().bootstrap.secret)));
    await sync.handlers[PERSON_KEY_CARRY]('addr:box', wire(keyAt(3, ['k9'])));
    await sync.handlers[PERSON_KEY_CARRY]('addr:box', { ...wire(good), seed: b64encode(derivePersonKeySeed(profile, 7)) });
    await sync.handlers[PERSON_KEY_CARRY]('addr:box', { ...wire(good), version: 9 });
    await sync.handlers[PERSON_KEY_CARRY]('addr:box', { subtype: PERSON_KEY_CARRY, subject: ME, version: 3, seed: 'junk', reveals: good.reveals });
    expect(stored).toEqual([]);
    expect(refused.map((r) => r[0])).toEqual(['malformed', 'no-root-reveal', 'no-root-reveal', 'no-root-reveal', 'no-root-reveal', 'malformed']);
  });
});

describe('catch-up', () => {
  it('a sibling\'s request is answered with the current key and its reveals; a stranger\'s is not', async () => {
    const { sync, sent } = rig();
    await sync.handlers[PERSON_KEY_CATCHUP_SUBTYPES.request]('addr:laptop', { subtype: PERSON_KEY_CATCHUP_SUBTYPES.request, subject: ME });
    await sync.handlers[PERSON_KEY_CATCHUP_SUBTYPES.request]('addr:stranger', { subtype: PERSON_KEY_CATCHUP_SUBTYPES.request, subject: ME });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'addr:laptop', payload: { subtype: PERSON_KEY_CARRY, version: 2 } });
    expect(Object.keys(sent[0].payload.reveals)).toEqual(['k1', 'k2']);
  });
  it('requestFromSiblings asks every sibling', async () => {
    const { sync, sent } = rig();
    expect(await sync.requestFromSiblings()).toEqual({ requested: 2 });
  });
});

describe('a key per self — the router binds a hand-over to the self whose root signed it', () => {
  // Anna's device holds her general self (subject ME, root `root`'s default profile) and a persona (subject PERSONA,
  // its own profile authority). Each self has its own sync; the router hands each payload to the self it names.
  const PERSONA = 'w:anna-buurt';
  const personaAuthority = root.deriveProfileAuthority('p-0123456789ab');
  const personaPub = authorityPubKeyB64Of(personaAuthority);
  const personaProfile = root.deriveAgentSeed('p-0123456789ab');
  const personaKeyAt = (version, { subject = PERSONA, secret = personaAuthority } = {}) => {
    const seed = derivePersonKeySeed(personaProfile, version);
    const facts = personKeyFacts({ version, pubKey: personKeyPubKeyB64(seed) });
    return { version, seed, reveals: { y1: signCeremonyReveal(secret, { circleId: 'y1', kind: PERSON_KEY_CARRY, subject, authorRef: subject, facts }) } };
  };
  const selfRig = (subject, commitmentOf) => {
    const stored = []; const refused = [];
    const sync = createPersonKeySync({
      siblings: async () => ['addr:other-device'], sendToPeer: async () => ({ delivered: true }),
      current: () => null, store: async (k) => { stored.push(k); return true; }, selfPubKey: subject,
      ownCommitmentFor: commitmentOf, onRefused: (reason) => refused.push(reason),
    });
    return { sync, stored, refused };
  };
  const setup = () => {
    const general = selfRig(ME, (c) => (['k1', 'k2'].includes(c) ? ceremonyCommitment(rootPub, c) : null));
    const persona = selfRig(PERSONA, (c) => (c === 'y1' ? ceremonyCommitment(personaPub, c) : null));
    const refused = [];
    const router = routePersonKeySync({
      instanceFor: (subject) => (subject === ME ? general.sync : subject === PERSONA ? persona.sync : null),
      all: () => [general.sync, persona.sync],
      onRefused: (reason) => refused.push(reason),
    });
    return { general, persona, router, refused };
  };
  const wireOf = (k, subject) => ({ subtype: PERSON_KEY_CARRY, subject, version: k.version, seed: b64encode(k.seed), reveals: k.reveals });

  it("the persona's carry lands in the persona only; the general self sees nothing of it", async () => {
    const { general, persona, router } = setup();
    await router.handlers[PERSON_KEY_CARRY]('addr:other-device', wireOf(personaKeyAt(2), PERSONA));
    expect(persona.stored.map((k) => k.version)).toEqual([2]);
    expect(general.stored, 'the general self adopted nothing').toEqual([]);
  });

  it("a carry that CLAIMS the persona but is signed by another self's root is refused — never adopted by the claim", async () => {
    const { general, persona, router } = setup();
    // the general self's root (another self) signs a reveal naming the persona
    await router.handlers[PERSON_KEY_CARRY]('addr:other-device', wireOf(personaKeyAt(2, { secret: root.deriveProfileAuthority('default') }), PERSONA));
    // …and the persona's own key, relabelled as the general self's
    await router.handlers[PERSON_KEY_CARRY]('addr:other-device', wireOf(personaKeyAt(2), ME));
    expect(persona.stored).toEqual([]);
    expect(general.stored).toEqual([]);
    expect(persona.refused).toEqual(['no-root-reveal']);
    expect(general.refused).toEqual(['no-root-reveal']);
  });

  it('a self this device does not hold, or no subject at all: refused and said, nothing adopted', async () => {
    const { general, persona, router, refused } = setup();
    await router.handlers[PERSON_KEY_CARRY]('addr:x', wireOf(personaKeyAt(2), 'w:someone-else'));
    await router.handlers[PERSON_KEY_CARRY]('addr:x', { ...wireOf(personaKeyAt(2), PERSONA), subject: undefined });
    expect(refused).toEqual(['unknown-self', 'no-subject']);
    expect([...general.stored, ...persona.stored]).toEqual([]);
  });
});
