/**
 * The registry carrier — the owner's registry survives the device.
 *
 * Real primitives: the real sealed pod data source over an in-memory pod, the real seal-to-self strategy
 * from a real identity, the real pseudo-pod in cache mode, the real agent registry composed over it.
 * What is faked is only the pod's transport (a Map). Each test names the journey it stands for.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createAgentRegistry, setCircleMembership, circleMembershipsOf } from '@onderling/agent-registry';
import { settingsSealStrategyForIdentity } from '../src/v2/sharedCopyOpener.js';
import { createRegistryCarrier, createRegistryPodMedium, registryPodName } from '../src/v2/registryCarrier.js';

/** An in-memory stand-in for SolidPodSource: read → {content}, 404 → NOT_FOUND. */
function memoryPodSource(store = new Map()) {
  const notFound = () => Object.assign(new Error('not found'), { code: 'NOT_FOUND', status: 404 });
  return {
    store,
    async read(uri) { if (!store.has(uri)) throw notFound(); return { content: store.get(uri) }; },
    async write(uri, content) { store.set(uri, String(content)); return {}; },
    async delete(uri) { store.delete(uri); },
    async list() { return { entries: [...store.keys()] }; },
  };
}
const identityFor = async (seedByte) => AgentIdentity.fromSeed(new Uint8Array(32).fill(seedByte), new VaultMemory());
const mediumFor = (identity, podSource) =>
  createRegistryPodMedium({ podSource, strategy: settingsSealStrategyForIdentity(identity) });

async function deviceFor(identity, podSource, { backend = createMemoryBackend(), onKeyMismatch } = {}) {
  const carrier = createRegistryCarrier({
    backend, deviceId: identity.pubKey, medium: await mediumFor(identity, podSource),
    name: registryPodName(identity), onKeyMismatch,
  });
  const attached = await carrier.attach();
  const registry = createAgentRegistry({ pseudoPod: carrier.pseudoPod, deviceId: identity.pubKey });
  return { carrier, registry, attached };
}
const join = (registry, circleId, handle) => registry.register({
  agentId: 'default', pubKey: 'p', agentUri: 'agent://p', role: 'profile',
  properties: setCircleMembership({}, circleId, { handle, address: `addr-${circleId}`, key: { ref: `dec:${circleId}`, posture: 'p2' } }),
});

describe('the registry carrier', () => {
  it('names the pod resource opaquely: stable per identity, meaningless to the host, different per person', async () => {
    const a = await identityFor(1); const b = await identityFor(2);
    expect(registryPodName(a)).toBe(registryPodName(a));
    expect(registryPodName(a)).not.toBe(registryPodName(b));
    expect(registryPodName(a)).not.toMatch(/registry|agent|private/);
  });

  it('JOURNEY 5 — a wiped device signed into its pod gets the circle list back, sealed at rest', async () => {
    const anna = await identityFor(1);
    const pod = memoryPodSource();
    const phone = await deviceFor(anna, pod);
    expect(phone.attached.probe).toBe('missing');
    await join(phone.registry, 'oosterpoort', 'anna');

    // The pod holds ONE resource, under the opaque name, and it is ciphertext.
    expect([...pod.store.keys()]).toEqual([registryPodName(anna)]);
    expect(pod.store.get(registryPodName(anna))).not.toContain('oosterpoort');

    // ── WIPE ── a new phone: fresh local backend, same identity (the phrase re-derived it), same pod.
    const newPhone = await deviceFor(anna, pod);
    expect(newPhone.attached).toMatchObject({ probe: 'openable', pulled: true, mode: 'cache' });
    const entry = await newPhone.registry.lookup('default');
    expect(circleMembershipsOf(entry).oosterpoort, 'the membership AND the wrapped-key ref came back')
      .toMatchObject({ handle: 'anna', key: { ref: 'dec:oosterpoort', posture: 'p2' } });
  });

  it('JOURNEY 6 — a second install without the phrase must not erase her: the pod copy is untouched', async () => {
    const anna = await identityFor(1);
    const stranger = await identityFor(9);
    const pod = memoryPodSource();
    const phone = await deviceFor(anna, pod);
    await join(phone.registry, 'oosterpoort', 'anna');
    const before = pod.store.get(registryPodName(anna));

    let mismatches = 0;
    // The stranger's install writes to the SAME pod path (the test pins it: in life the stranger would
    // derive a different name, which is a weaker guard than the seal, so the seal is what is asserted).
    const carrier = createRegistryCarrier({
      backend: createMemoryBackend(), deviceId: stranger.pubKey, medium: await mediumFor(stranger, pod),
      name: registryPodName(anna), onKeyMismatch: () => { mismatches += 1; },
    });
    const attached = await carrier.attach();
    expect(attached).toMatchObject({ probe: 'undecryptable', mode: 'local' });
    expect(mismatches).toBe(1);
    const registry = createAgentRegistry({ pseudoPod: carrier.pseudoPod, deviceId: stranger.pubKey });
    await join(registry, 'their-own-circle', 'x');   // the boot's own self-registration, in life
    expect(pod.store.get(registryPodName(anna)), 'nothing overwritten').toBe(before);
  });

  it('a network hiccup during the probe holds this session without accusing a key mismatch', async () => {
    const anna = await identityFor(1);
    const broken = { async read() { throw Object.assign(new Error('fetch failed'), { status: 503 }); }, async write() {}, async delete() {}, async list() { return { entries: [] }; } };
    let mismatches = 0;
    const phone = await deviceFor(anna, broken, { onKeyMismatch: () => { mismatches += 1; } });
    expect(phone.attached).toMatchObject({ probe: 'transport', mode: 'local' });
    expect(mismatches).toBe(0);
    await join(phone.registry, 'c', 'anna');   // local still works
    expect(circleMembershipsOf(await phone.registry.lookup('default')).c).toBeTruthy();
  });

  it('a device that joined circles while offline pushes its local copy up on the first attach to an empty pod', async () => {
    const anna = await identityFor(1);
    const backend = createMemoryBackend();
    const offline = createRegistryCarrier({ backend, deviceId: anna.pubKey });   // no medium: local only
    const reg = createAgentRegistry({ pseudoPod: offline.pseudoPod, deviceId: anna.pubKey });
    await join(reg, 'street', 'anna');

    const pod = memoryPodSource();
    const signedIn = await deviceFor(anna, pod, { backend });   // same local backend, now signed in
    expect(signedIn.attached).toMatchObject({ probe: 'missing', pushed: true, mode: 'cache' });
    expect(pod.store.has(registryPodName(anna))).toBe(true);
  });

  it('when both sides hold a copy, the newer one wins at the resource level', async () => {
    const anna = await identityFor(1);
    const pod = memoryPodSource();
    const laptop = await deviceFor(anna, pod);
    await join(laptop.registry, 'first', 'anna');
    const phoneBackend = createMemoryBackend();
    const phone = await deviceFor(anna, pod, { backend: phoneBackend });
    expect(phone.attached.pulled).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    await join(laptop.registry, 'second', 'anna');           // the laptop writes again, later
    const phoneAgain = await deviceFor(anna, pod, { backend: phoneBackend });   // the phone re-boots
    expect(phoneAgain.attached.pulled, 'the pod copy is newer → pulled').toBe(true);
    expect(Object.keys(circleMembershipsOf(await phoneAgain.registry.lookup('default')))).toEqual(['second']);
  });
});
