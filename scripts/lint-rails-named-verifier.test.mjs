/**
 * Self-tests for lint-rails-named-verifier — the parsers against the REAL sources (so a shape change fails here
 * first) and the audit against synthetic drift.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { RAILS, VERIFIER_ACCEPTS, parseAccepts, parseLane, namedDefault, namedAtComposition, rawRailCalls, audit } from './lint-rails-named-verifier.mjs';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f) => existsSync(path.join(ROOT, f));

describe('lint-rails-named-verifier', () => {
  it('parses the REAL table: the six signed lanes carry an accepts level, local kinds accept none', () => {
    const accepts = parseAccepts(read('packages/item-store/src/entryKinds.js'));
    expect(accepts['chat-message']).toBe('roster-binding');
    expect(accepts.membership).toBe('membership-binding');
    expect(accepts['key-event']).toBe('key-binding');
    expect(accepts.grants).toBe('device-set');
    expect(accepts.report).toBe('none');
    expect(Object.values(accepts).every((v) => typeof v === 'string'), 'no row without a binding').toBe(true);
  });

  it('the REAL rails are green (the live state is what the guard promises)', () => {
    const files = execSync("git ls-files 'apps/basis/src/**/*.js'", { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    const problems = audit({ rails: RAILS, accepts: parseAccepts(read('packages/item-store/src/entryKinds.js')), read, exists, railCalls: rawRailCalls(files, read) });
    expect(problems).toEqual([]);
    for (const r of RAILS) expect(parseLane(read(r.laneFile), r.laneConst), r.laneConst).toBeTruthy();
    expect(namedDefault(read('apps/basis/src/v2/keyRail.js'))).toBe('keyBindingVerifier');
    expect(namedAtComposition(read('apps/basis/src/core/agent/realAgent.js'), 'deviceSetVerifier')).toBe('deviceSetBindingVerifier');
  });

  it('a rail whose default verifier disagrees with the table is a problem; one with no named verifier too', () => {
    const rails = [{ file: 'r.js', laneFile: 'm.js', laneConst: 'X_LANE' }];
    const src = { 'm.js': "export const X_LANE = 'membership';", 'r.js': 'verifyBinding ?? rosterBindingVerifier(callSkill)' };
    const rig = (railSrc) => audit({ rails, accepts: { membership: 'membership-binding' }, read: (f) => (f === 'r.js' ? railSrc : src[f]), exists: () => true, railCalls: [] });
    expect(rig(src['r.js'])[0]).toMatch(/folded with rosterBindingVerifier \(roster-binding\) but ENTRY_KINDS says accepts: membership-binding/);
    expect(rig('verifyBinding = null; // nothing named')[0]).toMatch(/NO named verifier/);
    expect(rig('verifyBinding ?? membershipBindingVerifier(callSkill)')).toEqual([]);
  });

  it('a raw makeCircleEntryRail( outside the table, or without verifyBinding, is a problem', () => {
    const calls = rawRailCalls(['a.js', 'b.js'], (f) => (f === 'a.js'
      ? 'export function makeCircleEntryRail({ eventLog }) {}\n const x = makeCircleEntryRail({ eventLog, verifyBinding: v });'
      : 'const y = makeCircleEntryRail({ eventLog });'));
    expect(calls).toEqual([{ file: 'a.js', passesVerifier: true }, { file: 'b.js', passesVerifier: false }]);
    const problems = audit({ rails: [{ file: 'a.js', laneFile: 'm.js', laneConst: 'L' }], accepts: { k: 'roster-binding' }, read: (f) => (f === 'm.js' ? "export const L = 'k';" : 'verifyBinding ?? rosterBindingVerifier('), exists: () => true, railCalls: calls });
    expect(problems.some((p) => /b\.js: makeCircleEntryRail\( called outside/.test(p))).toBe(true);
  });

  it('the verifier → accepts map covers exactly the table\'s vocabulary minus none', () => {
    expect(new Set(Object.values(VERIFIER_ACCEPTS))).toEqual(new Set(['roster-binding', 'membership-binding', 'key-binding', 'device-set']));
  });
});
