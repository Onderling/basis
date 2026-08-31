/**
 * basis v2 — the ENTRUST (toevertrouwen) MANDATE: the PURE, platform-agnostic
 * core shared by the web picker (`web/v2/mandatePicker.js`) and the mobile picker
 * (`apps/basis-mobile/src/screens/v2/CircleMandatePicker.js`).
 *
 * A mandate is bounded authority the task owner entrusts to one member for one
 * task. It is TEMPORARY (it lifts the moment the task closes — revoke-on-complete
 * is already wired) and BROKERED (your keys stay with you; only answers travel).
 *
 * Invariant #1/#3: the grant/attenuation/legibility DECISIONS live ONCE, here.
 * The shells are thin projectors — DOM (web) / RN (mobile) — that render these
 * pure results and dispatch the ALREADY-registered `attachTaskGrant` op through
 * their platform's confirm/gate waist. NO grant logic lives in a shell.
 *
 * WAARVOOR (the WHAT) is a DATA-DRIVEN grant-KIND taxonomy (not offerings-only),
 * so new kinds slot in with one entry. v1 kinds:
 *   - actAs    — "namens jou handelen": act on your behalf, unnarrowed.
 *   - offering — one of YOUR offerings (only offerings you hold appear → visible
 *                attenuation).
 *   - resource — "toegang tot een bron / iets voor je opvragen", brokered through
 *                your device. ISSUABLE (G20/#31): a grant mints a per-grain
 *                `res.read:<id>` capability that rides the PROVEN resourceKeyGrant /
 *                PodCapabilityToken verify path (J-keyexchange, no new crypto). The
 *                grant carries the GRAIN (item vs list, #28), the BROKER posture
 *                (device-default / companion, #29) and the USE-consent (requestable
 *                -default / standing, consent-on-use). A row per enumerated resource
 *                is issuable; when the caller surfaces NONE yet, the kind falls back
 *                to a single honest "nog niet actief" placeholder — the token path is
 *                wired, a resource-ENUMERATION surface is the remaining slice.
 */

import { translatorOr } from '../locales/translatorOr.js';

// ── Resource-access mandate constants (G20/#28–31) ──────────────────────────
//
// The per-resource READ scope contract. It MUST stay byte-identical to
// `@onderling/pod-client` sealing's `SCOPE_PREFIX` (`'res.read:'`) — the token
// this grant mints is verified against exactly that string by the resourceKeyGrant
// broker's `offeringMatches` gate (the J-keyexchange path). This module is PURE
// and consumed by the RN picker; `apps/basis-mobile` does NOT depend on
// pod-client, so we mirror the prefix here rather than import it. A drift-guard
// test (`apps/basis/test/v2/mandateResource.test.js`) asserts the two agree.
const RES_READ_PREFIX = 'res.read:';

/** Broker postures (#29). Device-default; companion is an optional fallback. */
export const RESOURCE_BROKERS = ['device', 'companion'];
export const DEFAULT_RESOURCE_BROKER = 'device';

/**
 * Use-consent modes (consent-on-use). `requestable` (default) — the receiver asks
 * the granter for a fresh yes/no on EACH use (the same `humanInTheLoop` consent
 * card, now over a resource). `standing` — pre-authorised, no per-use ask.
 */
export const RESOURCE_USE_MODES = ['requestable', 'standing'];
export const DEFAULT_RESOURCE_USE = 'requestable';

/**
 * The per-grain capability scope string. Pure; no crypto.
 *   - item → `res.read:<item-id>`        exact per-resource scope (offeringMatches
 *            in the resourceKeyGrant broker gives per-resource isolation).
 *   - list → `res.read:/list/<id>/`      a composable list-container/path scope
 *            (trailing-slash container form; prefix-covered by the pod-scope matcher).
 * @param {{grain?:'item'|'list', id:string}} o
 * @returns {string}
 */
export function resourceScope({ grain = 'item', id } = {}) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('resourceScope: id (non-empty string) required');
  }
  return grain === 'list' ? `${RES_READ_PREFIX}/list/${id}/` : RES_READ_PREFIX + id;
}

/**
 * Whether the holder must raise a fresh per-use consent (the `humanInTheLoop`
 * card) before USING a resource grant. `requestable` → true (ask each time);
 * `standing` → false (pre-authorised). Pure — the ladder both sides read.
 * @param {'requestable'|'standing'} [use]
 * @returns {boolean}
 */
export function resourceUseRequiresConsent(use) {
  return (use ?? DEFAULT_RESOURCE_USE) !== 'standing';
}

/**
 * Build the grant object dispatched with `attachTaskGrant`. Pure. Switches on the
 * grant KIND so adding a kind is one `case` + one taxonomy entry (below).
 *
 * @param {object} o
 * @param {'actAs'|'offering'|'resource'} [o.kind]  the grant kind (inferred from
 *   the other args when omitted: offeringKey → offering, scope → resource, else actAs)
 * @param {string} o.myWebid       the granter (acts as this identity — "namens jou")
 * @param {string} [o.offeringKey] narrow the mandate to one of MY offerings (its key)
 * @param {string} [o.scope]       the resource id/path the brokered grant targets
 * @param {'item'|'list'} [o.grain='item']        the resource grain (#28)
 * @param {'device'|'companion'} [o.broker='device'] the broker posture (#29)
 * @param {'requestable'|'standing'} [o.use='requestable'] the use-consent (consent-on-use)
 * @returns {object} a TaskGrant template ({ actingAs?, skill?, pod?, constraints })
 */
export function buildMandateGrant({ kind, myWebid, offeringKey, scope, grain, broker, use } = {}) {
  const k = kind ?? (offeringKey ? 'offering' : (scope ? 'resource' : 'actAs'));
  switch (k) {
    case 'offering':
      return {
        actingAs: myWebid,
        ...(offeringKey ? { skill: offeringKey } : {}),
        // Brokered by construction: keys stay with the granter, only answers travel.
        constraints: { broker: true },
      };
    case 'resource': {
      // Per-grain `res.read:<id>` capability — NOT the generic '*' skill +
      // constraints.pod — so the minted token rides the PROVEN resourceKeyGrant /
      // PodCapabilityToken verify path (#30, J-keyexchange). The device stays the
      // scope authority and keys never leave (`broker:true`, `via:'device'` by
      // default; switchable to `'companion'`). `use` carries the consent-on-use.
      const g   = grain  === 'list'      ? 'list'      : 'item';
      const via = broker === 'companion' ? 'companion' : 'device';
      const u   = use    === 'standing'  ? 'standing'  : 'requestable';
      return {
        skill: resourceScope({ grain: g, id: scope }),
        constraints: { broker: true, via, use: u, grain: g },
      };
    }
    case 'actAs':
    default:
      return { actingAs: myWebid, constraints: { broker: true } };
  }
}

/**
 * The grant-KIND taxonomy driving the WAARVOOR menu. Each spec expands into 0+
 * selectable option rows; adding a kind = one entry here. An option:
 *   `{ kind, id, label, params, active, note? }`
 * `params` is spread into `buildMandateGrant` on confirm; `active:false` rows are
 * shown (legible taxonomy) but not issuable (honest "nog niet actief").
 */
export const GRANT_KIND_SPECS = [
  {
    kind: 'actAs',
    expand: ({ tr }) => [{
      kind: 'actAs', id: 'actAs',
      label: tr('circle.mandate.on_your_behalf'),
      params: {}, active: true,
    }],
  },
  {
    kind: 'offering',
    groupLabelKey: 'circle.mandate.kind.offering',
    // One row per offering the owner HOLDS — visible attenuation. None held → none.
    expand: ({ offerings, tr }) => (Array.isArray(offerings) ? offerings : [])
      .filter((o) => o && o.key)
      .map((o) => ({
        kind: 'offering', id: `offering:${o.key}`,
        label: o.text || o.label || o.key,
        params: { offeringKey: o.key }, active: true,
      })),
  },
  {
    kind: 'resource',
    groupLabelKey: 'circle.mandate.kind.resource',
    // One row per resource the granter surfaces — item or list grain (#28). NOT
    // limited to already-shared items: anything the granter can access. When the
    // caller surfaces NONE yet (no enumeration surface), fall back to a single
    // honest "nog niet actief" placeholder — the token path IS wired, enumeration
    // is the remaining slice.
    expand: ({ resources, tr }) => {
      const list = (Array.isArray(resources) ? resources : []).filter((r) => r && r.id);
      if (list.length) {
        return list.map((r) => ({
          kind: 'resource', id: `resource:${r.id}`,
          label: r.label || r.id,
          params: { scope: r.id, grain: r.grain === 'list' ? 'list' : 'item' },
          active: true,
        }));
      }
      return [{
        kind: 'resource', id: 'resource',
        label: tr('circle.mandate.kind.resource'),
        note:  tr('circle.mandate.kind.resource_note'),
        params: {}, active: false,
      }];
    },
  },
];

/**
 * Expand the taxonomy into render-ready groups `[{ groupLabelKey, rows:[opt] }]`.
 * A kind that expands to zero rows (e.g. offerings when you hold none) is omitted.
 */
export function grantKindOptions({ offerings = [], resources = [], t } = {}) {
  const tr = translatorOr(t, 'mandate.js');
  const groups = [];
  for (const spec of GRANT_KIND_SPECS) {
    const rows = spec.expand({ offerings, resources, tr });
    if (rows.length) groups.push({ groupLabelKey: spec.groupLabelKey ?? null, rows });
  }
  return groups;
}

/** A member's display label — a short name, falling back to a trimmed WebID. */
export function memberLabel(m) {
  if (!m || typeof m !== 'object') return '';
  const name = m.name ?? m.displayName ?? m.label ?? '';
  if (name) return name;
  const w = m.webid ?? m.id ?? '';
  return typeof w === 'string' && w ? (w.split(/[/#]/).filter(Boolean).pop() || w).slice(0, 24) : '';
}

/** A member's WebID (the `member` arg for `attachTaskGrant`). */
export function memberWebid(m) {
  return (m && (m.webid ?? m.id)) || null;
}

/**
 * The selectable roster for the picker — everyone in the circle BUT me (you don't
 * entrust a task to yourself). Pure; both shells project this identical list.
 *
 * @param {object} o
 * @param {Array}  [o.members=[]]  the circle roster ({webid,name,…})
 * @param {string} [o.myWebid]     my WebID (dropped from the roster)
 * @returns {Array} the members minus myself, in source order
 */
export function mandateRoster({ members = [], myWebid = null } = {}) {
  return (Array.isArray(members) ? members : [])
    .filter((m) => memberWebid(m) && memberWebid(m) !== myWebid);
}

/**
 * Whether the confirm is issuable for the current selection. Confirmable ONLY for
 * a picked member AND an ISSUABLE grant kind — an inactive "nog niet actief" kind
 * (e.g. resource) is selectable/legible but never dispatched. Pure; the one
 * gate both shells check before enabling their confirm button.
 */
export function mandateConfirmEnabled({ busy = false, pickedMember = null, pickedWhat = null } = {}) {
  return !busy && !!pickedMember && !!(pickedWhat && pickedWhat.active);
}

/**
 * Build the `{ taskId, member, grant }` payload the shells hand to `onConfirm`
 * (which dispatches `attachTaskGrant`). Returns null when the selection is not
 * issuable (no member, or an inactive kind), so a shell can't dispatch a
 * "nog niet actief" grant even if its button-gating slips. Pure.
 *
 * @param {object} o
 * @param {string} [o.taskId]
 * @param {string} [o.myWebid]      the granter (actingAs)
 * @param {string} [o.pickedMember] the WebID of the entrusted member
 * @param {object} [o.pickedWhat]   the selected grant-kind option ({kind,params,active})
 * @param {'device'|'companion'} [o.pickedBroker] the broker posture (resource kind only, #29)
 * @param {'requestable'|'standing'} [o.pickedUse] the use-consent (resource kind only)
 * @returns {{taskId, member, grant}|null}
 */
export function mandateConfirmPayload({
  taskId = null, myWebid = null, pickedMember = null, pickedWhat = null,
  pickedBroker = null, pickedUse = null,
} = {}) {
  if (!mandateConfirmEnabled({ pickedMember, pickedWhat })) return null;
  // The broker posture + use-consent apply ONLY to the resource kind; folding them
  // in for actAs/offering would be a no-op arg but is skipped to keep those grants
  // byte-identical.
  const extra = pickedWhat.kind === 'resource'
    ? { broker: pickedBroker ?? DEFAULT_RESOURCE_BROKER, use: pickedUse ?? DEFAULT_RESOURCE_USE }
    : {};
  return {
    taskId,
    member: pickedMember,
    grant: buildMandateGrant({ myWebid, kind: pickedWhat.kind, ...pickedWhat.params, ...extra }),
  };
}

/**
 * The pure legibility rows for a task's existing mandates — who + what — resolved
 * from the roster + offerings. Both the web DOM legibility list and the mobile
 * legibility list project these identical rows (invariant #3). A malformed grant
 * (no `member`) is skipped.
 *
 * @param {Array<{member:string, skill?:string}>} grants
 * @param {object} [o]
 * @param {Array} [o.members=[]]    roster, to resolve a member label
 * @param {Array} [o.offerings=[]]  MY offerings, to resolve a skill label
 * @param {function} [o.t]
 * @returns {Array<{member:string, who:string, what:string}>}
 */
export function mandateLegibilityRows(grants, { members = [], offerings = [], t } = {}) {
  const tr = translatorOr(t, 'mandate.js');
  const byWebid = new Map((members || []).map((m) => [(m && (m.webid ?? m.id)) || '', m]));
  const offeringLabel = new Map((offerings || []).filter((o) => o && o.key).map((o) => [o.key, o.text || o.label || o.key]));
  const out = [];
  for (const g of (Array.isArray(grants) ? grants : [])) {
    if (!g || !g.member) continue;
    const who = memberLabel(byWebid.get(g.member))
      || (typeof g.member === 'string' ? (g.member.split(/[/#]/).filter(Boolean).pop() || g.member).slice(0, 24) : '');
    // A resource grant records its scope in `skill` as `res.read:<id>` — show it as
    // an entrusted resource (the raw scope is not a member offering), not a raw key.
    const isResource = typeof g.skill === 'string' && g.skill.startsWith(RES_READ_PREFIX);
    const what = isResource
      ? tr('circle.mandate.resource.entrusted', { resource: g.skill.slice(RES_READ_PREFIX.length) })
      : (g.skill ? (offeringLabel.get(g.skill) || g.skill) : tr('circle.mandate.on_your_behalf'));
    out.push({ member: g.member, who, what });
  }
  return out;
}
