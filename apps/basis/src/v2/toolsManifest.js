/**
 * The `tools` manifest: a circle uses a TOOLBOX's tools (ledger L1035; the brief's section 4 as ruled).
 *
 * One op reaches every tool (`useTool {toolbox, tool, input}`), so the bot's closed map stays closed: a toolbox's tools
 * are DATA, not ops; the command word that reaches a tool is named by the admin when the toolbox is added (`zoek` →
 * the boodschappen toolbox's `products.choices`, the rest of the line into its `query`). No capability row and no
 * feature per toolbox: a toolbox that is added is on, removing it is the switch, and a call to one that is not added is
 * refused before anything leaves. A door op of the box (beside `assistant`): on the box's door and in `allManifests()`,
 * not in the web or phone catalogue (they hold no toolboxes).
 */
export const toolsManifest = Object.freeze({
  app: 'tools',
  version: '0.1.0',
  description: 'A circle uses the tools of the toolboxes its admin added: one op for every tool, a word per tool.',
  // a toolbox's thing as a row of an answer (`useTool`'s list): what the row button `pickThing` applies to; never stored
  itemTypes: ['tool-thing'],
  // the hosts a box's OPERATOR places as toolboxes (the reserved word, docs/conventions/manifest-standard.md): none is
  // fixed in the code; the egress gate treats this app as one that reaches outside
  hosts: ['@placed'],
  // the non-atom verbs, classified: a tool call reads (it asks; nothing of the circle is written), adding and removing a
  // toolbox write this device's record
  domainVerbs: { use: 'read', pick: 'write', 'add-toolbox': 'write', 'remove-toolbox': 'write' },
  operations: [
    {
      id: 'useTool', visibility: 'authenticated', verb: 'use',
      // what leaves: the tool's id and its input (the words of the question); never the person, the circle or a key
      params: [
        { name: 'toolbox', kind: 'string', required: true, schema: { minLength: 1 } },
        { name: 'tool',    kind: 'string', required: true, schema: { minLength: 1 } },
        { name: 'input',   kind: 'object', required: false },
      ],
      surfaces: {
        // the things come under a head per shop (`groupBy`, read by the shared renderer; each door paints the heads)
        chat: { reply: 'list', groupBy: 'seller', hint: 'Use a tool of one of the toolboxes this household added (see listTools): toolbox = its name, tool = the tool id, input = the tool\'s input (a search: {query}). A list of things comes back to choose from.' },
      },
    },
    {
      // the answer to "which one" after a list of things: the button the manifest declares on each thing's row (the
      // shared row buttons, `itemRowButtons`: a tap is `pickThing:<n>`, dispatched like `/kies <n>`). The thing goes on
      // the list of the shop that sells it, else the shopping list, else the reply asks which list (`/kies <n> <list>`).
      id: 'pickThing', visibility: 'authenticated', verb: 'pick',
      appliesTo: { type: 'tool-thing' },
      writes: { scope: 'circle', what: 'content' },
      params: [{ name: 'spec', kind: 'string', required: false }],
      surfaces: {
        slash: { command: '/kies', body: 'argline' },
        ui: { control: 'button', labelKey: 'circle.bot.toolbox_pick_button' },
      },
    },
    {
      // "Meer van <winkel>" (ledger L1035): the rest of one shop's things from the thread's KEPT list, each with its own
      // number. Reached by the button under a shop's cards (its line '/meer <tag> <shop> <from>'), never a model's pick
      // (no chat surface); a read of what was already fetched, so nothing leaves the box.
      id: 'moreThings', visibility: 'authenticated', verb: 'list',
      params: [{ name: 'spec', kind: 'string', required: false }],
      surfaces: { slash: { command: '/meer', body: 'argline' } },
    },
    {
      id: 'listTools', visibility: 'authenticated', verb: 'list',
      // a member sees what is on; the admin's `/toolbox` lists every placed one with its on/off (`all`)
      params: [{ name: 'all', kind: 'boolean', required: false }],
      surfaces: {
        chat: { reply: 'list', hint: 'The toolboxes this household added, their tools and the words that reach them.' },
      },
    },
    {
      // the admin switches ON a toolbox the operator PLACED (one file per toolbox on the box: name, address, words, beside
      // its key): no chat line carries an address, a tool id or a key. Without `confirm`: the card to say yes to; the yes
      // (the admin's private chat) switches it on. A placed toolbox is off until then.
      id: 'addToolbox', visibility: 'trusted', verb: 'add-toolbox',
      stepUp: 'private-door',
      // a CIRCLE's control (5): a toolbox decides where the circle's questions go; scope is the widest place an op
      // affects, not where its record is kept (the box's vault)
      writes: { scope: 'circle', what: 'control' },
      params: [
        { name: 'name',    kind: 'string',  required: true, schema: { minLength: 1 } },
        { name: 'confirm', kind: 'boolean', required: false },
      ],
      surfaces: {},
    },
    {
      id: 'removeToolbox', visibility: 'trusted', verb: 'remove-toolbox',
      stepUp: 'private-door',
      // a CIRCLE's control (5): a toolbox decides where the circle's questions go; scope is the widest place an op
      // affects, not where its record is kept (the box's vault)
      writes: { scope: 'circle', what: 'control' },
      params: [{ name: 'name', kind: 'string', required: true, schema: { minLength: 1 } }],
      surfaces: {},
    },
  ],
});
export default toolsManifest;
