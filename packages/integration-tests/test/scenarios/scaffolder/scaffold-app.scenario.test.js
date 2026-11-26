// @reads-source: this test reads source as text, so rung 1 runs it (docs/conventions/verification-ladder.md).
/**
 * Scenario: scaffolder / scaffold-app
 *
 * Phase 52.x scaffolder CLI — verifies `scripts/scaffold-app.mjs`
 * produces a well-formed app skeleton. The generated app's runtime
 * behaviour (npm test, CLI run) is exercised manually during
 * scaffolder development; this test ensures the file shape stays
 * stable + the templates remain parseable.
 *
 * Phase 52.x (2026-05-14).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const SCRIPT    = join(REPO_ROOT, 'scripts', 'scaffold-app.mjs');

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'scaffold-app-test-'));
});
afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* swallow */ }
});

/** Run the scaffolder + return the generated app dir path. */
function scaffold(name) {
  const cmd = `node "${SCRIPT}" ${name} --dir "${tmpDir}"`;
  execSync(cmd, { stdio: 'pipe' });
  return join(tmpDir, name);
}

describe('scaffold-app — generated app shape', () => {
  it('creates every expected file', () => {
    const appDir = scaffold('hello-world');
    const expected = [
      'package.json',
      'src/index.js',
      'bin/hello-world.js',
      'test/hello.test.js',
      'locales/en.json',
      'vitest.config.js',
      'README.md',
    ];
    for (const rel of expected) {
      const full = join(appDir, rel);
      expect(existsSync(full), `missing ${rel}`).toBe(true);
      expect(statSync(full).isFile()).toBe(true);
    }
  });

  it('package.json parses + has the expected name + deps', () => {
    const appDir = scaffold('my-app');
    const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('@onderling-app/my-app');
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe('module');
    expect(pkg.main).toBe('src/index.js');
    expect(pkg.bin).toEqual({ 'my-app': 'bin/my-app.js' });
    expect(pkg.dependencies['@onderling/core']).toMatch(/packages\/core$/);
    expect(pkg.devDependencies.vitest).toBeDefined();
  });

  it('src/index.js exports createApp + registers a hello skill', () => {
    const appDir = scaffold('greeter');
    const src    = readFileSync(join(appDir, 'src', 'index.js'), 'utf8');
    expect(src).toContain('export async function createApp');
    expect(src).toContain("defineSkill('hello'");
    expect(src).toContain('AgentIdentity.generate');
    expect(src).toContain('new InternalTransport');
  });

  it('bin/<name>.js has a shebang + invokes the hello skill', () => {
    const appDir = scaffold('mycli');
    const bin    = readFileSync(join(appDir, 'bin', 'mycli.js'), 'utf8');
    expect(bin.startsWith('#!/usr/bin/env node')).toBe(true);
    expect(bin).toContain("invoke(identity.pubKey, 'hello'");
  });

  it('test/hello.test.js has two assertions', () => {
    const appDir = scaffold('test-app');
    const test   = readFileSync(join(appDir, 'test', 'hello.test.js'), 'utf8');
    expect(test).toContain("expect(text).toBe('hello, world')");
    expect(test).toContain("expect(text).toBe('hello, Anne')");
  });

  it('locales/en.json uses the {text, doc} convention', () => {
    const appDir = scaffold('localised');
    const loc    = JSON.parse(readFileSync(join(appDir, 'locales', 'en.json'), 'utf8'));
    const leaf   = loc.cli?.hello?.greeting;
    expect(leaf).toBeDefined();
    expect(typeof leaf.text).toBe('string');
    expect(typeof leaf.doc).toBe('string');
    expect(leaf.doc.length).toBeGreaterThan(0);
  });

  it('README.md links to substrates functional design + lists upgrade path', () => {
    const appDir = scaffold('docs-check');
    const readme = readFileSync(join(appDir, 'README.md'), 'utf8');
    expect(readme).toContain('substrates-v2-functional-design');
    expect(readme).toContain('Upgrade path');
    expect(readme).toContain('VaultMemory');
    expect(readme).toContain('VaultNodeFs');
  });
});

describe('scaffold-app — input validation', () => {
  it('rejects an invalid name', () => {
    expect(() => {
      execSync(`node "${SCRIPT}" Bad_Name --dir "${tmpDir}"`, { stdio: 'pipe' });
    }).toThrow();
  });

  it('rejects an existing target dir', () => {
    scaffold('first');
    expect(() => {
      // Second time → already exists.
      execSync(`node "${SCRIPT}" first --dir "${tmpDir}"`, { stdio: 'pipe' });
    }).toThrow();
  });

  it('exits with code 2 on --help', () => {
    // node throws on non-zero exit; --help is code 0 so should succeed.
    const out = execSync(`node "${SCRIPT}" --help`, { stdio: 'pipe' }).toString();
    expect(out).toContain('Usage:');
    expect(out).toContain('scaffold-app');
  });
});
