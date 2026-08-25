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
 * Prints one summary line per test (passed / skipped / failed) and exits nonzero if any FAILED.
 *
 * ── THE FIXTURES `--provision` MINTS (2026-08-25) ────────────────────────────────────────────────
 * A pod is not one account. These suites judge ACCESS — who may read, who is refused — and that needs
 * more than one identity, plus somewhere inside a REAL pod to write. Provisioning one account and
 * leaving the rest unset did not make those suites skip; it made them assert against the SERVER ROOT,
 * which `@css:config/default.json` leaves world-readable/writable/controllable. "public already has
 * everything" is why a revoke looked broken and an owner-write looked forbidden: the suites were red,
 * and about nothing. So we mint FOUR accounts —
 *
 *   owner     the pod under test          → CSS_WEBID / CSS_CLIENT_ID / CSS_CLIENT_SECRET / CSS_POD_ROOT
 *   stranger  a real second identity      → CSS_STRANGER_* (the deny side) + CSS_GRANTEE_WEBID
 *   admin     a real third identity       → CSS_ADMIN_*    (the admin-write grant)
 *   bob       a second POD                → CSS_B_*        (cross-pod delivery; `owner` is CSS_A_*)
 *
 * — and set `CSS_SCRATCH`, a container path resolved against the OWNER'S POD ROOT (never the server
 * root; see the note on each suite that had it wrong).
 *
 * A row may declare `needs: { acp: true }`: CSS defaults to WAC, and a suite that proves the ACP
 * writer needs an ACP-configured server. Those rows run against a SECOND CSS booted with
 * `@css:config/file-acp.json` and their own accounts, rather than reading red on the wrong server.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INTEGRATION_TESTS, pkgOf, ROOT } from './integration-index.mjs';

const PROVISION = process.argv.includes('--provision');
/** `--only=<substr>[,<substr>]` — run just the matching rows (diagnosis; the default is everything). */
const ONLY = process.argv.filter((a) => a.startsWith('--only='))
  .flatMap((a) => a.slice('--only='.length).split(',')).filter(Boolean);
/** Where each suite's full output lands, so a red is DIAGNOSABLE without re-running it by hand. */
const LOG_DIR = `${ROOT}/.integration-logs`;
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

/**
 * Boot a throwaway CSS. `config` selects the AUTHORIZATION MODEL, which is the whole reason this takes a
 * parameter: `@css:config/default.json` is memory + **WAC**, `@css:config/file-acp.json` is disk + **ACP**.
 * A suite that proves the ACP writer cannot be judged on a WAC server — it reads red for the one reason
 * that says nothing about the code.
 */
async function bootCss({ port, base, config = '@css:config/default.json' }) {
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
function teardown(proc) {
  if (!proc) return;
  // The whole group — see the `detached` note in bootCss.
  try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* already gone */ }
  try { proc.kill('SIGKILL'); } catch { /* already gone */ }
  if (proc.dataDir) rmSync(proc.dataDir, { recursive: true, force: true });
}

/** The env every suite reads, from the four minted accounts. `base` is the server the accounts live on. */
function envFrom({ base, owner, stranger, admin, bob }) {
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
async function provisionAll(base, tag) {
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

/** Classify a vitest run from its output + exit status. */
function classify(out, status) {
  if (/Tests\s+.*\bfailed/i.test(out) || (status !== 0 && /failed/i.test(out))) return 'failed';
  if (/\bpassed\b/i.test(out) && !/0 passed/i.test(out)) return 'passed';
  if (/skipped|no CSS|set CSS_URL/i.test(out)) return 'skipped';
  return status === 0 ? 'skipped' : 'failed';
}

/** The lines that say WHY — the first assertion/error vitest printed, not the whole run. */
function reasonFrom(out) {
  const lines = out.split('\n');
  const picked = [];
  for (const l of lines) {
    if (/^\s*(AssertionError|Error|TypeError|FetchError|ReferenceError|\u2192|\u276f)/.test(l)
      || /expected .* to (be|equal|contain)|Tests\s+\d+ failed|Unhandled/i.test(l)) {
      const t = l.trim();
      if (t && !picked.includes(t)) picked.push(t);
    }
    if (picked.length >= 4) break;
  }
  return picked.length ? picked : ['(no reason line matched \u2014 read the log)'];
}

async function main() {
  const servers = BOOTED;
  let wacEnv = {};
  let acpEnv = null;

  rmSync(LOG_DIR, { recursive: true, force: true });
  mkdirSync(LOG_DIR, { recursive: true });
  const selected = ONLY.length
    ? INTEGRATION_TESTS.filter((t) => ONLY.some((o) => t.file.includes(o)))
    : INTEGRATION_TESTS;
  const wantAcp = selected.some((t) => t.needs?.acp);

  if (PROVISION) {
    const tag = `it${Date.now().toString(36)}`;
    servers.push(await bootCss({ port: PORT, base: BASE }));
    const wac = await provisionAll(BASE, tag);
    wacEnv = wac.env;
    console.log(`· provisioned pod ${wac.accounts.owner.podRoot} + stranger/admin/second-pod`);

    if (wantAcp) {
      const acpPort = PORT + 1;
      const acpBase = `http://localhost:${acpPort}/`;
      servers.push(await bootCss({ port: acpPort, base: acpBase, config: '@css:config/file-acp.json' }));
      const acp = await provisionAll(acpBase, `${tag}acp`);
      acpEnv = acp.env;
      console.log(`· provisioned ACP pod ${acp.accounts.owner.podRoot}`);
    }
    console.log('');
  } else if (!process.env.CSS_URL) {
    console.log('· no CSS_URL set — tests will SKIP. Pass --provision to boot a throwaway pod and run them for real.\n');
  }

  const results = [];
  for (const t of selected) {
    const pkg = pkgOf(t.file);
    const rel = t.file.slice(pkg.length + 1);
    // An ACP row runs against the ACP server; everything else against the WAC one. With no --provision
    // both are empty and the ambient env decides, exactly as before.
    const env = { ...process.env, ...(t.needs?.acp && acpEnv ? acpEnv : wacEnv) };
    const r = spawnSync('npx', ['vitest', 'run', rel, '--reporter=dot'], { cwd: `${ROOT}/${pkg}`, encoding: 'utf8', env });
    const out = (r.stdout || '') + (r.stderr || '');
    const verdict = classify(out, r.status);
    // The full output is KEPT. A red whose reason is not on screen gets diagnosed by re-running it by
    // hand with the env reconstructed from memory — which is how a fixture gap and a real regression
    // came to look alike here.
    const log = `${LOG_DIR}/${t.file.replace(/[/]/g, '__')}.log`;
    writeFileSync(log, out);
    results.push({ file: t.file, verdict, out, log });
    const mark = verdict === 'passed' ? '✓' : verdict === 'skipped' ? '·' : '✗';
    console.log(` ${mark} ${verdict.padEnd(7)} ${t.file}`);
    if (verdict === 'failed') console.log(reasonFrom(out).map((l) => `      ${l}`).join('\n'));
  }

  for (const proc of servers) teardown(proc);

  const failed = results.filter((r) => r.verdict === 'failed');
  const passed = results.filter((r) => r.verdict === 'passed').length;
  const skipped = results.filter((r) => r.verdict === 'skipped').length;
  console.log(`\n── integration: ${passed} passed · ${skipped} skipped · ${failed.length} failed ──`);
  process.exit(failed.length ? 1 : 0);
}

// A boot failure, a thrown provisioning error or a Ctrl-C must not leave a server holding the port.
const BOOTED = [];
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { for (const p of BOOTED) teardown(p); process.exit(130); });
}

main().catch((e) => {
  for (const p of BOOTED) teardown(p);
  console.error(e?.message ?? e);
  process.exit(1);
});
