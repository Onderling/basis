import { describe, it, expect } from 'vitest';
import { normalizeContentItem, loadCircleItems } from '../../src/v2/circleContent.js';

const callSkill = async (op, args) => {
  if (op === 'getBulletin') {
    return {
      posts: [
        { id: 'p1', title: 'Ladder?', circleId: args.circleId },
        { id: 'p2', text: 'Other circle', circleId: 'OTHER' },
      ],
    };
  }
  if (op === 'getMyTasks') return { tasks: [{ taskId: 't1', title: 'Sweep', circleId: args.circleId }] };
  if (op === 'getFeed') return null;
  if (op === '__generic__:household:list:note') return { notes: [{ noteId: 'n1', name: 'A note' }] }; // no circle hint
  return null;
};

describe('circleContent · normalizeContentItem', () => {
  it('builds {id,label,kind} with sensible fallbacks', () => {
    expect(normalizeContentItem({ taskId: 't', title: 'T' }, 'task'))
      .toMatchObject({ id: 't', label: 'T', kind: 'task' });
    expect(normalizeContentItem({ id: 'x' }).label).toBe('x');
    expect(normalizeContentItem({ postId: 'p', text: 'hi' }, 'post').id).toBe('p');
  });
});

describe('circleContent · loadCircleItems', () => {
  it('loads, normalises, and scopes to the circle (keeps matching + no-hint, drops other-circle)', async () => {
    const items = await loadCircleItems({ callSkill, circleId: 'home' });
    expect(items.map((i) => i.id).sort()).toEqual(['n1', 'p1', 't1']);
    expect(items.find((i) => i.id === 't1').kind).toBe('task');
    expect(items.find((i) => i.id === 'p1').label).toBe('Ladder?');
  });

  it('no circleId keeps everything', async () => {
    const items = await loadCircleItems({ callSkill, circleId: null });
    expect(items.map((i) => i.id).sort()).toEqual(['n1', 'p1', 'p2', 't1']);
  });

  it('tolerates a missing callSkill and erroring ops', async () => {
    expect(await loadCircleItems({})).toEqual([]);
    const boom = async () => { throw new Error('nope'); };
    expect(await loadCircleItems({ callSkill: boom, circleId: 'home' })).toEqual([]);
  });
});
