/**
 * MemberMap — webid ↔ external-id mapping for multi-member apps.
 *
 * Per L1h sketch: H2/H4/H5 use this to resolve "the Telegram user
 * with bridgeUid X" to a webid + display name + role.  Lightweight
 * data layer; pure in-memory + initial-state-from-pod-config
 * pattern.
 *
 * `MemberMap` is the **display/identity-projection** layer — it sits
 * IN FRONT of `core.GroupManager`'s cryptographic-membership layer.
 * They key on different things and serve different consumers:
 * `MemberMap` keys on `webid` for ergonomic resolution; `GroupManager`
 * keys on Ed25519 `pubKey` for signed-proof checks.  The two are
 * complementary, not redundant.
 *
 * **`role` on a member is a SNAPSHOT, not authoritative.**  For
 * permission gating, consult `GroupManager.getRole(pubKey, groupId)`
 * or `PolicyEngine.checkInbound(...)`.  Roles in `MemberMap` are
 * convenience for UI / logging; if the snapshot drifts from
 * `GroupManager` truth, GroupManager wins.
 */

import { Emitter } from '@onderling/core';

export class MemberMap extends Emitter {
  /** @type {Map<string, object>} */
  #byWebid = new Map();

  /**
   * @param {object} [opts]
   * @param {Array<object>} [opts.initial]    array of {webid, handle?, displayName?, pubKey?, avatarUrl?, externalIds?, role?}
   */
  constructor({ initial } = {}) {
    super();
    if (Array.isArray(initial)) {
      for (const m of initial) {
        if (m?.webid) this.#byWebid.set(m.webid, this.#normalise(m));
      }
    }
  }

  /**
   * Read a group config file from a Solid pod and populate a MemberMap.
   *
   * Composes `@onderling/pod-client.PodClient` via runtime injection — the
   * substrate does NOT static-import pod-client. Apps that only use the
   * in-memory path don't need pod-client installed.  Apps that DO want
   * pod-config-backed rosters pass their own constructed `PodClient`
   * (see `apps/folio-mobile/src/lib/serviceBuilder.js` for the canonical
   * `PodClient` construction pattern).
   *
   * Schema (per H5 design — `Project Files/Substrates/apps/H5-neighbourhood.md`):
   *
   *     { members: [
   *         { webid, displayName?, pubKey?, externalIds?, role? },
   *         ...
   *       ]
   *     }
   *
   * The `pubKey` slot is required by L1e (`@onderling/offering-match`) for
   * `pubSub.subscribe(agent, peerAddress, ...)` against group members.
   * Apps that don't use skill-match over pubSub can omit it.
   *
   * NOT_FOUND tolerance: bootstrap-time the config may not exist yet.
   * Apps that want strict mode pass no `fallback`; the call rethrows
   * the underlying NOT_FOUND.  Apps that prefer "empty roster on first
   * boot" pass `fallback: []`.
   *
   * @param {object} args
   * @param {{read: (uri: string, opts?: object) => Promise<{content: any}>}} args.podClient
   * @param {string} args.configUri
   * @param {Array<object>} [args.fallback]   used iff config returns NOT_FOUND
   * @returns {Promise<MemberMap>}
   */
  static async fromPodConfig({ podClient, configUri, fallback } = {}) {
    if (!podClient || typeof podClient.read !== 'function') {
      throw new TypeError('MemberMap.fromPodConfig: podClient with read() required');
    }
    if (typeof configUri !== 'string' || !configUri) {
      throw new TypeError('MemberMap.fromPodConfig: configUri required');
    }
    let members;
    try {
      const res = await podClient.read(configUri, { decode: 'json' });
      const content = res?.content;
      // Tolerate either {content: parsedJson} or {content: rawString}
      // depending on whether the caller's PodClient parses ahead of time.
      const parsed = typeof content === 'string'
        ? safeJsonParse(content)
        : content;
      members = Array.isArray(parsed?.members) ? parsed.members : [];
    } catch (err) {
      if (err?.code === 'NOT_FOUND' && Array.isArray(fallback)) {
        members = fallback;
      } else {
        throw err;
      }
    }
    return new MemberMap({ initial: members });
  }

  /**
   * Add or update a member.
   *
   * @param {object} m
   * @param {string} m.webid
   * @param {string} [m.handle]
   *   Lowercase, user-set primary UI identifier (e.g. 'oosterpoort-bird-23').
   *   Stoop-shape addition: when present, apps render `@<handle>` rather
   *   than `displayName` until a reveal happens.  Optional; legacy
   *   consumers (H2/H4) leave this absent.
   * @param {string} [m.displayName]
   *   Real / chosen display name.  Treated as opt-in-to-show when paired
   *   with a Reveals store (see ./Reveals.js).
   * @param {string} [m.avatarUrl]
   *   Optional avatar image URL.
   * @param {string} [m.stableId]
   *   Stoop V1 Phase 11 (2026-05-06): the SDK-level stable user
   *   identifier (`@onderling/core/identity/AgentIdentity.stableId`).
   *   Survives handle changes, network-pubkey rotations, pod-less
   *   users, and pod migrations.  Apps key mute / ban / report on
   *   this rather than on `webid`.  Optional — legacy consumers
   *   leave it absent.
   * @param {Array<{categoryId: string, freeTags?: string[], availability?: string, radius?: string, status?: string}>} [m.offerings]
   *   Per-member offerings profile (the human "I can do X" data). Legacy
   *   callers pass `skills`; it is read-accepted and normalised into
   *   `offerings` (with a transitional `skills` read-alias).  `categoryId`
   *   picks from a fixed taxonomy (canonical home:
   *   `@onderling/agent-registry` `OFFERINGS_TAXONOMY`).  `status` ∈
   *   `'active' | 'paused' | 'archived'` (+; legacy Dutch
   *   values `actief|gepauzeerd|gearchiveerd` are auto-translated).  Optional; legacy
   *   consumers leave it absent.
   * @param {Object<string, string>} [m.externalIds]   {telegramUid, email, ...}
   * @param {string} [m.role]
   */
  async addMember(m) {
    if (!m?.webid) throw new TypeError('addMember: webid required');
    const isNew = !this.#byWebid.has(m.webid);
    const merged = this.#normalise({
      ...(this.#byWebid.get(m.webid) ?? {}),
      ...m,
    });
    this.#byWebid.set(m.webid, merged);
    this.emit(isNew ? 'member-added' : 'member-updated', { ...merged });
    return { ...merged };
  }

  /**
   * Remove a member.
   *
   * @param {string} webid
   */
  async removeMember(webid) {
    const had = this.#byWebid.delete(webid);
    if (had) this.emit('member-removed', { webid });
  }

  /**
   * Resolve by external-id namespace+value.
   *
   * @param {string} ns          e.g. 'telegramUid'
   * @param {string} value
   * @returns {Promise<object|null>}
   */
  async resolveByExternalId(ns, value) {
    for (const m of this.#byWebid.values()) {
      if (m.externalIds?.[ns] === value) return { ...m };
    }
    return null;
  }

  /**
   * Resolve by webid.
   *
   * @param {string} webid
   * @returns {Promise<object|null>}
   */
  async resolveByWebid(webid) {
    const m = this.#byWebid.get(webid);
    return m ? { ...m } : null;
  }

  /**
   * Resolve by `stableId` (Stoop V1 Phase 11).  Returns the first
   * member whose `stableId` matches.  O(N) scan — fine for the
   * hundreds-of-members closed-group case.
   *
   * @param {string} stableId
   * @returns {Promise<object|null>}
   */
  async resolveByStableId(stableId) {
    if (!stableId) return null;
    for (const m of this.#byWebid.values()) {
      if (m.stableId === stableId) return { ...m };
    }
    return null;
  }

  /**
   * Resolve display-name (case-insensitive substring) → first match.
   *
   * @param {string} name
   * @returns {Promise<object|null>}
   */
  async resolveByName(name) {
    const lower = name.toLowerCase();
    for (const m of this.#byWebid.values()) {
      if ((m.displayName ?? '').toLowerCase().includes(lower)) return { ...m };
    }
    return null;
  }

  /**
   * @returns {Promise<object[]>}
   */
  async list() {
    return [...this.#byWebid.values()].map((m) => ({ ...m }));
  }

  #normalise(m) {
    return {
      webid:       m.webid,
      // handle: lowercase Telegram-style primary UI identifier.
      // When present, `Resolver.resolve()` returns it by default;
      // displayName is only surfaced after a reveal.  Optional —
      // legacy consumers (H2/H4) leave it absent.
      handle:      m.handle ?? null,
      displayName: m.displayName ?? null,
      // avatarUrl: optional avatar image URL (any URI).
      avatarUrl:   m.avatarUrl ?? null,
      // stableId: SDK-level "this person" key (Stoop V1 Phase 11).
      // Survives handle changes + network-pubkey rotations.  Apps
      // key mute / ban / report on this.  Optional.
      stableId:    m.stableId ?? null,
      // offerings: per-member offerings profile (the human "I can do X" data).
      // Each item: {categoryId, freeTags?, radius?, status?}.
      // Status: 'active' | 'paused' | 'archived' (English) — the
      // offer on/off, DISTINCT from when-I'm-reachable.
      // Legacy V1/V2 vault entries used Dutch (`actief`/`gepauzeerd`/
      // `gearchiveerd`); translated on read for back-compat.
      // NOTE: the old per-offering `availability` sub-field is DROPPED
      // (availability unification, NOTE-skills-properties-audit 4 5):
      // reachability is now the ONE member-level `availability` below, which
      // offerings reference — they no longer each carry a copy.
      // READ-ACCEPT: legacy stored members use the field name `skills`; we
      // accept it on input and expose the canonical `offerings` field, plus
      // a transitional `skills` read-alias (below) for readers not yet
      // migrated. Optional — consumers without offerings leave it absent (= null).
      offerings:   _normaliseOfferings(m.offerings ?? m.skills),
      // Transitional read-alias — legacy field name, same data. Remove once
      // all readers (stoop profile ops, the mobile profile UIs) move to
      // `offerings`.
      skills:      _normaliseOfferings(m.offerings ?? m.skills),
      // availability: the UNIFIED person-level reachability state
      // ('open' | 'limited' | 'away'), projected onto the roster for
      // skill-match routing (availability unification decision). 'away'
      // IS holiday mode (the coarse rung). Skill-match routes around a member
      // whose availability is 'away'.  Optional — absent reads as available.
      availability: (m.availability === 'open' || m.availability === 'limited' || m.availability === 'away')
        ? m.availability : null,
      // holidayMode: legacy cross-device flag (Stoop V2 Phase 23.4), now the
      // 'away' value of `availability` above. Kept mirrored so the old stoop
      // setHolidayMode/getHolidayMode ops + the UI banner keep working (thin
      // shim). Optional — defaults to false.
      holidayMode: m.holidayMode === true,
      // pubKey: Ed25519 pubkey of this member's agent. Required by
      // L1e (skill-match) which subscribes to peer pubsub by pubkey.
      // Optional — apps that don't use pubsub can omit.
      pubKey:      m.pubKey ?? null,
      // circleAddress: the per-circle ADDRESS this member presents in THIS
      // circle (identity substrate step 5B/C — deriveCircleAddress). Unlike
      // pubKey (the member's cross-circle transport identity), this is a
      // circle-scoped, unlinkable public key: other members/software cannot
      // correlate it to the member's addresses in other circles. Recorded on
      // redeem/create and surfaced by listGroupMembers. Optional — a member
      // who joined before the substrate shipped simply has none.
      circleAddress: m.circleAddress ?? null,
      // personaProperties: the coarse background values this member CHOSE to disclose in THIS circle when
      // they joined AS a persona (property layer — getPersonaRelease). A map {key: coarseValue}; opt-in
      // (default-withhold → absent). Recorded on redeem/create + surfaced by listGroupMembers, like circleAddress.
      personaProperties: (m.personaProperties && typeof m.personaProperties === 'object') ? m.personaProperties : null,
      // nknAddr: this member's NKN peer address (2026-05-27).  Used
      // by the chat-shell to route DMs over NKN after a /share-my-
      // contact QR exchange — addContactFromQr reads it from the
      // scanned card.  Independent of pubKey (which is the long-
      // term identity key) — nknAddr can rotate per session.
      nknAddr:     m.nknAddr ?? null,
      // ── Stoop V2 Phase 24: contact-graph fields (additive) ──
      // relation: distinguishes group members (default for back-compat
      //   with V1 callers) from 1:1 contacts.  5.6 (basis v2) added
      //   `'agent'` for members whose own WebID is an LLM-backed peer
      //   over NKN — same membership stack as a human, just marked so
      //   per-circle override gates (agents-filter) can route
      //   them differently.  Apps that don't model contacts/agents
      //   leave this as 'group-member'.
      relation:    m.relation === 'contact' ? 'contact'
                 : m.relation === 'agent'   ? 'agent'
                 : 'group-member',
      // trustLevel: per-contact trust gradient. Two levels in Stoop V2;
      //   apps may extend.  Null when not set (e.g. for 'group-member').
      trustLevel:
        m.trustLevel === 'bekend' || m.trustLevel === 'vertrouwd'
          ? m.trustLevel
          : null,
      // tags: user's free labels for THIS contact ('koor', 'familie', …).
      //   Personal taxonomy; not visible to the contact themselves.
      tags:        Array.isArray(m.tags) ? [...m.tags] : [],
      // shareLocation: do I share my coarse location with this contact?
      //   Only meaningful at trustLevel 'vertrouwd' or higher.  Default false.
      shareLocation:    m.shareLocation === true,
      // allowHopThrough: may this contact relay through my device?
      //   Gated by the global hop toggle in Settings (also default off).
      allowHopThrough:  m.allowHopThrough === true,
      // allowAutomatching: accept inbound auto-skillmatch hints from
      //   this contact?  Default true — silent-on-no-match by design.
      allowAutomatching: m.allowAutomatching === false ? false : true,
      // location: optional coarse-grain location ({cell, label, source}).
      //   Phase 26 wires this; here only the slot exists for forward-compat.
      location:    m.location && typeof m.location === 'object'
        ? {
            cell:   m.location.cell   ?? null,
            label:  m.location.label  ?? null,
            source: m.location.source ?? null,
          }
        : null,
      externalIds: m.externalIds ? { ...m.externalIds } : {},
      role:        m.role ?? null,
    };
  }
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * Normalise a stored offerings array (each {categoryId, freeTags?, radius?,
 * status?}); legacy Dutch status values translated. Returns null when absent.
 */
function _normaliseOfferings(list) {
  if (!Array.isArray(list)) return null;
  return list.map(s => ({
    categoryId: s.categoryId,
    freeTags:   Array.isArray(s.freeTags) ? [...s.freeTags] : [],
    radius:     s.radius ?? null,
    status:     _translateLegacyStatus(s.status) ?? 'active',
  }));
}

/**
 * Translate legacy Dutch skill-status values to + English.
 * One-shot back-compat shim: V1/V2 vaults stored
 * 'actief'/'gepauzeerd'/'gearchiveerd'; everything past uses
 * English.  Unknown values pass through unchanged.
 */
const LEGACY_STATUS_MAP = Object.freeze({
  actief:       'active',
  gepauzeerd:   'paused',
  gearchiveerd: 'archived',
});
function _translateLegacyStatus(s) {
  if (typeof s !== 'string') return s ?? null;
  return LEGACY_STATUS_MAP[s] ?? s;
}
