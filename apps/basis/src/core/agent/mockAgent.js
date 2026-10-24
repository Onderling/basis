/**
 * basis — mock household agent (test fixture).
 *
 * Originally the v0.1.4 web-demo backend.  Post slices 1 / 2b / 4
 * (2026-05-23), the production basis boots a REAL household
 * via `realAgent.js` (the `hostAgent` registers chores skills
 * directly on the shared InternalBus); this file's role narrowed
 * to a lightweight test fixture for `mockAgent.test.js` + a
 * declarative `mockHouseholdManifest` that `realAgent.js` returns
 * as its `.manifest` field for chat-shell routing.
 *
 * Slash-binding manifests for tasks-v0 / pinboard / folio used to
 * live alongside this fixture; they moved to `mockManifests.js`
 * in the slice-4 polish pass (file was 60% manifest declarations).
 *
 * Public surface (do not remove without checking callsites):
 *   - `mockHouseholdManifest`     — used as household's manifest
 *                                   declaration by realAgent.js
 *   - `createMockHouseholdAgent`  — fixture for mockAgent.test.js
 */

/**
 * @typedef {object} MockChore
 * @property {string} id
 * @property {string} label
 * @property {'chore'} type
 * @property {'open' | 'done'} state
 */

const SEED_CHORES = [
  { id: 'c-1', label: 'Dishwasher',         type: 'chore', state: 'open' },
  { id: 'c-2', label: 'Bins out',           type: 'chore', state: 'open' },
  { id: 'c-3', label: 'Vacuum living room', type: 'chore', state: 'open' },
];

/**
 * Household manifest for the demo.  Mirrors the production household
 * manifest's relevant ops; declarations only — the mock agent
 * provides the skill implementations.
 */
// household list types (shopping/errand/repair/schedule) — the real household app's `addItem`
// feature, now surfaced in the circle so the bot can drive shopping lists etc. (not just chores).
export const HH_LIST_TYPES = ['shopping', 'errand', 'repair', 'schedule'];

export const mockHouseholdManifest = {
  app:        'household',
  itemTypes:  ['chore', ...HH_LIST_TYPES],
  operations: [
    {
      id:    'listOpenItems',
      verb:  'list',
      params: [
        // Optional: a specific household list to show. Omit → open chores (back-compat).
        { name: 'type', kind: 'enum', of: ['chore', ...HH_LIST_TYPES], required: false },
      ],
      surfaces: {
        // Part C gate — "list/show/mine" → listOpen (no arg).
        slash: { command: '/mine',
          match: { verbs: ['list', 'show', 'mine', 'lijst', 'toon'], body: 'none' } },
        chat:  { reply: 'list', hint: 'List open household items. Omit type for chores, or pass a list to show it: shopping, errand, repair, or schedule (e.g. "what is on the shopping list?" → listOpen type=shopping).' },
      },
    },
    {
      id:    'addItem',
      verb:  'add',
      params: [
        { name: 'type', kind: 'enum',   of: HH_LIST_TYPES, required: true },
        { name: 'text', kind: 'string', required: true },
      ],
      surfaces: {
        // A DISTINCT slash (no gate `match`): the deterministic "add" verb already routes to a TASK, so
        // this op is reached via the LLM path (free text → the right household list) or `/add-item`.
        slash: { command: '/add-item' },
        chat:  { reply: 'text', hint: 'Add an item to a household LIST: shopping, errand, repair, or schedule. Use this for shopping/grocery/list requests — e.g. "put bread on the shopping list" → addItem(type=shopping, text=bread); "add milk to the groceries" → addItem(type=shopping, text=milk).' },
      },
    },
    {
      id:        'markComplete',
      verb:      'complete',
      appliesTo: { type: 'chore', state: ['open'] },     // array form is canonical (matches tasks-v0/calendar/pinboard)
      params:    [{
        name: 'choreId', kind: 'string', required: true,
        // bare `/done` → list open chores; click row → done.
        pickerSource: { listOp: 'listOpenItems' },
      }],
      surfaces:  {
        // Part C gate — "done X" / "klaar met X" → markComplete{choreId} (choreId has pickerSource).
        slash: { command: '/done',
          match: { verbs: [['klaar', 'met'], 'done', 'complete', 'did', 'finished', 'bought', 'klaar', 'gedaan', 'gekocht'], body: 'match', arg: 'choreId', splitItems: true } },
        chat:  { reply: 'text', hint: 'mark a chore complete' },
        ui:    { control: 'button', label: 'Mark done' },
      },
    },
    /**
     * `/profile` — record-shape demo.  Returns a household profile
     * blob so the chat shell can showcase the v0.3.1 `record` reply
     * rendering with title bar + field rows + [Close] button.
     */
    {
      id:    'getProfile',
      verb:  'list',
      params: [],
      surfaces: {
        slash: { command: '/profile' },
        chat:  { reply: 'record', hint: 'show household profile' },
      },
    },
    /**
     * `/addmember <name>` — household membership demo. follow-up:
     * after adding a member, suggest sharing a folio folder with them
     * (cross-app chain registered in followUps.js, but this op also
     * declares an in-app follow-up — viewing the chore list — so we
     * cover both cases in the demo).
     */
    {
      id:    'addMember', verb: 'add',
      params: [{ name: 'name', kind: 'string', required: true }],
      surfaces: {
        // Part C gate — "register X" / "add member X" → addMember{name}.
        slash: { command: '/addmember',
          match: { verbs: ['register', ['add', 'member'], 'registreer', 'naam', ['lid', 'toevoegen']], body: 'text-only', arg: 'name' } },
        chat:  {
          reply: 'text', hint: 'add a member to the household',
          followUps: [
            { opId: 'listOpenItems' },   // same-app follow-up
          ],
        },
      },
    },
    /**
     * v0.7.cc — `/add-chore <label>` — add a new chore.  Mirrors the
     * native household app's `addItem`; in basis command-first
     * shape it's an explicit verb (the LLM-driven NL path lands in v0.8).
     */
    {
      id:    'addChore', verb: 'add',
      params: [{ name: 'label', kind: 'string', required: true }],
      surfaces: {
        // Part C gate — "add X" / "voeg X toe" → addChore{label}; drops a "… to/op the list" clause.
        slash: { command: '/add-chore',
          match: { verbs: ['add', ['new', 'chore'], 'toevoegen', 'noteer', ['voeg', 'toe']], body: 'text-only', arg: 'label', dropTrailing: ['to', 'op', 'aan', 'toe'], splitItems: true } },
        chat:  { reply: 'text', hint: 'add a new chore' },
      },
    },
    /**
     * v0.7.cc — `/nudge <peer> [<chore>]` — nudge a peer about a
     * pending chore.  Native app fires the nudge via the daily-digest
     * scheduler; chat-side this is an explicit verb.
     */
    {
      id:    'nudgePeer', verb: 'add',
      params: [
        { name: 'peer',  kind: 'string', required: true },
        { name: 'chore', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/nudge', body: 'flags' },
        chat:  { reply: 'text', hint: 'nudge a peer about a chore' },
      },
    },
    /**
     * v0.7.cc — `/remove-chore <id-or-label>` — destructive.
     * Two-step: first call returns a confirm prompt; second call
     * adds the `--confirm=true` flag (body:'flags' so both positional
     * id + boolean flag parse together).
     */
    {
      id:    'removeChore', verb: 'remove',
      params: [
        {
          name: 'choreId', kind: 'string', required: true,
          pickerSource: { listOp: 'listOpenItems' },
        },
        { name: 'confirm', kind: 'boolean', required: false },
      ],
      surfaces: {
        // Part C gate — "remove X" → removeChore{choreId}; bare 'cancel' is calendar.cancelEvent's.
        slash: { command: '/remove-chore', body: 'flags',
          match: { verbs: ['remove', 'delete', 'nope', 'verwijder', 'weg'], body: 'match', arg: 'choreId', splitItems: true } },
        chat:  { reply: 'text', hint: 'remove a chore (asks to confirm)' },
      },
    },
    /**
     * (v0.5) — `getChoreSnapshot` produces an ItemSnapshot for
     * the J7 embed primitive.  Declared on the household manifest so
     * markComplete-style ops can be embedded into chat messages.
     */
    {
      id:    'getChoreSnapshot', verb: 'list',
      params: [{ name: 'choreId', kind: 'string', required: true }],
      surfaces: {
        chat: { hint: 'snapshot a chore for embedding' },
      },
    },
    // Mark `markComplete` as embeddable: the embed primitive will
    // call getChoreSnapshot to produce the snapshot.
  ],
  views: [{ id: 'chores', title: 'Chores', type: 'chore' }],
};

// Attach declaratively post-manifest-definition: markComplete's
// embed-card factory is getChoreSnapshot.  This keeps the manifest
// definition above readable while still wiring for the demo.
mockHouseholdManifest.operations.find((o) => o.id === 'markComplete')
  .surfaces.chat.embed = { cardSnapshotSkill: 'getChoreSnapshot' };

// v0.7 — brief-summary decl on household's list op. /brief fans
// across these to produce the morning brief. Pinboard / folio +
// augmentations live in `mockManifests.js`.
mockHouseholdManifest.operations.find((o) => o.id === 'listOpenItems')
  .surfaces.chat.brief = {
    summarySkill: 'briefSummary',
    order:        10,
    label:        'Lists',   // K0: household = the simple-LISTS app (vs tasks = graphs)
  };

// v0.7.5 — search decl on household's list op.
mockHouseholdManifest.operations.find((o) => o.id === 'listOpenItems')
  .surfaces.chat.search = { searchSkill: 'searchChores' };

/**
 * Build a mock agent: returns `{ manifest, callSkill, reset }`.
 *
 * @param {object} [opts]
 * @param {MockChore[]} [opts.seed]   override initial chore list
 * @returns {{ manifest: object, callSkill: Function, reset: Function, state: () => MockChore[] }}
 */
export function createMockHouseholdAgent(opts = {}) {
  /** @type {MockChore[]} */
  let chores = (opts.seed ?? SEED_CHORES).map((c) => ({ ...c }));

  const callSkill = async (appOrigin, opId, args) => {
    if (appOrigin !== 'household') {
      throw new Error(`mock agent: unknown appOrigin "${appOrigin}"`);
    }
    if (opId === 'listOpenItems') {
      return { items: chores.filter((c) => c.state === 'open') };
    }
    if (opId === 'getProfile') {
      const open = chores.filter((c) => c.state === 'open').length;
      const done = chores.filter((c) => c.state === 'done').length;
      return {
        title:        'Household',
        name:         'Casa de Demo',
        openChores:   open,
        doneChores:   done,
        memberCount:  3,
        polite:       true,
        established:  '2026-05-21',
      };
    }
    if (opId === 'addMember') {
      const name = String(args?.name ?? '').trim();
      if (!name) return { ok: false, error: 'name required' };
      return { ok: true, message: `✓ Added member: ${name}`, memberName: name };
    }
    if (opId === 'getChoreSnapshot') {
      const id = args?.choreId;
      const target = chores.find((c) => c.id === id);
      if (!target) return { ok: false, error: `No chore with id "${id}".` };
      return {
        id:    target.id,
        type:  target.type,
        state: target.state,
        title: target.label,
        fields: {
          state: target.state,
          assigned_to: 'unassigned',
        },
      };
    }
    if (opId === 'markComplete') {
      const id = args?.choreId;
      const target = chores.find((c) => c.id === id);
      if (!target) {
        return { ok: false, error: `No chore with id "${id}".` };
      }
      if (target.state === 'done') {
        return { ok: false, error: `Chore "${target.label}" is already done.` };
      }
      target.state = 'done';
      return {
        ok:      true,
        message: `✓ Done: ${target.label}`,
        itemId:  target.id,
      };
    }
    throw new Error(`mock agent: unknown opId "${opId}"`);
  };

  return {
    manifest: mockHouseholdManifest,
    callSkill,
    reset() { chores = (opts.seed ?? SEED_CHORES).map((c) => ({ ...c })); },
    state() { return chores.map((c) => ({ ...c })); },
  };
}
