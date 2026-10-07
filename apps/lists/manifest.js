/**
 * lists — the composable LISTS feature's contract.
 *
 * The feature is not new; its declaration is. `packages/kring-host/src/circleLists.js` has held a `list`
 * container whose children are policy-driven (`LISTS_ACCEPTS_MANIFEST` + `buildAcceptsPolicy`), a
 * `list-item` that is itself a container, and a cross-app `accepts` seam the tasks app already extends
 * (`tasksInLists.js`: a list accepts `task` children "with no new type"). Both shells render it — web's
 * `openListsPanel`, mobile's `CircleListsScreen`, both with the container's own type picker.
 *
 * What it never had is a manifest, so it lived where only its own panel could open it: the "+" could not
 * offer it, no slash command reached it, no journey could drive it, no agent could be given it. That is
 * the same shape as basis's own ops before they reached the waist — a working feature behind one door.
 *
 * These ops are the SERVICE's own surface, named as the app already names them; the handlers are mounted
 * by the shell (`agent.mountAppOps('lists', …)`) because the service is per-circle and holds the circle's
 * own store and seal strategy — the device's affordances, like basis's, rather than an agent's skills.
 *
 * The circle FEATURE `lists` already exists (`circlePolicy.js`, the settings toggle, the tab), so every
 * op declares `requires: ['lists']`: a circle with lists switched off offers none of this, by the same
 * contextual rung that hides anything else.
 */
/** @type {import('@onderling/app-manifest').__types__} */
export const listsManifest = {
  app:       'lists',
  // The network hosts this app's code reaches. None: whatever it syncs goes through the person's own
  // pod and relay, which they configure — not a fixed host.
  hosts:     [],
  itemTypes: ['list', 'list-item', 'board'],

  // The capability surface (`(atom × noun)` pairs the per-circle matrix gates at `callSkill`):
  // creating/listing lists, and adding/completing their entries. `board` is stored structure the list
  // ops manage — no op names it directly, so it carries no atoms yet.
  nouns: {
    list:        { atoms: ['add', 'list'] },
    'list-item': { atoms: ['add', 'complete', 'remove', 'update'] },
  },
  verbs:     [],
  operations: [
    {
      id:        'createList',
      verb:      'add',
      writes: { scope: 'circle' },
      appliesTo: { type: 'list' },
      requires:  ['lists'],
      // Two people naming a list at the same moment write the same field; last-writer-by-content is the
      // honest merge for a name (there is nothing to claim and no order to preserve).
      resolves:  [{ field: 'text', policy: 'content' }],
      params: [
        { name: 'text', kind: 'string', required: true, schema: { minLength: 1 } },
        // What a bare add to this list makes — one of the kinds a list accepts (a chores list: `task`); absent → the
        // list type's own default.
        { name: 'defaultChild', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/new-list', body: 'argline' },
        chat:  { reply: 'text', hint: 'Start a new list in this circle.' },
        // In the "+": making a list is a thing you do while talking about it.
        attach: { label: 'circle.attach.new_list', group: 'create' },
      },
    },
    {
      id:        'addToList',
      verb:      'add',
      writes: { scope: 'circle' },
      appliesTo: { type: 'list-item' },
      requires:  ['lists'],
      // The entry's own text merges by content. The CONTAINMENT edge it also writes is not a mergeable
      // field — `embeds`/`containedBy` are sets the substrate unions (containment.js), so two people
      // adding to the same list both land rather than one overwriting the other.
      resolves:  [{ field: 'text', policy: 'content' }],
      params: [
        // WHICH LIST — a PICKER, not a typed-in name. `pickerSource` is the app's one way of saying "this
        // param names a thing that already exists": the form draws a chooser over `listLists`, and the
        // chat asks "which one?" and offers the same candidates as buttons (`clarifyTargets`). One
        // declaration, both doors — which is what "+ = inline, text = textual" means in practice, rather
        // than a second flow per surface.
        {
          name: 'list', kind: 'string', required: true, schema: { minLength: 1 },
          pickerSource: { listOp: 'listLists', appOrigin: 'lists' },
        },
        { name: 'text', kind: 'string', required: true, schema: { minLength: 1 } },
        // WHICH KIND of child. The container's `accepts` policy decides what is allowed and what the
        // default is (`resolveAddInContainer` / `addKinds`), so this is the answer to the picker's
        // question and not a free-text type. Absent → the container's default child.
        //
        // Its candidates depend on WHICH LIST was picked, and `pickerSource` names an op, not an op with
        // an argument bound from a sibling field — so the picker cannot be declared here yet. The
        // shells' own type picker (the Lists panel's, already built) is what asks it today; extending
        // the form contract to a dependent picker is the honest next step and is on the work list.
        { name: 'kind', kind: 'string', required: false },
        // A chore's person and day, on a list whose entries are chores: `assignee` is "mij" or a name the bot knows,
        // `due` a local date without a zone. Who may be named is the bot's setting, decided at the waist.
        { name: 'assignee', kind: 'string', required: false },
        { name: 'due', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/add-to-list', body: 'flags' },
        chat:  { reply: 'text', hint: 'Add something to a list — a plain entry, or any kind that list accepts.' },
        attach: { label: 'circle.attach.list_item', group: 'create' },
      },
    },
    {
      id:       'listLists', group: 'data',
      verb:     'list',
      requires: ['lists'],
      params:   [],
      surfaces: {
        slash: { command: '/lists', body: 'none' },
        chat:  { reply: 'list', hint: 'The lists in this circle.' },
      },
    },
    {
      id:        'markListItemDone',
      verb:      'complete',
      writes: { scope: 'circle' },
      appliesTo: { type: 'list-item' },
      requires:  ['lists'],
      // Ticking off is a CLAIM in the same sense a task claim is: the first person to do it is the one
      // who did it, and a later tick must not silently overwrite who. (`state` is the item's own field;
      // the claim cluster's no-downgrade rule applies to `task`, not here, but the shape is the same.)
      resolves:  [{ field: 'state', policy: 'claim' }],
      params: [
        // the entry: its id, or its words as they stand on the list; the list only to tell two apart
        { name: 'item', kind: 'string', required: true, schema: { minLength: 1 } },
        { name: 'list', kind: 'string', required: false, pickerSource: { listOp: 'listLists', appOrigin: 'lists' } },
      ],
      surfaces: {
        slash: { command: '/list-done', body: 'argline' },
        chat:  { reply: 'text', hint: 'Tick something off a list.' },
        ui:    { control: 'button', labelKey: 'circle.list.done' },
      },
    },
    {
      // A line becomes a chore in place (the same item, its type now task) — said with who does it or when. List-item
      // and task stay two types (their verbs differ); this is the one verb between them.
      id:        'makeChore', group: 'compose',
      verb:      'update',
      writes: { scope: 'circle' },
      appliesTo: { type: 'list-item' },
      requires:  ['lists'],
      // the type is the line's content as anything else is: the later write wins (a chore stays one)
      resolves:  [{ field: 'type', policy: 'content' }],
      params: [
        { name: 'item', kind: 'string', required: true, schema: { minLength: 1 } },
        { name: 'list', kind: 'string', required: false, pickerSource: { listOp: 'listLists', appOrigin: 'lists' } },
        { name: 'assignee', kind: 'string', required: false },
        { name: 'due', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/list-chore', body: 'argline' },
        chat:  { reply: 'text', hint: 'Make a line on a list a chore: who does it, or when.' },
      },
    },
    {
      // The reminders EVERYONE it is for gets for one entry (an appointment, a dated chore): the household's statement
      // about it, in a person's words ("60", "ook avond", "7:30"; "gewoon" drops it) — whoever may edit the entry.
      id:        'entryReminders', group: 'compose',
      verb:      'update',
      writes: { scope: 'circle' },
      appliesTo: { type: 'list-item' },
      requires:  ['lists'],
      resolves:  [{ field: 'reminders', policy: 'content' }],
      params: [
        { name: 'item', kind: 'string', required: true, schema: { minLength: 1 } },
        { name: 'reminders', kind: 'string', required: true, schema: { minLength: 1 } },
        { name: 'list', kind: 'string', required: false, pickerSource: { listOp: 'listLists', appOrigin: 'lists' } },
      ],
      surfaces: {
        slash: { command: '/list-reminders', body: 'flags' },
        chat:  { reply: 'text', hint: 'The reminders everyone gets for one entry (an appointment or a dated chore), in words: "60" (minutes before), "ochtend", "avond" (the evening before), "7:30", "ook …" to add to the usual ones, "gewoon" to drop them. For one person\'s own reminder use remindMe.' },
      },
    },
    {
      // At a shop: the general shopping list and that shop's own lists together (a member's idea, 2026-10-06).
      id:        'shopVisit', group: 'data',
      verb:      'list',
      requires:  ['lists'],
      params: [
        { name: 'shop', kind: 'string', required: true, schema: { minLength: 1 } },
        { name: 'general', kind: 'string', required: false, pickerSource: { listOp: 'listLists', appOrigin: 'lists' } },
      ],
      surfaces: {
        slash: { command: '/winkel', body: 'argline' },
        chat:  { reply: 'text', hint: 'The person is at a shop: the general shopping list and that shop\'s own list(s).' },
      },
    },
    {
      id:        'listEntries', group: 'data',
      verb:      'list',
      requires:  ['lists'],
      params: [
        { name: 'list', kind: 'string', required: true, schema: { minLength: 1 }, pickerSource: { listOp: 'listLists', appOrigin: 'lists' } },
      ],
      surfaces: {
        slash: { command: '/list-entries', body: 'argline' },
        chat:  { reply: 'list', hint: 'What is on one list (the open entries).' },
      },
    },
    {
      id:        'removeFromList', group: 'compose',
      verb:      'remove',
      writes:    { scope: 'circle' },
      appliesTo: { type: 'list-item' },
      requires:  ['lists'],
      params: [
        // the entry: its id, or its words as they stand on the list; the list only to tell two apart
        { name: 'item', kind: 'string', required: true, schema: { minLength: 1 } },
        { name: 'list', kind: 'string', required: false, pickerSource: { listOp: 'listLists', appOrigin: 'lists' } },
      ],
      surfaces: {
        slash: { command: '/list-remove', body: 'flags' },
        chat:  { reply: 'text', hint: 'Take an entry off a list (a mistake, or no longer needed).' },
      },
    },
    {
      // The confirm below is the SURFACE's (a chat asks first; a screen paints it): the waist does not ask. A connected
      // screen that calls this op directly removes the list — on a household bot that is the admin's own screen only.
      id:        'removeList', group: 'compose',
      verb:      'remove',
      writes:    { scope: 'circle' },
      requires:  ['lists'],
      params: [
        { name: 'list', kind: 'string', required: true, schema: { minLength: 1 }, pickerSource: { listOp: 'listLists', appOrigin: 'lists' } },
      ],
      surfaces: {
        slash: { command: '/list-delete', body: 'argline' },
        chat:  { reply: 'text', hint: 'Remove a whole list and everything on it (a list made by mistake).' },
        // the list and its entries go at once: asked first, in the household's words
        // `preview`: the op is first called with `preview: true` (a read, no change) and its `vars` fill the question —
        // how many entries and chores go, how many of those someone holds, how many stay on another list
        ui:    { confirm: { severity: 'danger', messageKey: 'circle.lists.remove_list_confirm', message: 'Remove this list and everything on it?', preview: true } },
      },
    },
    {
      // A removed list comes back (within the keep window: 30 days on a household bot) with everything that went with
      // it. Without a name: the lists that can come back, a button each.
      id:        'restoreList', group: 'compose',
      verb:      'unarchive',
      writes:    { scope: 'circle' },
      requires:  ['lists'],
      params: [
        { name: 'list', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/list-restore', body: 'argline' },
        chat:  { reply: 'text', hint: 'Put a removed list back, with everything that was on it (within 30 days).' },
      },
    },
    {
      id:        'editEntry', group: 'compose',
      verb:      'edit',
      writes:    { scope: 'circle' },
      appliesTo: { type: 'list-item' },
      requires:  ['lists'],
      // Two people fixing the same entry write the same field; the text merges by content.
      resolves:  [{ field: 'text', policy: 'content' }],
      params: [
        { name: 'item', kind: 'string', required: true, schema: { minLength: 1 } },
        // new words, or a new time, or both — a form still asks for the words (`ask`)
        { name: 'text', kind: 'string', required: false, ask: true, schema: { minLength: 1 } },
        { name: 'list', kind: 'string', required: false, pickerSource: { listOp: 'listLists', appOrigin: 'lists' } },
        // an appointment's new start (it keeps its length) or a chore's new due: the line's time, edited as its words are
        { name: 'when', kind: 'date', required: false },
      ],
      surfaces: {
        slash: { command: '/list-edit', body: 'flags' },
        chat:  { reply: 'text', hint: 'Change an entry on a list: its words (text), and/or its time (when — an appointment moves, keeping its length; a chore gets a new due). "zet de tandarts op vrijdag 14:00" → item tandarts, when.' },
      },
    },
  ],
};

export default listsManifest;
