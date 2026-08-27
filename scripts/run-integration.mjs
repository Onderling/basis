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
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
// The CSS boot + account minting is shared with the journeys harness — one implementation, so a
// pod behaves the same wherever a test asks for one.
import { bootCss, teardown, provisionAll } from './css-harness.mjs';
import { INTEGRATION_TESTS, pkgOf, ROOT } from './integration-index.mjs';

const PROVISION = process.argv.includes('--provision');
/** `--only=<substr>[,<substr>]` — run just the matching rows (diagnosis; the default is everything). */
const ONLY = process.argv.filter((a) => a.startsWith('--only='))
  .flatMap((a) => a.slice('--only='.length).split(',')).filter(Boolean);
/** Where each suite's full output lands, so a red is DIAGNOSABLE without re-running it by hand. */
const LOG_DIR = `${ROOT}/.integration-logs`;
const PORT = Number(process.env.CSS_PORT) || 3838;
const BASE = `http://localhost:${PORT}/`;

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
