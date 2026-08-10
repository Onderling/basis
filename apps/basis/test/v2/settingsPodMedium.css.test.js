/**
 * settingsPodMedium — LIVE Community Solid Server e2e (#36 pod-sync). Env-gated: runs only when
 * `CSS_URL` + `CSS_CLIENT_ID` + `CSS_CLIENT_SECRET` are set (the `settings-pod-css-harness.mjs` boots a
 * real CSS, provisions an owner pod + client credentials, and sets them). Otherwise SKIPPED — never part
 * of `npm test` / CI (a real server is slow + network-bound), mirroring the other `*.css.test.js` gates.
 *
 * Proves the SAME assembly the app ships (realAgent → `provisionSettingsMedium` → `createSettingsPodMedium`
 * → sealed `SolidPodSource`) round-trips an agent-scoped setting over a REAL pod: the key-holder reads its
 * value back, the pod stores ciphertext at rest, a SECOND device of the same user (same owner-root seed →
 * same key) opens it, and a different user's key is denied.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const CSS_URL = process.env.CSS_URL;
const SUITE   = (CSS_URL && process.env.CSS_CLIENT_ID && process.env.CSS_CLIENT_SECRET) ? describe : describe.skip;

let SolidVault, VaultMemory, AgentIdentity, SolidPodSource;
let createSettingsPodMedium, settingsSealStrategyForIdentity;

SUITE('settingsPodMedium — live CSS pod (#36 pod-sync e2e)', () => {
  let fetchFn, podRoot;

  beforeAll(async () => {
    ({ SolidVault } = await import('@onderling/oidc-session'));
    ({ VaultMemory } = await import('@onderling/vault'));
    ({ AgentIdentity } = await import('@onderling/core'));
    ({ SolidPodSource } = await import('@onderling/pod-client'));
    ({ createSettingsPodMedium } = await import('../../src/v2/settingsPodMedium.js'));
    ({ settingsSealStrategyForIdentity } = await import('../../src/v2/sharedCopyOpener.js'));

    const sv = new SolidVault({ webid: process.env.CSS_WEBID, vault: new VaultMemory() });
    await sv.login({
      clientId:     process.env.CSS_CLIENT_ID,
      clientSecret: process.env.CSS_CLIENT_SECRET,
      oidcIssuer:   process.env.CSS_OIDC_ISSUER || CSS_URL,
    });
    fetchFn = sv.getAuthenticatedFetch();
    podRoot = CSS_URL.endsWith('/') ? CSS_URL : `${CSS_URL}/`;
  });

  it('agent-scoped setting round-trips over the pod; ciphertext at rest; a 2nd device opens it; a stranger is denied', async () => {
    const PATH  = 'mem://basis/settings/shared.json';
    const value = JSON.stringify({ 'nearby.ask.defaultTtlMs': 900000 });
    const seed  = new Uint8Array(32).fill(11);   // the user's owner-root-derived seed (same on their devices)

    // Device A writes an agent-scoped setting, sealed to the user's own network-derived key.
    const idA     = await AgentIdentity.fromSeed(seed, new VaultMemory());
    const deviceA = await createSettingsPodMedium({ fetch: fetchFn, podRoot, strategy: settingsSealStrategyForIdentity(idA) });
    expect(deviceA).toBeTruthy();
    await deviceA.write(PATH, value);

    // Key-holder view: the value round-trips.
    expect(await deviceA.read(PATH)).toBe(value);

    // Host/pod view: the RAW bytes on the pod are a sealed envelope, not the plaintext.
    const rawSource = new SolidPodSource({ podUrl: podRoot, fetch: fetchFn });
    const rawStr = new TextDecoder().decode((await rawSource.read(`${podRoot}basis/settings/shared.json`)).content);
    expect(rawStr.startsWith('fp1:')).toBe(true);
    expect(rawStr).not.toContain('900000');

    // Device B — the SAME user's second device (same owner-root seed → same key) opens A's setting.
    const idB     = await AgentIdentity.fromSeed(seed, new VaultMemory());
    const deviceB = await createSettingsPodMedium({ fetch: fetchFn, podRoot, strategy: settingsSealStrategyForIdentity(idB) });
    expect(JSON.parse(await deviceB.read(PATH))).toEqual(JSON.parse(value));

    // A different user's key cannot open it — deny, never a plaintext/ciphertext leak.
    const idOther   = await AgentIdentity.fromSeed(new Uint8Array(32).fill(22), new VaultMemory());
    const stranger  = await createSettingsPodMedium({ fetch: fetchFn, podRoot, strategy: settingsSealStrategyForIdentity(idOther) });
    await expect(stranger.read(PATH)).rejects.toBeTruthy();

    // Cleanup.
    await deviceA.delete(PATH);
  }, 60_000);
});
