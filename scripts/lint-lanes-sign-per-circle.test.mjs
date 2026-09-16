/**
 * Self-tests for lint-lanes-sign-per-circle — a guard whose own logic is untested is not a guard.
 * The pure `auditLaneModules` with synthetic sources; then the REAL lane modules, which must be clean.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { auditLaneModules, stripComments, LANE_MODULES, FORBIDDEN, ALLOWED } from './lint-lanes-sign-per-circle.mjs';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();

describe('lint-lanes-sign-per-circle', () => {
  it('a lane module that names the profile identity is a hit, with file, token and line', () => {
    const src = "const a = 1;\nconst key = chatId.pubKey;\n";
    const { hits } = auditLaneModules({ files: ['x.js'], read: () => src });
    expect(hits).toEqual([{ file: 'x.js', token: 'chatId', line: 2 }]);
  });

  it('a mention in a comment or a string is not a hit; a longer identifier that contains the word is not either', () => {
    const src = "// we never use chatId here\n/* profileIdentity is the wrong key */\nconst why = 'chatId';\nconst fp = ownerRootFingerprint(x);\n";
    const { hits } = auditLaneModules({ files: ['x.js'], read: () => src });
    expect(hits).toEqual([]);
    expect(stripComments('a /* b */ c // d\ne')).toBe('a         c     \ne');
  });

  it('an ALLOWED row with a reason silences exactly that token in that file', () => {
    const src = 'const k = chatId; const s = profileSeed;';
    const { hits } = auditLaneModules({ files: ['x.js'], read: () => src, allowed: { 'x.js': { chatId: 'the enrol greeting' } } });
    expect(hits.map((h) => h.token)).toEqual(['profileSeed']);
  });

  it('a listed module that no longer exists is reported, never silently skipped', () => {
    const { missing } = auditLaneModules({ files: ['gone.js'], read: () => '', exists: () => false });
    expect(missing).toEqual(['gone.js']);
  });

  it('the REAL lane modules are clean (the state the revoke walk left them in), and all exist', () => {
    const { hits, missing } = auditLaneModules({
      files: LANE_MODULES, forbidden: FORBIDDEN, allowed: ALLOWED,
      read: (f) => readFileSync(path.join(ROOT, f), 'utf8'),
      exists: (f) => existsSync(path.join(ROOT, f)),
    });
    expect(missing).toEqual([]);
    expect(hits).toEqual([]);
  });
});
