/**
 * "Wie doet de lamp?" is a read over the chores: the task type's open read takes the person's words (`text`) and answers
 * the open tasks whose words hold them — the same read on every shell (the household bot's chores answer it the same
 * way, over the circle's store).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataPart } from '@onderling/core';
import { buildBundle } from '../src/storage/buildBundle.js';
import { createCircleAgent } from '../src/Circle.js';
import { taskHasWords } from '../src/index.js';

const ANNE = 'https://id.example/anne';
const CIRCLE = {
  circleId: 'list-open-text-circle', name: 'Words', kind: 'project',
  members: [{ webid: ANNE, displayName: 'Anne', role: 'admin' }],
};

const call = (agent, skillId, args, from) => agent.skills.get(skillId).handler({ parts: [DataPart(args)], from, agent, envelope: null });

describe('listOpen {text}: the open tasks whose words hold the words', () => {
  let circle;
  beforeEach(async () => {
    circle = await createCircleAgent({ circleConfig: CIRCLE, localStoreBundle: buildBundle(), wireOnboardingSkills: false });
    for (const text of ['Lamp vervangen', 'lamp kopen', 'Ramen lappen']) await call(circle.agent, 'addTask', { text }, ANNE);
  });
  afterEach(async () => { await circle?.close?.(); });

  it('case aside; none is an empty list; no words is every open task', async () => {
    const words = async (text) => (await call(circle.agent, 'listOpen', { text }, ANNE)).items.map((t) => t.text).sort();
    expect(await words('LAMP')).toEqual(['Lamp vervangen', 'lamp kopen']);
    expect(await words('ramen')).toEqual(['Ramen lappen']);
    expect(await words('fiets')).toEqual([]);
    expect((await call(circle.agent, 'listOpen', {}, ANNE)).items).toHaveLength(3);
  });

  it('the predicate: words inside the task\'s words, case and edge spaces aside', () => {
    expect(taskHasWords({ text: 'Lamp vervangen' }, ' lamp ')).toBe(true);
    expect(taskHasWords({ title: 'Lamp vervangen' }, 'vervangen')).toBe(true);
    expect(taskHasWords({ text: 'Lamp vervangen' }, 'fiets')).toBe(false);
    expect(taskHasWords({ text: 'Lamp' }, '')).toBe(true);
  });
});
