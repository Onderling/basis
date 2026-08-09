/**
 * circleHop — the SOCIAL match-hop (contact-discovery), shared web + mobile.
 *
 * "Second-degree via contacts": a skill question with no direct match may,
 * IF an intermediary allows it, relay ONE hop to their contacts — per-contact
 * permission, max one hop, anonymized. This is DISCOVERY (find someone with a
 * skill), not routing.
 *
 * NOT the transport-hop. The `'hop'` in `@onderling/core`'s
 * `routing/ReachabilityTier.js` / `routing/hopTunnel.js` is a different
 * concept entirely: peer-as-relay message ROUTING (forward a payload through
 * an intermediary peer to reach a target). This module never touches routing;
 * it decides whether to ASK a contact to search one degree further.
 *
 * This board is UI around an existing Stoop primitive: the global stance is
 * `getHopMode`/`setHopMode` (`bundle.settings.allowHopThrough`), and
 * per-contact `hopThrough` flags live in Stoop already. This module is the
 * pure glue: normalize the hop mode, model a 1-hop relay chain for the match
 * card, and shape the (anonymized) relay request. The host calls the Stoop
 * skills + sends.
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';   // re-exported from @onderling/core

/** Hard ceiling — hopping is strictly second-degree. (scope:device, kind:internal — a fixed bound.) */
export const MAX_HOPS = param({ key: 'kringHost.maxHops', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 1 });

/** Normalize a `getHopMode` reply to `{ global }`. */
export function normalizeHopMode(raw) {
  return { global: !!(raw && raw.global) };
}

/**
 * Model a relay chain requester → gate(s) → target for the hop-match card.
 * Each step is `{ role, id, label }` with role 'me' | 'gate' | 'target'.
 * `hops` = number of intermediaries; `withinLimit` enforces MAX_HOPS.
 *
 * @param {object}   [opts]
 * @param {object}   [opts.requester]  { id, label }
 * @param {object[]} [opts.gates=[]]   [{ id, label }] intermediaries (gate must allow relay)
 * @param {object}   [opts.target]     { id, label }
 */
export function buildHopChain({ requester = {}, gates = [], target = {} } = {}) {
  const step = (role, p = {}) => ({ role, id: p.id ?? null, label: p.label ?? p.id ?? '' });
  const gateList = Array.isArray(gates) ? gates : [];
  const steps = [
    step('me', requester),
    ...gateList.map((g) => step('gate', g)),
    step('target', target),
  ];
  const hops = gateList.length;
  return { steps, hops, withinLimit: hops >= 1 && hops <= MAX_HOPS };
}

/**
 * Shape an anonymized relay request to ask a gate to forward a skill query.
 * Pure — the host sends it over the existing Stoop hop path. Anonymized by
 * default: the gate sees the skill, not the requester's identity.
 */
export function makeHopRelayRequest({ skill, gate = {}, anonymized = true } = {}) {
  return {
    type:       'hop-relay-request',
    skill:      skill ?? null,
    gateId:     gate.id ?? null,
    anonymized: anonymized !== false,
    hops:       1,
  };
}
