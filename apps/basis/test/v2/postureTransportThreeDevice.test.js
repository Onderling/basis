/**
 * Storage postures across circles and devices — stories 7.1 + 7.3 of
 * `plans/NOTE-multi-device-user-stories.md`.
 *
 * A posture is a PROMISE about where content can be read: `p2` means client-side group-key sealing, `p3`
 * means sealed at rest to the roster, `p0`/`p1` mean the host (or its enclave) can see it. The failure mode
 * that matters is not a wrong cipher — it is a promise that quietly stops being kept:
 *   • 7.1 — one person in two circles with DIFFERENT postures. Each circle's content must stay under its own
 *     posture, and a circle that cannot honour a sealed affordance must say so rather than pretend.
 *   • 7.3 — the pod goes away MID-FLOW (Anna signs out between two shares). The second share must degrade
 *     HONESTLY: no silent plaintext, no false success.
 *
 * 7.2 (transport ladder) is deliberately NOT re-tested here: relay↔NKN failover, degradation and
 * route-selection already have direct coverage (`packages/secure-agent/test/sendFailover.test.js`,
 * `packages/core/test/RoutingStrategy.test.js`, and the `routing/transport-flap` + `mesh-partition-heal`
 * integration scenarios). A third-device restatement would duplicate rather than probe.
 *
 * Hermetic, like `circleShareCanonical.test.js`: REAL sealing primitives + REAL createCanonicalShare over a
 * fake ACP `sharing` table. No pod, no DOM.
 */
import { describe, it, expect } from 'vitest';
import { makeCircleShareEnforcement } from '@onderling/item-store';
import {
  createCanonicalShare, generateKeypair, unwrapGroupKey, chooseSealScheme, SEAL_SCHEMES,
} from '@onderling/pod-client';
import { makeResourceUriResolver, sharedRefResourceUri } from '@onderling/pod-onboarding/resourceUri';
import { makeCircleLists } from '@onderling/kring-host/circleLists';
import { shareItemAcrossCircles, listSharedResolved } from '../../src/v2/circleShare.js';

/** A fake ACP surface — grant/revoke mutate a table; list answers deny-by-default from it. */
function fakeSharing() {
  const table = new Map();
  const key = (uri) => { if (!table.has(uri)) table.set(uri, new Set()); return table.get(uri); };
  return {
    table,
    has: (uri, agent) => key(uri).has(agent),
    grantCount: () => [...table.values()].reduce((n, s) => n + s.size, 0),
    async grant({ resourceUri, agent }) { key(resourceUri).add(agent); return { resourceUri, agent }; },
    async revoke({ resourceUri, agent }) { key(resourceUri).delete(agent); return { resourceUri, agent }; },
    async list({ resourceUri, agentsToQuery = [] }) {
      const set = key(resourceUri);
      return agentsToQuery.filter((a) => set.has(a)).map((agent) => ({ subject: 'agent', agent, modes: ['read'] }));
    },
  };
}

function memKeyStore(initial = null) {
  let stored = initial;
  return { read: async () => stored, write: async (r) => { stored = r; }, current: () => stored };
}

const resourceUriFor = sharedRefResourceUri(makeResourceUriResolver({ podUri: 'https://pod.example/' }));

/** The pod-tier enforcement a signed-in device builds. Returning null from `enforcementFor` is what a
 *  signed-OUT device produces — that asymmetry is the whole of story 7.3. */
function buildEnforcement({ sharing, keyStore, controllerKey, currentRecipients }) {
  const canonicalShare = createCanonicalShare({ sharing, keyStore, controllerKey, resourceUriFor });
  return makeCircleShareEnforcement({
    sharing, resourceUriFor, open: (text) => text, canonicalShare, currentRecipients,
  });
}

describe('7.1 — the posture→scheme mapping is per-circle and does not blur', () => {
  it('p2 seals with the GROUP key, p3 pairwise, and p0/p1 seal not at all', () => {
    // The single decision point both circles route through. If these ever collapse onto one scheme, two
    // circles with different promises start sharing one cipher — the "scheme mix-up" this story names.
    expect(chooseSealScheme({ posture: 'p2' })).toBe(SEAL_SCHEMES.GROUP_KEY);
    expect(chooseSealScheme({ posture: 'p3' })).toBe(SEAL_SCHEMES.PAIRWISE);
    expect(chooseSealScheme({ posture: 'p0' })).toBe(null);
    expect(chooseSealScheme({ posture: 'p1' })).toBe(null);
  });

  it('the field is `posture`, NOT the app\'s `storagePosture` — and the mismatch fails OPEN', () => {
    // A footgun worth pinning rather than discovering. The app policy's field is `storagePosture`; the
    // resolver reads `posture`, and `resolveCircleStorage({posture: policy.storagePosture})` is what bridges
    // them. Hand `chooseSealScheme` the app's field name directly and it does not throw — it returns null,
    // i.e. NO SEAL. A rename or a new call site that forgets the bridge silently turns sealing off.
    expect(chooseSealScheme({ storagePosture: 'p2' })).toBe(null);
    expect(chooseSealScheme({ posture: 'p2' })).toBe(SEAL_SCHEMES.GROUP_KEY);   // the bridged form works
  });

  it('two circles resolve INDEPENDENTLY — X being p2 does not make Y p2', () => {
    const x = { posture: 'p2' };
    const y = { posture: 'p3' };
    expect(chooseSealScheme(x)).not.toBe(chooseSealScheme(y));
    expect(chooseSealScheme(y)).toBe(SEAL_SCHEMES.PAIRWISE);   // re-read after X: no shared mutable state
    expect(chooseSealScheme(x)).toBe(SEAL_SCHEMES.GROUP_KEY);
  });
});

describe('7.1 — content shared out of one circle does not appear in a third', () => {
  it('Anna shares X→Y; circle Z (where she is also a member) stays empty', async () => {
    const svc = makeCircleLists();
    const resolveService = async () => svc;
    const controllerKey = generateKeypair();
    const anna = generateKeypair();
    const bram = generateKeypair();
    const sharing = fakeSharing();
    const enforcement = buildEnforcement({
      sharing, keyStore: memKeyStore(), controllerKey, currentRecipients: () => [anna.publicKey],
    });

    const src = await svc.createList('X', 'the X-circle plan', 'anna');
    const r = await shareItemAcrossCircles({
      resolveService, enforcementFor: async () => enforcement,
      policyOf: async () => ({ sharePosture: 'canonical' }),
      itemId: src.id, fromCircleId: 'X', toCircleId: 'Y', by: 'anna',
      recipients: ['did:bram'], recipientKeys: [bram.publicKey],
    });
    expect(r.ok).toBe(true);

    expect(await svc.stores.getStore('Y').listByType('shared-ref')).toHaveLength(1);
    expect(await svc.stores.getStore('Z').list()).toHaveLength(0);      // the third circle is untouched

    // And the read gate agrees: Bram (granted, in Y) resolves it; a member of Z does not.
    expect(await listSharedResolved({
      resolveService, enforcementFor: async () => enforcement, circleId: 'Y', recipient: 'did:bram',
    })).toHaveLength(1);
    expect(await listSharedResolved({
      resolveService, enforcementFor: async () => enforcement, circleId: 'Z', recipient: 'did:cato',
    })).toHaveLength(0);
  });

  it('a `closed` circle refuses to share out at all, and says why', async () => {
    const svc = makeCircleLists();
    const src = await svc.createList('X', 'private', 'anna');
    const r = await shareItemAcrossCircles({
      resolveService: async () => svc, policyOf: async () => ({ sharePosture: 'closed' }),
      itemId: src.id, fromCircleId: 'X', toCircleId: 'Y', by: 'anna', recipients: ['did:bram'],
    });
    expect(r).toMatchObject({ ok: false, error: 'sharing-closed' });
    expect(await svc.stores.getStore('Y').list()).toHaveLength(0);      // and nothing was written
  });

  it('an UNREADABLE policy is treated as closed — deny-by-default, not open-by-accident', async () => {
    const svc = makeCircleLists();
    const src = await svc.createList('X', 'private', 'anna');
    const r = await shareItemAcrossCircles({
      resolveService: async () => svc,
      policyOf: async () => { throw new Error('policy store unreachable'); },
      itemId: src.id, fromCircleId: 'X', toCircleId: 'Y', by: 'anna', recipients: ['did:bram'],
    });
    expect(r).toMatchObject({ ok: false, error: 'sharing-closed' });
  });
});

describe('7.3 — the pod goes away between two shares', () => {
  /** One circle, one policy, two shares — the ONLY difference is whether the device still has a pod. */
  async function shareTwice({ secondEnforcement = null, storagePosture = 'p0', keepPod = false }) {
    const svc = makeCircleLists();
    const resolveService = async () => svc;
    const controllerKey = generateKeypair();
    const anna = generateKeypair();
    const bram = generateKeypair();
    const sharing = fakeSharing();
    const keyStore = memKeyStore();
    const live = buildEnforcement({
      sharing, keyStore, controllerKey, currentRecipients: () => [anna.publicKey],
    });

    const policyOf = async () => ({ sharePosture: 'canonical', storagePosture });
    const one = await svc.createList('X', 'first body', 'anna');
    const two = await svc.createList('X', 'second body', 'anna');

    const first = await shareItemAcrossCircles({
      resolveService, enforcementFor: async () => live, policyOf,
      itemId: one.id, fromCircleId: 'X', toCircleId: 'Y', by: 'anna',
      recipients: ['did:bram'], recipientKeys: [bram.publicKey],
    });

    // …Anna signs out of her pod here. `buildCircleShareEnforcement` returns null without a podRoot, so the
    // shell's `enforcementFor` yields null — the ONLY change.
    const second = await shareItemAcrossCircles({
      resolveService, enforcementFor: async () => (keepPod ? live : secondEnforcement), policyOf,
      itemId: two.id, fromCircleId: 'X', toCircleId: 'Y', by: 'anna',
      recipients: ['did:bram'], recipientKeys: [bram.publicKey],
    });

    return { svc, sharing, keyStore, first, second, bram, refs: () => svc.stores.getStore('Y').listByType('shared-ref') };
  }

  it('the FIRST share (pod live) is sealed and granted — the control', async () => {
    const { first, sharing, keyStore, bram, refs } = await shareTwice({});
    expect(first.ok).toBe(true);
    const uri = resourceUriFor((await refs())[0]);
    expect(sharing.has(uri, 'did:bram')).toBe(true);                       // ACP grant landed
    expect(unwrapGroupKey(keyStore.current(), bram.privateKey)).toBeTruthy(); // key re-wrapped to Bram
  });

  // ✅ FIXED 2026-07-26. The share now REFUSES when the circle's own `storagePosture` promised sealing
  // (p2/p3) and the pod-tier enforcement is absent — `{ok:false, error:'seal-unavailable'}`. The refusal is
  // scoped to circles that made the promise, so a p0/p1 circle (including the DEFAULT, p0) still takes the
  // deliberate in-memory path exactly as before; see the p0 test below.
  it('a sealed circle REFUSES the share after sign-out rather than writing plaintext', async () => {
    const { second, sharing, refs } = await shareTwice({ secondEnforcement: null, storagePosture: 'p3' });
    expect(second).toMatchObject({ ok: false, error: 'seal-unavailable', posture: 'p3' });

    // Nothing was written and nothing was granted — the refusal is complete, not cosmetic.
    expect(await refs()).toHaveLength(1);            // only the FIRST share's ref
    expect(sharing.grantCount()).toBe(1);
  });

  it('p2 refuses too — both sealing postures are covered, not just the one', async () => {
    const { second } = await shareTwice({ secondEnforcement: null, storagePosture: 'p2' });
    expect(second).toMatchObject({ ok: false, error: 'seal-unavailable', posture: 'p2' });
  });

  it('a p0 circle is UNAFFECTED — the no-pod in-memory mode still works', async () => {
    // The control that keeps the fix honest: p0 promises no client-side seal, so the plain `shared-ref`
    // write IS its correct behaviour. If this ever starts refusing, the fix has over-reached.
    const { second, refs } = await shareTwice({ secondEnforcement: null, storagePosture: 'p0' });
    expect(second.ok).toBe(true);
    expect(await refs()).toHaveLength(2);
  });

  it('a sealed circle with the pod STILL LIVE is unaffected — it is the absence that refuses', async () => {
    const { first, second } = await shareTwice({ storagePosture: 'p3', keepPod: true });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);                    // enforcement present ⇒ no refusal
  });
});
