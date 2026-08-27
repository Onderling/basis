/**
 * css-harness — boot a throwaway Community Solid Server and mint the identities a test needs.
 *
 * Extracted 2026-08-27 so the two harnesses that need a pod share ONE implementation:
 * `scripts/run-integration.mjs` (the `*.css.test.js` tier) and `apps/e2e-journeys/run.mjs` (the user
 * journeys). Before this, only the first could boot a pod, which is why two perfectly healthy
 * journeys spent months reported as "skipped" — nobody had given them infrastructure, and the summary
 * line made that look like a gap in the product rather than in the harness.
 *
 * Everything here is throwaway: an in-memory (or temp-dir) server on a free port, accounts minted
 * through the account API, and a teardown that kills the process GROUP — `proc.kill()` reaps the npx
 * wrapper and leaves the node server holding the port, which wedges the NEXT run with a boot timeout
 * that looks like a server fault.
 *
 * ⚠ The access model matters. CSS ships WAC in its default configs and serves ACP only from
 * `@css:config/file-acp.json`. Onderling's circle sharing writes ACP resources, so a test that
 * exercises sharing must ask for the ACP config or it will watch every grant succeed and authorize
 * nothing. See docs/architecture.md, the Pod home.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Provision a fresh CSS account + pod + client-credentials (cookie-based account API; the returned webId). */
export async function provision(base, label) {
  let cookie = '';
  const api = async (url, opts = {}) => {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { accept: 'application/json', ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    let json = null; try { json = await res.json(); } catch { /* */ }
    return json;
  };
  const c0 = (await api(`${base}.account/`)).controls;
  await api(c0.account.create, { method: 'POST' });
  const c = (await api(`${base}.account/`)).controls;
  await api(c.password.create, { method: 'POST', body: { email: `${label}@ex.com`, password: 'pw-123456' } });
  const pod = await api(c.account.pod, { method: 'POST', body: { name: label } });
  const webId = pod?.webId ?? `${base}${label}/profile/card#me`;
  const cc = await api(c.account.clientCredentials, { method: 'POST', body: { name: `${label}-tok`, webId } });
  return { podRoot: pod?.pod ?? `${base}${label}/`, webId, clientId: cc?.id, clientSecret: cc?.secret };
}

export async function reachable(base) {
  try { const r = await fetch(`${base}.account/`, { signal: AbortSignal.timeout(2000) }); return r.ok; }
  catch { return false; }
}

/**
 * Boot a throwaway CSS. `config` selects the AUTHORIZATION MODEL, which is the whole reason this takes a
 * parameter: `@css:config/default.json` is memory + **WAC**, `@css:config/file-acp.json` is disk + **ACP**.
 * A suite that proves the ACP writer cannot be judged on a WAC server — it reads red for the one reason
 * that says nothing about the code.
 */
export async function bootCss({ port, base, config = '@css:config/default.json' }) {
  const onDisk = config.includes('file');
  const dataDir = onDisk ? mkdtempSync(join(tmpdir(), 'css-integration-')) : null;
  console.log(`· booting a throwaway CSS on :${port} (${config.replace('@css:config/', '')}) …`);
  const args = ['-y', '@solid/community-server', '-p', String(port), '-b', base, '-l', 'error', '-c', config];
  if (dataDir) args.push('-f', dataDir);
  // `detached` so the server gets its own process GROUP. Killing the `npx` wrapper leaves the node
  // server it spawned holding the port — measured: two orphans still listening on :3838/:3839 after a
  // run "tore down", which wedges the NEXT run with a boot timeout that looks like a server fault.
  const proc = spawn('npx', args, { cwd: ROOT, stdio: 'ignore', detached: true });
  proc.dataDir = dataDir;
  for (let i = 0; i < 90; i++) {
    if (await reachable(base)) return proc;
    await new Promise((r) => setTimeout(r, 1000));
  }
  proc.kill('SIGKILL');
  throw new Error(`CSS did not come up on :${port} within 90s`);
}

/** Stop a booted CSS and drop its data dir. */
export function teardown(proc) {
  if (!proc) return;
  // The whole group — see the `detached` note in bootCss.
  try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* already gone */ }
  try { proc.kill('SIGKILL'); } catch { /* already gone */ }
  if (proc.dataDir) rmSync(proc.dataDir, { recursive: true, force: true });
}

/** The env every suite reads, from the four minted accounts. `base` is the server the accounts live on. */
export function envFrom({ base, owner, stranger, admin, bob }) {
  const root = (p) => (p.endsWith('/') ? p : p + '/');
  const podRoot = root(owner.podRoot);
  return {
    CSS_URL: base,
    CSS_OIDC_ISSUER: base,
    // the pod under test
    CSS_WEBID: owner.webId,
    CSS_CLIENT_ID: owner.clientId,
    CSS_CLIENT_SECRET: owner.clientSecret,
    CSS_POD_ROOT: podRoot,
    CSS_CIRCLE_ROOT: `${podRoot}circles`,
    // A container INSIDE that pod. Relative on purpose — each suite joins it onto the pod root, and CSS
    // creates the intermediate container on the first PUT.
    CSS_SCRATCH: 'scratch/',
    // A REAL second identity. Granting to a synthetic WebID stores the string and proves nothing: the
    // grantee can never come back and try the read, so "the grant works" and "the grant is ignored"
    // look the same.
    CSS_GRANTEE_WEBID:  stranger.webId,
    CSS_STRANGER_WEBID: stranger.webId,
    CSS_STRANGER_ID:     stranger.clientId,
    CSS_STRANGER_SECRET: stranger.clientSecret,
    // A third identity, so "the admin may write" is not proven by the same account that must be refused.
    CSS_ADMIN_WEBID:  admin.webId,
    CSS_ADMIN_ID:     admin.clientId,
    CSS_ADMIN_SECRET: admin.clientSecret,
    // The cross-pod pair (A = owner). Without B the cross-pod suite SKIPPED — silently, which is the
    // worst reading of all: the one proof that two separate pods can deliver to each other never ran.
    CSS_A_WEBID: owner.webId,
    CSS_A_CLIENT_ID: owner.clientId,
    CSS_A_CLIENT_SECRET: owner.clientSecret,
    CSS_A_ROOT: `${podRoot}circles`,
    CSS_B_WEBID: bob.webId,
    CSS_B_CLIENT_ID: bob.clientId,
    CSS_B_CLIENT_SECRET: bob.clientSecret,
  };
}

/** Mint the four accounts on `base` and return the env they imply. */
export async function provisionAll(base, tag) {
  const mint = (who) => provision(base, `${tag}${who}`);
  const accounts = {
    base,
    owner:    await mint('own'),
    stranger: await mint('str'),
    admin:    await mint('adm'),
    bob:      await mint('bob'),
  };
  for (const [who, a] of Object.entries(accounts)) {
    if (who === 'base') continue;
    if (!a.clientId || !a.clientSecret) throw new Error(`provisioning ${who} did not return client-credentials`);
  }
  return { accounts, env: envFrom(accounts) };
}
