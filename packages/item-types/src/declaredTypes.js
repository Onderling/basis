/**
 * Declared types — a noun a manifest DECLARES with a schema (`nouns[noun].schema`) joins the node's type registry when
 * the catalogue composes it. The registry is the one place a store asks "is this a type I hold?", so this is how an
 * extension's data type plugs in: no store of its own (it lands in the scope's one store), no per-type code.
 *
 * The rules (one place):
 *   - a first-party manifest's noun keeps its bare name;
 *   - an extension's noun must sit under ITS composed origin — `<origin>.<noun>`, where the origin is the catalogue's
 *     reading of who the manifest is (the caller hands it), never a name the manifest gives itself;
 *   - a name already registered (a canonical type, an alias, another manifest's) is never shadowed;
 *   - all or nothing per manifest: one refused noun and it brings none of its types.
 * Refusals are returned, for the composer to say out loud; nothing is skipped silently.
 */

/**
 * Register the types the given manifests declare (`nouns[noun].schema`) on a registry, by the rules above: a
 * first-party noun under its bare name, an extension's only under its origin, no shadow, all or nothing per manifest.
 * @param {ReturnType<typeof import('./registry.js').createRegistry>} registry
 * @param {Array<{origin: string, manifest: object, firstParty?: boolean}>} entries
 * @returns {{registered: string[], refused: Array<{origin: string, noun: string, reason: 'not-in-origin'|'already-registered'|'bad-schema'}>}}
 */
export function registerDeclaredTypes(registry, entries = []) {
  const registered = [];
  const refused = [];
  for (const { origin, manifest, firstParty = false } of entries) {
    const declared = Object.entries(manifest?.nouns ?? {}).filter(([, n]) => n && typeof n.schema === 'object' && n.schema);
    const mine = [];
    for (const [noun, n] of declared) {
      if (!firstParty && !(typeof origin === 'string' && origin && noun.startsWith(`${origin}.`) && noun.length > origin.length + 1)) {
        mine.push({ noun, reason: 'not-in-origin' });
      } else if (registry.schema(noun) !== null) {
        mine.push({ noun, reason: 'already-registered' });
      } else if (n.schema.type !== undefined && n.schema.type !== 'object') {
        mine.push({ noun, reason: 'bad-schema' });
      }
    }
    if (mine.length) { refused.push(...mine.map((r) => ({ origin, ...r }))); continue; }
    for (const [noun, n] of declared) {
      // the item names its type; the rest of the shape is the manifest's own
      const schema = { ...n.schema, type: 'object', properties: { ...(n.schema.properties ?? {}), type: { const: noun } }, required: [...new Set(['type', ...(n.schema.required ?? [])])] };
      try { registry.registerType(noun, schema); registered.push(noun); }
      catch { refused.push({ origin, noun, reason: 'bad-schema' }); }
    }
  }
  return { registered, refused };
}
