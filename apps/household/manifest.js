/**
 * household — app manifest.
 *
 * (proven byte-equivalent, see `test/manifest-equivalence.test.js`):
 * the five user-facing operations (addItem, listOpen, markComplete,
 * removeItem, help) reproduce the pre-manifest hand-catalogues exactly
 * (V0_TOOL_CATALOGUE + SYSTEM_PROMPT_CLASSIFY + regexParse grammar).
 *
 * (this delta, owner-approved 2026-05-19): household grows tasks +
 * named members.  Adds canonical `task` + `contact` item types, five new
 * operations (addTask, listTasks, claim, reassign, registerName) and
 * two views (tasks, members). The surface stays byte-equal because
 * `addItem`/`listOpen` declare their type enum **explicitly** (not via
 * the `'itemTypes'` reference) — growing the manifest's itemTypes does
 * not affect their emitted JSON Schema.
 *
 * F-SP1-a — `shopping`/`errand`/`repair`/`schedule` are app-local types
 *           (no canonical schema in `@onderling/item-types`); permitted by
 *           `validateManifest`.
 * F-SP1-b — slash grammar spec covers EN/NL aliases, multi-word verb
 *           phrases ("voeg toe"), specials, item splitting.
 * F-SP1-c — string params use `schema: { minLength: 1 }` for
 *           byte-equivalence with V0_TOOL_CATALOGUE.
 * F-SP1-d — `systemPrompt` is re-exported from `src/llm/prompts.js`.
 * F-SP1-e — `help` and `register` are non-canonical verbs (app-specific).
 * F-SP2-a — `'text-only'` body kind in `surfaces.slash.match` (whole
 *           body → `args.text`), for `addTask` and `registerName`.
 */

import { SYSTEM_PROMPT_CLASSIFY } from './src/llm/prompts.js';

const STR_NONEMPTY = { schema: { minLength: 1 } };

// Frozen list-item types — declared explicitly so the
// byte-equivalence gate holds even after the manifest grows new
// canonical itemTypes for (and beyond).
const LIST_TYPES = ['shopping', 'errand', 'repair', 'schedule'];

/** @type {import('@onderling/app-manifest').__types__} */
export const householdManifest = {
  app:       'household',
  itemTypes: [...LIST_TYPES, 'task', 'contact', 'note'],

  // B · Layer 1 — domain (non-atom) verbs this manifest ships (F-SP1-e).
  // `help` (meta) + `register` (identity act, not a plain `add contact`) +
  // `enroll-device` (the add-a-device ceremony — an identity act on the host).
  // Every other op maps to an SDK atom; the `{atoms:true}` validator enforces it.
  // The ceremonies and the authority grants are their own verbs on purpose. None of them maps onto an SDK
  // atom without lying: revealing a recovery phrase is not a `list`, and granting a connection the right to
  // act as you is not an `add`. Declaring them here is what the atom-discipline guard asks for — it refuses
  // an undeclared verb rather than letting one drift in under a borrowed atom.
  domainVerbs: [
    'help', 'register',
    'enroll-device', 'revoke-device', 'reveal-owner-phrase', 'restore-owner-phrase',
    'grant-surface', 'revoke-surface', 'list-surface-grants',
  ],

  // B · Layer 1 — the (verb × noun) capability surface (PLAN-capability-arc.md).
  // Each key is one of `itemTypes`; each `atoms` entry is a CANONICAL SDK atom
  // verb (not an alias) from `@onderling/app-manifest`'s ATOM catalogue.  This is
  // the forward-additive declaration the atom-validator keys off — `add` is ONE
  // atom resolved per noun (addItem for the list nouns, addTask for `task`),
  // both now routed through the single shared `createHouseholdItem` create path.
  nouns: {
    shopping: { atoms: ['add', 'list', 'complete', 'remove'] },
    errand:   { atoms: ['add', 'list', 'complete', 'remove'] },
    repair:   { atoms: ['add', 'list', 'complete', 'remove'] },
    schedule: { atoms: ['add', 'list', 'complete', 'remove'] },
    task:     { atoms: ['add', 'list', 'complete', 'remove', 'claim', 'reassign'] },
    contact:  { atoms: [] },   // only the `register` domain verb
    // §1b "declare a noun → get CRUD free" — a free-form circle note. Declares CRUD atoms with NO
    // implementing op: `createHouseholdService.callCapability` serves it via `createGenericAtomHandlers`
    // over the per-circle CircleItemStore (zero handler code). This is the live proof that a new noun
    // added to a manifest becomes storable + gate-able at once (docs/architecture.md L84).
    note:     { atoms: ['add', 'list', 'get', 'remove'] },
  },

  // F-SP1-d: verbatim, sourced from the same module classifyAndExtract reads.
  systemPrompt: SYSTEM_PROMPT_CLASSIFY,

  operations: [
    // ── ops (byte-equal to V0_TOOL_CATALOGUE) ────────────────────
    {
      id:   'addItem', group: 'compose',
      verb: 'add',
      params: [
        { name: 'type', kind: 'enum',   of: LIST_TYPES, required: true },
        { name: 'text', kind: 'string', required: true, ...STR_NONEMPTY  },
      ],
      surfaces: {
        chat:  { hint: 'Add an item to a household LIST — type is one of shopping, errand, repair, schedule. Use this for "add X to the shopping/groceries/errand/repair list".' },
        slash: {
          command: '/add',
          match: {
            verbs:      ['add', 'toevoegen', 'noteer', ['voeg', 'toe']],
            body:       'type+text',
            splitItems: true,
            onEmpty:    { skillId: 'help', args: {} },
          },
        },
      },
    },
    {
      id:   'listOpen', group: 'data',
      verb: 'list',
      params: [
        { name: 'type', kind: 'enum', of: LIST_TYPES, required: true },
      ],
      surfaces: {
        chat:  {
          hint: 'List open items of a type.',
          // household's slot in the morning brief. /brief fans
          // across apps that declare `surfaces.chat.brief`; the
          // `household_briefSummary` skill (skills/briefSummary.js)
          // returns a count of open items + the topmost row.
          brief: { summarySkill: 'household_briefSummary', order: 10, label: 'Household' },
        },
        slash: {
          command: '/list',
          match: {
            verbs:   ['list', 'show', 'lijst', 'toon'],
            body:    'type-only',
            onEmpty: { skillId: 'help', args: {} },
          },
        },
      },
    },
    {
      id:        'markComplete',
      verb:      'complete',
      // surface as per-item button across all list-type
      // sections + tasks.  Multi-type via F-SP3-a; safe vs renderChat
      // byte-equivalence (toolCatalogue ignores appliesTo).
      appliesTo: { type: [...LIST_TYPES, 'task'] },
      params: [
        { name: 'match', kind: 'string', required: true, ...STR_NONEMPTY },
      ],
      surfaces: {
        chat:  { hint: 'Mark an open item complete.  match = id, id-prefix, or keyword.' },
        slash: {
          command: '/done',
          match: {
            verbs:      ['done', 'complete', 'bought', 'did', 'finished',
                         'klaar', 'gedaan', 'gekocht'],
            body:       'match',
            splitItems: true,
            onEmpty:    { skillId: 'help', args: {} },
          },
        },
        ui: { control: 'button', label: 'Done' },   // web surface
      },
    },
    {
      id:        'removeItem',
      verb:      'remove',
      appliesTo: { type: [...LIST_TYPES, 'task'] },   // same as markComplete
      params: [
        { name: 'match', kind: 'string', required: true, ...STR_NONEMPTY },
      ],
      surfaces: {
        chat:  { hint: 'Hard-delete an item.' },
        slash: {
          command: '/remove',
          match: {
            verbs:      ['remove', 'delete', 'cancel', 'nope',
                         'verwijder', 'weg'],
            body:       'match',
            splitItems: true,
            onEmpty:    { skillId: 'help', args: {} },
          },
        },
        ui: { control: 'button', label: 'Remove' },  // web surface
      },
    },
    {
      id:   'help', group: 'help',
      verb: 'help',                              // F-SP1-e: non-canonical
      params: [],
      surfaces: {
        chat:  { hint: 'Print the command list.' },
        slash: {
          command: '/help',
          match:   { verbs: ['help', 'hulp'], body: 'none' },
          // Slash dedup (2026-06-19): `/help` stays for STANDALONE household (the
          // bot + the byte-equivalence grammar + the bare-command fallback
          // target). But in a merged circle the basis SHELL owns the global
          // `/help` (it introspects every app, including household), so this one
          // is NOT contributed to the unified catalogue — `standaloneOnly` makes
          // mergeManifests skip it (no /help collision). See manifestMerge.js.
          standaloneOnly: true,
        },
      },
    },

    // ── ops (tasks + contacts; co-equal to the list ops) ───────
    {
      id:        'addTask', group: 'compose',
      verb:      'add',
      appliesTo: { type: 'task' },
      params: [
        { name: 'text',     kind: 'string', required: true, ...STR_NONEMPTY },
        { name: 'assignee', kind: 'string' },                  // optional
        { name: 'dueAt',    kind: 'number' },                  // optional
      ],
      surfaces: {
        chat:  { hint: 'Add a CHORE/TASK to do (assignable, has a due date) — NOT a shopping/errand/repair/schedule list item (use addItem for those).' },
        slash: {
          command: '/task',
          match: {
            verbs:      ['task', 'taak'],
            body:       'text-only',                         // F-SP2-a
            splitItems: true,
            onEmpty:    { skillId: 'help', args: {} },
          },
        },
      },
    },
    {
      id:        'listTasks', group: 'data',
      verb:      'list',
      appliesTo: { type: 'task' },
      params: [],
      surfaces: {
        chat:  { hint: 'List open tasks.' },
        slash: {
          command: '/tasks',
          match: { verbs: ['tasks', 'tasks'], body: 'none' },
        },
      },
    },
    {
      id:        'claim',
      verb:      'claim',
      appliesTo: { type: 'task', state: ['open'] },     // array form is canonical (matches tasks-v0/calendar/stoop)
      // DECLARATION LAYER (#34) — grabbing a household task writes `assignee` under the CLAIM policy
      // (first-wins). Same declared (task, assignee)→claim the receiver enforces for every app's task.
      resolves: [{ field: 'assignee', policy: 'claim' }],
      params: [
        { name: 'match', kind: 'string', required: true, ...STR_NONEMPTY },
      ],
      surfaces: {
        chat:  { hint: 'Grab an open task to do it.  match = id, id-prefix, or keyword.' },
        slash: {
          // `/grab` (not `/claim`): in basis's unified catalogue, `/claim`
          // + the "claim/pak/neem" gate verbs are owned by tasks-v0 (the
          // dedicated circle-task system).  Household's task-claim uses a distinct
          // command + verbs so the two never collide (Part G de-ambiguation
          // 2026-06-18; backwards-compat intentionally dropped).
          command: '/grab',
          match: {
            verbs:   ['grab', 'oppakken'],
            body:    'match',
            onEmpty: { skillId: 'help', args: {} },
          },
        },
        ui:    { control: 'button', label: "I'll do this" },
      },
    },
    {
      id:        'reassign', group: 'admin',
      verb:      'reassign',
      appliesTo: { type: 'task' },
      // DECLARATION LAYER (#34) — reassigning writes `assignee`, part of the CLAIM cluster (first-wins).
      resolves: [{ field: 'assignee', policy: 'claim' }],
      params: [
        { name: 'match',    kind: 'string', required: true, ...STR_NONEMPTY },
        { name: 'assignee', kind: 'string', required: true, ...STR_NONEMPTY },
      ],
      surfaces: {
        // No slash match for V0 — two-arg slash forms aren't in the V0
        // grammar.  LLM-only entry point.
        chat: { hint: 'Reassign a task to a different webid.  match = id/keyword; assignee = webid.' },
      },
    },
    {
      id:        'registerName', group: 'compose',
      verb:      'register',                                   // F-SP1-e
      appliesTo: { type: 'contact' },
      params: [
        // `text` matches the F-SP2-a 'text-only' body shape; the contact
        // item's text field carries the display name.
        { name: 'text', kind: 'string', required: true, ...STR_NONEMPTY },
      ],
      surfaces: {
        chat:  { hint: 'Register your name in the household.' },
        slash: {
          command: '/register',
          match: {
            verbs:   ['register', 'registreer', 'naam'],
            body:    'text-only',                            // F-SP2-a
            onEmpty: { skillId: 'help', args: {} },
          },
        },
      },
    },
    {
      id:   'revokeDevice', group: 'device',
      verb: 'revoke-device',
      // The device-revocation CEREMONY (the eviction machinery pointed inward): phrase-proven on a
      // SURVIVING device; tombstones the delegation and retires the device's per-circle addresses
      // from every roster set (fold-enforced at every member's end — the device becomes an island).
      params: [
        { name: 'mnemonic', kind: 'secret', required: true },
        { name: 'deviceId', kind: 'string', required: true },
      ],
      // CEREMONY-ONLY, like enrollDevice: reached through the revoke-device flow.
      surfaces: {},
    },
    {
      id:   'exportRecoveryFile', group: 'device',
      verb: 'get',
      // THE RECOVERY FILE, out: the registry (circles, devices, wrapped-key refs) sealed exactly as the pod
      // mirror seals it — to the profile-derived key the phrase re-derives — so the phrase is the only
      // secret. Reached from My data → "Save a recovery file" (both shells); no chat/slash surface.
      params: [],
      surfaces: {},
    },
    {
      id:   'importRecoveryFile', group: 'device',
      verb: 'import',
      // THE RECOVERY FILE, in: opens the file with this device's key, upserts every entry through the
      // registry handle, and runs the boot re-open loop. Refuses `not-your-file` / `unreadable-file`.
      // Reached from My data → "Load a recovery file" after a phrase restore.
      params: [
        { name: 'file', kind: 'string', required: true },
      ],
      surfaces: {},
    },
    {
      id:   'replaceDevice', group: 'device',
      verb: 'replace-device',
      // THE REPLACE CEREMONY (one ceremony for both restore intents — a phone that broke, a phone that
      // walked away): on THIS, the restored device, phrase-proven; retires every other device the
      // registry lists (and the first device's profile-derived addresses) in every circle, absorbs the
      // group-key history those devices could read, and rotates the key where this device is an admin.
      params: [
        { name: 'mnemonic', kind: 'secret', required: true },
      ],
      // CEREMONY-ONLY, like revokeDevice: reached through the replace-device flow.
      surfaces: {},
    },
    {
      id:   'enrollDevice', group: 'device',
      verb: 'enroll-device',
      // The add-a-device CEREMONY (a host identity act, like restoreOwnerPhrase): restores the
      // owner root from the phrase — typed on THIS, the NEW device — and writes this install's
      // delegation blob, so the next boot derives per-circle keys from the delegation seed and
      // presents this device's own address in every circle. The phrase is SECRET-kind: the flow
      // pauses for it and the runner never persists it.
      params: [
        { name: 'mnemonic', kind: 'secret', required: true },
        { name: 'label',    kind: 'string' },
      ],
      // CEREMONY-ONLY: reached through the enroll-device flow (the first-run/settings shells
      // start it); no chat/slash surface — a phrase does not belong in a chat box.
      surfaces: {},
    },
    {
      id:   'buildEnrollOffer', group: 'device',
      verb: 'get',
      // The add-a-device OFFER (`onderling-enroll://`) shown on the EXISTING device as a QR/copy
      // string: relay hint + per-circle {id, handle, this device's per-circle address} — the
      // transport bootstrap the freshly enrolled device consumes after its ceremony. PUBLIC BY
      // DESIGN (no secret, no phrase — enrolling still takes the phrase, typed on the new device).
      params: [
        { name: 'relayUrl', kind: 'string' },
      ],
      // Reached from the my-data screen beside the enroll ceremony; not a chat/slash act.
      surfaces: {},
    },
    {
      id:   'revealOwnerPhrase', group: 'device',
      verb: 'reveal-owner-phrase',
      // Shows the owner recovery phrase to the person already holding the device. Takes nothing:
      // possession of an unlocked device IS the authority, and asking for a secret to reveal a
      // secret would be theatre. Owner-only at the dispatch gate.
      params: [],
      // No chat/slash surface, for the same reason as the ceremonies: a phrase does not belong in
      // a transcript. Reached from the my-data screen on both shells.
      surfaces: {},
    },
    {
      id:   'restoreOwnerPhrase', group: 'device',
      verb: 'restore-owner-phrase',
      // The other direction: adopt an owner root from a phrase typed on THIS device. Distinct from
      // enrollDevice, which also writes a delegation blob for a device joining an existing account.
      params: [
        { name: 'mnemonic', kind: 'secret', required: true },
      ],
      surfaces: {},
    },
    {
      id:   'grantSurface', group: 'admin',
      verb: 'grant-surface',
      // CONNECTIONS — a thing that is not this device (a screen, a bot, an always-on companion)
      // acting as you within limits you ticked. `ops` is the boundary: the pick IS the grant, and
      // nothing outside it verifies at the door. `reads` names which sections its lane may carry.
      params: [
        { name: 'viewPubKey', kind: 'string', required: true },
        // There is no list KIND in the vocabulary (string · number · boolean · enum · date · webid ·
        // file · image · secret · object). `schema` is the documented escape hatch — keywords the
        // per-kind switch does not model ride through it — so the array shape is declared there
        // rather than by inventing a kind, which would need its own home and guard.
        { name: 'ops',        kind: 'object', required: true, schema: { type: 'array', items: { type: 'string' } } },
        { name: 'reads',      kind: 'object' },
        { name: 'label',      kind: 'string' },
        { name: 'nonce',      kind: 'string' },
      ],
      // Owner-only and deliberately unreachable from chat: granting authority by talking to an
      // assistant is exactly the escalation this vocabulary exists to prevent.
      surfaces: {},
    },
    {
      id:   'revokeSurface', group: 'admin',
      verb: 'revoke-surface',
      // Unpairing. Revoke-wins: the grant stops working regardless of what the other side still holds.
      params: [
        { name: 'viewPubKey', kind: 'string', required: true },
      ],
      surfaces: {},
    },
    {
      id:   'listSurfaceGrants', group: 'admin',
      verb: 'list-surface-grants',
      // What is currently connected, and what each may do — the read behind the connections list.
      params: [],
      surfaces: {},
    },
  ],

  // ── FLOWS — the enroll-a-device ceremony, BORN a flow (the add-a-device model): one declared
  // step whose op does the whole ceremony; the reload after it lets boot finish the job by
  // existing machinery (derivation cutover · registry record self-heal · reopen · re-announce).
  // Declared effects are the consent surface: what this ceremony changes.
  flows: [
    {
      id: 'enroll-device',
      kind: 'ceremony',
      scope: 'device',
      labelKey: 'circle.enroll.title',
      effects: [
        { kind: 'overwrite', target: 'owner-root' },
        { kind: 'write',     target: 'device-delegation' },
        { kind: 'write',     target: 'registry' },
      ],
      produces: [
        { name: 'deviceId',       kind: 'string',  from: '$steps.ceremony.deviceId' },
        { name: 'reloadRequired', kind: 'boolean', from: '$steps.ceremony.reloadRequired' },
      ],
      steps: [
        { id: 'ceremony', op: 'enrollDevice', labelKey: 'circle.enroll.ceremony' },
      ],
    },
    {
      id: 'replace-device',
      kind: 'ceremony',
      scope: 'device',
      labelKey: 'circle.replace.title',
      effects: [
        { kind: 'write', target: 'registry' },
        { kind: 'write', target: 'history-keys' },
        { kind: 'send',  target: 'circle-address-revoke' },
        { kind: 'send',  target: 'circle-key-rotate' },
      ],
      produces: [
        { name: 'retiredDevices', kind: 'string',  from: '$steps.ceremony.retiredDevices' },
        { name: 'circles',        kind: 'number',  from: '$steps.ceremony.circles' },
        { name: 'historyKeys',    kind: 'number',  from: '$steps.ceremony.historyKeys' },
      ],
      steps: [
        { id: 'ceremony', op: 'replaceDevice', labelKey: 'circle.replace.ceremony' },
      ],
    },
    {
      id: 'revoke-device',
      kind: 'ceremony',
      scope: 'device',
      labelKey: 'circle.revoke.title',
      effects: [
        { kind: 'write', target: 'registry' },
        { kind: 'send',  target: 'circle-address-revoke' },
      ],
      produces: [
        { name: 'deviceId', kind: 'string', from: '$steps.ceremony.deviceId' },
        { name: 'circles',  kind: 'number', from: '$steps.ceremony.circles' },
      ],
      steps: [
        { id: 'ceremony', op: 'revokeDevice', labelKey: 'circle.revoke.ceremony' },
      ],
    },
  ],

  views: [
    // four list-type views. These let the
    // household web surface (`PLAN-gui-chat-uplift.md` Slice A) render
    // one section per canonical list-type.  `addItem` / `markComplete`
    // `removeItem` surface in each section via renderWeb's type
    // enum fallback (see DESIGN-navmodel-sketch.md). No impact
    // on renderChat output (toolCatalogue + systemPrompt unchanged).
    //
    // adoption (2026-05-21) — `dataSource` makes the
    // per-section list skill EXPLICIT.  The four list-types could
    // rely on `fetchSectionItems`'s rule-b default
    // (`listOpen({type, ...filter})`) but the manifest-author intent
    // is to drive section→skill mapping declaratively; this also
    // future-proofs against any default-fallback change.  `tasks`
    // MUST declare `listTasks` because the fallback would call
    // `listOpen({type:'task'})` which listOpen.js's KNOWN_TYPES
    // guard rejects.
    {
      id: 'shopping', title: 'Shopping', type: 'shopping', filter: { open: true },
      dataSource: { skillId: 'listOpen', args: { type: 'shopping' } },
    },
    {
      id: 'errand',   title: 'Errands',  type: 'errand',   filter: { open: true },
      dataSource: { skillId: 'listOpen', args: { type: 'errand'   } },
    },
    {
      id: 'repair',   title: 'Repairs',  type: 'repair',   filter: { open: true },
      dataSource: { skillId: 'listOpen', args: { type: 'repair'   } },
    },
    {
      id: 'schedule', title: 'Schedule', type: 'schedule', filter: { open: true },
      dataSource: { skillId: 'listOpen', args: { type: 'schedule' } },
    },
    {
      id: 'tasks',    title: 'Tasks',    type: 'task',     filter: { open: true },
      dataSource: { skillId: 'listTasks' },
    },
    // Members section — LIMITATION (signal for):
    //
    //   introduced `readOnly: true` to suppress creative
    //   affordances on sections without a list-skill. then
    //   made `register` a creative verb so `registerName` auto-
    //   surfaces here.  These two collide: setting `readOnly: true`
    //   here would suppress the `registerName` affordance (the
    //   only way to populate a member from the UI), but leaving
    //   `readOnly` off leaves the section's items list empty
    //   (listOpen's KNOWN_TYPES guard rejects 'contact'; no
    //   listMembers/listContacts skill exists yet).
    //
    //   Three paths could unblock this cleanly:
    //     (a) add a list-contacts skill + `dataSource: { skillId:
    //         'listContacts' }` here;
    //     (b) widen listOpen's KNOWN_TYPES to include 'contact';
    //     (c) split so readOnly suppresses ONLY non-register
    //         creative verbs (less coherent — the substrate would
    //         need per-verb flags).
    //
    //   Until then we keep members as-is: registerName affordance
    //   visible, items list empty (V0 gap acknowledged in
    //   web/main.js).  `test/navmodel.test.js` § members section
    //   pins the registerName-affordance expectation.
    { id: 'members',  title: 'Members',  type: 'contact' },
  ],

  slashGrammar: {
    // Strip ONE leading prefix.  Matches `regexCommands.js`
    // ADDRESSED_PREFIX_RE: /^(?:@household\s+|\/|!)/i.
    addressedPrefixes: ['@household\\s+', '/', '!'],

    // "what do we need [in/at <where>]?" / "wat hebben we nodig …" →
    // listOpen({ type: 'shopping' }).  Matches WHAT_DO_WE_NEED_RE.
    specials: [{
      pattern: '^(?:what\\s+do\\s+we\\s+need|wat\\s+hebben\\s+we\\s+nodig)\\b.*$',
      flags:   'i',
      skillId: 'listOpen',
      args:    { type: 'shopping' },
    }],

    // Mirrors `regexCommands.js` TYPE_ALIASES (EN + NL).  The `task` key
    // here resolves to the LIST type 'errand' (grammar, unchanged);
    // the new `task` ITEM type is reached via the addTask verb, not
    // this alias map.
    typeAliases: {
      shopping:     'shopping',
      groceries:    'shopping',
      buy:          'shopping',
      boodschappen: 'shopping',
      winkel:       'shopping',
      errand:       'errand',
      task:         'errand',
      todo:         'errand',
      klusje:       'errand',
      boodschap:    'errand',
      repair:       'repair',
      fix:          'repair',
      reparatie:    'repair',
      repareren:    'repair',
      schedule:     'schedule',
      event:        'schedule',
      appointment:  'schedule',
      agenda:       'schedule',
      afspraak:     'schedule',
    },
    defaultType: 'shopping',
  },
};

export default householdManifest;
