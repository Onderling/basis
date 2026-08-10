/**
 * settings-pod-css-harness — boot a real Community Solid Server, provision an owner account + pod +
 * client credentials, then run the env-gated live-pod e2e for the parameter register's pod-sync
 * (`apps/basis/test/v2/settingsPodMedium.css.test.js`). Tear the server down after.
 *
 *   node apps/basis/scripts/settings-pod-css-harness.mjs
 *
 * Manual / dev-only — NEVER part of `npm test` or CI (it boots CSS via `npx`, slow + network-bound). Mirrors
 * `packages/pod-client/scripts/css-sharing-harness.mjs`; no committed `@solid/community-server` dep (npx).
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const REPO_ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const CSS_CONFIG = process.env.CSS_HARNESS_CONFIG || '@css:config/file.json';
const TEST_PATH = 'apps/basis/test/v2/settingsPodMedium.css.test.js';

const log = (...a) => console.log('[settings-pod-harness]', ...a);
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
  dataDir = await mkdtemp(join(tmpdir(), 'css-settings-'));
  const port = await freePort();
  const base = `http://localhost:${port}/`;
  log(`booting CSS (${CSS_CONFIG}) at ${base}`);
  css = spawn('npx', [
    '-y', '@solid/community-server@^7',
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
  };
  log(`running gated e2e (${TEST_PATH}) against ${env.CSS_URL}…`);
  const v = spawn('npx', ['vitest', 'run', TEST_PATH, '--reporter=verbose'],
    { cwd: REPO_ROOT, env, stdio: 'inherit' });
  process.exitCode = await new Promise((res) => v.on('exit', res)) ?? 1;
}

try { await main(); }
catch (e) { console.error('[settings-pod-harness] FAILED:', e?.stack || e); process.exitCode = 1; }
finally {
  if (css?.pid) { try { process.kill(-css.pid, 'SIGKILL'); } catch { try { css.kill('SIGKILL'); } catch {} } }
  if (dataDir) { try { await rm(dataDir, { recursive: true, force: true }); } catch {} }
}
