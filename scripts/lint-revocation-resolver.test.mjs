/**
 * Self-tests for lint-revocation-resolver — a guard whose own logic is untested is not a guard.
 *
 * The pure `auditRevocationResolver` is driven with synthetic sources (both the violations it must
 * catch and the look-alikes it must not), and the two scanners it rests on are checked against the REAL
 * `PolicyEngine.js`: if the resolver field were renamed, or the constructor's shape moved, this guard
 * would quietly be checking nothing — which is the failure mode a guard cannot be allowed to have.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import {
  auditRevocationResolver, blankNoise, constructorBodies, collectFiles, isTestFile,
  RESOLVER_ASSIGN,
} from './lint-revocation-resolver.mjs';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const POLICY_ENGINE = path.join(ROOT, 'packages/core/src/permissions/PolicyEngine.js');

const audit = (src, file = 'packages/x/src/a.js') => auditRevocationResolver([{ file, src }]);

describe('lint-revocation-resolver — the violations it must catch', () => {
  it('a setter method that replaces the resolver, by name AND by shape', () => {
    const v = audit(`
      class PolicyEngine {
        #isRevoked;
        constructor({ isRevoked = null }) { this.#isRevoked = isRevoked; }
        setRevocationCheck(fn) { this.#isRevoked = fn; }
      }
    `);
    expect(v.map((x) => x.kind).sort()).toEqual(['assignment', 'name']);
  });

  it('a differently-NAMED setter is still caught, by the assignment shape alone', () => {
    // The whole point of check B: whatever it is called, assigning the resolver after construction
    // is the defect.
    const v = audit(`
      class Gate {
        #isRevoked;
        constructor(fn) { this.#isRevoked = fn; }
        adopt(fn) { this.#isRevoked = fn; }
      }
    `);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ kind: 'assignment', text: 'adopt(fn) { this.#isRevoked = fn; }' });
  });

  it('a CALL site in production source is flagged — that is where the damage was done', () => {
    const v = audit('policyEngine.setRevocationCheck((id) => revoked.has(id));');
    expect(v).toEqual([{ file: 'packages/x/src/a.js', line: 1, kind: 'name', text: 'policyEngine.setRevocationCheck((id) => revoked.has(id));' }]);
  });

  it('the installer-verb family, not just the one name it shipped as', () => {
    for (const name of ['installRevocationCheck', 'enableIssuerRevocation', 'registerRevocationSource', 'setIsRevoked']) {
      expect(audit(`obj.${name}(x);`), name).toHaveLength(1);
    }
  });

  it('writing the resolver onto someone else’s engine', () => {
    const v = audit('engine.isRevoked = (id) => revoked.has(id);');
    expect(v).toEqual([{ file: 'packages/x/src/a.js', line: 1, kind: 'assignment', text: 'engine.isRevoked = (id) => revoked.has(id);' }]);
  });
});

describe('lint-revocation-resolver — the look-alikes it must NOT catch', () => {
  it('taking the resolver at construction is the whole point', () => {
    expect(audit(`
      class PolicyEngine {
        #isRevoked;
        constructor({ isRevoked = null }) {
          this.#isRevoked = typeof isRevoked === 'function' ? isRevoked : null;
        }
      }
    `)).toEqual([]);
  });

  it('asking a source, declaring a default, and passing one as an option', () => {
    expect(audit(`
      const revoked = await source.isRevoked(id);
      function make({ isRevoked = null }) { return isRevoked; }
      const pe = new PolicyEngine({ trustRegistry, isRevoked: anyRevoked([a, b]) });
      class Src { setRevoked(id) { this.#revoked.add(id); } }
    `)).toEqual([]);
  });

  it('prose that describes the old defect — comments and strings are blanked, not scanned', () => {
    expect(audit(`
      // setRevocationCheck used to replace the resolver; engine.isRevoked = fn was the shape.
      /* installRevocationCheck fed a manager's set into the engine. */
      throw new Error('enableIssuerRevocation: gone');
    `)).toEqual([]);
  });

  it('a TEST may NAME a gone method to assert it is gone, but may not PROVIDE one', () => {
    const f = 'packages/x/test/a.test.js';
    expect(audit('expect(() => pe.setRevocationCheck(() => false)).toThrow(TypeError);', f)).toEqual([]);
    expect(audit('mgr.installRevocationCheck({ setRevocationCheck: (fn) => { held = fn; } });', f)).toHaveLength(1);
    expect(audit('function setRevocationCheck(fn) { held = fn; }', f)).toHaveLength(1);
  });

  it('recognises both test-file conventions used here', () => {
    expect(isTestFile('packages/core/test/permissions/x.test.js')).toBe(true);
    expect(isTestFile('apps/basis/src/foo.test.js')).toBe(true);
    expect(isTestFile('packages/core/src/permissions/PolicyEngine.js')).toBe(false);
  });
});

describe('lint-revocation-resolver — the scanners cannot go blind silently', () => {
  it('blankNoise preserves offsets and line numbers while removing prose', () => {
    const src = "a // setRevocationCheck\nb '#isRevoked =' c\n";
    const out = blankNoise(src);
    expect(out).toHaveLength(src.length);
    expect(out.split('\n')).toHaveLength(src.split('\n').length);
    expect(out).not.toMatch(/setRevocationCheck/);
    expect(out).not.toMatch(/#isRevoked/);
  });

  it('finds the REAL PolicyEngine constructor, and the real resolver assignment inside it', () => {
    const code = blankNoise(readFileSync(POLICY_ENGINE, 'utf8'));
    const ctors = constructorBodies(code);
    expect(ctors.length, 'PolicyEngine.js must still have constructors the scanner can see').toBeGreaterThan(0);

    const hits = [...code.matchAll(RESOLVER_ASSIGN)];
    expect(hits.length, 'the resolver field is still named what this guard watches').toBe(1);
    expect(
      ctors.some(([a, b]) => hits[0].index > a && hits[0].index < b),
      'and it is assigned inside a constructor — which is why the live scan is green',
    ).toBe(true);
  });

  it('the live repo has no way to replace a revocation resolver (the claim itself)', () => {
    const files = collectFiles(ROOT);
    expect(files.length, 'the walker found no source files — it has gone blind').toBeGreaterThan(500);
    expect(auditRevocationResolver(files)).toEqual([]);
  });
});
