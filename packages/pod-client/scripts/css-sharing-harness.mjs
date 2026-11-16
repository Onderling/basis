/**
 * css-sharing-harness — boot a real Community Solid Server, provision
 * an owner + grantee, and run the gated `client.sharing` integration
 * test (`test/sharing/sharing.css.test.js`) against it. Then tear down.
 *
 * This is the durable, repeatable way to test `client.sharing` against
 * a real server in the future. It is **manual / dev-only** — NEVER part
 * of the default `npm test` or CI (it boots a server via `npx`, which
 * is slow and network-bound).
 *
 *   npm run test:css                 --prefix packages/pod-client
 *   CSS_HARNESS_CONFIG=@css:config/file.json npm run test:css   # WAC mode
 *
 * Why this exists: as of 2026-05-16, `@inrupt/solid-client@3.0.0` (the
 * current `latest`) is a silent no-op against CSS 7.1.9 ACP — so the
 * gated test is RED-on-gate-ON **by design** vs CSS (a precise
 * regression gate: it flips GREEN the day the Inrupt↔CSS interop gap
 * closes). To test the *supported* path (Inrupt-hosted), don't use this
 * harness — point the same gated test at a real Inrupt pod instead:
 *   CSS_URL=https://<your>.pod/ CSS_CLIENT_ID=… CSS_CLIENT_SECRET=… \
 *   CSS_WEBID=… CSS_OIDC_ISSUER=https://login.inrupt.com/ \
 *   npx vitest run test/sharing/sharing.css.test.js --prefix packages/pod-client
 *
 * Full analysis: Project Files/Inrupt-migration/
 * css-acp-integration-test-design-2026-05-16.md.
 *
 * No committed `@solid/community-server` dep — it runs via `npx` so the
 * heavy server package never enters the workspace tree.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CSS_CONFIG = process.env.CSS_HARNESS_CONFIG || '@css:config/file-acp.json';

const log = (...a) => console.log('[css-harness]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}

// CSS 7.1 account session is cookie-based — tiny cookie jar.
let cookieJar = '';
function absorb(resp) {
  for (const c of resp.headers.getSetCookie?.() ?? []) {
    const kv = c.split(';')[0];
    cookieJar = cookieJar ? `${cookieJar}; ${kv}` : kv;
  }
}
async function api(url, { method = 'GET', body } = {}) {
  const r = await fetch(url, {
    method,
    headers: {
      accept: 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookieJar ? { cookie: cookieJar } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  absorb(r);
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}

let css, dataDir;
async function main() {
  dataDir = await mkdtemp(join(tmpdir(), 'css-sharing-'));
  const port = await freePort();
  const base = `http://localhost:${port}/`;
  log(`booting CSS (${CSS_CONFIG}) at ${base}`);
  css = spawn('npx', [
    '-y', '@solid/community-server@7.2.0',
    '-c', CSS_CONFIG,
    '-f', dataDir, '-p', String(port), '-b', base, '-l', 'error',
  ], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  css.stdout.on('data', (d) => process.stderr.write(`[css] ${d}`));
  css.stderr.on('data', (d) => process.stderr.write(`[css] ${d}`));

  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${base}.account/`)).ok) break; } catch { /* not up */ }
    await sleep(1000);
    if (i === 119) throw new Error('CSS did not become ready in 120s');
  }
  log('CSS ready');

  // Discovery-driven CSS 7.1 account API (controls map changes once authed).
  async function provision(label) {
    cookieJar = '';                                  // fresh session per account
    const c0 = (await api(`${base}.account/`)).json.controls;
    if (!c0?.account?.create) throw new Error(`no account.create control; controls=${JSON.stringify(c0)}`);
    await api(c0.account.create, { method: 'POST' });
    const c = (await api(`${base}.account/`)).json.controls;       // now authed via cookie jar
    if (!c?.password?.create) throw new Error(`no password.create after auth; controls=${JSON.stringify(Object.keys(c ?? {}))}`);
    await api(c.password.create, { method: 'POST', body: { email: `${label}@ex.com`, password: 'pw-123456' } });
    const pod = await api(c.account.pod, { method: 'POST', body: { name: label } });
    const webId = pod.json?.webId ?? `${base}${label}/profile/card#me`;
    const cc = await api(c.account.clientCredentials, { method: 'POST', body: { name: `${label}-tok`, webId } });
    log(`${label}: pod=${pod.json?.pod} cc=${cc.status}`);
    return { podRoot: pod.json?.pod ?? `${base}${label}/`, webId, clientId: cc.json?.id, clientSecret: cc.json?.secret };
  }

  const owner = await provision('owner');
  const grantee = await provision('grantee');
  if (!owner.clientId || !owner.clientSecret) {
    throw new Error('owner client-credentials missing — CSS account-API shape changed; inspect GET <base>.account/');
  }

  const env = {
    ...process.env,
    CSS_URL: owner.podRoot.endsWith('/') ? owner.podRoot : `${owner.podRoot}/`,
    CSS_WEBID: owner.webId,
    CSS_OIDC_ISSUER: base,
    CSS_CLIENT_ID: owner.clientId,
    CSS_CLIENT_SECRET: owner.clientSecret,
    CSS_GRANTEE_WEBID: grantee.webId,
    CSS_SCRATCH: '',                                  // write at pod root
  };
  log('running gated sharing test (test/sharing/sharing.css.test.js)…');
  const v = spawn('npx', ['vitest', 'run', 'test/sharing/sharing.css.test.js', '--reporter=verbose'],
    { cwd: PKG_ROOT, env, stdio: 'inherit' });
  process.exitCode = await new Promise((res) => v.on('exit', res)) ?? 1;
}

try { await main(); }
catch (e) { console.error('[css-harness] FAILED:', e?.stack || e); process.exitCode = 1; }
finally {
  if (css?.pid) { try { process.kill(-css.pid, 'SIGKILL'); } catch { try { css.kill('SIGKILL'); } catch {} } }
  if (dataDir) { try { await rm(dataDir, { recursive: true, force: true }); } catch {} }
}
