import { describe, it, expect, vi } from 'vitest';
import { circleGateRules } from '../../src/v2/circleGate.js';
import { createTokenGate } from '../../src/v2/tokenGate.js';
import { createCircleDispatch } from '../../src/v2/circleDispatch.js';

// The circle gate is now MANIFEST-DERIVED (renderGate over mockTasksManifest's surfaces.slash.match),
// not a hand-written rule set. These assert the projected rules behave as the device-run needs.
const gate = () => createTokenGate({ rules: circleGateRules() });
const route = (text) => gate().evaluate(text, {});

describe('circle gate (manifest-derived) — deterministic routing', () => {
  it('"add X to the list" → addItem{text:X} with NO type — the shell asks which list (L90, 2026-09-05)', async () => {
    const r = await route('add milk to the list');
    expect(r.via).toBe('rule');
    expect(r.command).toEqual({ opId: 'addItem', args: { text: 'milk' } });
  });

  it('add keeps a multi-word item with no qualifier', async () => {
    expect((await route('add buy fresh milk')).command).toEqual({ opId: 'addItem', args: { text: 'buy fresh milk' } });
    // saying "task" keeps it a task
    expect((await route('add task call the plumber')).command).toEqual({ opId: 'addTask', args: { text: 'task call the plumber' } });
  });

  it('TYPED list: "add X to the shopping/repair list" → addItem({type}), not addTask', async () => {
    expect((await route('add bananas to the shopping list')).command).toEqual({ opId: 'addItem', args: { type: 'shopping', text: 'bananas' } });
    expect((await route('add nails to the repair list')).command).toEqual({ opId: 'addItem', args: { type: 'repair', text: 'nails' } });
    // alias (groceries → shopping) + a multi-word item
    expect((await route('add fresh milk to the groceries list')).command).toEqual({ opId: 'addItem', args: { type: 'shopping', text: 'fresh milk' } });
    // Dutch typed list
    expect((await route('zet melk op de boodschappenlijst')).command).toEqual({ opId: 'addItem', args: { type: 'shopping', text: 'melk' } });
  });

  it('an untyped add with a conversation under way is left to the model (memoryTurns > 0)', async () => {
    const rules = circleGateRules('nl');
    const rule = rules.find((r) => r.name === 'household:addItem(untyped-asks)');
    expect(rule.command('doe broccoli erbij', { memoryTurns: 2 })).toBeNull();
    expect(rule.command('doe broccoli erbij', { memoryTurns: 0 })).toEqual({ opId: 'addItem', args: { text: 'broccoli' } });
  });

  it('a typed add naming several items → one command per item (more)', async () => {
    const r = await route('zet stokbrood, melk en eieren op de boodschappenlijst');
    expect(r.command.args).toEqual({ type: 'shopping', text: 'stokbrood' });
    expect(r.command.more.map((m) => m.args.text)).toEqual(['melk', 'eieren']);
    expect((await route('zet brood en eieren op de boodschappen')).command.more).toBeUndefined();
  });

  it('the colon form "voeg toe: X" / "add: X" is an add of X — never a task named "toe: X" (walk 3)', async () => {
    expect((await route('Voeg toe: spruiten kopen')).command).toEqual({ opId: 'addItem', args: { text: 'spruiten kopen' } });
    expect((await route('add: milk')).command).toEqual({ opId: 'addItem', args: { text: 'milk' } });
  });

  it('a stated "X is gekocht/gedaan/bought" → markComplete{match:X} without a model', async () => {
    expect((await route('kaas is gekocht')).command).toEqual({ opId: 'markComplete', args: { match: 'kaas' } });
    expect((await route('De afwas is gedaan!')).command).toEqual({ opId: 'markComplete', args: { match: 'afwas' } });
    expect((await route('milk is bought')).command).toEqual({ opId: 'markComplete', args: { match: 'milk' } });
  });

  it('UNTYPED "add X to the list" → addItem without a type (asks), never a silent task', async () => {
    expect((await route('add milk to the list')).command).toEqual({ opId: 'addItem', args: { text: 'milk' } });
  });

  it('READ: "show/what\'s on the <type> list" → listOpen({type}) — NOT markComplete (the read misfire)', async () => {
    expect((await route('show the shopping list')).command).toEqual({ opId: 'listOpen', args: { type: 'shopping' } });
    expect((await route('show me the shopping list')).command).toEqual({ opId: 'listOpen', args: { type: 'shopping' } });
    expect((await route("what's on the errand list")).command).toEqual({ opId: 'listOpen', args: { type: 'errand' } });
  });

  it('READ: "what tasks do we have" / "show the chores" → listTasks', async () => {
    expect((await route('what tasks do we have?')).command).toEqual({ opId: 'listTasks', args: {} });
    expect((await route('show the chores')).command).toEqual({ opId: 'listTasks', args: {} });
  });

  it('READ: a meta question with no type/tasks keyword falls through to the LLM (not a false read)', async () => {
    expect((await route('what lists do we have')).via).toBe('llm');
    expect((await route('what should we cook tonight?')).via).toBe('llm');
  });

  it('Dutch: "voeg melk toe" / "zet melk op de lijst" → addItem{text:melk} without a type (asks which list)', async () => {
    expect((await route('voeg melk toe')).command).toEqual({ opId: 'addItem', args: { text: 'melk' } });
    expect((await route('zet melk op de lijst')).command).toEqual({ opId: 'addItem', args: { text: 'melk' } });
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
      postToCircle: () => {},
      gate: gate(),
    });
    return { bot, dispatched, interpret };
  }

  it('a matched rule routes BEFORE the LLM (interpret never called)', async () => {
    const { bot, dispatched, interpret } = setup();
    const r = await bot.handle('@assistant add milk to the list');
    expect(r.via).toBe('rule');
    expect(dispatched).toEqual([{ opId: 'addItem', args: { text: 'milk' } }]);
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

// ── Part A parity: createGate (host-level) ≡ the old direct renderGate projection ──────────────
// circleGate.js used to build the manifest half by importing app-manifest's `renderGate` directly via
// a deep relative path; it now consumes `@onderling/manifest-host`'s `createGate`. These assert the two
// paths are byte-for-byte equivalent over the REAL circle manifests, so the switch is behaviour-safe.
import { renderGate } from '@onderling/app-manifest';
import { createGate } from '@onderling/manifest-host';
import { mockTasksManifest, mockStoopManifest, mockFolioManifest } from '../../src/core/manifests/mockManifests.js';
import { calendarManifest } from '../../../calendar/manifest.js';
import { CIRCLE_GATE_TRAIL } from '../../src/v2/circleGateLexicon.js';

describe('Part A — createGate parity with the old direct renderGate path', () => {
  const CIRCLE = [mockTasksManifest, mockStoopManifest, mockFolioManifest, calendarManifest];
  const probes = [
    'add buy milk', 'done sok', 'sok done', 'claim t1', 'post need a drill',
    'share notes', 'afwas klaar', 'noteer melk', 'random free text with no verb',
  ];

  for (const locale of ['en', 'nl']) {
    it(`same rules + same command results for every probe (${locale})`, () => {
      const opts = { locale, trailLexicon: CIRCLE_GATE_TRAIL };
      const composed = createGate(CIRCLE, opts).rules;
      const direct   = renderGate(CIRCLE, opts);
      expect(composed.length).toBe(direct.length);
      for (let i = 0; i < direct.length; i++) {
        expect(composed[i].name).toBe(direct[i].name);
        for (const p of probes) {
          expect(composed[i].command(p)).toEqual(direct[i].command(p));
        }
      }
    });
  }
});
