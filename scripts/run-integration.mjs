#!/usr/bin/env node
/**
 * run-integration.mjs — trigger every integration test in the index (`integration-index.mjs`).
 *
 * The integration tests are gated on a live Community Solid Server (a real pod) and SELF-SKIP without one.
 * Two ways to run:
 *   • `node scripts/run-integration.mjs`             — run them against whatever CSS your env points at
 *                                                      (CSS_URL + CSS_CLIENT_ID/SECRET/WEBID). No pod → they skip.
 *   • `node scripts/run-integration.mjs --provision` — boot a throwaway in-memory CSS, mint an account + pod +
 *                                                      client-credentials (the same flow the companion journey
 *                                                      uses), wire the env, run everything, tear the server down.
 *
 * Prints one summary line per test (passed / skipped / failed) and exits nonzero if any FAILED (skips are OK —
 * a skip means "no pod for this one", not a defect).
 */
import { spawn, spawnSync } from 'node:child_process';
import { INTEGRATION_TESTS, pkgOf, ROOT } from './integration-index.mjs';

const PROVISION = process.argv.includes('--provision');
const PORT = Number(process.env.CSS_PORT) || 3838;
const BASE = `http://localhost:${PORT}/`;

/** Provision a fresh CSS account + pod + client-credentials (cookie-based account API; the returned webId). */
async function provision(base, label) {
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

async function reachable(base) {
  try { const r = await fetch(`${base}.account/`, { signal: AbortSignal.timeout(2000) }); return r.ok; }
  catch { return false; }
}

async function bootCss() {
  console.log(`· booting a throwaway CSS on :${PORT} …`);
  const proc = spawn('npx', ['-y', '@solid/community-server', '-p', String(PORT), '-b', BASE, '-l', 'error', '-c', '@css:config/default.json'],
    { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    if (await reachable(BASE)) return proc;
    await new Promise((r) => setTimeout(r, 1000));
  }
  proc.kill('SIGKILL');
  throw new Error(`CSS did not come up on :${PORT} within 60s`);
}

function envFromAccount(acct) {
  const podRoot = acct.podRoot.endsWith('/') ? acct.podRoot : acct.podRoot + '/';
  return {
    CSS_URL: BASE,
    CSS_OIDC_ISSUER: BASE,
    CSS_WEBID: acct.webId,
    CSS_CLIENT_ID: acct.clientId,
    CSS_CLIENT_SECRET: acct.clientSecret,
    CSS_POD_ROOT: podRoot,
    CSS_CIRCLE_ROOT: `${podRoot}circles`,
  };
}

/** Classify a vitest run from its output + exit status. */
function classify(out, status) {
  if (/Tests\s+.*\bfailed/i.test(out) || (status !== 0 && /failed/i.test(out))) return 'failed';
  if (/\bpassed\b/i.test(out) && !/0 passed/i.test(out)) return 'passed';
  if (/skipped|no CSS|set CSS_URL/i.test(out)) return 'skipped';
  return status === 0 ? 'skipped' : 'failed';
}

async function main() {
  let cssProc = null;
  let extraEnv = {};

  if (PROVISION) {
    cssProc = await bootCss();
    const label = `it${Date.now().toString(36)}`;
    const acct = await provision(BASE, label);
    if (!acct.clientId || !acct.clientSecret) { cssProc.kill('SIGKILL'); throw new Error('provisioning did not return client-credentials'); }
    extraEnv = envFromAccount(acct);
    console.log(`· provisioned pod ${acct.podRoot} (webId ${acct.webId})\n`);
  } else if (!process.env.CSS_URL) {
    console.log('· no CSS_URL set — tests will SKIP. Pass --provision to boot a throwaway pod and run them for real.\n');
  }

  const env = { ...process.env, ...extraEnv };
  const results = [];
  for (const t of INTEGRATION_TESTS) {
    const pkg = pkgOf(t.file);
    const rel = t.file.slice(pkg.length + 1);
    const r = spawnSync('npx', ['vitest', 'run', rel, '--reporter=dot'], { cwd: `${ROOT}/${pkg}`, encoding: 'utf8', env });
    const out = (r.stdout || '') + (r.stderr || '');
    const verdict = classify(out, r.status);
    results.push({ file: t.file, verdict });
    const mark = verdict === 'passed' ? '✓' : verdict === 'skipped' ? '·' : '✗';
    console.log(` ${mark} ${verdict.padEnd(7)} ${t.file}`);
  }

  if (cssProc) cssProc.kill('SIGKILL');

  const failed = results.filter((r) => r.verdict === 'failed');
  const passed = results.filter((r) => r.verdict === 'passed').length;
  const skipped = results.filter((r) => r.verdict === 'skipped').length;
  console.log(`\n── integration: ${passed} passed · ${skipped} skipped · ${failed.length} failed ──`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
