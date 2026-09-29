/**
 * A turn may READ before it acts. "melk is gekocht": the model's first pick is often the list (to find the entry),
 * and a turn that runs one call shows the person the list instead of the tick. With a `peek` (run an op without
 * showing it), a read the model picks is looked at, its result goes back to the model once, and the turn does what
 * the model then picks — the act. A turn that only asked to see something still shows the read, once.
 */
import { describe, it, expect, vi } from 'vitest';
import { createCircleDispatch } from '../../src/v2/circleDispatch.js';

const op = (id, verb) => [id, { op: { id, verb }, appOrigin: 'lists' }];
const catalogue = { opsById: new Map([op('listEntries', 'list'), op('markListItemDone', 'complete'), op('addToList', 'add')]), commandMenu: [] };

function harness({ interpret, peek }) {
  const dispatched = [];
  const cd = createCircleDispatch({
    catalogue,
    policy: { llmTool: 'local' },
    llmProviders: { local: { invoke: vi.fn() } },
    interpret,
    botName: 'bot',
    dispatch: (input) => { dispatched.push(input); },
    onNoMatch: () => {},
    ...(peek ? { peek } : {}),
  });
  return { cd, dispatched };
}

const LIST = { opId: 'listEntries', args: { list: 'Boodschappen' } };
const TICK = { opId: 'markListItemDone', args: { itemId: 'e1' } };
const peek = vi.fn(async () => ({ payload: { items: [{ id: 'e1', label: 'melk' }] } }));

describe('a turn that reads, then acts', () => {
  it('"melk is gekocht": the list is read, not shown, and the tick is what happens', async () => {
    const interpret = vi.fn(async (_text, o) => ((o.context ?? []).some((l) => /\[e1\] melk/.test(l)) ? TICK : LIST));
    const { cd, dispatched } = harness({ interpret, peek });
    const r = await cd.handle('@bot melk is gekocht');
    expect(interpret).toHaveBeenCalledTimes(2);
    expect(dispatched.map((d) => d.opId)).toEqual(['markListItemDone']);
    expect(r.cmd.opId).toBe('markListItemDone');
  });

  it('"wat staat er op de lijst": the model reads again — the read is shown, once', async () => {
    const interpret = vi.fn(async () => LIST);
    const { cd, dispatched } = harness({ interpret, peek });
    await cd.handle('@bot wat staat er op de boodschappenlijst?');
    expect(dispatched.map((d) => d.opId)).toEqual(['listEntries']);
  });

  it('a door without a peek runs one call, as before', async () => {
    const interpret = vi.fn(async () => LIST);
    const { cd, dispatched } = harness({ interpret });
    await cd.handle('@bot melk is gekocht');
    expect(interpret).toHaveBeenCalledTimes(1);
    expect(dispatched.map((d) => d.opId)).toEqual(['listEntries']);
  });
});
