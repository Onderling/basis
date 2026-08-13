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

    // ── The settings-restore ops (#44's choices, promoted from boot-closures to declared ops so the
    //    restore FLOW below can reference them — every effectful step is an op, per the flow model). ──
    {
      id:   'restore-probe',
      verb: 'restore-probe',
      // Re-probe the pod settings medium POST-BOOT. Outcomes: clean (openable, attached, values agree) ·
      // conflicts (openable; the per-param diff rides the result) · undecryptable (sealed under another
      // key — the coarse choice follows) · transport (could not verify; never accuses) · no-medium.
      params: [],
      surfaces: {},
    },
    {
      id:   'restore-merge',
      verb: 'restore-merge',
      // Apply the per-param choices over the probe's captured conflicts: 'theirs' adopts the pod's value
      // through the ONE kind-gated set-param (so it syncs normally); 'mine' is doing nothing — the local
      // value already stands.
      params: [{ name: 'choices', kind: 'object', required: true }],
      surfaces: {},
    },
    {
      id:   'restore-resolve-mismatch',
      verb: 'restore-resolve-mismatch',
      // The coarse choice: 'local' (stay held — the default; nothing is written) · 'phrase' (route to
      // the recovery wizard — the shell launches it off the flow's produce) · 'overwrite' (the one
      // explicit destructive act: this device's settings replace the pod's).
      params: [{ name: 'choice', kind: 'enum', of: ['local', 'phrase', 'overwrite'], required: true }],
      surfaces: {},
    },
  ],

  // ── FLOWS (the L7 model, ratified 2026-08-12) — restore-settings is the PROVING migration: ──────────
  // the #44 hand-wired dialogs become this declaration + the one runner + the one projector. The probe
  // branches three ways (the case that proved flows must be DAGs); both interactive steps pause as
  // awaiting-input on their op's required param; scope is device (a restore-in-progress never syncs).
  flows: [
    {
      id: 'restore-settings',
      kind: 'ceremony',
      scope: 'device',
      labelKey: 'circle.settings_restore.mismatch_title',
      effects: [
        { kind: 'write', target: 'settings' },
        { kind: 'overwrite', target: 'pod-settings' },
      ],
      produces: [
        { name: 'how', kind: 'string', from: '$steps.probe.outcome' },
        { name: 'choice', kind: 'string', from: '$steps.mismatch.choice' },
      ],
      steps: [
        {
          id: 'probe', op: 'restore-probe',
          next: { clean: null, 'no-medium': null, transport: null, conflicts: 'merge', undecryptable: 'mismatch' },
        },
        { id: 'merge', op: 'restore-merge', labelKey: 'circle.settings_restore.conflicts_title' },
        { id: 'mismatch', op: 'restore-resolve-mismatch', labelKey: 'circle.settings_restore.mismatch_title' },
      ],
    },
  ],
};

export default paramsManifest;
