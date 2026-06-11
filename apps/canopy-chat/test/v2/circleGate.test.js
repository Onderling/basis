import { describe, it, expect, vi } from 'vitest';
import { circleGateRules } from '../../src/v2/circleGate.js';
import { createTokenGate } from '../../src/v2/tokenGate.js';
import { createCircleDispatch } from '../../src/v2/circleDispatch.js';

// The circle gate is now MANIFEST-DERIVED (renderGate over mockTasksManifest's surfaces.slash.match),
// not a hand-written rule set. These assert the projected rules behave as the device-run needs.
const gate = () => createTokenGate({ rules: circleGateRules() });
const route = (text) => gate().evaluate(text, {});

describe('circle gate (manifest-derived) — deterministic routing', () => {
  it('"add X to the list" → addTask{text:X}, dropping the list qualifier', async () => {
    const r = await route('add milk to the list');
    expect(r.via).toBe('rule');
    expect(r.command).toEqual({ opId: 'addTask', args: { text: 'milk' } });
  });

  it('add keeps a multi-word item with no qualifier', async () => {
    expect((await route('add buy fresh milk')).command).toEqual({ opId: 'addTask', args: { text: 'buy fresh milk' } });
  });

  it('Dutch: "voeg melk toe" / "zet melk op de lijst" → addTask{text:melk}', async () => {
    expect((await route('voeg melk toe')).command).toEqual({ opId: 'addTask', args: { text: 'melk' } });
    expect((await route('zet melk op de lijst')).command).toEqual({ opId: 'addTask', args: { text: 'melk' } });
  });

  it('"done X" → completeTask with id (the pickerSource param), not match', async () => {
    expect((await route('done the dishes')).command).toEqual({ opId: 'completeTask', args: { id: 'the dishes' } });
  });

  it('multiword "klaar met X" beats bare "klaar" → completeTask{id:X}', async () => {
    expect((await route('klaar met afwas')).command).toEqual({ opId: 'completeTask', args: { id: 'afwas' } });
  });

  it('"claim X" / "I\'ll take X" / "ik pak X" → claimTask{id:X}', async () => {
    expect((await route('claim the dishes')).command).toEqual({ opId: 'claimTask', args: { id: 'the dishes' } });
    expect((await route("I'll take the trash")).command).toEqual({ opId: 'claimTask', args: { id: 'the trash' } });
    expect((await route('ik pak de afwas')).command).toEqual({ opId: 'claimTask', args: { id: 'de afwas' } });
  });

  it('unmatched free text falls through to the LLM', async () => {
    expect((await route('what should we cook tonight?')).via).toBe('llm');
  });
});

describe('circle gate — Part C: multi-app verbs, collisions, removed declarations', () => {
  const op = async (text) => (await route(text)).command?.opId ?? null;

  it('routes each app\'s user-action verbs to the right op', async () => {
    expect(await op('submit the report')).toBe('submitTask');
    expect(await op('post a ladder')).toBe('postRequest');
    expect(await op('help with the drill')).toBe('respondToItem');
    expect(await op('returned the ladder')).toBe('markReturned');
    expect(await op('report the spam')).toBe('reportPost');
    expect(await op('download budget.xlsx')).toBe('downloadFile');
    expect(await op('sync')).toBe('syncOnce');
    expect(await op('schedule lunch')).toBe('addEvent');
  });

  it('resolves each cross-app collision to its single owner', async () => {
    expect(await op('share the deck')).toBe('shareFolder');      // not stoop.postRequest
    expect(await op('deel de fotos')).toBe('shareFolder');
    expect(await op('accept the invite')).toBe('rsvpAccept');    // not tasks.approveTask
    expect(await op('reject the draft')).toBe('rejectTask');     // not calendar.rsvpDecline
    expect(await op('decline the invite')).toBe('rsvpDecline');  // calendar keeps 'decline'
    expect(await op('cancel event Demo')).toBe('cancelEvent');   // not household.removeChore
    expect(await op('approve the report')).toBe('approveTask');  // tasks keeps 'approve'
  });

  it('honours multiword-before-bare precedence', async () => {
    expect(await op('cancel appointment Lunch')).toBe('cancelEvent');
    expect(await op('klaar met afwas')).toBe('completeTask');
  });

  it('removed/invalid declarations do NOT route (fall to the LLM)', async () => {
    expect(await op('sign-out')).toBe(null);        // signOutOfPod: invalid body:'reject' removed
    expect(await op('tree the item')).toBe(null);   // getItemTree: debug op, match removed
    expect(await op('bulletin ask')).toBe(null);    // stoop.listOpen: mis-wired type-only removed
  });

  it('the gate never throws on any input (renderSlash body kinds all valid)', async () => {
    for (const t of ['', '/', 'random words', 'sign-out now', 'cancel', 'ik kom niet']) {
      await expect(route(t)).resolves.toBeDefined();
    }
  });
});

describe('circle bot + manifest gate — routing precedence', () => {
  function setup() {
    const dispatched = [];
    const interpret = vi.fn(async () => ({ opId: 'fromLlm', args: {} }));
    const bot = createCircleDispatch({
      policy: { llmTool: 'local' },
      llmProviders: { local: { chat: async () => '' } },             // truthy llm so the gate path runs
      interpret,
      dispatch: (cmd) => dispatched.push(cmd),
      postToKring: () => {},
      gate: gate(),
    });
    return { bot, dispatched, interpret };
  }

  it('a matched rule routes BEFORE the LLM (interpret never called)', async () => {
    const { bot, dispatched, interpret } = setup();
    const r = await bot.handle('@assistant add milk to the list');
    expect(r.via).toBe('rule');
    expect(dispatched).toEqual([{ opId: 'addTask', args: { text: 'milk' } }]);
    expect(interpret).not.toHaveBeenCalled();
  });

  it('unmatched free text still reaches the LLM', async () => {
    const { bot, dispatched, interpret } = setup();
    const r = await bot.handle('@assistant what is for dinner');
    expect(interpret).toHaveBeenCalledTimes(1);
    expect(r.via).toBe('llm');
    expect(dispatched).toEqual([{ opId: 'fromLlm', args: {} }]);
  });
});
