/**
 * Hermetic wiring test for the real-pod `ensureAccess` hook on the
 * endorsement resource + community catalogue (feat/real-pod-acp).
 *
 * The LIVE proof that the underlying `setResourceAccess` primitive really
 * enforces access on a Solid pod (public-read → unauth 200; non-granted
 * write → 403) lives in `@onderling/pod-client`'s CSS-gated
 * `test/sharing/setResourceAccess.css.test.js` (WAC-proven). THIS test only
 * asserts the agent-registry WIRING contract, hermetically:
 *   - the hook fires (once) after the first write to a REAL (https) pod URI;
 *   - it NEVER fires on a `pseudo-pod://` URI (the hermetic no-op);
 *   - a throwing hook does NOT break the write (best-effort);
 *   - the community catalogue forwards the hook to its underlying resource.
 */
import { describe, it, expect } from 'vitest';
import { createEndorsementResource } from '../src/endorsementResource.js';
import { createCommunityCatalogue }    from '../src/communityCatalogue.js';

/** In-memory pseudo-pod (etag-CAS honoured by createEndorsementResource). */
function makePod() {
  const map = new Map();
  return {
    _map: map,
    async read(uri)  { return map.has(uri) ? { bytes: map.get(uri), etag: String(map.get(uri)?.updatedAt ?? '') } : null; },
    async write(uri, body) { map.set(uri, body); return { etag: String(body?.updatedAt ?? '') }; },
  };
}

const REC = { id: 'e1', subject: 'agent:x', endorser: 'pk:admin', sig: 'deadbeef' };

describe('real-pod ensureAccess wiring — endorsement resource', () => {
  it('fires the hook ONCE after the first write to an https pod URI', async () => {
    const calls = [];
    const res = createEndorsementResource({
      pseudoPod: makePod(),
      resourceUri: 'https://pod.example/public/endorsements',
      ensureAccess: (uri) => { calls.push(uri); },
    });
    await res.append(REC);
    await res.append({ ...REC, id: 'e2' });      // second write must NOT re-fire
    expect(calls).toEqual(['https://pod.example/public/endorsements']);
  });

  it('NEVER fires on a pseudo-pod:// URI (hermetic no-op)', async () => {
    const calls = [];
    const res = createEndorsementResource({
      pseudoPod: makePod(),
      resourceUri: 'pseudo-pod://device-1/public/endorsements',
      ensureAccess: (uri) => { calls.push(uri); },
    });
    await res.append(REC);
    await res.ensureAccess();                     // explicit call is also a no-op here
    expect(calls).toEqual([]);
  });

  it('is best-effort — a throwing hook does not break the write', async () => {
    const res = createEndorsementResource({
      pseudoPod: makePod(),
      resourceUri: 'https://pod.example/public/endorsements',
      ensureAccess: () => { throw new Error('acl server down'); },
    });
    await expect(res.append(REC)).resolves.toBeDefined();
    expect(await res.list()).toHaveLength(1);     // the endorsement still landed
  });

  it('explicit ensureAccess() surfaces a hook error without throwing', async () => {
    const res = createEndorsementResource({
      pseudoPod: makePod(),
      resourceUri: 'https://pod.example/public/endorsements',
      ensureAccess: () => { throw Object.assign(new Error('nope'), { code: 'SHARING_GRANT_NOOP' }); },
    });
    const r = await res.ensureAccess();
    expect(r.code).toBe('SHARING_GRANT_NOOP');
  });

  it('no hook injected → append works, ensureAccess() is a clean skip', async () => {
    const res = createEndorsementResource({
      pseudoPod: makePod(),
      resourceUri: 'https://pod.example/public/endorsements',
    });
    await res.append(REC);
    expect(await res.ensureAccess()).toEqual({ skipped: true });
  });
});

describe('real-pod ensureAccess wiring — community catalogue forwards the hook', () => {
  it('fires the (admin-write) hook on the first admin write to an https URI', async () => {
    const calls = [];
    const cat = createCommunityCatalogue({
      circleId: 'c1',
      isAdmin: (pk) => pk === 'pk:admin',
      pseudoPod: makePod(),
      resourceUri: 'https://pod.example/public/communities/c1/endorsements',
      ensureAccess: (uri) => { calls.push(uri); },
    });
    await cat.endorse(REC);                        // endorser pk:admin is an admin
    expect(calls).toEqual(['https://pod.example/public/communities/c1/endorsements']);
    expect(typeof cat.ensureAccess).toBe('function');
  });
});
