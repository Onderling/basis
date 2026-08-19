/**
 * CSS integration proof for `setResourceAccess` — the real-pod access
 * posture of the commons/registry resources (feat/real-pod-acp).
 *
 * Mirrors `sharing.css.test.js`'s gate EXACTLY: gated on a **running**
 * Community Solid Server via `CSS_URL` + client-credentials (skips cleanly
 * otherwise, so `npm test` / CI stay green — no server boot in the default
 * suite). Heavy imports are dynamic in `beforeAll`.
 *
 * Requires (same as the sharing/PodClient CSS path):
 *   - `CSS_URL`                       e.g. http://localhost:3000/
 *   - `CSS_CLIENT_ID` + `CSS_CLIENT_SECRET`   (owner client-credentials)
 *   - optional `CSS_WEBID`, `CSS_OIDC_ISSUER`, `CSS_SCRATCH`
 *   - `CSS_STRANGER_ID` + `CSS_STRANGER_SECRET` (+ `CSS_STRANGER_WEBID`)
 *       — a SECOND account's client-credentials, to prove the DENY side
 *       (a non-owner/non-admin write → 403). Without it, the deny-side
 *       assertions are skipped (the whole point is the deny proof, so the
 *       harness provisions this — see `scripts/css-acp-harness.mjs`).
 *
 * ── What this proves (the ACP/WAC is REAL) ─────────────────────────────
 * On an endorsement-shaped resource set to **public-read + owner-write**:
 *   (a) an UNAUTHENTICATED reader CAN read it            → 200
 *   (b) a NON-owner (stranger) CANNOT write it           → 403
 *   (c) the OWNER CAN write it                            → ok
 * On a community-catalogue-shaped resource with an added **admin-write** grant:
 *   (d) the configured admin (2nd WebID) CAN write it     → ok
 *       (and, absent that grant, the stranger still can't — covered by (b))
 *
 * ── Model note (WAC vs ACP on CSS) ─────────────────────────────────────
 * Against a WAC-configured CSS (the default `@css:config/file.json`) the
 * grants land and enforce — this test goes GREEN. Against an ACP-configured
 * CSS, `@inrupt/solid-client@3.0.0` is a silent no-op (it detects ACP but
 * can't write the CSS `.acr`); `setResourceAccess` records that in
 * `report.errors` (code `SHARING_GRANT_NOOP`) rather than faking success, so
 * the public-read assertion legitimately fails there. That is the pre-existing
 * Inrupt↔CSS-ACP interop gap, not a regression here. Boot the harness in WAC
 * mode for the green proof; real Inrupt-hosted (ACP) pods are the SDK's
 * supported target.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const CSS_URL   = process.env.CSS_URL;
const HAVE_OIDC = !!(process.env.CSS_CLIENT_ID && process.env.CSS_CLIENT_SECRET);
const SUITE     = CSS_URL && HAVE_OIDC ? describe : describe.skip;
const HAVE_STRANGER = !!(process.env.CSS_STRANGER_ID && process.env.CSS_STRANGER_SECRET);

let PodClient, SolidOidcAuth, setResourceAccess, SolidVault, VaultMemory;

beforeAll(async () => {
  if (!CSS_URL || !HAVE_OIDC) return;
  ({ PodClient, SolidOidcAuth, setResourceAccess } = await import('../../src/index.js'));
  ({ VaultMemory } = await import('@onderling/vault'));
  ({ SolidVault }  = await import('@onderling/oidc-session'));
});

SUITE('setResourceAccess — CSS integration (real-pod ACP/WAC proof)', () => {
  const scratch = process.env.CSS_SCRATCH ?? 'public/';
  const strangerWebId = process.env.CSS_STRANGER_WEBID || `${CSS_URL}stranger/profile/card#me`;

  async function makeClient({ podRoot, webid, clientId, clientSecret }) {
    const vault = new VaultMemory();
    const sv = new SolidVault({ webid, vault });
    await sv.login({ clientId, clientSecret, oidcIssuer: process.env.CSS_OIDC_ISSUER || CSS_URL });
    return new PodClient({ podRoot, auth: new SolidOidcAuth({ vault: sv }) });
  }
  const owner = () => makeClient({
    podRoot: CSS_URL,
    webid: process.env.CSS_WEBID || `${CSS_URL}profile/card#me`,
    clientId: process.env.CSS_CLIENT_ID, clientSecret: process.env.CSS_CLIENT_SECRET,
  });
  const stranger = () => makeClient({
    podRoot: CSS_URL,
    webid: strangerWebId,
    clientId: process.env.CSS_STRANGER_ID, clientSecret: process.env.CSS_STRANGER_SECRET,
  });

  it('endorsement resource: public-read + owner-write is REAL (unauth read 200, stranger write 403, owner write ok)', async () => {
    const client = await owner();
    const uri = `${CSS_URL}${scratch}endorsements-${Date.now()}`;
    await client.write(uri, JSON.stringify({ v: 1, endorsements: [] }), { contentType: 'application/json', force: true });

    // Apply the commons posture via the reusable primitive.
    const report = await setResourceAccess({
      sharing: client.sharing,
      resourceUri: uri,
      public: { read: true },
    });
    // eslint-disable-next-line no-console
    console.log('[setResourceAccess.css] report:', JSON.stringify(report));
    expect(report.errors).toEqual([]);                       // WAC pod: no no-op errors
    expect(report.applied).toContainEqual({ subject: 'public', modes: ['read'] });

    // (a) unauthenticated read → 200
    const unauth = await fetch(uri, { headers: { accept: 'application/json' } });
    expect(unauth.status).toBe(200);

    // (c) owner can still write
    await expect(
      client.write(uri, JSON.stringify({ v: 1, endorsements: [{ id: 'x' }] }), { contentType: 'application/json', force: true }),
    ).resolves.toBeDefined();

    // (b) a non-owner stranger CANNOT write → 403 (the deny-side guard)
    if (HAVE_STRANGER) {
      const s = await stranger();
      let denied = false;
      try {
        await s.write(uri, JSON.stringify({ v: 1, hacked: true }), { contentType: 'application/json', force: true });
      } catch (err) {
        denied = err?.status === 403 || err?.code === 'FORBIDDEN' || /403|forbidden/i.test(err?.message ?? '');
      }
      expect(denied).toBe(true);
      await s.close?.();
    }

    await client.delete(uri).catch(() => {});
    await client.close?.();
  });

  it('community catalogue: adding admin-write lets the admin write, public-read stays', async () => {
    if (!HAVE_STRANGER) return;                              // needs a 2nd account to act as the admin
    const client = await owner();
    const uri = `${CSS_URL}${scratch}community-${Date.now()}`;
    await client.write(uri, JSON.stringify({ v: 1, endorsements: [] }), { contentType: 'application/json', force: true });

    const report = await setResourceAccess({
      sharing: client.sharing,
      resourceUri: uri,
      public: { read: true },
      agents: { [strangerWebId]: { read: true, write: true } },  // the circle admin
    });
    expect(report.errors).toEqual([]);
    expect(report.applied).toContainEqual({ subject: 'agent', agent: strangerWebId, modes: ['read', 'write'] });

    // unauth read still 200
    expect((await fetch(uri, { headers: { accept: 'application/json' } })).status).toBe(200);

    // (d) the granted admin CAN write
    const admin = await stranger();
    await expect(
      admin.write(uri, JSON.stringify({ v: 1, endorsements: [{ id: 'byAdmin' }] }), { contentType: 'application/json', force: true }),
    ).resolves.toBeDefined();
    await admin.close?.();

    await client.delete(uri).catch(() => {});
    await client.close?.();
  });
});
