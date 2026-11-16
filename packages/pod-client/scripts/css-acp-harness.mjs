/**
 * css-acp-harness — boot a real Community Solid Server, provision an OWNER +
 * a STRANGER account, and run the gated `setResourceAccess` integration proof
 * (`test/sharing/setResourceAccess.css.test.js`) against it. Then tear down.
 *
 * This is the durable, repeatable way to prove the commons/registry resources'
 * real-pod access posture (public-read + owner-write + admin-write, and the
 * deny side: a non-owner write → 403). Manual / dev-only — NEVER part of the
 * default `npm test` or CI (it boots a server via `npx`, slow + network-bound).
 *
 *   node scripts/css-acp-harness.mjs                 # WAC mode (green proof)
 *   CSS_HARNESS_CONFIG=@css:config/file-acp.json node scripts/css-acp-harness.mjs
 *       # ACP mode — @inrupt/solid-client@3.0.0 is a silent no-op vs CSS-ACP,
 *       # so the public-read grant lands in report.errors (SHARING_GRANT_NOOP)
 *       # and the proof is legitimately RED (the pre-existing Inrupt↔CSS gap).
 *
 * Sibling of `css-sharing-harness.mjs`; same account-API provisioning flow,
 * plus a 2nd (stranger/admin) account for the deny-side + admin-write cases.
 * No committed `@solid/community-server` dep — it runs via `npx`.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CSS_CONFIG = process.env.CSS_HARNESS_CONFIG || '@css:config/file.json'; // WAC = green

const log = (...a) => console.log('[css-acp-harness]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}

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
  dataDir = await mkdtemp(join(tmpdir(), 'css-acp-'));
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

  async function provision(label) {
    cookieJar = '';
    const c0 = (await api(`${base}.account/`)).json.controls;
    if (!c0?.account?.create) throw new Error(`no account.create control; controls=${JSON.stringify(c0)}`);
    await api(c0.account.create, { method: 'POST' });
    const c = (await api(`${base}.account/`)).json.controls;
    await api(c.password.create, { method: 'POST', body: { email: `${label}@ex.com`, password: 'pw-123456' } });
    const pod = await api(c.account.pod, { method: 'POST', body: { name: label } });
    const webId = pod.json?.webId ?? `${base}${label}/profile/card#me`;
    const cc = await api(c.account.clientCredentials, { method: 'POST', body: { name: `${label}-tok`, webId } });
    log(`${label}: pod=${pod.json?.pod} cc=${cc.status}`);
    return { podRoot: pod.json?.pod ?? `${base}${label}/`, webId, clientId: cc.json?.id, clientSecret: cc.json?.secret };
  }

  const owner = await provision('owner');
  const stranger = await provision('stranger');
  if (!owner.clientId || !owner.clientSecret || !stranger.clientId) {
    throw new Error('client-credentials missing — CSS account-API shape changed; inspect GET <base>.account/');
  }

  const env = {
    ...process.env,
    CSS_URL: owner.podRoot.endsWith('/') ? owner.podRoot : `${owner.podRoot}/`,
    CSS_WEBID: owner.webId,
    CSS_OIDC_ISSUER: base,
    CSS_CLIENT_ID: owner.clientId,
    CSS_CLIENT_SECRET: owner.clientSecret,
    CSS_STRANGER_ID: stranger.clientId,
    CSS_STRANGER_SECRET: stranger.clientSecret,
    CSS_STRANGER_WEBID: stranger.webId,
    CSS_SCRATCH: 'public/',
  };
  log('running gated proof (test/sharing/setResourceAccess.css.test.js)…');
  const v = spawn('npx', ['vitest', 'run', 'test/sharing/setResourceAccess.css.test.js', '--reporter=verbose'],
    { cwd: PKG_ROOT, env, stdio: 'inherit' });
  process.exitCode = await new Promise((res) => v.on('exit', res)) ?? 1;
}

try { await main(); }
catch (e) { console.error('[css-acp-harness] FAILED:', e?.stack || e); process.exitCode = 1; }
finally {
  if (css?.pid) { try { process.kill(-css.pid, 'SIGKILL'); } catch { try { css.kill('SIGKILL'); } catch {} } }
  if (dataDir) { try { await rm(dataDir, { recursive: true, force: true }); } catch {} }
}
