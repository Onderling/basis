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
  itemTypes: ['list', 'list-item', 'board'],
  verbs:     [],
  operations: [
    {
      id:        'createList',
      verb:      'add',
      appliesTo: { type: 'list' },
      requires:  ['lists'],
      // Two people naming a list at the same moment write the same field; last-writer-by-content is the
      // honest merge for a name (there is nothing to claim and no order to preserve).
      resolves:  [{ field: 'text', policy: 'content' }],
      params: [
        { name: 'text', kind: 'string', required: true, schema: { minLength: 1 } },
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
      ],
      surfaces: {
        slash: { command: '/add-to-list', body: 'flags' },
        chat:  { reply: 'text', hint: 'Add something to a list — a plain entry, or any kind that list accepts.' },
        attach: { label: 'circle.attach.list_item', group: 'create' },
      },
    },
    {
      id:       'listLists',
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
      appliesTo: { type: 'list-item' },
      requires:  ['lists'],
      // Ticking off is a CLAIM in the same sense a task claim is: the first person to do it is the one
      // who did it, and a later tick must not silently overwrite who. (`state` is the item's own field;
      // the claim cluster's no-downgrade rule applies to `task`, not here, but the shape is the same.)
      resolves:  [{ field: 'state', policy: 'claim' }],
      params: [
        { name: 'itemId', kind: 'string', required: true, schema: { minLength: 1 } },
      ],
      surfaces: {
        slash: { command: '/list-done', body: 'argline' },
        chat:  { reply: 'text', hint: 'Tick something off a list.' },
        ui:    { control: 'button', labelKey: 'circle.list.done' },
      },
    },
  ],
};

export default listsManifest;
