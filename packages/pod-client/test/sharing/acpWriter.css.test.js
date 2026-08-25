/**
 * CSS-ACP integration proof for the DIRECT `.acr` writer (feat/acp-acr-writer).
 *
 * This is the ACP twin of `setResourceAccess.css.test.js` (which proves the
 * WAC path). It proves that on an **ACP-configured** CSS — where
 * `@inrupt/solid-client@3.0.0`'s `universalAccess` is a silent no-op —
 * `setResourceAccess` now ROUTES to the direct ACR writer and REAL ACP access
 * control ENFORCES.
 *
 * Gate mirrors `sharing.css.test.js` / `setResourceAccess.css.test.js` EXACTLY:
 * gated on a **running** Community Solid Server in ACP mode via `CSS_URL` +
 * client-credentials (skips cleanly otherwise, so `npm test` / CI stay green —
 * no server boot in the default suite). Heavy imports are dynamic in
 * `beforeAll`.
 *
 * Requires (provisioned by `scripts/css-acp-writer-harness.mjs`):
 *   - CSS booted with `@css:config/file-acp.json` (ACP mode).
 *   - `CSS_URL`, `CSS_CLIENT_ID`, `CSS_CLIENT_SECRET`  (owner)
 *   - optional `CSS_WEBID`, `CSS_OIDC_ISSUER`, `CSS_SCRATCH`
 *   - `CSS_STRANGER_ID` + `CSS_STRANGER_SECRET` (+ `CSS_STRANGER_WEBID`)
 *       — a SECOND, NON-granted account: the DENY proof (its write → 403).
 *   - `CSS_ADMIN_ID` + `CSS_ADMIN_SECRET` (+ `CSS_ADMIN_WEBID`)
 *       — a THIRD account, GRANTED agent-write: proves the agent grant lands
 *         (its write → 2xx) while the stranger's still → 403.
 *
 * ── What this proves (ACP enforcement is REAL, not a no-op) ─────────────
 * On a resource set (via `setResourceAccess`) to public-read + owner-write
 * (+ admin agent-write):
 *   (a) an UNAUTHENTICATED reader CAN read it              → 200
 *   (b) a NON-granted stranger CANNOT write it             → 403   ← THE PROOF
 *   (c) the OWNER CAN still write it                       → 2xx
 *   (d) the GRANTED admin CAN write it                     → 2xx
 *       and the non-granted stranger still cannot          → 403
 */
import { describe, it, expect, beforeAll } from 'vitest';

const CSS_URL   = process.env.CSS_URL;
const HAVE_OIDC = !!(process.env.CSS_CLIENT_ID && process.env.CSS_CLIENT_SECRET);
const SUITE     = CSS_URL && HAVE_OIDC ? describe : describe.skip;
const HAVE_STRANGER = !!(process.env.CSS_STRANGER_ID && process.env.CSS_STRANGER_SECRET);
const HAVE_ADMIN    = !!(process.env.CSS_ADMIN_ID && process.env.CSS_ADMIN_SECRET);

let PodClient, SolidOidcAuth, setResourceAccess, SolidVault, VaultMemory;

beforeAll(async () => {
  if (!CSS_URL || !HAVE_OIDC) return;
  ({ PodClient, SolidOidcAuth, setResourceAccess } = await import('../../src/index.js'));
  ({ VaultMemory } = await import('@onderling/vault'));
  ({ SolidVault }  = await import('@onderling/oidc-session'));
});

SUITE('acpWriter — CSS-ACP integration (direct .acr writer ENFORCES)', () => {
  // The pod under test is the OWNER'S POD, not the server root. Addressing `CSS_URL` meant writing into
  // the CSS root container, which the throwaway server leaves world-readable/writable/CONTROLLABLE — so
  // "public" already held every mode before a single grant was made, and every grant/revoke assertion here
  // was measuring the default ACL of a container nobody owns. `CSS_POD_ROOT` falls back to `CSS_URL` so an
  // operator pointing this at an external CSS keeps the old behaviour.
  const POD_BASE = process.env.CSS_POD_ROOT || CSS_URL;
  const scratch = process.env.CSS_SCRATCH ?? 'public/';
  const strangerWebId = process.env.CSS_STRANGER_WEBID || `${CSS_URL}stranger/profile/card#me`;
  const adminWebId    = process.env.CSS_ADMIN_WEBID    || `${CSS_URL}admin/profile/card#me`;

  async function makeClient({ podRoot, webid, clientId, clientSecret }) {
    const vault = new VaultMemory();
    const sv = new SolidVault({ webid, vault });
    await sv.login({ clientId, clientSecret, oidcIssuer: process.env.CSS_OIDC_ISSUER || CSS_URL });
    return new PodClient({ podRoot, auth: new SolidOidcAuth({ vault: sv }) });
  }
  const owner = () => makeClient({
    podRoot: POD_BASE,
    webid: process.env.CSS_WEBID || `${CSS_URL}profile/card#me`,
    clientId: process.env.CSS_CLIENT_ID, clientSecret: process.env.CSS_CLIENT_SECRET,
  });
  const stranger = () => makeClient({
    podRoot: POD_BASE,
    webid: strangerWebId,
    clientId: process.env.CSS_STRANGER_ID, clientSecret: process.env.CSS_STRANGER_SECRET,
  });
  const admin = () => makeClient({
    podRoot: POD_BASE,
    webid: adminWebId,
    clientId: process.env.CSS_ADMIN_ID, clientSecret: process.env.CSS_ADMIN_SECRET,
  });

  async function writeDenied(client, uri) {
    try {
      await client.write(uri, JSON.stringify({ v: 1, hacked: true }), { contentType: 'application/json', force: true });
      return false; // wrote → LEAK
    } catch (err) {
      return err?.status === 403 || err?.code === 'FORBIDDEN' || /403|forbidden/i.test(err?.message ?? '');
    }
  }

  it('is actually ACP (capability probe), and public-read + owner-write ENFORCES (unauth 200, stranger write 403, owner write ok)', async () => {
    const client = await owner();

    const uri = `${POD_BASE}${scratch}acp-endorsements-${Date.now()}`;
    await client.write(uri, JSON.stringify({ v: 1, endorsements: [] }), { contentType: 'application/json', force: true });

    // Sanity: this CSS really is ACP for THIS resource (else the WAC path would
    // apply and the test would be proving the wrong thing). Probed after the
    // write — an unmaterialised container HEADs 404 and mis-reads as unsupported.
    const caps = await client.sharing.capabilities({ resourceUri: uri });
    expect(caps.acp).toBe(true);

    // Apply the commons posture — routes to the direct ACR writer on ACP.
    const report = await setResourceAccess({
      sharing: client.sharing,
      resourceUri: uri,
      public: { read: true },
    });
    // eslint-disable-next-line no-console
    console.log('[acpWriter.css] report:', JSON.stringify(report));
    expect(report.errors).toEqual([]);                       // ACP writer: no no-op errors
    expect(report.applied).toContainEqual({ subject: 'public', modes: ['read'] });

    // (a) unauthenticated read → 200 (public-read landed + enforced)
    const unauth = await fetch(uri, { headers: { accept: 'application/json' } });
    expect(unauth.status).toBe(200);

    // (c) owner can still write
    await expect(
      client.write(uri, JSON.stringify({ v: 1, endorsements: [{ id: 'x' }] }), { contentType: 'application/json', force: true }),
    ).resolves.toBeDefined();

    // (b) THE DENY PROOF — a non-granted stranger CANNOT write → 403
    if (HAVE_STRANGER) {
      const s = await stranger();
      expect(await writeDenied(s, uri)).toBe(true);
      await s.close?.();
    }

    await client.delete(uri).catch(() => {});
    await client.close?.();
  });

  it('agent grant: the GRANTED admin can write, a NON-granted stranger cannot (public-read stays)', async () => {
    if (!HAVE_ADMIN || !HAVE_STRANGER) return;               // needs both a granted + a non-granted account
    const client = await owner();
    const uri = `${POD_BASE}${scratch}acp-community-${Date.now()}`;
    await client.write(uri, JSON.stringify({ v: 1, endorsements: [] }), { contentType: 'application/json', force: true });

    const report = await setResourceAccess({
      sharing: client.sharing,
      resourceUri: uri,
      public: { read: true },
      agents: { [adminWebId]: { read: true, write: true } },   // the circle admin
    });
    expect(report.errors).toEqual([]);
    expect(report.applied).toContainEqual({ subject: 'public', modes: ['read'] });
    expect(report.applied).toContainEqual({ subject: 'agent', agent: adminWebId, modes: ['read', 'write'] });

    // unauth read still 200
    expect((await fetch(uri, { headers: { accept: 'application/json' } })).status).toBe(200);

    // (d) the granted admin CAN write
    const a = await admin();
    await expect(
      a.write(uri, JSON.stringify({ v: 1, endorsements: [{ id: 'byAdmin' }] }), { contentType: 'application/json', force: true }),
    ).resolves.toBeDefined();
    await a.close?.();

    // …and the NON-granted stranger STILL cannot (403) — the grant is scoped
    const s = await stranger();
    expect(await writeDenied(s, uri)).toBe(true);
    await s.close?.();

    await client.delete(uri).catch(() => {});
    await client.close?.();
  });
});
