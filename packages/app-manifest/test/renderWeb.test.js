/**
 * `renderWeb` V0 — unit tests.
 *
 * Pure-data projector test: inline manifests, no consumer (no
 * household / tasks-v0 dependency).  A.2 will add the first real
 * manifest snapshot test against `householdManifest`.
 *
 * Tests cover the five owner decisions from
 * `DESIGN-navmodel-sketch.md` (locked 2026-05-20):
 *   detail-view: NOT present in V0 NavModel
 *   section ordering: manifest declaration order
 *   globals source: inferred from surfaces.ui.placement === 'global'
 *   strict equality: tests written so renderMobile can later
 *      produce structurally-equal output
 *   view.sort passed through
 */

import { describe, it, expect } from 'vitest';

import { renderWeb } from '../src/renderWeb.js';

/* ─── synthetic manifest covering V0 cases ──────────────────────────── */

const SYNTH = {
  app:       'synth',
  itemTypes: ['shopping', 'task', 'contact'],
  operations: [
    // add-style op → section affordance
    {
      id:        'addShopping',
      verb:      'add',
      appliesTo: { type: 'shopping' },
      params:    [{ name: 'text', kind: 'string', required: true }],
      surfaces:  { ui: { control: 'button', label: 'Add to shopping' } },
    },
    // add-style op for tasks
    {
      id:        'addTask',
      verb:      'add',
      appliesTo: { type: 'task' },
      params:    [{ name: 'text', kind: 'string', required: true }],
      surfaces:  { ui: { control: 'button', label: 'Add a task' } },
    },
    // state-gated op → section itemAction
    {
      id:        'claim',
      verb:      'claim',
      appliesTo: { type: 'task', state: 'open' },
      params:    [{ name: 'id', kind: 'string', required: true }],
      surfaces:  { ui: { control: 'button', label: 'Claim' } },
    },
    // F-SP3-a multi-state op
    {
      id:        'revoke',
      verb:      'revoke',
      appliesTo: { type: 'task', state: ['claimed', 'submitted'] },
      params:    [{ name: 'id', kind: 'string', required: true }],
      surfaces:  { ui: { control: 'button', label: 'Revoke' } },
    },
    // global op → goes to globals[]
    {
      id:       'help',
      verb:     'help',
      params:   [],
      surfaces: { ui: { control: 'button', label: 'Help', placement: 'global' } },
    },
    // chat-only op (no surfaces.ui) — must be omitted from NavModel
    {
      id:        'classify',
      verb:      'classify',
      params:    [{ name: 'text', kind: 'string', required: true }],
      surfaces:  { chat: { hint: 'classify a message' } },
    },
  ],
  views: [
    { id: 'shopping', title: 'Shopping', type: 'shopping' },
    { id: 'tasks',    title: 'Tasks',    type: 'task',     filter: { open: true },
      sort: { by: 'createdAt', direction: 'desc' } },
    { id: 'contacts', title: 'Contacts', type: 'contact' },   // no matching ops
  ],
};

/* ─── tests ──────────────────────────────────────────────────────────── */

describe('renderWeb V0', () => {
  describe('contract', () => {
    it('rejects missing manifest', () => {
      expect(() => renderWeb(null)).toThrow(/manifest required/);
    });

    it('produces a NavModel with app + sections + globals top-level keys', () => {
      const nav = renderWeb(SYNTH);
      expect(nav).toHaveProperty('app');
      expect(nav).toHaveProperty('sections');
      expect(nav).toHaveProperty('globals');
      expect(Object.keys(nav).sort()).toEqual(['app', 'globals', 'sections']);
    });

    it('app mirrors manifest.app', () => {
      expect(renderWeb(SYNTH).app).toBe('synth');
    });

    it('empty-manifest case — no views, no operations', () => {
      const nav = renderWeb({ app: 'empty', itemTypes: [], operations: [], views: [] });
      expect(nav).toEqual({ app: 'empty', sections: [], globals: [] });
    });
  });

  describe('sections', () => {
    it('one section per manifest.view, in declaration order (Q2)', () => {
      const ids = renderWeb(SYNTH).sections.map((s) => s.id);
      expect(ids).toEqual(['shopping', 'tasks', 'contacts']);
    });

    it('section mirrors view.{id, title, itemType}', () => {
      const tasks = renderWeb(SYNTH).sections.find((s) => s.id === 'tasks');
      expect(tasks).toMatchObject({ id: 'tasks', title: 'Tasks', itemType: 'task' });
    });

    it('section.filter passed through when present', () => {
      const tasks = renderWeb(SYNTH).sections.find((s) => s.id === 'tasks');
      expect(tasks.filter).toEqual({ open: true });
    });

    it('section.filter ABSENT when view.filter not declared', () => {
      const shopping = renderWeb(SYNTH).sections.find((s) => s.id === 'shopping');
      expect(shopping).not.toHaveProperty('filter');
    });

    it('section.sort passed through when present (Q5)', () => {
      const tasks = renderWeb(SYNTH).sections.find((s) => s.id === 'tasks');
      expect(tasks.sort).toEqual({ by: 'createdAt', direction: 'desc' });
    });

    it('section.sort ABSENT when view.sort not declared', () => {
      const shopping = renderWeb(SYNTH).sections.find((s) => s.id === 'shopping');
      expect(shopping).not.toHaveProperty('sort');
    });

    it('section.audience passed through when present (V0 NavModel ignores; SP-5b consumer reads)', () => {
      const nav = renderWeb({
        ...SYNTH,
        views: [{ id: 'shared', title: 'Shared', type: 'task', audience: 'circle:abc' }],
      });
      expect(nav.sections[0].audience).toBe('circle:abc');
    });

    it('SP-5b — section.audience defaults from view.defaultAudience (the schema field)', () => {
      const nav = renderWeb({
        ...SYNTH,
        views: [{ id: 'shared', title: 'Shared', type: 'task', defaultAudience: 'circle:abc' }],
      });
      expect(nav.sections[0].audience).toBe('circle:abc');
    });

    it('SP-5b — explicit view.audience overrides view.defaultAudience', () => {
      const nav = renderWeb({
        ...SYNTH,
        views: [{ id: 'shared', title: 'Shared', type: 'task', audience: 'circle:explicit', defaultAudience: 'circle:default' }],
      });
      expect(nav.sections[0].audience).toBe('circle:explicit');
    });

    it('SP-5b — section.audience ABSENT when neither audience nor defaultAudience declared', () => {
      const nav = renderWeb({
        ...SYNTH,
        views: [{ id: 'plain', title: 'Plain', type: 'task' }],
      });
      expect(nav.sections[0]).not.toHaveProperty('audience');
    });
  });

  describe('affordances (verb===add ops)', () => {
    it('shopping section gets addShopping as an affordance', () => {
      const shopping = renderWeb(SYNTH).sections.find((s) => s.id === 'shopping');
      expect(shopping.affordances).toHaveLength(1);
      expect(shopping.affordances[0]).toMatchObject({
        opId: 'addShopping', label: 'Add to shopping', placement: 'section',
      });
      expect(shopping.affordances[0].paramsSchema.type).toBe('object');
    });

    it('contacts section has no affordances (no add op targets type:contact)', () => {
      const contacts = renderWeb(SYNTH).sections.find((s) => s.id === 'contacts');
      expect(contacts.affordances).toEqual([]);
    });
  });

  describe('itemActions (state-gated ops)', () => {
    it('tasks section gets claim + revoke', () => {
      const tasks = renderWeb(SYNTH).sections.find((s) => s.id === 'tasks');
      expect(tasks.itemActions.map((a) => a.opId).sort()).toEqual(['claim', 'revoke']);
    });

    it('itemAction preserves appliesTo verbatim (single-state)', () => {
      const tasks = renderWeb(SYNTH).sections.find((s) => s.id === 'tasks');
      const claim = tasks.itemActions.find((a) => a.opId === 'claim');
      expect(claim.appliesTo).toEqual({ type: 'task', state: 'open' });
    });

    it('itemAction preserves appliesTo verbatim (multi-state array, F-SP3-a)', () => {
      const tasks = renderWeb(SYNTH).sections.find((s) => s.id === 'tasks');
      const revoke = tasks.itemActions.find((a) => a.opId === 'revoke');
      expect(revoke.appliesTo).toEqual({ type: 'task', state: ['claimed', 'submitted'] });
    });

    it('itemAction label sources from surfaces.ui.label', () => {
      const tasks = renderWeb(SYNTH).sections.find((s) => s.id === 'tasks');
      const claim = tasks.itemActions.find((a) => a.opId === 'claim');
      expect(claim.label).toBe('Claim');
    });

    // regression (surfaced by C.4) — buildItemAction used to strip
    // every appliesTo field except type+state, silently dropping the
    // generic gate the adapter's itemMatchesAppliesTo expects.
    it('itemAction preserves generic appliesTo fields (V0.4 per-kind gating)', () => {
      const M = {
        appId:      'inbox',
        title:      'Inbox',
        version:    '0',
        itemTypes:  ['inbox-item'],
        operations: [
          {
            id:        'approveSubtaskProposal',
            verb:      'approve',
            params:    [],
            appliesTo: { type: 'inbox-item', kind: 'subtask-proposal' },
            surfaces:  { ui: { label: 'Approve' }, chat: {} },
          },
          {
            id:        'declineSubtaskRequest',
            verb:      'decline',
            params:    [],
            appliesTo: { type: 'inbox-item', kind: ['subtask-request', 'subtask-proposal'] },
            surfaces:  { ui: { label: 'Decline' }, chat: {} },
          },
        ],
        views: [{ id: 'inbox', title: 'Inbox', type: 'inbox-item' }],
      };
      const sec = renderWeb(M).sections.find((s) => s.id === 'inbox');
      const approve = sec.itemActions.find((a) => a.opId === 'approveSubtaskProposal');
      expect(approve.appliesTo).toEqual({
        type: 'inbox-item',
        kind: 'subtask-proposal',
      });
      const decline = sec.itemActions.find((a) => a.opId === 'declineSubtaskRequest');
      expect(decline.appliesTo).toEqual({
        type: 'inbox-item',
        kind: ['subtask-request', 'subtask-proposal'],
      });
    });
  });

  describe('globals (Q3 — inferred from surfaces.ui.placement)', () => {
    it('help (placement:global) lands in globals[]', () => {
      const nav = renderWeb(SYNTH);
      expect(nav.globals).toHaveLength(1);
      expect(nav.globals[0]).toMatchObject({
        opId: 'help', label: 'Help', placement: 'global',
      });
    });

    it('global op is NOT also pushed to any section.affordances', () => {
      const nav = renderWeb(SYNTH);
      const allSectionAffordanceIds = nav.sections.flatMap((s) =>
        s.affordances.map((a) => a.opId),
      );
      expect(allSectionAffordanceIds).not.toContain('help');
    });
  });

  describe('chat-only ops omitted', () => {
    it('classify (no surfaces.ui) is absent from sections + globals', () => {
      const nav = renderWeb(SYNTH);
      const allOpIds = [
        ...nav.globals.map((g) => g.opId),
        ...nav.sections.flatMap((s) => [
          ...s.affordances.map((a) => a.opId),
          ...s.itemActions.map((a) => a.opId),
        ]),
      ];
      expect(allOpIds).not.toContain('classify');
    });
  });

  describe('determinism', () => {
    it('same manifest → identical NavModel (JSON-equal)', () => {
      expect(JSON.stringify(renderWeb(SYNTH))).toBe(JSON.stringify(renderWeb(SYNTH)));
    });

    it('detail-view field NOT present in V0 (Q1 deferred)', () => {
      const nav = renderWeb(SYNTH);
      for (const section of nav.sections) {
        expect(section).not.toHaveProperty('detail');
        expect(section).not.toHaveProperty('detailViewRef');
      }
    });
  });
});

/* ───: type-enum fallback + prefilledParams (added 2026-05-20) ─── */

const MULTI_TYPE_SYNTH = {
  app:       'mt',
  itemTypes: ['shopping', 'errand', 'task'],
  operations: [
    // (a) verb=add WITHOUT surfaces.ui, WITHOUT appliesTo, WITH type-enum param.
    //     Surfaces in EACH section whose itemType is in the enum (rule a).
    {
      id:     'addItem',
      verb:   'add',
      params: [
        { name: 'type', kind: 'enum', of: ['shopping', 'errand'], required: true },
        { name: 'text', kind: 'string', required: true },
      ],
      surfaces: { chat: { hint: 'Add' } },  // chat-only declared; no surfaces.ui
    },
    // (b) verb=complete WITH surfaces.ui, WITH multi-type appliesTo (F-SP3-a).
    //     Surfaces as itemAction in each section listed in appliesTo.type[].
    {
      id:        'markDone',
      verb:      'complete',
      appliesTo: { type: ['shopping', 'errand', 'task'] },
      params:    [{ name: 'match', kind: 'string', required: true }],
      surfaces:  { ui: { control: 'button', label: 'Done' } },
    },
    // (c) verb=list ops — skip rule (implicit data source).  Should NOT
    //     surface in either affordances or itemActions.
    {
      id:     'listAll',
      verb:   'list',
      params: [{ name: 'type', kind: 'enum', of: ['shopping', 'errand'], required: true }],
      surfaces: { chat: { hint: 'List' }, ui: { control: 'button', label: 'Refresh' } },
    },
    // (d) verb=add WITH explicit appliesTo (single type) — surfaces only in that section.
    {
      id:        'addTask',
      verb:      'add',
      appliesTo: { type: 'task' },
      params:    [{ name: 'text', kind: 'string', required: true }],
      surfaces:  { chat: { hint: 'Add task' } },
    },
  ],
  views: [
    { id: 'shopping', title: 'Shopping', type: 'shopping' },
    { id: 'errand',   title: 'Errands',  type: 'errand'   },
    { id: 'tasks',    title: 'Tasks',    type: 'task'     },
  ],
};

describe('renderWeb V0 — Q6 type-enum fallback + prefilledParams', () => {
  describe('verb=add auto-surface (Q6 rule a)', () => {
    it('addItem surfaces as affordance in EVERY section matching its type-enum', () => {
      const nav = renderWeb(MULTI_TYPE_SYNTH);
      const sh = nav.sections.find((s) => s.id === 'shopping');
      const er = nav.sections.find((s) => s.id === 'errand');
      const ta = nav.sections.find((s) => s.id === 'tasks');

      expect(sh.affordances.map((a) => a.opId)).toContain('addItem');
      expect(er.affordances.map((a) => a.opId)).toContain('addItem');
      expect(ta.affordances.map((a) => a.opId)).not.toContain('addItem');  // task not in enum
    });

    it('addItem affordance carries prefilledParams.type for each section', () => {
      const nav = renderWeb(MULTI_TYPE_SYNTH);
      const shAdd = nav.sections.find((s) => s.id === 'shopping').affordances
        .find((a) => a.opId === 'addItem');
      const erAdd = nav.sections.find((s) => s.id === 'errand').affordances
        .find((a) => a.opId === 'addItem');

      expect(shAdd.prefilledParams).toEqual({ type: 'shopping' });
      expect(erAdd.prefilledParams).toEqual({ type: 'errand' });
    });

    it('add ops WITHOUT surfaces.ui DO surface (Q6 rule a — no surfaces.ui required for add)', () => {
      const nav = renderWeb(MULTI_TYPE_SYNTH);
      const shAdd = nav.sections.find((s) => s.id === 'shopping').affordances
        .find((a) => a.opId === 'addItem');
      expect(shAdd).toBeTruthy();
      expect(shAdd.label).toBe('add');  // verb fallback (no surfaces.ui.label)
    });

    it('addTask with EXPLICIT appliesTo surfaces only in matching section + has NO prefilledParams', () => {
      const nav = renderWeb(MULTI_TYPE_SYNTH);
      const ta = nav.sections.find((s) => s.id === 'tasks');
      const sh = nav.sections.find((s) => s.id === 'shopping');

      const taAddTask = ta.affordances.find((a) => a.opId === 'addTask');
      expect(taAddTask).toBeTruthy();
      expect(taAddTask).not.toHaveProperty('prefilledParams');
      expect(sh.affordances.find((a) => a.opId === 'addTask')).toBeUndefined();
    });
  });

  describe('verb=list skip (Q6 rule b)', () => {
    it('listAll does NOT surface in any section, even with surfaces.ui', () => {
      const nav = renderWeb(MULTI_TYPE_SYNTH);
      const allOpIds = nav.sections.flatMap((s) => [
        ...s.affordances.map((a) => a.opId),
        ...s.itemActions.map((a) => a.opId),
      ]);
      expect(allOpIds).not.toContain('listAll');
    });
  });

  describe('multi-type appliesTo via F-SP3-a', () => {
    it('markDone surfaces as itemAction in every section in its appliesTo.type[]', () => {
      const nav = renderWeb(MULTI_TYPE_SYNTH);
      for (const sectionId of ['shopping', 'errand', 'tasks']) {
        const section = nav.sections.find((s) => s.id === sectionId);
        expect(section.itemActions.map((a) => a.opId)).toContain('markDone');
      }
    });

    it('markDone preserves the full multi-type appliesTo (not narrowed to view.type)', () => {
      const nav = renderWeb(MULTI_TYPE_SYNTH);
      const sh = nav.sections.find((s) => s.id === 'shopping');
      const md = sh.itemActions.find((a) => a.opId === 'markDone');
      expect(md.appliesTo).toEqual({ type: ['shopping', 'errand', 'task'] });
      expect(md).not.toHaveProperty('prefilledParams');
    });
  });
});

/* ───: view.dataSource + appliesTo wildcard ─────────────── */

const V02_SYNTH = {
  app:       'v02',
  itemTypes: ['ask', 'offer', 'lend', 'task'],
  operations: [
    // Wildcard appliesTo — surfaces in every section.
    {
      id:        'cancelAny',
      verb:      'remove',
      appliesTo: { type: '*' },
      params:    [{ name: 'id', kind: 'string', required: true }],
      surfaces:  { ui: { control: 'button', label: 'Cancel' } },
    },
    // Wildcard with state — must compose.
    {
      id:        'archiveOpen',
      verb:      'archive',
      appliesTo: { type: '*', state: 'open' },
      params:    [{ name: 'id', kind: 'string', required: true }],
      surfaces:  { ui: { control: 'button', label: 'Archive' } },
    },
    // Single-type op — still works as before; should NOT appear in other sections.
    {
      id:        'submitTask',
      verb:      'submit',
      appliesTo: { type: 'task', state: 'claimed' },
      params:    [{ name: 'id', kind: 'string', required: true }],
      surfaces:  { ui: { control: 'button', label: 'Submit' } },
    },
  ],
  views: [
    // view.dataSource declared explicitly.
    {
      id:         'mine-asks',
      title:      'My asks',
      type:       'ask',
      dataSource: { skillId: 'listMyAsks', args: { open: true } },
    },
    // view.dataSource OMITTED — adapter falls back to default heuristic.
    { id: 'all-offers', title: 'All offers', type: 'offer' },
    // dataSource with no args.
    {
      id:         'lend',
      title:      'Lend',
      type:       'lend',
      dataSource: { skillId: 'listLends' },
    },
    // task section — single-type op should appear here.
    { id: 'tasks', title: 'Tasks', type: 'task' },
  ],
};

describe('renderWeb V0.2 — Q7 view.dataSource', () => {
  it('section.dataSource is passed through when declared on the view', () => {
    const nav = renderWeb(V02_SYNTH);
    const asks = nav.sections.find((s) => s.id === 'mine-asks');
    expect(asks.dataSource).toEqual({ skillId: 'listMyAsks', args: { open: true } });
  });

  it('section.dataSource is ABSENT when the view does not declare it', () => {
    const nav = renderWeb(V02_SYNTH);
    const offers = nav.sections.find((s) => s.id === 'all-offers');
    expect(offers).not.toHaveProperty('dataSource');
  });

  it('section.dataSource with no args field is preserved verbatim', () => {
    const nav = renderWeb(V02_SYNTH);
    const lend = nav.sections.find((s) => s.id === 'lend');
    expect(lend.dataSource).toEqual({ skillId: 'listLends' });
    expect(lend.dataSource).not.toHaveProperty('args');
  });
});

/* ─── D-mig-1a: view.labelField + view.categoryField passthrough ─────── */

describe('renderWeb D-mig-1a — list-surface field selectors', () => {
  const MANIFEST = {
    app:       'dmig',
    itemTypes: ['contact', 'post'],
    operations: [
      { id: 'listContacts', verb: 'list', appliesTo: { type: 'contact' }, params: [] },
      { id: 'listOpen',     verb: 'list', params: [] },
    ],
    views: [
      {
        id:            'contacts',
        title:         'Contacts',
        type:          'contact',
        dataSource:    { skillId: 'listContacts' },
        labelField:    'label',
        categoryField: 'category',
        searchFields:  ['label', 'handle'],
      },
      {
        id:            'noticeboard',
        title:         'Noticeboard',
        type:          'post',
        dataSource:    { skillId: 'listOpen' },
        categoryField: 'kind',
      },
      // A view WITHOUT the new fields — must remain unchanged.
      { id: 'plain', title: 'Plain', type: 'post' },
    ],
  };

  it('projects labelField + categoryField onto the contacts section', () => {
    const c = renderWeb(MANIFEST).sections.find((s) => s.id === 'contacts');
    expect(c.labelField).toBe('label');
    expect(c.categoryField).toBe('category');
    expect(c.dataSource).toEqual({ skillId: 'listContacts' });
    expect(c.itemType).toBe('contact');
  });

  it('projects categoryField (kind) onto the noticeboard section; labelField absent', () => {
    const p = renderWeb(MANIFEST).sections.find((s) => s.id === 'noticeboard');
    expect(p.categoryField).toBe('kind');
    expect(p).not.toHaveProperty('labelField');
    expect(p.dataSource).toEqual({ skillId: 'listOpen' });
    expect(p.itemType).toBe('post');
  });

  it('a view without the new fields projects neither (back-compatible)', () => {
    const plain = renderWeb(MANIFEST).sections.find((s) => s.id === 'plain');
    expect(plain).not.toHaveProperty('labelField');
    expect(plain).not.toHaveProperty('categoryField');
  });

  // D-mig-2 — the filter grammar passthrough.
  it('projects searchFields onto the contacts section (verbatim)', () => {
    const c = renderWeb(MANIFEST).sections.find((s) => s.id === 'contacts');
    expect(c.searchFields).toEqual(['label', 'handle']);
  });

  it('a view without searchFields projects none (consumer defaults to [labelField])', () => {
    const p = renderWeb(MANIFEST).sections.find((s) => s.id === 'noticeboard');
    expect(p).not.toHaveProperty('searchFields');
    const plain = renderWeb(MANIFEST).sections.find((s) => s.id === 'plain');
    expect(plain).not.toHaveProperty('searchFields');
  });
});

/* ─── D-mig-1a: real stoop manifest projects contacts + noticeboard ─────── */

describe('renderWeb D-mig-1a — stoop manifest projection', () => {
  it('stoop contacts section carries listContacts + label + category', async () => {
    const { stoopManifest } = await import('../../../apps/stoop/manifest.js');
    const c = renderWeb(stoopManifest).sections.find((s) => s.id === 'contacts');
    expect(c).toBeDefined();
    expect(c.itemType).toBe('contact');
    expect(c.dataSource).toEqual({ skillId: 'listContacts' });
    expect(c.labelField).toBe('label');
    expect(c.categoryField).toBe('category');
    // D-mig-2 — contacts declare a genuine secondary searchable field (handle).
    expect(c.searchFields).toEqual(['label', 'handle']);
  });

  it('stoop noticeboard section carries listOpen + kind + post', async () => {
    const { stoopManifest } = await import('../../../apps/stoop/manifest.js');
    const p = renderWeb(stoopManifest).sections.find((s) => s.id === 'noticeboard');
    expect(p).toBeDefined();
    expect(p.itemType).toBe('post');
    expect(p.dataSource).toEqual({ skillId: 'listOpen' });
    expect(p.categoryField).toBe('kind');
    // D-mig-2 — noticeboard's label IS the post body; searchFields formalises the
    // label-only default explicitly (no distinct secondary field exists).
    expect(p.searchFields).toEqual(['label']);
    expect(p).not.toHaveProperty('labelField');
  });
});

describe('renderWeb V0.2 — Q9 view.readOnly', () => {
  const MANIFEST = {
    app:       'ro',
    itemTypes: ['contact', 'task'],
    operations: [
      {
        id:        'addContact', verb: 'add', appliesTo: { type: 'contact' },
        params:    [{ name: 'name', kind: 'string', required: true }],
        surfaces:  { chat: { hint: 'add' } },
      },
      {
        id:        'removeContact', verb: 'remove', appliesTo: { type: 'contact' },
        params:    [{ name: 'id', kind: 'string', required: true }],
        surfaces:  { ui: { control: 'button', label: 'X' } },
      },
    ],
    views: [
      { id: 'contacts-ro', title: 'Contacts',     type: 'contact', readOnly: true },
      { id: 'contacts-rw', title: 'Editable',     type: 'contact' },
    ],
  };

  it('section.readOnly is set when view.readOnly is true', () => {
    const nav = renderWeb(MANIFEST);
    const ro = nav.sections.find((s) => s.id === 'contacts-ro');
    expect(ro.readOnly).toBe(true);
  });

  it('section.readOnly is ABSENT when view.readOnly is not declared', () => {
    const nav = renderWeb(MANIFEST);
    const rw = nav.sections.find((s) => s.id === 'contacts-rw');
    expect(rw).not.toHaveProperty('readOnly');
  });

  it('creative affordances are SKIPPED in read-only sections', () => {
    const nav = renderWeb(MANIFEST);
    const ro = nav.sections.find((s) => s.id === 'contacts-ro');
    expect(ro.affordances).toEqual([]);
  });

  it('itemActions still render in read-only sections (delete-button etc.)', () => {
    const nav = renderWeb(MANIFEST);
    const ro = nav.sections.find((s) => s.id === 'contacts-ro');
    expect(ro.itemActions.map((a) => a.opId)).toContain('removeContact');
  });

  it('writable sibling keeps both affordances + itemActions', () => {
    const nav = renderWeb(MANIFEST);
    const rw = nav.sections.find((s) => s.id === 'contacts-rw');
    expect(rw.affordances.map((a) => a.opId)).toContain('addContact');
    expect(rw.itemActions.map((a) => a.opId)).toContain('removeContact');
  });
});

describe('renderWeb V0.2 — Q10 creative verbs (add + register)', () => {
  const MANIFEST = {
    app:       'cv',
    itemTypes: ['task', 'contact'],
    operations: [
      // verb='register' op without surfaces.ui — surfaces it.
      {
        id:        'registerName',
        verb:      'register',
        appliesTo: { type: 'contact' },
        params:    [{ name: 'text', kind: 'string', required: true }],
        surfaces:  { chat: { hint: 'register name' } },
      },
      // verb='add' op — also surfaces (rule a, now generalised).
      {
        id:        'addTask',
        verb:      'add',
        appliesTo: { type: 'task' },
        params:    [{ name: 'text', kind: 'string', required: true }],
        surfaces:  { chat: { hint: 'add task' } },
      },
      // Non-creative verb without surfaces.ui — STILL omitted (only
      // creative verbs auto-surface).
      {
        id:        'classify',
        verb:      'classify',
        appliesTo: { type: 'task' },
        params:    [{ name: 'text', kind: 'string', required: true }],
        surfaces:  { chat: { hint: 'classify' } },
      },
    ],
    views: [
      { id: 'tasks',   title: 'Tasks',   type: 'task'    },
      { id: 'members', title: 'Members', type: 'contact' },
    ],
  };

  it('verb=register op auto-surfaces in members section', () => {
    const nav = renderWeb(MANIFEST);
    const members = nav.sections.find((s) => s.id === 'members');
    expect(members.affordances.map((a) => a.opId)).toContain('registerName');
  });

  it('verb=add op continues to auto-surface (Q6 rule a still works)', () => {
    const nav = renderWeb(MANIFEST);
    const tasks = nav.sections.find((s) => s.id === 'tasks');
    expect(tasks.affordances.map((a) => a.opId)).toContain('addTask');
  });

  it('non-creative verbs WITHOUT surfaces.ui stay omitted', () => {
    const nav = renderWeb(MANIFEST);
    const allOpIds = nav.sections.flatMap((s) => [
      ...s.affordances.map((a) => a.opId),
      ...s.itemActions.map((a) => a.opId),
    ]);
    expect(allOpIds).not.toContain('classify');
  });
});

describe('renderWeb V0.4 — Q18 view.fields (record-shape patch fields)', () => {
  const MANIFEST = {
    app:       'rec',
    itemTypes: ['settings-record'],
    operations: [
      {
        id:   'updateSettings',
        verb: 'update',
        params: [
          { name: 'language',    kind: 'string' },
          { name: 'pushEnabled', kind: 'boolean' },
        ],
        surfaces: { chat: { hint: 'patch settings' } },
      },
    ],
    views: [
      {
        id:    'settings',
        title: 'Settings',
        type:  'settings-record',
        shape: 'record',
        dataSource: { skillId: 'getSettings' },
        fields: [
          { name: 'language', type: 'enum', label: 'Language',
            choices: ['en', 'nl'],
            patch: { opId: 'updateSettings', argName: 'language' } },
          { name: 'pushEnabled', type: 'boolean',
            patch: { opId: 'updateSettings', argName: 'pushEnabled' } },
          { name: 'displayName', type: 'string' /* no patch — read-only field */ },
        ],
      },
      { id: 'no-fields', title: 'No fields', type: 'settings-record', shape: 'record' },
    ],
  };

  it('section.fields is set when view.shape === record + view.fields declared', () => {
    const nav = renderWeb(MANIFEST);
    const settings = nav.sections.find((s) => s.id === 'settings');
    expect(settings.fields).toHaveLength(3);
    expect(settings.fields[0]).toMatchObject({
      name: 'language', type: 'enum', label: 'Language',
      choices: ['en', 'nl'],
      patch: { opId: 'updateSettings', argName: 'language' },
    });
  });

  it('section.fields[].patch is preserved verbatim per field', () => {
    const nav = renderWeb(MANIFEST);
    const settings = nav.sections.find((s) => s.id === 'settings');
    const lang = settings.fields.find((f) => f.name === 'language');
    expect(lang.patch).toEqual({ opId: 'updateSettings', argName: 'language' });
  });

  it('section.fields[] entry WITHOUT patch is read-only (no patch field)', () => {
    const nav = renderWeb(MANIFEST);
    const settings = nav.sections.find((s) => s.id === 'settings');
    const dn = settings.fields.find((f) => f.name === 'displayName');
    expect(dn).not.toHaveProperty('patch');
  });

  it('section.fields is ABSENT when view.fields not declared (forward-compat)', () => {
    const nav = renderWeb(MANIFEST);
    const noFields = nav.sections.find((s) => s.id === 'no-fields');
    expect(noFields).not.toHaveProperty('fields');
  });

  /* ─── (2026-05-22) — patch.argWrapper pass-through ─────── */

  it('Q21 — field.patch.argWrapper passes through verbatim when present', () => {
    const nav = renderWeb({
      app:       'rec',
      itemTypes: ['settings-record'],
      operations: [
        { id: 'updateSettings', verb: 'update',
          params: [{ name: 'pollIntervalMs', kind: 'number' }] },
      ],
      views: [{
        id: 'settings', title: 'Settings', type: 'settings-record', shape: 'record',
        fields: [
          { name: 'pollIntervalMs', type: 'number',
            patch: { opId: 'updateSettings', argName: 'pollIntervalMs',
                     argWrapper: 'patch' } },
        ],
      }],
    });
    const settings = nav.sections.find((s) => s.id === 'settings');
    expect(settings.fields[0].patch).toEqual({
      opId: 'updateSettings', argName: 'pollIntervalMs', argWrapper: 'patch',
    });
  });

  it('Q21 — flat patch (no argWrapper) preserves V0.4 behaviour', () => {
    const nav = renderWeb(MANIFEST);
    const settings = nav.sections.find((s) => s.id === 'settings');
    const lang = settings.fields.find((f) => f.name === 'language');
    // fields stayed flat — argWrapper key must NOT appear.
    expect(lang.patch).toEqual({ opId: 'updateSettings', argName: 'language' });
    expect(lang.patch).not.toHaveProperty('argWrapper');
  });

  it('Q21 — empty-string argWrapper is dropped (treated as absent)', () => {
    const nav = renderWeb({
      app:       'rec',
      itemTypes: ['settings-record'],
      operations: [
        { id: 'updateSettings', verb: 'update',
          params: [{ name: 'pollIntervalMs', kind: 'number' }] },
      ],
      views: [{
        id: 'settings', title: 'Settings', type: 'settings-record', shape: 'record',
        fields: [
          { name: 'pollIntervalMs', type: 'number',
            patch: { opId: 'updateSettings', argName: 'pollIntervalMs',
                     argWrapper: '' } },
        ],
      }],
    });
    const settings = nav.sections.find((s) => s.id === 'settings');
    expect(settings.fields[0].patch).toEqual({
      opId: 'updateSettings', argName: 'pollIntervalMs',
    });
    expect(settings.fields[0].patch).not.toHaveProperty('argWrapper');
  });
});

describe('renderWeb V0.7 — Q26 field.requiresField conditional display', () => {
  // B.2.4 signal: pod-settings groupPodUri only meaningful when
  // policy ∈ {centralised, hybrid}. declares the gate; adapter
  // hides the field when policy is 'personal'.
  const MANIFEST = {
    app:       'cond-rec',
    itemTypes: ['storage-rec'],
    operations: [
      { id: 'getPolicy',    verb: 'read', params: [] },
      { id: 'updatePolicy', verb: 'update',
        params: [{ name: 'policy', kind: 'string' },
                 { name: 'groupPodUri', kind: 'string' }] },
    ],
    views: [{
      id: 'pod-settings', title: 'Pod settings', type: 'storage-rec', shape: 'record',
      dataSource: { skillId: 'getPolicy' },
      fields: [
        { name: 'policy', type: 'enum', choices: ['personal', 'centralised', 'hybrid'],
          patch: { opId: 'updatePolicy', argName: 'policy' } },
        // Single-value gate.
        { name: 'groupPodUri', type: 'string', label: 'Group pod URI',
          requiresField: { policy: 'centralised' },
          patch: { opId: 'updatePolicy', argName: 'groupPodUri' } },
        // Array-value gate (OR within the key).
        { name: 'fallbackUri', type: 'string', label: 'Fallback URI',
          requiresField: { policy: ['centralised', 'hybrid'] } },
        // No gate — always shown.
        { name: 'displayName', type: 'string', label: 'Display name' },
      ],
    }],
  };

  it('Q26 — single-value requiresField projected verbatim', () => {
    const sec = renderWeb(MANIFEST).sections.find((s) => s.id === 'pod-settings');
    const f = sec.fields.find((x) => x.name === 'groupPodUri');
    expect(f.requiresField).toEqual({ policy: 'centralised' });
  });

  it('Q26 — array-value requiresField projected as defensive copy', () => {
    const sec = renderWeb(MANIFEST).sections.find((s) => s.id === 'pod-settings');
    const f = sec.fields.find((x) => x.name === 'fallbackUri');
    expect(f.requiresField).toEqual({ policy: ['centralised', 'hybrid'] });
    // Mutating projected gate must NOT touch the manifest.
    f.requiresField.policy.push('personal');
    expect(MANIFEST.views[0].fields[2].requiresField.policy).toEqual(['centralised', 'hybrid']);
  });

  it('Q26 — absent requiresField leaves no key on the projection', () => {
    const sec = renderWeb(MANIFEST).sections.find((s) => s.id === 'pod-settings');
    const f = sec.fields.find((x) => x.name === 'displayName');
    expect(f).not.toHaveProperty('requiresField');
  });
});

describe('renderWeb V0.7 — Q25 field.readSkill multi-skill records', () => {
  // E.4 signal: stoop's holidayMode is reachable both via getMyProfile
  // AND via dedicated getHolidayMode. declares the dedicated skill
  // so the adapter can refresh single fields without re-fetching the
  // whole record.
  const MANIFEST = {
    app:       'multi-rec',
    itemTypes: ['profile-record'],
    operations: [
      { id: 'getMyProfile',  verb: 'read', params: [] },
      { id: 'getHolidayMode', verb: 'read', params: [] },
      { id: 'updateProfile',  verb: 'update',
        params: [{ name: 'holidayMode', kind: 'boolean' }] },
    ],
    views: [{
      id: 'profile', title: 'Profile', type: 'profile-record', shape: 'record',
      dataSource: { skillId: 'getMyProfile' },
      fields: [
        // Field with readSkill — adapter calls getHolidayMode for value.
        { name:  'holidayMode', type: 'boolean', label: 'Vakantiemodus',
          readSkill: { skillId: 'getHolidayMode' },
          patch:     { opId: 'updateProfile', argName: 'holidayMode' } },
        // Field WITHOUT readSkill — adapter reads from record value.
        { name:  'handle', type: 'string', label: 'Handle' },
      ],
    }],
  };

  it('Q25 — readSkill projected verbatim onto section.fields[]', () => {
    const profile = renderWeb(MANIFEST).sections.find((s) => s.id === 'profile');
    const f = profile.fields.find((x) => x.name === 'holidayMode');
    expect(f.readSkill).toEqual({ skillId: 'getHolidayMode' });
  });

  it('Q25 — absent readSkill leaves no key on the projection', () => {
    const profile = renderWeb(MANIFEST).sections.find((s) => s.id === 'profile');
    const f = profile.fields.find((x) => x.name === 'handle');
    expect(f).not.toHaveProperty('readSkill');
  });

  it('Q25 — readSkill.args carried through as a defensive copy', () => {
    const M = {
      app:       'cx',
      itemTypes: ['rec'],
      operations: [
        { id: 'getOne',     verb: 'read', params: [] },
        { id: 'getRecord',  verb: 'read', params: [] },
      ],
      views: [{
        id: 'r', title: 'R', type: 'rec', shape: 'record',
        dataSource: { skillId: 'getRecord' },
        fields: [
          { name: 'lang', type: 'string',
            readSkill: { skillId: 'getOne', args: { locale: 'nl' } } },
        ],
      }],
    };
    const r = renderWeb(M).sections.find((s) => s.id === 'r');
    expect(r.fields[0].readSkill).toEqual({
      skillId: 'getOne',
      args:    { locale: 'nl' },
    });
    // Mutating projected args must NOT touch the manifest.
    r.fields[0].readSkill.args.locale = 'en';
    expect(M.views[0].fields[0].readSkill.args.locale).toBe('nl');
  });
});

describe('renderWeb V0.6 — Q23 field.type file / image', () => {
  // documents the recognized field.type set + adds `'file'` and
  // `'image'` for byte-shaped fields.  Substrate passes them through
  // verbatim; the dispatch contract (consumer-side transform) is
  // documented in JSDoc.
  const MANIFEST = {
    app:       'media-rec',
    itemTypes: ['profile-record'],
    operations: [
      { id: 'setAvatar', verb: 'update',
        params: [{ name: 'avatar', kind: 'object' }] },
      { id: 'attachDoc', verb: 'update',
        params: [{ name: 'doc', kind: 'object' }] },
    ],
    views: [{
      id: 'profile', title: 'Profile', type: 'profile-record', shape: 'record',
      fields: [
        { name: 'avatar', type: 'image', label: 'Avatar',
          patch: { opId: 'setAvatar', argName: 'avatar' } },
        { name: 'doc',    type: 'file',  label: 'Document',
          patch: { opId: 'attachDoc', argName: 'doc' } },
      ],
    }],
  };

  it("Q23 — field.type: 'image' is passed through verbatim", () => {
    const profile = renderWeb(MANIFEST).sections.find((s) => s.id === 'profile');
    const avatar  = profile.fields.find((f) => f.name === 'avatar');
    expect(avatar.type).toBe('image');
    expect(avatar.patch).toEqual({ opId: 'setAvatar', argName: 'avatar' });
  });

  it("Q23 — field.type: 'file' is passed through verbatim", () => {
    const profile = renderWeb(MANIFEST).sections.find((s) => s.id === 'profile');
    const doc     = profile.fields.find((f) => f.name === 'doc');
    expect(doc.type).toBe('file');
    expect(doc.patch).toEqual({ opId: 'attachDoc', argName: 'doc' });
  });
});

describe('renderWeb V0.8 — Q27 confirm severity hint', () => {
  // Manifest with confirm on each label-bearing surface: an affordance
  // (creative verb, section placement), an item-action (state-gated),
  // and a section-header CTA (placement).
  const MANIFEST = {
    app:       'destructive-rec',
    itemTypes: ['note'],
    operations: [
      {
        id:        'addNote',
        verb:      'add',
        params:    [{ name: 'text', kind: 'string' }],
        appliesTo: { type: 'note' },
        surfaces:  { ui: { label: 'Add note' } },
      },
      {
        id:        'archiveNote',
        verb:      'archive',
        params:    [],
        appliesTo: { type: 'note', state: 'open' },
        surfaces:  { ui: { label: 'Archive',
                           confirm: { severity: 'warn',
                                      message: 'Archived notes hide from the list.' } } },
      },
      {
        id:        'deleteNote',
        verb:      'remove',
        params:    [],
        appliesTo: { type: 'note', state: ['open', 'archived'] },
        surfaces:  { ui: { label: 'Delete',
                           confirm: { severity: 'danger',
                                      message: 'Permanently deletes the note.' } } },
      },
      {
        id:        'clearAll',
        verb:      'clear',
        params:    [],
        appliesTo: { type: 'note' },
        surfaces:  { ui: { label: 'Clear all',
                           placement: 'section-header',
                           confirm: { severity: 'warn' } } },
      },
    ],
    views: [{ id: 'notes', title: 'Notes', type: 'note' }],
  };

  it('Q27 — itemAction surfaces confirm with severity + message', () => {
    const sec = renderWeb(MANIFEST).sections.find((s) => s.id === 'notes');
    const archive = sec.itemActions.find((a) => a.opId === 'archiveNote');
    expect(archive.confirm).toEqual({
      severity: 'warn',
      message:  'Archived notes hide from the list.',
    });
  });

  it('Q27 — itemAction surfaces confirm with severity: danger', () => {
    const sec = renderWeb(MANIFEST).sections.find((s) => s.id === 'notes');
    const del = sec.itemActions.find((a) => a.opId === 'deleteNote');
    expect(del.confirm.severity).toBe('danger');
  });

  it('Q27 — section-header CTA surfaces confirm (no message — severity only)', () => {
    const sec = renderWeb(MANIFEST).sections.find((s) => s.id === 'notes');
    const clear = sec.sectionActions.find((a) => a.opId === 'clearAll');
    expect(clear.confirm).toEqual({ severity: 'warn' });
    // No message — assert no spurious key.
    expect(clear.confirm).not.toHaveProperty('message');
  });

  it('Q27 — absent confirm leaves no key on the projection', () => {
    const sec = renderWeb(MANIFEST).sections.find((s) => s.id === 'notes');
    const add = sec.affordances.find((a) => a.opId === 'addNote');
    expect(add).not.toHaveProperty('confirm');
  });
});

describe('renderWeb V0.6 — Q22 labelKey localisation passthrough', () => {
  // Manifest with labelKey on every label-bearing surface: an op-level
  // affordance, an item-action op (state-gated), and a field on a
  // record-shape view.  The projector must pass labelKey through
  // unchanged on each surface; absent labelKey leaves NavModel
  // identical to (no extra key).
  const MANIFEST = {
    app:       'localisation-rec',
    itemTypes: ['task', 'settings-record'],
    operations: [
      {
        id:     'addTask',
        verb:   'add',
        params: [{ name: 'text', kind: 'string' }],
        appliesTo: { type: 'task' },
        surfaces: { ui: { label: 'Add task', labelKey: 'task.add' } },
      },
      {
        id:        'claim',
        verb:      'claim',
        params:    [],
        appliesTo: { type: 'task', state: 'open' },
        surfaces:  { ui: { label: 'Claim', labelKey: 'task.claim' } },
      },
      {
        id:     'updateSettings',
        verb:   'update',
        params: [{ name: 'language', kind: 'string' }],
      },
    ],
    views: [
      { id: 'tasks', title: 'Tasks', type: 'task' },
      {
        id: 'settings', title: 'Settings', type: 'settings-record', shape: 'record',
        fields: [
          {
            name:     'language', type: 'enum', choices: ['nl', 'en'],
            label:    'Taal',          // Dutch fallback
            labelKey: 'settings.language',
            patch:    { opId: 'updateSettings', argName: 'language' },
          },
          // No labelKey — fallback to label only.
          { name: 'foo', type: 'string', label: 'Foo' },
        ],
      },
    ],
  };

  it('Q22 — affordance carries labelKey alongside label', () => {
    const tasks = renderWeb(MANIFEST).sections.find((s) => s.id === 'tasks');
    const add = tasks.affordances.find((a) => a.opId === 'addTask');
    expect(add.label).toBe('Add task');
    expect(add.labelKey).toBe('task.add');
  });

  it('Q22 — itemAction carries labelKey alongside label', () => {
    const tasks = renderWeb(MANIFEST).sections.find((s) => s.id === 'tasks');
    const claim = tasks.itemActions.find((a) => a.opId === 'claim');
    expect(claim.label).toBe('Claim');
    expect(claim.labelKey).toBe('task.claim');
  });

  it('Q22 — record field carries labelKey alongside label', () => {
    const settings = renderWeb(MANIFEST).sections.find((s) => s.id === 'settings');
    const lang = settings.fields.find((f) => f.name === 'language');
    expect(lang.label).toBe('Taal');
    expect(lang.labelKey).toBe('settings.language');
  });

  it('Q22 — absent labelKey leaves no key on the projection', () => {
    const settings = renderWeb(MANIFEST).sections.find((s) => s.id === 'settings');
    const foo = settings.fields.find((f) => f.name === 'foo');
    expect(foo.label).toBe('Foo');
    expect(foo).not.toHaveProperty('labelKey');
  });
});

describe("renderWeb V0.4 — Q19 surfaces.ui.placement: 'section-header'", () => {
  const MANIFEST = {
    app:       'cta',
    itemTypes: ['inbox-item'],
    operations: [
      // Section-scope CTA (e.g. clear all).
      {
        id:        'clearInbox',
        verb:      'remove',
        appliesTo: { type: 'inbox-item' },
        params:    [],
        surfaces:  { ui: { control: 'button', label: 'Clear all', placement: 'section-header' } },
      },
      // Per-row item action — should still go to itemActions.
      {
        id:        'clearInboxItem',
        verb:      'remove',
        appliesTo: { type: 'inbox-item' },
        params:    [{ name: 'id', kind: 'string', required: true }],
        surfaces:  { ui: { control: 'button', label: 'Dismiss' } },
      },
    ],
    views: [
      { id: 'inbox', title: 'Inbox', type: 'inbox-item' },
    ],
  };

  it("ops with placement === 'section-header' surface in section.sectionActions[]", () => {
    const nav = renderWeb(MANIFEST);
    const inbox = nav.sections.find((s) => s.id === 'inbox');
    expect(inbox.sectionActions).toHaveLength(1);
    expect(inbox.sectionActions[0]).toMatchObject({
      opId: 'clearInbox', label: 'Clear all', placement: 'section-header',
    });
  });

  it("ops with default placement still go to itemActions[]", () => {
    const nav = renderWeb(MANIFEST);
    const inbox = nav.sections.find((s) => s.id === 'inbox');
    expect(inbox.itemActions.map((a) => a.opId)).toContain('clearInboxItem');
    // Section-header op NOT in itemActions.
    expect(inbox.itemActions.map((a) => a.opId)).not.toContain('clearInbox');
  });

  it("section.sectionActions is ABSENT when no section-header ops match", () => {
    const nav = renderWeb({
      app: 'noheader', itemTypes: ['task'], operations: [], views: [
        { id: 'v', title: 'V', type: 'task' },
      ],
    });
    const section = nav.sections.find((s) => s.id === 'v');
    expect(section).not.toHaveProperty('sectionActions');
  });

  it("section-header op does NOT also land in globals[]", () => {
    const nav = renderWeb(MANIFEST);
    expect(nav.globals.map((g) => g.opId)).not.toContain('clearInbox');
  });
});

describe("renderWeb V0.3 — Q17 view.shape: 'record'", () => {
  const MANIFEST = {
    app:       'rec',
    itemTypes: ['settings-record', 'task'],
    operations: [],
    views: [
      { id: 'settings', title: 'Settings', type: 'settings-record',
        shape: 'record',
        dataSource: { skillId: 'getSettings' } },
      { id: 'tasks', title: 'Tasks', type: 'task' },              // implicit 'list'
      { id: 'explicit-list', title: 'Explicit list', type: 'task',
        shape: 'list' },
    ],
  };

  it("section.shape is set to 'record' when view.shape === 'record'", () => {
    const nav = renderWeb(MANIFEST);
    const settings = nav.sections.find((s) => s.id === 'settings');
    expect(settings.shape).toBe('record');
  });

  it("section.shape is ABSENT when view.shape is undefined (default 'list')", () => {
    const nav = renderWeb(MANIFEST);
    const tasks = nav.sections.find((s) => s.id === 'tasks');
    expect(tasks).not.toHaveProperty('shape');
  });

  it("section.shape is ABSENT when view.shape === 'list' (avoid noise; default is implicit)", () => {
    const nav = renderWeb(MANIFEST);
    const ex = nav.sections.find((s) => s.id === 'explicit-list');
    expect(ex).not.toHaveProperty('shape');
  });
});

describe("renderWeb V0.2 — Q8 appliesTo.type: '*' wildcard", () => {
  it('wildcard op surfaces as itemAction in EVERY section', () => {
    const nav = renderWeb(V02_SYNTH);
    for (const section of nav.sections) {
      const ids = section.itemActions.map((a) => a.opId);
      expect(ids, `section ${section.id} should include cancelAny`).toContain('cancelAny');
    }
  });

  it('wildcard with state preserves state gate', () => {
    const nav = renderWeb(V02_SYNTH);
    const asks = nav.sections.find((s) => s.id === 'mine-asks');
    const archive = asks.itemActions.find((a) => a.opId === 'archiveOpen');
    expect(archive.appliesTo).toEqual({ type: '*', state: 'open' });
  });

  it('wildcard itemAction has appliesTo.type preserved as "*" (NOT narrowed to view.type)', () => {
    const nav = renderWeb(V02_SYNTH);
    const tasks = nav.sections.find((s) => s.id === 'tasks');
    const cancel = tasks.itemActions.find((a) => a.opId === 'cancelAny');
    expect(cancel.appliesTo.type).toBe('*');
  });

  it('wildcard op does NOT get prefilledParams (it is type-agnostic)', () => {
    const nav = renderWeb(V02_SYNTH);
    const asks = nav.sections.find((s) => s.id === 'mine-asks');
    const cancel = asks.itemActions.find((a) => a.opId === 'cancelAny');
    expect(cancel).not.toHaveProperty('prefilledParams');
  });

  it('single-type op (submitTask) still only appears in matching section', () => {
    const nav = renderWeb(V02_SYNTH);
    const tasks = nav.sections.find((s) => s.id === 'tasks');
    const asks  = nav.sections.find((s) => s.id === 'mine-asks');
    expect(tasks.itemActions.map((a) => a.opId)).toContain('submitTask');
    expect(asks.itemActions.map((a) => a.opId)).not.toContain('submitTask');
  });
});

/* ─── D / — surfaces.page → NavModel.pages[] ─────────────────── */

// A manifest whose ops declare `surfaces.page` (the -validated shape).
const PAGE_SYNTH = {
  app: 'pagey',
  itemTypes: [],
  views: [],
  operations: [
    {
      id: 'settings', verb: 'list',
      surfaces: {
        slash: { command: '/settings' },
        chat:  { hint: 'open Settings in a side panel' },
        page:  { kind: 'side-panel', title: 'Settings' },
      },
    },
    {
      id: 'restore', verb: 'do',
      surfaces: { page: { kind: 'modal', title: 'Restore identity', route: '/restore' } },
    },
    // No page surface → must NOT appear in pages[].
    { id: 'noop', verb: 'do', surfaces: { chat: { hint: 'x' } } },
  ],
};

describe('renderWeb — pages (D / SP-3b, surfaces.page)', () => {
  it('projects one Page per op with surfaces.page, in declaration order', () => {
    const nav = renderWeb(PAGE_SYNTH);
    expect(nav.pages.map((p) => p.opId)).toEqual(['settings', 'restore']);
  });

  it('passes kind + title through verbatim', () => {
    const nav = renderWeb(PAGE_SYNTH);
    const settings = nav.pages.find((p) => p.opId === 'settings');
    expect(settings).toEqual({ opId: 'settings', kind: 'side-panel', title: 'Settings' });
  });

  it('carries the mobile `route` so the same projection feeds renderMobile', () => {
    const nav = renderWeb(PAGE_SYNTH);
    const restore = nav.pages.find((p) => p.opId === 'restore');
    expect(restore).toEqual({ opId: 'restore', kind: 'modal', title: 'Restore identity', route: '/restore' });
  });

  it('OMITS the pages key entirely when no op declares surfaces.page (shape unchanged)', () => {
    const nav = renderWeb({ app: 'empty', itemTypes: [], views: [], operations: [] });
    expect(nav).not.toHaveProperty('pages');
    expect(nav).toEqual({ app: 'empty', sections: [], globals: [] });
  });

  it('passes an optional labelKey through (Q22 localisation discipline)', () => {
    const nav = renderWeb({
      app: 'l', itemTypes: [], views: [],
      operations: [{ id: 's', verb: 'list', surfaces: { page: { kind: 'screen', title: 'S', labelKey: 'circle.settings.title' } } }],
    });
    expect(nav.pages[0]).toEqual({ opId: 's', kind: 'screen', title: 'S', labelKey: 'circle.settings.title' });
  });
});
