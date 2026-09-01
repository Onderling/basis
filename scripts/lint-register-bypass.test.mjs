/**
 * The guard's own test — a guard whose test is red, or whose test cannot go red, is not a guard.
 *
 * It runs the real script (so the check under test is the check that ships) and then proves each of its
 * three failure modes: an unmarked mirror, a straight bypass, and a mirror entry that has gone stale.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lint-register-bypass.mjs');
const ROOT = path.dirname(path.dirname(SCRIPT));

const runFails = (script = SCRIPT) => {
  try { execFileSync(process.execPath, [script], { cwd: ROOT, encoding: 'utf8' }); return ''; }
  catch (err) { return String(err.stderr ?? ''); }
};

describe('lint-register-bypass', () => {
  it('passes on the repo as it stands — no raw bypass, every mirror marked', () => {
    const out = execFileSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    expect(out).toMatch(/register params, no raw bypass/);
    expect(out).toMatch(/declared pre-boot mirror\(s\) across \d+ marked site\(s\)/);
  });

  it('FAILS on a raw read of a key the register owns — the property it exists to hold', () => {
    const dir = path.join(ROOT, 'apps', 'basis', 'src', '.guard-fixture-tmp');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'bypass.js'),
      "export const t = () => localStorage.getItem('display.theme');\n",
    );
    try {
      const stderr = runFails();
      expect(stderr, 'the guard refuses a raw read of an owned param').toMatch(
        /reads\/writes 'display\.theme' raw, which the register owns/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('FAILS on an UNMARKED touch of a declared pre-boot mirror — the marker is the point', () => {
    const dir = path.join(ROOT, 'apps', 'basis', 'src', '.guard-fixture-tmp');
    mkdirSync(dir, { recursive: true });
    // The same key the shells legitimately mirror — but with nothing saying so.
    writeFileSync(path.join(dir, 'unmarked.js'), "export const t = () => localStorage.getItem('basis.theme');\n");
    try {
      expect(runFails()).toMatch(/touches 'basis\.theme', the pre-boot cache of the register param/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('PASSES the same touch once it carries the marker', () => {
    const dir = path.join(ROOT, 'apps', 'basis', 'src', '.guard-fixture-tmp');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'marked.js'),
      "// pre-boot cache of display.theme\nexport const t = () => localStorage.getItem('basis.theme');\n",
    );
    try {
      const out = execFileSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
      expect(out).toMatch(/no raw bypass/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('FAILS on a cache WRITE that skips the register — the bug this half was added for', () => {
    // The shape that shipped: a screen saves the relay URL through the pref store and never echoes the
    // register, so the setting reverts on the next app open while another door writes both. The write
    // goes through a factory-made store, not `setItem`, which is exactly why a naive check misses it.
    const dir = path.join(ROOT, 'apps', 'basis-mobile', 'src', '.guard-fixture-tmp');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'saver.js'), [
      "import { createRelayPrefStore, asyncStorageRelayIo } from '../../../basis/src/v2/relayPref.js';",
      'const relayStore = createRelayPrefStore(asyncStorageRelayIo(null));',
      'export const save = (url) => relayStore.set(url);',
    ].join('\n'));
    try {
      expect(runFails()).toMatch(/writes the 'cc\.relayUrl' cache .* never writes the register param 'relay\.url'/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('PASSES a writer that echoes the register, and a READER that changes nothing', () => {
    const dir = path.join(ROOT, 'apps', 'basis-mobile', 'src', '.guard-fixture-tmp');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'saver.js'), [
      "import { createRelayPrefStore, asyncStorageRelayIo } from '../../../basis/src/v2/relayPref.js';",
      'const relayStore = createRelayPrefStore(asyncStorageRelayIo(null));',
      'export const save = async (url, callSkill) => {',
      '  const saved = await relayStore.set(url);',
      "  callSkill('params', 'set-param', { key: 'relay.url', value: saved });",
      '};',
    ].join('\n'));
    // …and the reader beside it: the transport loads the relay at connect and writes nothing. Asking
    // this file for a register write reported three innocent files the first time round.
    writeFileSync(path.join(dir, 'reader.js'), [
      "import { resolveRelayUrl, asyncStorageRelayIo } from '../../../basis/src/v2/relayPref.js';",
      'export const read = async () => resolveRelayUrl(await asyncStorageRelayIo(null).load(), null);',
    ].join('\n'));
    try {
      const out = execFileSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
      expect(out).toMatch(/no raw bypass/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('FAILS when a mirror entry goes stale — the list only ever shrinks', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'guard-'));
    try {
      const patched = readFileSync(SCRIPT, 'utf8').replace(
        /const REGISTER = '[^']+';/,
        "const REGISTER = 'apps/basis/src/.guard-register-fixture.js';",
      );
      const copy = path.join(dir, 'patched.mjs');
      writeFileSync(copy, patched);
      // A register declaring one real param and a mirror for a key nothing in the trees mentions.
      const fixture = path.join(ROOT, 'apps', 'basis', 'src', '.guard-register-fixture.js');
      writeFileSync(fixture, [
        "export const P = [{ key: 'display.theme' }];",
        'export const PARAM_PREBOOT_MIRRORS = Object.freeze({',
        "  'cc.nothingReadsThisAnyMore': 'display.theme',",
        '});',
      ].join('\n'));
      try {
        expect(runFails(copy)).toMatch(/nothing reads or writes it raw any more/);
      } finally {
        rmSync(fixture, { force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
