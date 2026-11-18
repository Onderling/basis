/**
 * The `tools` manifest: a circle uses a TOOLBOX's tools (ledger L1035, slice 3; the brief's section 4 as ruled).
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
  itemTypes: [],
  // the non-atom verbs, classified: a tool call reads (it asks; nothing of the circle is written), adding and removing a
  // toolbox write this device's record
  domainVerbs: { use: 'read', 'add-toolbox': 'write', 'remove-toolbox': 'write' },
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
        chat: { reply: 'list', hint: 'Use a tool of one of the toolboxes this household added (see listTools): toolbox = its name, tool = the tool id, input = the tool\'s input (a search: {query}). A list of things comes back to choose from.' },
      },
    },
    {
      id: 'listTools', visibility: 'authenticated', verb: 'list',
      params: [],
      surfaces: {
        chat: { reply: 'list', hint: 'The toolboxes this household added, their tools and the words that reach them.' },
      },
    },
    {
      // the admin adds a toolbox by its name, its address and the words for its tools; the KEY is the box's operator
      // config (an env value or a key file named by the toolbox's name), never a chat: refused when it is not there
      id: 'addToolbox', visibility: 'trusted', verb: 'add-toolbox',
      stepUp: 'private-door',
      writes: { scope: 'device' },
      params: [
        { name: 'name',  kind: 'string', required: true, schema: { minLength: 1 } },
        { name: 'url',   kind: 'string', required: true, schema: { minLength: 1 } },
        { name: 'words', kind: 'object', required: true, schema: { type: 'array', items: { type: 'object' } } },
      ],
      surfaces: {},
    },
    {
      id: 'removeToolbox', visibility: 'trusted', verb: 'remove-toolbox',
      stepUp: 'private-door',
      writes: { scope: 'device' },
      params: [{ name: 'name', kind: 'string', required: true, schema: { minLength: 1 } }],
      surfaces: {},
    },
  ],
});
export default toolsManifest;
