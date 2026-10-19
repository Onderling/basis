/**
 * example-plants — a THIRD-PARTY data type, declared only: the proof that an extension's noun plugs in.
 *
 * One noun (`plants.plant`: a name, a room, when it wants water) with the free atoms, its schema, how a row shows and
 * when it is due. No handler, no store, no surface code: the node composes the type into its registry, the free atoms
 * run over the scope's one store, the chat gate answers to `plant …`, and the row syncs like any other.
 */
export const plantsManifest = Object.freeze({
  app: 'plants',
  version: '0.1.0',
  description: 'An example extension: house plants and when they want water.',
  itemTypes: ['plants.plant'],
  nouns: {
    'plants.plant': {
      atoms: ['add', 'list', 'get', 'update', 'remove'],
      schema: {
        type: 'object',
        properties: {
          body:     { type: 'string', minLength: 1 },
          room:     { type: 'string' },
          waterAt:  { type: 'string' },
        },
        required: ['body'],
      },
      presents: { label: 'body', moment: 'waterAt', order: 'asc' },
    },
  },
  operations: [],
});
export default plantsManifest;
