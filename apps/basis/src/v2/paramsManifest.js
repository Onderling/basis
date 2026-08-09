/**
 * params — the manifest for the parameter register's read/write surface (#36).
 *
 * The register's settable runtime (`set-param` / `get-param` / `list-user-params`) is a CROSS-CUTTING concern
 * — it governs every app's params, so it gets its own thin contract rather than being bolted onto one app's
 * manifest. It is generic plumbing, not an "app silo": no item types, no nouns, just three meta-ops routed
 * through the waist (`callSkill('params', <op>, …)`) to `paramsService`. The settings GUI is a projector over
 * `list-user-params` (the `kind:user` slice); `set-param` is the ONE kind-gated write op.
 */

/** @type {import('@onderling/app-manifest').__types__} */
export const paramsManifest = {
  app:       'params',
  itemTypes: [],
  // Meta-verbs (not SDK atoms) — the register's read/write surface. `{atoms:true}` validators skip these.
  domainVerbs: ['set-param', 'get-param', 'list-user-params'],
  nouns: {},

  operations: [
    {
      id:   'set-param',
      verb: 'set-param',
      // The ONE kind-gated write: sets a kind:user param (routed by scope to its home); refuses kind:internal
      // and unknown keys. Reached through the waist so the security gate binds at one place.
      params: [
        { name: 'key',   kind: 'string', required: true },
        // `value` is polymorphic — its REAL type comes from the target param in the register (the settings
        // form projects that from `list-user-params`). `string` here is just the generic surface holder.
        { name: 'value', kind: 'string', required: true },
      ],
      // SETTINGS-ONLY (Frits 2026-08-10): no chat/slash surface — driven by the settings GUI calling
      // `callSkill('params', …)` directly. Surfacing set-param in chat would let an LLM change your settings
      // from a sentence — a deliberate future opt-in ("conversational settings"), not a default.
      surfaces: {},
    },
    {
      id:   'get-param',
      verb: 'get-param',
      params: [{ name: 'key', kind: 'string', required: true }],
      surfaces: {},
    },
    {
      id:   'list-user-params',
      verb: 'list-user-params',
      // The settings form projects over this — the kind:user slice with scope/default/current value.
      params: [],
      surfaces: {},
    },
  ],
};

export default paramsManifest;
