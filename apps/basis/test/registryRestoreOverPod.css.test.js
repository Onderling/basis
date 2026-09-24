/**
 * THE REGISTRY RIDES A REAL POD — journey 5 against a live Community Solid Server, with what 2026-09-24 added to the
 * record: a circle PUT AWAY (opbergen). Env-gated like every `*.css.test.js`: runs under
 * `node scripts/run-integration.mjs --provision`, skips without a pod.
 *
 * The in-memory sibling (`registryRestoreOverPod.test.js`) proves the logic; this one proves the bytes: the real
 * agent factory, the registry carrier's sealed pod medium over an authenticated `fetch`, a phone that writes a
 * membership and puts it away, a NEW phone (fresh local backend, same owner root = "she typed her phrase") that finds
 * both on the pod — and a pod that holds neither the circle id nor the mark in clear.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const CSS_URL = process.env.CSS_URL;
const SUITE = (CSS_URL && process.env.CSS_CLIENT_ID && process.env.CSS_CLIENT_SECRET) ? describe : describe.skip;
const CIRCLE = 'circle-oosterpoort-live';

SUITE('the registry rides a real pod — journey 5 with a circle put away', () => {
  let fetchFn; let podRoot;
  let VaultMemory; let createMemoryBackend; let createRealHouseholdAgent; let createRegistryPodMedium; let SolidPodSource;

  beforeAll(async () => {
    const { SolidVault } = await import('@onderling/oidc-session');
    ({ VaultMemory } = await import('@onderling/vault'));
    ({ createMemoryBackend } = await import('@onderling/pseudo-pod'));
    ({ SolidPodSource } = await import('@onderling/pod-client'));
    ({ createRealHouseholdAgent } = await import('../src/web/realAgent.js'));
    ({ createRegistryPodMedium } = await import('../src/v2/registryCarrier.js'));
    const sv = new SolidVault({ webid: process.env.CSS_WEBID, vault: new VaultMemory() });
    await sv.login({ clientId: process.env.CSS_CLIENT_ID, clientSecret: process.env.CSS_CLIENT_SECRET, oidcIssuer: process.env.CSS_OIDC_ISSUER || CSS_URL });
    fetchFn = sv.getAuthenticatedFetch();
    const root = process.env.CSS_POD_ROOT || CSS_URL;
    podRoot = root.endsWith('/') ? root : `${root}/`;
  });

  const boot = (vaults) => createRealHouseholdAgent({
    seedHousehold: false, seedDemoData: false,
    ownerRootVault: vaults.owner, chatVault: vaults.chat,
    registryBackend: createMemoryBackend(),
    provisionRegistryMedium: async (strategy) => createRegistryPodMedium({ fetch: fetchFn, podRoot, strategy }),
  });

  it('a phone puts a circle away; a NEW phone with her phrase finds the circle AND the mark on the pod; the pod holds neither in clear', async () => {
    const anna = { owner: new VaultMemory(), chat: new VaultMemory() };
    const phone = await boot(anna);
    expect(phone.registryCarrierStatus().mode, 'the registry rides the pod').toBe('cache');
    expect((await phone.callSkill('agents', 'setProfileCircleMembership', {
      id: 'default', circleId: CIRCLE, handle: 'anna', address: 'relay:anna-oosterpoort',
    }))?.ok).toBe(true);
    const put = await phone.setCircleSight(CIRCLE, true);
    expect(put.ok, JSON.stringify(put)).toBe(true);

    // What the HOST sees: list the pod and read everything the carrier wrote — neither the circle id nor the mark.
    const raw = new SolidPodSource({ podUrl: podRoot, fetch: fetchFn });
    const seen = [];
    const walk = async (uri, depth = 0) => {
      if (depth > 4) return;
      let entries = [];
      try { entries = (await raw.list(uri))?.entries ?? []; } catch { return; }
      for (const e of entries) {
        const u = typeof e === 'string' ? e : (e?.uri ?? e?.url);
        if (!u) continue;
        if (u.endsWith('/')) { await walk(u, depth + 1); continue; }
        try { seen.push(new TextDecoder().decode((await raw.read(u)).content)); } catch { /* not ours to read */ }
      }
    };
    await walk(podRoot);
    const all = seen.join('\n');
    expect(seen.length, 'the carrier wrote something to the pod').toBeGreaterThan(0);
    expect(all, 'the circle id is not on the pod in clear').not.toContain(CIRCLE);
    expect(all, 'nor the put-away mark').not.toContain('putAway');

    // ── WIPE: a new phone — fresh local backend, the same owner root (the ceremony writes exactly this seed) ──
    const newPhone = await boot(anna);
    expect(newPhone.registryCarrierStatus()).toMatchObject({ mode: 'cache', probe: 'openable', pulled: true });
    const { reopened } = await newPhone.reopenMemberCircles();
    expect(reopened, 'the circle came back from the pod').toContain(CIRCLE);
    const sights = await newPhone.circleSights();
    expect(sights[CIRCLE]?.putAway, 'and it is still put away').toBe(true);
  }, 120_000);
});
