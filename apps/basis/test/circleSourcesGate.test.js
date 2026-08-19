/**
 * Regression: circles whose source op is ABSENT from the manifest catalog must still
 * load. `listMyCircles` (stoop) + `getMyCircles` are agent skills, not manifest ops; the
 * catalog "perf gate" used to skip them on every origin → loadCircles returned nothing
 * → "No circles yet" on reload even though the data persisted. (Fix in circleSources.js.)
 */
import { describe, it, expect } from 'vitest';
import { makeResolvingCallSkill, circleSourcesFromAgent } from '../src/v2/circleSources.js';
import { loadCircles } from '../src/v2/circleModel.js';
import { HELP_CIRCLE_ID } from '../src/v2/helpCircle.js';

describe('makeResolvingCallSkill — catalog gate', () => {
  it('tries an op the catalog does NOT know on all origins (the listMyCircles fix)', async () => {
    const calls = [];
    const raw = async (origin, opId) => {
      calls.push(`${origin}/${opId}`);
      if (origin === 'stoop' && opId === 'listMyCircles') return { circles: ['kleurenwiezen', 'boi'] };
      return null;
    };
    // catalog knows getMyCircles@tasks but NOTHING about listMyCircles
    const catalog = { opsById: new Map([['tasks/getMyCircles', { appOrigin: 'tasks' }]]) };
    const callSkill = makeResolvingCallSkill(raw, undefined, () => catalog);
    const r = await callSkill('listMyCircles', {});
    expect(r).toEqual({ circles: ['kleurenwiezen', 'boi'] });
    expect(calls).toContain('stoop/listMyCircles');     // stoop was NOT skipped
  });

  it('still gates a catalog-KNOWN op to its declared origin (getMyCircles → tasks only)', async () => {
    const calls = [];
    const raw = async (origin, opId) => { calls.push(origin); if (origin === 'tasks' && opId === 'getMyCircles') return { circles: [] }; return null; };
    const catalog = { opsById: new Map([['tasks/getMyCircles', { appOrigin: 'tasks' }]]) };
    const callSkill = makeResolvingCallSkill(raw, undefined, () => catalog);
    await callSkill('getMyCircles', {});
    expect(calls).not.toContain('stoop');   // skipped: catalog says getMyCircles is on tasks
    expect(calls).toContain('tasks');
  });

  it('loadCircles surfaces groups from listMyCircles with an empty catalog', async () => {
    const raw = async (origin, opId) => (origin === 'stoop' && opId === 'listMyCircles'
      ? { circles: ['kleurenwiezen', 'boi', 'mai'] } : null);
    const callSkill = makeResolvingCallSkill(raw, undefined, () => ({ opsById: new Map() }));
    const circles = await loadCircles(circleSourcesFromAgent({ callSkill }));
    expect(circles.map((c) => c.id).sort()).toEqual(['boi', 'kleurenwiezen', 'mai']);
  });

  it('null catalog → tries every origin (unchanged)', async () => {
    const raw = async (origin, opId) => (origin === 'stoop' && opId === 'listMyCircles' ? { circles: ['x'] } : null);
    const callSkill = makeResolvingCallSkill(raw, undefined, () => null);
    expect(await callSkill('listMyCircles', {})).toEqual({ circles: ['x'] });
  });
});

describe('circleSourcesFromAgent — help-circle display name', () => {
  // listMyCircles returns bare ids, so the help circle's tile/header used to fall back to the raw id
  // 'cc-help'. The shell injects a localised name; the adapter relabels ONLY the help circle.
  const callSkillFor = (circles) => async (opId) => (opId === 'listMyCircles' ? { circles } : null);

  it('relabels the help circle with the injected name, leaving other circles untouched', async () => {
    const sources = circleSourcesFromAgent({
      callSkill: callSkillFor([HELP_CIRCLE_ID, 'kleurenwiezen']),
      helpCircleName: 'Uitleg',
    });
    const groups = await sources.fetchGroups();
    const help = groups.find((g) => g.id === HELP_CIRCLE_ID);
    const other = groups.find((g) => g.id === 'kleurenwiezen');
    expect(help.name).toBe('Uitleg');           // NOT the raw id
    expect(other.name).toBe('kleurenwiezen');    // unrelated circles keep the id-name fallback
  });

  it('accepts a live-language getter for the help name', async () => {
    let lang = 'nl';
    const sources = circleSourcesFromAgent({
      callSkill: callSkillFor([HELP_CIRCLE_ID]),
      helpCircleName: () => (lang === 'nl' ? 'Uitleg' : 'Help'),
    });
    expect((await sources.fetchGroups())[0].name).toBe('Uitleg');
    lang = 'en';
    expect((await sources.fetchGroups())[0].name).toBe('Help');
  });

  it('without a name injected, the help circle still falls back to its id (back-compat)', async () => {
    const sources = circleSourcesFromAgent({ callSkill: callSkillFor([HELP_CIRCLE_ID]) });
    expect((await sources.fetchGroups())[0].name).toBe(HELP_CIRCLE_ID);
  });
});
