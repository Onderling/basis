/**
 * agents — app manifest (read CONTROL ops).
 *
 * The "your agents" management surface: a member's registered agents
 * (their devices + delegated agents) listed from the canonical
 * `@onderling/agent-registry` pod resource.
 *
 * READ ops (canonical `list` atom):
 *   • listAgents — the non-revoked roster (soft-revoke: entries with a
 *     `revokedAt` are skipped from the list).
 *   • viewAgent  — one agent's detail record, resolved by agentId/pubKey.
 *
 * CONTROL ops (PLAN-agent-management-surface.md). Design rule
 * (decision 2): the signed CapabilityToken is the ENFORCED authority;
 * the registry's `grants[]`/`capabilities[]` only MIRROR it — so grant
 * issues the token FIRST, then mirrors; revoke hits token(s) + entry
 * together.  Without an injected token collaborator the ops still keep
 * the mirror honest and report `tokenBacked: false` (degraded).
 *   • revokeAgent (atom `revoke`)  — soft-revoke the whole agent: revoke
 *     each of its grant tokens, then stamp the entry `revokedAt`.
 *     Confirm-gated (`severity: 'danger'` — disables an agent).
 *   • grantAgent  (atom `update`)  — issue a fresh scoped token, then
 *     mirror it into the entry (`applyGrant`).  Mutates the entry's
 *     capability surface, hence `update`.
 *   • revokeGrant (atom `revoke`)  — the adjust op: revoke ONE token,
 *     then un-mirror it from the entry (`revokeGrant`).
 *   • purgeAgent  (atom `remove`)  — HARD delete of the entry (works on
 *     a revoked agent).  Confirm-gated, permanent.
 *
 * itemType `'agent'` is app-local (F-SP1-a — not canonical in
 * `@onderling/item-types`); permitted by validateManifest.  The DETAIL
 * view mirrors the stoop `settings` / tasks-v0 `pod-settings` record-
 * view precedent (`shape: 'record'` + a runtime-derived dataSource arg
 * via `argsFromContext`), still read-only (no `fields[]` patch surface —
 * mutation goes through the explicit ops above).
 *
 * Hints are written for the LLM tool-calling layer (surfaces.chat.hint);
 * listAgents also carries a `/agents` slash command.
 *
 * @type {import('@onderling/app-manifest').__types__}
 */
export const agentsManifest = {
  app:       'agents',
  itemTypes: ['agent', 'data-version', 'catalogue-entry'],

  // Layer-1 capability surface — (verb × noun) atoms this app ships.
  // CONTROL: `revoke` (revokeAgent / revokeGrant), `update`
  // (grantAgent — mutates the entry's capability surface), `remove`
  // (purgeAgent — hard delete).
  // RECOVERY (`data-version`, app-local like `agent`): `list`
  // (listDataVersions) + `update` (restoreDataVersion — writes a prior
  // state back to the live resource).
  nouns: {
    // INSTALL adds `add` (installAgent — adds a catalogue/override card
    // to your agents, default-deny).
    agent:          { atoms: ['list', 'revoke', 'update', 'remove', 'add'] },
    'data-version': { atoms: ['list', 'update'] },
    // INSTALL: the pluggable curated-catalogue source, browsed read-only.
    'catalogue-entry': { atoms: ['list'] },
  },

  operations: [
    {
      id:        'listAgents',
      verb:      'list',
      appliesTo: { type: 'agent' },
      params:    [],
      surfaces: {
        slash: { command: '/agents' },
        chat: {
          reply: 'list',
          hint:  'List your registered agents (devices + delegated agents), newest signing first. '
               + 'Shows name, role, status (active), and when each was last seen. Revoked agents are omitted. Read-only.',
        },
      },
    },
    {
      id:        'viewAgent',
      verb:      'list',
      appliesTo: { type: 'agent' },
      params: [
        // Resolve on agentId OR pubKey only (NOT webid — a webid is
        // ambiguous for multi-device users, who share one webid across
        // several agent entries).  kind:'string' — the core matches it
        // against agentId then pubKey.
        { name: 'agentId', kind: 'string', required: true, schema: { minLength: 1 } },
      ],
      surfaces: {
        chat: {
          reply: 'record',
          hint:  'Show one agent in detail by its agentId or pubKey: derived skills '
               + '(from its grants + capabilities), a grant summary, status, and last-seen. Read-only.',
        },
      },
    },

    /* ── per-skill EXPOSURE (P1 §5) ─────────────────────────────────────
     * What this agent ADVERTISES, per circle. A discovery filter, NOT access control — the surfaces
     * must say "what people see, not what they may do", because a modified client that knows a skill
     * id can still dispatch it; the grant/token check is what refuses. Authority: agent-wide changes
     * are signed by the owner key (`bySigner` vs the entry's ownerFingerprint — which is also what
     * makes this answerable for an agent in no circle); a circle admin may only NARROW inside their
     * own circle.
     */
    {
      id:        'setAgentSkillExposure',
      verb:      'update',
      appliesTo: { type: 'agent' },
      params: [
        { name: 'agentId',  kind: 'string',  required: true, schema: { minLength: 1 } },
        { name: 'skillId',  kind: 'string',  required: true, schema: { minLength: 1 } },
        { name: 'exposed',  kind: 'boolean', required: true },
        // Scope the change to ONE circle (an admin narrowing); omitted ⇒ agent-wide (owner only).
        { name: 'circleId', kind: 'string' },
      ],
      surfaces: {
        slash: { command: '/agent-skill' },
        chat: {
          reply: 'text',
          hint:  'Show or hide one of an agent\'s skills — agent-wide (owner) or inside one circle '
               + '(admin, hide only). This changes what OTHERS SEE in catalogues and cards; it does not '
               + 'restrict what the agent may do — a grant does that.',
        },
      },
    },
    {
      id:        'getAgentSkillExposure',
      verb:      'list',
      appliesTo: { type: 'agent' },
      params: [
        { name: 'agentId',  kind: 'string', required: true, schema: { minLength: 1 } },
        // Answer "as seen in this circle" (applies that circle's narrowing on top of the agent's own).
        { name: 'circleId', kind: 'string' },
      ],
      surfaces: {
        chat: {
          reply: 'list',
          hint:  'List an agent\'s skills with whether each is currently advertised (optionally as seen '
               + 'in one circle). Read-only.',
        },
      },
    },

    /* ── identity step 4 — create a PROFILE ─────────────────────────────
     * A profile is a labelled identity whose key derives from the owner root
     * (recoverable from the phrase). The DERIVATION is the injected `profiles`
     * collaborator (owner-root-backed); this op names it. verb `add` (a new
     * `agent`-type entry).
     */
    {
      id:        'createProfile',
      verb:      'add',
      appliesTo: { type: 'agent' },
      params: [
        // Stable profile id — also the registry agentId + the HKDF label. Never rename.
        { name: 'id',         kind: 'string', required: true, schema: { minLength: 1 } },
        // Optional display name.
        { name: 'name',       kind: 'string' },
        // Optional own/inherit property map — a JSON string (same convention as installAgent.grants).
        { name: 'properties', kind: 'string' },
      ],
      surfaces: {
        chat: {
          reply: 'record',
          hint:  'Create a new PROFILE — a labelled identity whose key derives from your owner root '
               + '(recoverable from your recovery phrase). Give it an id (a stable label) and an '
               + 'optional name/properties (JSON own/inherit map). It joins your agents; you can then '
               + 'load it on a device.',
        },
        // Front-end (step 4/5 app) — a plain button on the agents surface. Creating your OWN profile
        // isn't destructive, so no consent gate (unlike installAgent, which adds a third party).
        ui: {
          control: 'button',
          label:   'New profile',
        },
      },
    },

    /* Property layer — curate a coarse property ONCE on a profile (place/ageBand/…), readable by any app
     * (cross-app reuse). setProfileProperty writes an OWN value; getProfileProperties reads the map. */
    {
      id:        'setProfileProperty',
      verb:      'update',
      appliesTo: { type: 'agent' },
      params: [
        { name: 'id',    kind: 'string', required: true, schema: { minLength: 1 } },
        { name: 'key',   kind: 'string', required: true, schema: { minLength: 1 } },
        { name: 'value', kind: 'string' },
      ],
      surfaces: { chat: { reply: 'record', hint: 'Set a coarse property (e.g. place) on a profile — curated once, reusable across apps.' } },
    },
    {
      id:        'getProfileProperties',
      verb:      'get',
      appliesTo: { type: 'agent' },
      params: [
        { name: 'id', kind: 'string', required: true, schema: { minLength: 1 } },
      ],
      surfaces: { chat: { reply: 'record', hint: 'Read a profile\'s properties (own/inherit).' } },
    },

    /* Drivers (#3) — an OPEN personal-driver property { kind, text, tags[] } (goals/hobbies/…), not a coarse
     * string, so it has its own set/get. Curated once, governed by the same per-persona disclosure; the
     * on-device matcher reads them via getProfileDrivers. */
    {
      id:        'setProfileDriver',
      verb:      'update',
      appliesTo: { type: 'agent' },
      params: [
        { name: 'id',   kind: 'string', required: true, schema: { minLength: 1 } },
        { name: 'key',  kind: 'string', required: true, schema: { minLength: 1 } },
        { name: 'kind', kind: 'string' },
        { name: 'text', kind: 'string' },
        { name: 'tags', kind: 'string' },
      ],
      surfaces: { chat: { reply: 'record', hint: 'Set a personal driver (goal/hobby/…) on a profile: a phrase + comma-separated tags.' } },
    },
    {
      id:        'getProfileDrivers',
      verb:      'get',
      appliesTo: { type: 'agent' },
      params: [
        { name: 'id', kind: 'string', required: true, schema: { minLength: 1 } },
      ],
      surfaces: { chat: { reply: 'record', hint: 'Read a profile\'s personal drivers.' } },
    },
    /* Registry restore-data — record a per-circle membership ({handle, address, …}) on a profile so a
     * restored device knows its circles + the handle it used. The join wizard writes through this on a
     * successful join; the wrapped-key ref is written later (group-key event) and is optional. */
    {
      id:        'setProfileCircleMembership',
      verb:      'update',
      appliesTo: { type: 'agent' },
      params: [
        { name: 'id',       kind: 'string', required: true, schema: { minLength: 1 } },
        { name: 'circleId', kind: 'string', required: true, schema: { minLength: 1 } },
        { name: 'handle',   kind: 'string' },
        { name: 'address',  kind: 'string' },
      ],
      surfaces: { chat: { reply: 'record', hint: 'Record a per-circle membership on a profile (restore-data).' } },
    },

    /* Personas — persist what a persona SHARES per context (circle/project). The general per-persona version
     * of the feedback charter consent; the "About me" surface + join wizard write through these. */
    {
      id:        'setProfileDisclosure',
      verb:      'update',
      appliesTo: { type: 'agent' },
      params: [
        { name: 'id',        kind: 'string',  required: true, schema: { minLength: 1 } },
        { name: 'contextId', kind: 'string',  required: true, schema: { minLength: 1 } },
        { name: 'key',       kind: 'string',  required: true, schema: { minLength: 1 } },
        { name: 'enabled',   kind: 'boolean' },
        { name: 'rung',      kind: 'string' },
      ],
      surfaces: { chat: { reply: 'record', hint: 'Choose whether a persona shares a property in a given circle/context.' } },
    },
    {
      id:        'getProfileDisclosure',
      verb:      'get',
      appliesTo: { type: 'agent' },
      params: [
        { name: 'id', kind: 'string', required: true, schema: { minLength: 1 } },
      ],
      surfaces: { chat: { reply: 'record', hint: 'Read a persona\'s per-context disclosure policy.' } },
    },
    {
      id:        'getPersonaView',
      verb:      'get',
      appliesTo: { type: 'agent' },
      params: [
        { name: 'id', kind: 'string', required: true, schema: { minLength: 1 } },
      ],
      surfaces: { chat: { reply: 'record', hint: 'The "About me" view — a persona\'s properties + per-context sharing in one call.' } },
    },
    {
      id:        'getPersonaRelease',
      verb:      'get',
      appliesTo: { type: 'agent' },
      params: [
        { name: 'id',        kind: 'string', required: true, schema: { minLength: 1 } },
        { name: 'contextId', kind: 'string', required: true, schema: { minLength: 1 } },
        { name: 'keys',      kind: 'string' },
      ],
      surfaces: { chat: { reply: 'record', hint: 'What a persona would share in a circle (its release for that context).' } },
    },

    /* ── CONTROL ops ─────────────────────────────────────────────────
     * All resolve the target by agentId OR pubKey ONLY (never webid —
     * ambiguous for multi-device users), same as viewAgent.  Token-first
     * discipline: see the header comment (decision 2).
     */
    {
      id:        'revokeAgent',
      verb:      'revoke',
      appliesTo: { type: 'agent' },
      params: [
        { name: 'agentId', kind: 'string', required: true, schema: { minLength: 1 } },
      ],
      surfaces: {
        chat: {
          reply: 'record',
          hint:  'Revoke (disable) an agent by agentId or pubKey: revokes each of its '
               + 'capability-grant tokens, then soft-revokes the registry entry (kept for '
               + 'audit; drops off the roster). Reports how many tokens were revoked.',
        },
        // Tier C consent gate — disabling an agent cuts off every
        // delegation it holds.  'danger' → adapter shows a red confirm.
        ui: {
          control: 'button',
          label:   'Revoke agent',
          confirm: {
            severity: 'danger',
            message:  'Revoke this agent?  All its capability grants stop working immediately. '
                    + 'The entry is kept for audit.',
          },
        },
      },
    },
    {
      id:        'grantAgent',
      verb:      'update',
      appliesTo: { type: 'agent' },
      params: [
        { name: 'agentId',       kind: 'string', required: true, schema: { minLength: 1 } },
        // The fine-grained skill scope the token authorises (e.g.
        // 'tasks.addTask' or a prefix like 'bot.*'). Optional when `profile` is given.
        { name: 'skill',         kind: 'string', schema: { minLength: 1 } },
        // identity step 2.3 — name a PROFILE the grantee (a device) may run; the token carries
        // it as a constraint the PolicyEngine gate enforces. At least one of skill/profile.
        { name: 'profile',       kind: 'string', schema: { minLength: 1 } },
        // Coarse capability label mirrored into `capabilities[]`;
        // defaults to `skill` when omitted.
        { name: 'capability',    kind: 'string' },
        // Token lifetime; defaults to 30 days (BotAgentRegistry precedent).
        { name: 'expiresInDays', kind: 'number', schema: { exclusiveMinimum: 0 } },
        // Token subject (grantee key); defaults to the agent's pubKey.
        { name: 'subject',       kind: 'string' },
      ],
      surfaces: {
        chat: {
          reply: 'record',
          hint:  'Grant an agent (by agentId or pubKey) a scoped capability: issues a fresh '
               + 'signed capability token for the given skill (optional coarse capability '
               + 'label, expiry in days — default 30, subject — default the agent pubKey), '
               + 'then mirrors it into the registry entry.',
        },
      },
    },
    /* ── ROLE grant (roles as capability bundles) ────────────────────
     * grantRole ASSIGNS a role to a member AND materializes the role's
     * capability bundle: the injected `roleGrants` collaborator (bound to
     * core's `RoleGrantManager`) sets the governance role via
     * `GroupManager.setRole` (signed) AND issues the bundle's cap-tokens
     * to the member.  Same token-first discipline as grantAgent — the
     * enforced authority (the materialized tokens) is issued by the
     * collaborator; this op only names the act.  Without a collaborator it
     * reports the honest degraded `roleBacked: false`.  Enforcement stays
     * PolicyEngine (`requiredRole` + cap-token verify) — no second gate.
     */
    {
      id:        'grantRole',
      verb:      'update',
      appliesTo: { type: 'agent' },
      params: [
        // The circle/group the role is held IN.
        { name: 'groupId', kind: 'string', required: true, schema: { minLength: 1 } },
        // A Roles.js role id with a registered RoleBundle (standard or custom).
        { name: 'role',    kind: 'string', required: true, schema: { minLength: 1 } },
        // The member the role is granted to — resolved by agentId/pubKey
        // (like the other control ops), OR named directly via `subject`
        // (the member's pubKey). At least one.
        { name: 'agentId', kind: 'string', schema: { minLength: 1 } },
        { name: 'subject', kind: 'string', schema: { minLength: 1 } },
        // Token lifetime for the materialized bundle; defaults to 1 day.
        { name: 'expiresInDays', kind: 'number', schema: { exclusiveMinimum: 0 } },
      ],
      surfaces: {
        chat: {
          reply: 'record',
          hint:  'Grant a member a ROLE and materialize its capability bundle: sets the '
               + 'governance role (signed) AND issues the role bundle\'s capability tokens to '
               + 'the member (by groupId + role + the member agentId/pubKey or subject; optional '
               + 'expiry in days). Reports the role, rank, and the materialized token ids.',
        },
      },
    },
    {
      id:        'revokeGrant',
      verb:      'revoke',
      appliesTo: { type: 'agent' },
      params: [
        { name: 'agentId', kind: 'string', required: true, schema: { minLength: 1 } },
        { name: 'tokenId', kind: 'string', required: true, schema: { minLength: 1 } },
      ],
      surfaces: {
        chat: {
          reply: 'record',
          hint:  'Revoke ONE capability grant from an agent (by agentId/pubKey + the grant '
               + 'tokenId, as listed in the agent detail): revokes the token, then removes '
               + 'the grant from the registry entry (un-mirroring its coarse capability '
               + 'when no other grant still uses it). The agent itself stays active.',
        },
      },
    },
    {
      id:        'purgeAgent',
      verb:      'remove',
      appliesTo: { type: 'agent' },
      params: [
        { name: 'agentId', kind: 'string', required: true, schema: { minLength: 1 } },
      ],
      surfaces: {
        chat: {
          reply: 'record',
          hint:  'PERMANENTLY delete an agent entry from the registry by agentId or pubKey '
               + '(hard delete — unlike revoke, nothing is kept for audit). Works on an '
               + 'already-revoked agent; idempotent when the entry is absent.',
        },
        ui: {
          control: 'button',
          label:   'Purge agent',
          confirm: {
            severity: 'danger',
            message:  'Permanently delete this agent entry?  This cannot be undone — the '
                    + 'record is removed entirely (revoke instead to keep it for audit).',
          },
        },
      },
    },

    /* ── INSTALL ops (PLAN-agent-management-surface) ─────────────
     * Install an agent into "your agents" with CAPABILITY-SECURITY: the
     * entry is registered default-deny (no ambient authority); only the
     * user-picked, card-DECLARED skills are granted, each through the
     * token-first grant path.  Two sources: a curated catalogue (pluggable
     * `store.catalogue`) and the power-user override (a pasted/fetched card
     * that bypasses the catalogue).  commons-governance: the catalogue's
     * trust/curation is designed separately — here it is a data source.
     */
    {
      id:        'listCatalogue',
      verb:      'list',
      appliesTo: { type: 'catalogue-entry' },
      params:    [],
      surfaces: {
        slash: { command: '/agent-catalogue' },
        chat: {
          reply: 'list',
          hint:  'List the curated agent catalogue: installable agents (id, name, description, '
               + 'the skills each declares). Read-only. Until the community catalogue ships this '
               + 'may be empty/placeholder — use installAgent with a pasted card to install '
               + 'from any source.',
        },
      },
    },
    {
      id:        'installAgent',
      verb:      'add',
      appliesTo: { type: 'agent' },
      params: [
        // CURATED path — the id of a catalogue entry (from listCatalogue).
        { name: 'catalogueId', kind: 'string' },
        // OVERRIDE path (power-user) — an A2A Agent Card, passed as a
        // pasted/fetched JSON string (or an object, programmatically);
        // bypasses the catalogue. Supply this OR catalogueId.
        { name: 'card',      kind: 'string' },
        // The user-picked grant set (default-deny: omitted ⇒ inert
        // install). A JSON array of skill strings OR
        // {skill, capability?, expiresInDays?, subject?}. A requested skill
        // the card does not DECLARE is rejected, never granted.
        { name: 'grants',    kind: 'string' },
        // Optional local display-name override.
        { name: 'name',      kind: 'string' },
      ],
      surfaces: {
        chat: {
          reply: 'record',
          hint:  'Install an agent into your agents. Provide catalogueId (a curated catalogue entry) '
               + 'OR card (an A2A agent card object/JSON — the power-user override, any source). '
               + 'The agent is registered with NO capabilities by default; pass grants (skill '
               + 'names, or {skill,capability,expiresInDays,subject}) to grant ONLY those — and '
               + 'only skills the card declares. Returns what was granted, declined, and rejected.',
        },
        // Install adds authority — a Tier-C consent gate (same red confirm
        // as the other capability-changing control ops).
        ui: {
          control: 'button',
          label:   'Install agent',
          confirm: {
            severity: 'warn',
            message:  'Install this agent? It is added with only the capabilities you grant — '
                    + 'nothing else. Review the granted skills before confirming.',
          },
        },
      },
    },

    /* ── RECOVERY ops (PLAN-pod-versioning-history-recovery) ─────────
     * "Restore corrupted / lost data" over the per-circle pod version
     * history. Deliberately on THIS surface: J5/J7's recovery arc is
     * "revoke the misbehaving agent → restore what it touched".
     */
    {
      id:        'listDataVersions',
      verb:      'list',
      appliesTo: { type: 'data-version' },
      params: [
        { name: 'circleId', kind: 'string', required: true, schema: { minLength: 1 } },
        // Without `uri`: every resource with history (uri · latest · count).
        // With `uri`: that resource's versions, newest-first — the restore pick-list.
        { name: 'uri',      kind: 'string' },
      ],
      surfaces: {
        chat: {
          reply: 'record',
          hint:  'List a circle\'s data-version history: without a uri, every resource in the '
               + 'circle pod that has retained versions (uri, latest timestamp, count); with a '
               + 'uri, that resource\'s versions newest-first (ts, id, sha256, size, writing '
               + 'device) — use an id with restoreDataVersion to roll back. Read-only.',
        },
      },
    },
    {
      id:        'restoreDataVersion',
      verb:      'update',
      appliesTo: { type: 'data-version' },
      params: [
        { name: 'circleId', kind: 'string', required: true, schema: { minLength: 1 } },
        { name: 'uri',      kind: 'string', required: true, schema: { minLength: 1 } },
        // Numeric ts or the full "<ts>-<writer>" version id from listDataVersions.
        { name: 'version',  kind: 'string', required: true, schema: { minLength: 1 } },
      ],
      surfaces: {
        chat: {
          reply: 'record',
          hint:  'Restore a circle pod resource to a previous version (by uri + version ts/id '
               + 'from listDataVersions). Overwrites the CURRENT content — but undoably: the '
               + 'current state is snapshotted first (snapshotMsBeforeRestore), so a wrong '
               + 'restore can itself be restored. Use to recover data corrupted or deleted by '
               + 'a misbehaving agent.',
        },
        // Overwrites live content (undoably) — red confirm, same tier
        // as revokeAgent.
        ui: {
          control: 'button',
          label:   'Restore version',
          confirm: {
            severity: 'danger',
            message:  'Restore this resource to the selected version?  Its current content is '
                    + 'snapshotted first, so this restore can itself be undone.',
          },
        },
      },
    },
  ],

  views: [
    // LIST — the roster.  Rows carry name · role · status · lastSeen
    // (see the `toRow` mapping in src/cores.js).  Non-revoked only.
    {
      id:         'agents',
      title:      'Your agents',
      type:       'agent',
      labelField: 'name',
      dataSource: { skillId: 'listAgents' },
    },
    // DETAIL — one agent, record shape (mirrors stoop `settings` /
    // tasks-v0 `pod-settings`).  `agentId` is a RUNTIME-derived arg
    // (the selected row / URL), supplied via the fetch-section context
    // as `$agentId` (same pattern tasks-v0 uses for `$circleId`).
    // read-only: no `fields[]` — this slice has no patch surface.
    {
      id:       'agent-detail',
      title:    'Agent',
      type:     'agent',
      shape:    'record',
      readOnly: true,
      dataSource: {
        skillId:         'viewAgent',
        argsFromContext: { agentId: '$agentId' },
      },
    },

    /* ── INSTALL view — the curated catalogue (pluggable source) ───────
     * Browse installable agents (rows: id · name · description · declared
     * skills, exposed as `items` with id/label by listCatalogue). The
     * install act is the `add`-verb `installAgent` op, which auto-surfaces
     * as the "Install agent" affordance on the `agents` roster section
     * (verb === 'add' → section affordance). commons-governance: what the
     * catalogue contains / who curates it is the commons thread's call — this
     * view just renders whatever the source returns.
     */
    {
      id:         'catalogue',
      title:      'Agent catalogue',
      type:       'catalogue-entry',
      labelField: 'name',
      dataSource: { skillId: 'listCatalogue' },
    },

    /* ── RECOVERY views — "restore corrupted / lost data" by screen ──
     * Same op (`listDataVersions`) drives BOTH sections; the `uri`
     * context arg switches the mode (see the op's param comments).
     * `restoreDataVersion` surfaces on each row via its `surfaces.ui`
     * button + `appliesTo: {type: 'data-version'}` (danger confirm
     * already declared on the op — renderWeb projects it as an
     * itemAction with `confirm.severity: 'danger'`).
     */
    // LIST — the circle's version SERIES roster: every resource with
    // retained history (rows: uri · latestMs · count; the core also
    // exposes them as `items` with id/label ← uri for the list
    // renderer).  `$circleId` is the same runtime context arg the
    // tasks-v0 `pod-settings` view uses (— host supplies the
    // active circle).
    {
      id:         'data-versions',
      title:      'Data versions',
      type:       'data-version',
      labelField: 'uri',
      dataSource: {
        skillId:         'listDataVersions',
        argsFromContext: { circleId: '$circleId' },
      },
    },
    // DETAIL — ONE resource's versions newest-first (the restore
    // pick-list; rows: ts · id · sha256 · size · writer, exposed as
    // `items` with label ← ISO(ts) · id).  `$uri` is a NEW runtime
    // context arg: the host materializer supplies it from the row the
    // user picked in `data-versions` (same mechanism as
    // `$agentId` on agent-detail).  Stays a LIST (not shape:'record')
    // — the drilldown is itself a pick-list of versions.
    {
      id:         'data-version-detail',
      title:      'Version history',
      type:       'data-version',
      labelField: 'label',
      dataSource: {
        skillId:         'listDataVersions',
        argsFromContext: { circleId: '$circleId', uri: '$uri' },
      },
    },
  ],
};

export default agentsManifest;
