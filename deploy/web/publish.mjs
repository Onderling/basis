#!/usr/bin/env node
/**
 * publish — put a web app on ANY web server, from your own machine. No GitHub, no box needed.
 *
 *   npm run publish:web -- basis --target transip          # build · stamp · upload · verify
 *   npm run publish:web -- basis --zip                     # build · stamp · one archive to upload by hand
 *   npm run publish:web -- basis --dry-run                 # build · stamp · say what would be uploaded
 *
 * A web app here is a Vite app under apps/<name>: `npm run build` writes apps/<name>/dist — an index.html
 * and an assets folder, which is what any web server serves. This script:
 *   1. builds it with the release tag baked in (VITE_APP_VERSION) and writes dist/version.json,
 *   2. uploads dist/ to the target with a SWAP (upload beside, then rename), so visitors never see a
 *      half-uploaded site — rsync over SSH when the target has SSH, an sftp batch otherwise, a plain
 *      copy when the target is a local path (the box's web role uses that),
 *   3. fetches <url>/version.json back and refuses to say "done" unless it reports the tag just built.
 *
 * A target is a small env file OUTSIDE git: deploy/web/targets/<name>.env (see example.env):
 *   WEB_URL=https://basis.onderling.org      what visitors open (used for the verify step)
 *   WEB_HOST=ssh.example.org                 the host; empty ⇒ WEB_PATH is a local directory
 *   WEB_USER=onderling
 *   WEB_PORT=22
 *   WEB_PATH=/www/basis.onderling.org        the folder that serves WEB_URL
 *   WEB_MODE=rsync | sftp                    rsync needs a shell on the host; sftp works on any SFTP host
 * The SSH key is your own (ssh-agent); this script never stores a secret.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, renameSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

export function parseTarget(text) {
  const t = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#')) t[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  if (!t.WEB_PATH) throw new Error('target: WEB_PATH is required');
  if (t.WEB_HOST && !t.WEB_USER) throw new Error('target: WEB_USER is required when WEB_HOST is set');
  t.WEB_MODE = t.WEB_MODE || (t.WEB_HOST ? 'rsync' : 'local');
  t.WEB_PORT = t.WEB_PORT || '22';
  return t;
}

/** The release stamp: the nearest tag (or the short sha) of the tree being published. */
export function releaseStamp(cwd = ROOT) {
  const run = (args) => spawnSync('git', args, { cwd, encoding: 'utf8' }).stdout.trim();
  const tag = run(['describe', '--tags', '--always']);
  const sha = run(['rev-parse', '--short', 'HEAD']);
  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }).stdout.trim() ? '-dirty' : '';
  return { tag: `${tag}${dirty}`, sha, builtAt: new Date().toISOString() };
}

/** Build apps/<app> with the stamp baked in; write dist/version.json. Returns the dist dir. */
export function build(app, stamp, { appsDir = join(ROOT, 'apps'), log = console.log } = {}) {
  const dir = join(appsDir, app);
  if (!existsSync(join(dir, 'package.json'))) throw new Error(`no app at ${dir}`);
  log(`building ${app} as ${stamp.tag} …`);
  const r = spawnSync('npm', ['run', '--silent', 'build'], { cwd: dir, stdio: 'inherit', env: { ...process.env, VITE_APP_VERSION: stamp.tag, VITE_APP_SHA: stamp.sha } });
  if (r.status !== 0) throw new Error(`build failed for ${app}`);
  return stampDist(app, stamp, join(dir, 'dist'));
}

/** Write dist/version.json — the stamp a live site answers with. Separate from build() so --skip-build still stamps. */
export function stampDist(app, stamp, dist) {
  if (!existsSync(join(dist, 'index.html'))) throw new Error(`no build at ${dist}/index.html — run without --skip-build`);
  writeFileSync(join(dist, 'version.json'), JSON.stringify({ app, ...stamp }, null, 2));
  return dist;
}

/** The sftp batch that uploads dist beside the live folder and swaps it in. Pure, so it is testable. */
export function sftpBatch(dist, remotePath) {
  const p = remotePath.replace(/\/$/, '');
  return [
    `-rm -r ${p}.new`, `mkdir ${p}.new`, `put -r ${dist}/* ${p}.new/`,
    `-rm -r ${p}.old`, `-rename ${p} ${p}.old`, `rename ${p}.new ${p}`, `-rm -r ${p}.old`, 'bye', '',
  ].join('\n');
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`);
}

/** Upload with a swap. local: copy beside + rename. rsync: rsync to <path>.new then swap over ssh. sftp: the batch. */
export function upload(dist, t, { log = console.log, run = sh } = {}) {
  const p = t.WEB_PATH.replace(/\/$/, '');
  if (t.WEB_MODE === 'local') {
    log(`copying to ${p} (swap) …`);
    rmSync(`${p}.new`, { recursive: true, force: true });
    mkdirSync(dirname(p), { recursive: true });
    cpSync(dist, `${p}.new`, { recursive: true });
    rmSync(`${p}.old`, { recursive: true, force: true });
    if (existsSync(p)) renameSync(p, `${p}.old`);
    renameSync(`${p}.new`, p);
    rmSync(`${p}.old`, { recursive: true, force: true });
    return;
  }
  const dest = `${t.WEB_USER}@${t.WEB_HOST}`;
  if (t.WEB_MODE === 'rsync') {
    log(`rsync to ${dest}:${p} (swap) …`);
    run('rsync', ['-az', '--delete', '-e', `ssh -p ${t.WEB_PORT}`, `${dist}/`, `${dest}:${p}.new/`]);
    run('ssh', ['-p', t.WEB_PORT, dest, `rm -rf '${p}.old'; [ -e '${p}' ] && mv '${p}' '${p}.old'; mv '${p}.new' '${p}' && rm -rf '${p}.old'`]);
    return;
  }
  if (t.WEB_MODE === 'sftp') {
    log(`sftp to ${dest}:${p} (swap) …`);
    const batch = join(dist, '..', '.publish-sftp-batch');
    writeFileSync(batch, sftpBatch(dist, p));
    try { run('sftp', ['-P', t.WEB_PORT, '-b', batch, dest]); } finally { rmSync(batch, { force: true }); }
    return;
  }
  throw new Error(`unknown WEB_MODE ${t.WEB_MODE}`);
}

/** Fetch <url>/version.json and compare — the only "done" there is. */
export async function verify(url, stamp, { fetchImpl = fetch, tries = 6, waitMs = 5000 } = {}) {
  const u = `${url.replace(/\/$/, '')}/version.json`;
  let last = '';
  for (let i = 0; i < tries; i += 1) {
    try {
      const r = await fetchImpl(u, { cache: 'no-store' });
      const j = await r.json();
      if (j.tag === stamp.tag) return j;
      last = `serves ${j.tag}`;
    } catch (e) { last = e.message; }
    if (i < tries - 1) await new Promise((res) => setTimeout(res, waitMs));
  }
  throw new Error(`verify: ${u} does not report ${stamp.tag} (${last})`);
}

export function zipDist(dist, app, stamp, outDir = ROOT) {
  const out = join(outDir, `${app}-${stamp.tag}.zip`);
  rmSync(out, { force: true });
  sh('zip', ['-qr', out, '.'], { cwd: dist });
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    target: { type: 'string' }, zip: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, 'skip-build': { type: 'boolean' },
  } });
  const app = positionals[0];
  if (!app) { console.error('usage: publish <app> [--target <name> | --zip | --dry-run]'); process.exit(2); }
  try {
    const stamp = releaseStamp();
    const dist = values['skip-build'] ? stampDist(app, stamp, join(ROOT, 'apps', app, 'dist')) : build(app, stamp);
    if (values.zip) { console.log(`archive: ${zipDist(dist, app, stamp)} — upload its contents to the folder that serves the site`); process.exit(0); }
    if (!values.target) { console.log(`built ${dist} as ${stamp.tag}; give --target <name> to upload, or --zip`); process.exit(values['dry-run'] ? 0 : 2); }
    const f = join(HERE, 'targets', `${values.target}.env`);
    if (!existsSync(f)) { console.error(`no target ${values.target}: copy deploy/web/targets/example.env to ${f}`); process.exit(2); }
    const t = parseTarget(readFileSync(f, 'utf8'));
    if (values['dry-run']) { console.log(`would upload ${dist} → ${t.WEB_MODE} ${t.WEB_HOST ? `${t.WEB_USER}@${t.WEB_HOST}:` : ''}${t.WEB_PATH}, then verify ${t.WEB_URL}/version.json = ${stamp.tag}`); process.exit(0); }
    upload(dist, t);
    if (t.WEB_URL) { const seen = await verify(t.WEB_URL, stamp); console.log(`live: ${t.WEB_URL} serves ${seen.tag} (${seen.sha})`); }
    else console.log('uploaded (no WEB_URL in the target, so not verified)');
  } catch (e) { console.error(`publish: ${e.message}`); process.exit(1); }
}
