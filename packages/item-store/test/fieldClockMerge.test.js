/**
 * The field-clock resolution policy, told as three devices of one person holding the same contact row.
 *
 * A row-level merge keeps the causally newer row whole. For a contact that loses facts: the hide made on one device
 * and the persona change made on another are two changes to two different parts of the row, and the row that wins
 * carries the other part's OLD value. The contact type declares its field-sets with their own clocks (`hiddenAt`,
 * `personaAt`, `linkedAt`, and `deletedAt` by itself); each set merges by its own clock, the rest of the row stays
 * row-LWW. No merge code for the type: the declaration is read by the resolution registry.
 */
import { describe, it, expect } from 'vitest';
import { CircleItemStore } from '../src/CircleItemStore.js';
import { memoryDataSource } from '../src/memoryDataSource.js';
import { defaultResolutionRegistry, RESOLUTION, createResolutionRegistry } from '../src/resolutionPolicy.js';

const device = () => new CircleItemStore({ dataSource: memoryDataSource(), rootContainer: 'mem://own/' });
const BASE = { id: 'c-bea', type: 'contact', webid: 'bea', displayName: 'Bea', persona: 'p-general', revealPreset: 'handle', personaAt: 10, hidden: false, hiddenAt: 10 };

/** Three devices that all hold the base row (as if it had crossed once already). */
async function threeDevices() {
  const A = device(); const B = device(); const C = device();
  const base = await A.put(BASE, { by: 'me' });
  await B.put(base, { origin: true, sync: false });
  await C.put(base, { origin: true, sync: false });
  return { A, B, C };
}

describe('contact rows merge per declared field-set', () => {
  it('a hide on A and a persona change on B both survive on C, in either arrival order', async () => {
    for (const order of ['A-then-B', 'B-then-A']) {
      const { A, B, C } = await threeDevices();
      const onA = await A.put({ ...(await A.get('c-bea')), hidden: true, hiddenAt: 200 }, { by: 'me' });
      const onB = await B.put({ ...(await B.get('c-bea')), persona: 'p-work', revealPreset: 'profile', personaAt: 300 }, { by: 'me' });
      const first = order === 'A-then-B' ? onA : onB;
      const second = order === 'A-then-B' ? onB : onA;
      await C.put(first, { origin: true, sync: false });
      await C.put(second, { origin: true, sync: false });
      const onC = await C.get('c-bea');
      expect({ order, hidden: onC.hidden, hiddenAt: onC.hiddenAt }).toEqual({ order, hidden: true, hiddenAt: 200 });
      expect({ order, persona: onC.persona, revealPreset: onC.revealPreset, personaAt: onC.personaAt })
        .toEqual({ order, persona: 'p-work', revealPreset: 'profile', personaAt: 300 });
    }
  });

  it('A and B converge too: each receiving the other keeps both changes', async () => {
    const { A, B } = await threeDevices();
    const onA = await A.put({ ...(await A.get('c-bea')), hidden: true, hiddenAt: 200 }, { by: 'me' });
    const onB = await B.put({ ...(await B.get('c-bea')), persona: 'p-work', personaAt: 300 }, { by: 'me' });
    await A.put(onB, { origin: true, sync: false });
    await B.put(onA, { origin: true, sync: false });
    for (const d of [A, B]) {
      const row = await d.get('c-bea');
      expect([row.hidden, row.persona]).toEqual([true, 'p-work']);
    }
  });

  it('a deletedAt beats an older edit, and a later return does not drop it', async () => {
    const { A, B, C } = await threeDevices();
    const deleted = await A.put({ ...(await A.get('c-bea')), hidden: true, hiddenAt: 500, deletedAt: 500 }, { by: 'me' });
    // B edits the display name later in row order (a higher clock), from a copy that never saw the delete
    await B.put(await B.get('c-bea'), { by: 'me' });
    const edited = await B.put({ ...(await B.get('c-bea')), displayName: 'Bea B.' }, { by: 'me' });
    await C.put(deleted, { origin: true, sync: false });
    await C.put(edited, { origin: true, sync: false });
    const onC = await C.get('c-bea');
    expect(onC.displayName).toBe('Bea B.');          // undeclared field: row-LWW, the newer row's
    expect([onC.hidden, onC.deletedAt]).toEqual([true, 500]);
    // a return (un-hide) after the delete keeps the delete mark, as the book does today
    const back = await C.put({ ...onC, hidden: false, hiddenAt: 900, deletedAt: undefined }, { by: 'me' });
    await A.put(back, { origin: true, sync: false });
    const onA = await A.get('c-bea');
    expect([onA.hidden, onA.deletedAt]).toEqual([false, 500]);
  });

  it('an equal clock on both sides keeps the row winner\'s set (deterministic, no churn)', async () => {
    const { A, B, C } = await threeDevices();
    // two devices, each its own writer id (the row merge breaks an equal Lamport clock on it)
    const onA = await A.put({ ...(await A.get('c-bea')), hidden: true, hiddenAt: 200 }, { by: 'device-a' });
    const onB = await B.put({ ...(await B.get('c-bea')), hidden: false, hiddenAt: 200 }, { by: 'device-b' });
    await C.put(onA, { origin: true, sync: false });
    const r1 = await C.put(onB, { origin: true, sync: false });
    const D = device();
    await D.put(onB, { origin: true, sync: false });
    const r2 = await D.put(onA, { origin: true, sync: false });
    expect(r1.hidden).toBe(r2.hidden);
  });
});

describe('the field-clock declaration', () => {
  it('lives on the type and is read by the default registry', () => {
    const r = defaultResolutionRegistry();
    expect(r.hasChannel('contact', RESOLUTION.FIELD_CLOCK)).toBe(true);
    expect(r.resolutionOf('contact', 'hidden')).toBe(RESOLUTION.FIELD_CLOCK);
    expect(r.resolutionOf('contact', 'displayName')).toBe(RESOLUTION.CONTENT);
    expect(r.fieldClocksOf('contact')).toEqual(expect.arrayContaining([
      { clock: 'hiddenAt', fields: ['hidden'] },
      { clock: 'personaAt', fields: ['persona', 'revealPreset'] },
      { clock: 'linkedAt', fields: ['linkedRow', 'linkedRoot'] },
      { clock: 'deletedAt', fields: [] },
    ]));
  });

  it('is refused for a type that is not own-devices-only: a writer-stamped clock is safe only among one person\'s devices', () => {
    expect(() => createResolutionRegistry().declareFieldClock('task', 'doneAt', ['done'])).toThrow(/own-devices/);
    expect(() => createResolutionRegistry().declareFieldClock('note', 'editedAt', ['text'])).toThrow(/own-devices/);
    expect(() => createResolutionRegistry().declareFieldClock('contact', 'hiddenAt', ['hidden'])).not.toThrow();
  });

  it('a field-clock cannot be declared one field at a time (it needs its clock)', () => {
    expect(() => createResolutionRegistry().declare('contact', 'hidden', RESOLUTION.FIELD_CLOCK)).toThrow(/declareFieldClock/);
  });
});
