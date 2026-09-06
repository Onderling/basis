// deploy/box — the updater, proven against a real git remote and a FAKE docker (a script on PATH that
// records every call and whose health answer we control). What is proven: a box with nothing new does
// nothing; a new commit on the release branch is checked out, built, started and recorded; a red health
// gate rolls back to the previous sha and records that; HOLD freezes; a RESET tag is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const RUNNER = resolve(import.meta.dirname, '..');

function sh(cmd, args, opts = {}) { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim(); }

/** A fake box: a remote repo with a `live` branch carrying one role, a clone under the box, a fake docker. */
function makeBox() {
  const root = mkdtempSync(join(tmpdir(), 'box-'));
  const remote = join(root, 'remote.git');
  const work = join(root, 'work');
  sh('git', ['init', '-q', '--bare', '-b', 'live', remote]);
  sh('git', ['init', '-q', '-b', 'live', work]);
  sh('git', ['-C', work, 'config', 'user.email', 't@t']); sh('git', ['-C', work, 'config', 'user.name', 't']);
  mkdirSync(join(work, 'deploy/roles'), { recursive: true });
  writeFileSync(join(work, 'deploy/roles/thing.yml'), 'services:\n  thing:\n    image: x\n');
  writeFileSync(join(work, 'deploy/roles/thing.health'), '#!/usr/bin/env bash\n[ ! -f "$BOX_DIR/RED" ]\n');
  chmodSync(join(work, 'deploy/roles/thing.health'), 0o755);
  sh('git', ['-C', work, 'add', '-A']); sh('git', ['-C', work, 'commit', '-q', '-m', 'v1']);
  sh('git', ['-C', work, 'remote', 'add', 'origin', remote]); sh('git', ['-C', work, 'push', '-q', 'origin', 'live']);

  const box = join(root, 'box');
  mkdirSync(join(box, 'repos'), { recursive: true }); mkdirSync(join(box, 'data/caddy'), { recursive: true });
  sh('git', ['clone', '-q', '--branch', 'live', remote, join(box, 'repos/mono')]);
  writeFileSync(join(box, 'box.conf'), `REPOS="mono=${remote}#live"\nROLES="thing@mono"\n`);
  writeFileSync(join(box, '.env'), `BOX_DIR=${box}\nACME_EMAIL=a@b.c\n`);

  // the fake docker: appends every argv line to calls.log; `compose … exec/ps` answer ok
  const bin = join(root, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash\necho "$*" >> "${root}/calls.log"\nexit 0\n`);
  chmodSync(join(bin, 'docker'), 0o755);

  const commit = (msg, tag) => {
    writeFileSync(join(work, 'CHANGE'), msg); sh('git', ['-C', work, 'add', '-A']); sh('git', ['-C', work, 'commit', '-q', '-m', msg]);
    if (tag) sh('git', ['-C', work, 'tag', '-a', tag, '-m', tag]);
    sh('git', ['-C', work, 'push', '-q', '--tags', 'origin', 'live']);
    return sh('git', ['-C', work, 'rev-parse', 'HEAD']);
  };
  const run = (env = {}) => spawnSync('bash', [join(RUNNER, 'update.sh')], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, BOX_DIR: box, HEALTH_TIMEOUT: '2', HEALTH_POLL: '1', ...env },
  });
  const calls = () => (existsSync(join(root, 'calls.log')) ? readFileSync(join(root, 'calls.log'), 'utf8').trim().split('\n').filter(Boolean) : []);
  const clearCalls = () => rmSync(join(root, 'calls.log'), { force: true });
  const state = () => JSON.parse(readFileSync(join(box, 'state.json'), 'utf8'));
  const headOfBox = () => sh('git', ['-C', join(box, 'repos/mono'), 'rev-parse', 'HEAD']);
  return { root, box, work, commit, run, calls, clearCalls, state, headOfBox };
}

test('nothing new on the release branch → no docker call, no state change', () => {
  const b = makeBox();
  const first = b.run({ FORCE: '1' });            // the install's first bring-up
  assert.equal(first.status, 0, first.stderr);
  assert.ok(b.calls().some((c) => /compose .* build/.test(c)) && b.calls().some((c) => /compose .* up -d/.test(c)), 'first run builds + starts');
  assert.equal(b.state().rolledBack, false);
  b.clearCalls();
  const again = b.run();
  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(b.calls(), [], 'no docker call when nothing changed');
});

test('a new commit is checked out, built, started, recorded with its tag', () => {
  const b = makeBox();
  b.run({ FORCE: '1' }); b.clearCalls();
  const sha = b.commit('v2', 'v0.2.0');
  const r = b.run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(b.headOfBox(), sha);
  assert.equal(b.state().repos.mono.sha, sha);
  assert.equal(b.state().repos.mono.tag, 'v0.2.0');
  assert.ok(b.calls().some((c) => /build --pull thing/.test(c)), 'built the changed repo\'s role');
  assert.ok(b.calls().some((c) => /up -d --remove-orphans/.test(c)));
});

test('a red health gate rolls back to the previous sha and says so', () => {
  const b = makeBox();
  b.run({ FORCE: '1' });
  const before = b.headOfBox();
  const bad = b.commit('v3 breaks');
  writeFileSync(join(b.box, 'RED'), '');         // the role's health script fails while this exists
  const r = b.run();
  assert.notEqual(r.status, 0, 'a rolled-back update exits non-zero');
  assert.equal(b.headOfBox(), before, 'back on the previous sha');
  assert.notEqual(b.headOfBox(), bad);
  assert.equal(b.state().rolledBack, true);
  assert.equal(b.state().failedRole, 'thing');
  assert.match(readFileSync(join(b.box, 'box.log'), 'utf8'), /health gate RED \(role: thing\)/);
  // the next tick with a green gate goes forward again
  rmSync(join(b.box, 'RED'));
  const r2 = b.run();
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(b.headOfBox(), bad);
  assert.equal(b.state().rolledBack, false);
});

test('HOLD freezes the box; a RESET tag is refused without ALLOW_RESET', () => {
  const b = makeBox();
  b.run({ FORCE: '1' });
  const before = b.headOfBox();
  writeFileSync(join(b.box, 'HOLD'), '');
  b.commit('v4');
  assert.equal(b.run().status, 0);
  assert.equal(b.headOfBox(), before, 'HOLD: nothing moved');
  rmSync(join(b.box, 'HOLD'));
  const reset = b.commit('v5 RESET', 'v0.5.0-RESET');
  // tag message carries RESET → refused
  sh('git', ['-C', b.work, 'tag', '-d', 'v0.5.0-RESET']);
  sh('git', ['-C', b.work, 'tag', '-a', 'v0.5.0', '-m', 'RESET: wire format changed, data re-derives']);
  sh('git', ['-C', b.work, 'push', '-q', '--tags', 'origin', 'live']);
  assert.equal(b.run().status, 0);
  assert.notEqual(b.headOfBox(), reset, 'RESET tag held');
  assert.equal(b.run({ ALLOW_RESET: '1' }).status, 0);
  assert.equal(b.headOfBox(), reset, 'ALLOW_RESET applies it');
});

test('the Caddyfile is rendered from the enabled roles\' snippets with .env values', () => {
  const b = makeBox();
  writeFileSync(join(b.work, 'deploy/roles/thing.caddy'), '${RELAY_DOMAIN} {\n\treverse_proxy thing:1\n}\n');
  b.commit('caddy snippet');
  writeFileSync(join(b.box, '.env'), `BOX_DIR=${b.box}\nACME_EMAIL=a@b.c\nRELAY_DOMAIN=relay.example.org\n`);
  b.run({ FORCE: '1' });
  const caddy = readFileSync(join(b.box, 'data/caddy/Caddyfile'), 'utf8');
  assert.match(caddy, /email a@b\.c/);
  assert.match(caddy, /relay\.example\.org \{/);
  assert.doesNotMatch(caddy, /\$\{RELAY_DOMAIN\}/);
});

test('install.sh (system steps skipped): writes box.conf + .env, clones at live, brings the relay profile up', () => {
  // a fake "canopy-mono" remote carrying the real runner + roles, so install finds deploy/box and deploy/roles
  const root = mkdtempSync(join(tmpdir(), 'box-install-'));
  const remote = join(root, 'mono.git'); const work = join(root, 'work');
  sh('git', ['init', '-q', '--bare', '-b', 'live', remote]); sh('git', ['init', '-q', '-b', 'live', work]);
  sh('git', ['-C', work, 'config', 'user.email', 't@t']); sh('git', ['-C', work, 'config', 'user.name', 't']);
  cpSync(RUNNER, join(work, 'deploy/box'), { recursive: true });
  cpSync(resolve(RUNNER, '../roles'), join(work, 'deploy/roles'), { recursive: true });
  sh('git', ['-C', work, 'add', '-A']); sh('git', ['-C', work, 'commit', '-q', '-m', 'v1']);
  sh('git', ['-C', work, 'tag', '-a', 'v1.0.0', '-m', 'v1.0.0']);
  sh('git', ['-C', work, 'remote', 'add', 'origin', remote]); sh('git', ['-C', work, 'push', '-q', '--tags', 'origin', 'live']);
  const bin = join(root, 'bin'); mkdirSync(bin);
  // the fake docker answers `compose … ps --status running --services` with caddy + relay so both health scripts pass;
  // `exec … relay node -e …` is a no-op exit 0
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash\necho "$*" >> "${root}/calls.log"\ncase "$*" in *"ps --status running"*) echo caddy; echo relay;; esac\nexit 0\n`);
  chmodSync(join(bin, 'docker'), 0o755);
  const box = join(root, 'box');
  const r = spawnSync('bash', [join(RUNNER, 'install.sh')], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, BOX_DIR: box, SKIP_SYSTEM: '1', PROFILE: 'relay', RELAY_DOMAIN: 'relay.example.org', ACME_EMAIL: 'a@b.c', BOX_REPO_URL: remote, HEALTH_TIMEOUT: '2', HEALTH_POLL: '1' },
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(readFileSync(join(box, 'box.conf'), 'utf8'), /ROLES="caddy@canopy-mono relay@canopy-mono"/);
  assert.match(readFileSync(join(box, '.env'), 'utf8'), /RELAY_DOMAIN=relay\.example\.org/);
  assert.ok(existsSync(join(box, 'repos/canopy-mono/deploy/box/update.sh')), 'cloned at live');
  const state = JSON.parse(readFileSync(join(box, 'state.json'), 'utf8'));
  assert.equal(state.repos['canopy-mono'].tag, 'v1.0.0');
  assert.equal(state.rolledBack, false);
  assert.match(readFileSync(join(box, 'data/caddy/Caddyfile'), 'utf8'), /relay\.example\.org \{\n\treverse_proxy relay:8787/);
  assert.match(r.stdout, /relay: wss:\/\/relay\.example\.org/);
  // a second install run keeps box.conf/.env (idempotent) and exits 0
  const r2 = spawnSync('bash', [join(RUNNER, 'install.sh')], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, BOX_DIR: box, SKIP_SYSTEM: '1', PROFILE: 'relay', RELAY_DOMAIN: 'other', ACME_EMAIL: 'x@y.z', BOX_REPO_URL: remote, HEALTH_TIMEOUT: '2', HEALTH_POLL: '1' } });
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(readFileSync(join(box, '.env'), 'utf8'), /RELAY_DOMAIN=relay\.example\.org/, 'existing .env kept');
});
