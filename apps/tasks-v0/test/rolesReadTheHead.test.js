/**
 * Every authority gate in this app reads the caller's role from ONE source: the host's membership head
 * when a host injects it, else the composition's declared map. Before this, the gates read the bundle's own
 * `roles` map — composed locally, and on a host inherited by every lazily-opened circle with this device as
 * admin — so a gate refused nobody local and never learned of a promotion made on the circle's record.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DataPart } from '@onderling/core';
import { makeRoleOf } from '../src/skills/roleOf.js';
import { buildCircleControlSkills } from '../src/skills/circleControls.js';
import { buildForceCompleteSkill } from '../src/skills/forceComplete.js';

const here = dirname(fileURLToPath(import.meta.url));
const ANNE = 'https://id.example/anne';

const fakeCircle = (roles) => {
  const live = { circleId: 'c1', paused: false };
  return {
    circleId: 'c1', liveCircle: live, roles,
    circleMutator: (patch) => Object.assign(live, patch),
    itemStore: { listOpen: async () => [], listClosed: async () => [] },
  };
};
const call = (skills, id, from) => skills.find((s) => s.id === id).handler({ parts: [DataPart({ circleId: 'c1' })], from, envelope: null });

describe('the gates ask the head, not the bundle', () => {
  it('no skill module reads the bundle role map directly any more (the reader is the one exception)', () => {
    const dir = join(here, '../src/skills');
    const offenders = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.js') || f === 'roleOf.js') continue;
      const src = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (/\broles\?\.\[|\.roles\[|members\?\.find\?\.\([^)]*\)\?\.role/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it('a host reader that says MEMBER refuses the admin op, though the bundle map says admin', async () => {
    const roleOf = makeRoleOf(async () => 'member');
    const circle = fakeCircle({ [ANNE]: 'admin' });
    const skills = buildCircleControlSkills({ bundleResolver: () => circle, roleOf });
    expect(await call(skills, 'pauseCircle', ANNE)).toEqual({ error: 'admin or coordinator required' });
    expect(circle.liveCircle.paused).toBe(false);
  });

  it('a host reader that says ADMIN admits the op, though the bundle map says member — a promotion on the record reaches the gate', async () => {
    const asked = [];
    const roleOf = makeRoleOf(async (circleId, webid) => { asked.push([circleId, webid]); return 'admin'; });
    const circle = fakeCircle({ [ANNE]: 'member' });
    const skills = buildCircleControlSkills({ bundleResolver: () => circle, roleOf });
    expect(await call(skills, 'pauseCircle', ANNE)).toEqual({ ok: true, paused: true });
    expect(asked).toEqual([['c1', ANNE]]);
  });

  it('a reader that throws or answers nothing REFUSES — absence never falls through to a yes', async () => {
    const circle = fakeCircle({ [ANNE]: 'admin' });
    for (const reader of [async () => { throw new Error('roster unavailable'); }, async () => null, async () => undefined, async () => 42]) {
      const skills = buildForceCompleteSkill({ bundleResolver: () => circle, roleOf: makeRoleOf(reader) });
      const r = await call(skills, 'forceCompleteTask', ANNE);
      expect(r?.ok ?? false, String(reader)).toBe(false);
      expect(r?.error, String(reader)).toBeTruthy();
    }
  });

  it('without a host reader the declared map is what the gates read, per circle', async () => {
    const roleOf = makeRoleOf(null);
    expect(await roleOf(fakeCircle({ [ANNE]: 'coordinator' }), ANNE)).toBe('coordinator');
    expect(await roleOf(fakeCircle({}), ANNE)).toBe(null);
    expect(await roleOf(null, ANNE)).toBe(null);
    expect(await roleOf(fakeCircle({ [ANNE]: 'admin' }), '')).toBe(null);
  });

  it('the host (basis) injects the reader into the multi-circle runtime — the pin that makes the head the source there', () => {
    const src = readFileSync(join(here, '../../basis/src/core/agent/realAgent.js'), 'utf8');
    const at = src.indexOf('createBrowserMultiCircleTasksAgent({');
    expect(at).toBeGreaterThan(0);
    expect(src.slice(at, at + 1200)).toMatch(/circleRoleOf:\s*async \(circleId, webid\)/);
    const wire = readFileSync(join(here, '../src/wireSkills.js'), 'utf8');
    expect(wire).toContain('const roleOf = makeRoleOf(circleRoleOf);');
    expect((wire.match(/, roleOf \}\)/g) ?? []).length).toBeGreaterThanOrEqual(15);
  });
});
