/**
 * basis v2 — local-network "who's here" model.
 *
 * The launcher's passive "Nearby N device(s)" row (5.9c) is the count
 * signal; is the dedicated `HIER` screen reached from the
 * launcher: a list of people on the same WiFi/BLE with their public
 * skills, with a "X of N share skills with you" header + a "What
 * others see of you" footer.
 *
 * This module is the pure projection: hosts pass the raw peer list
 * (from `MdnsTransport.peers`) + the local user's published skills,
 * and get back a render-ready `{rows, header, ownProfile}` shape.
 * The chat-shell integration (new RN screen, web renderer, tab-bar
 * entry, mDNS TXT-record skill-broadcast) is the follow-up.
 *
 * V0 substrate gap: peers don't carry skills over mDNS today.  The
 * helper accepts `peer.skills` when present + falls back to "no skill
 * intersection" for everyone else, so the screen renders honestly
 * (people are visible; their skills are blank until the broadcast
 * lands).
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';
import { translatorOr } from '../locales/translatorOr.js';

// Parameter register (#36) — how many shared skills a nearby row shows (scope:device, kind:internal — a
// render cap). Caller-overridable via arg. `param()` returns 3 unchanged.
const SHARED_SKILLS_DEFAULT_MAX = param({ key: 'circleNearby.maxSharedSkillsPerRow', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 3 });

/**
 * Build the Nearby model from raw peers + the local user's skills.
 *
 * @param {object}   args
 * @param {object[]} [args.peers=[]]
 *   `{ pubKey, pseudonym?, displayName?, source?: 'mdns'|'ble',
 *      proximity?: 'wifi'|'<10m', skills?: Array<string|{text}>,
 *      lastSeen?: number }[]`
 * @param {Array<string|object>} [args.mySkills=[]]
 *   Local user's published skills (public-tier).
 * @param {string} [args.myPseudonym]
 * @param {function} [args.t]                 host translator
 * @param {number}   [args.maxSharedSkillsPerRow]
 * @returns {{
 *   rows: Array<{ id:string, pseudonym:string, source:'mdns'|'ble'|'unknown',
 *                 proximity:string|null, sharedSkills:string[], allSkills:string[],
 *                 sharesAny:boolean, lastSeen:number|null }>,
 *   counts: { total:number, sharingAny:number },
 *   ownProfile: { pseudonym:string, publishedSkills:string[] },
 *   headerLabel: string,
 * }}
 */
export function buildNearbyModel({
  peers = [],
  mySkills = [],
  myPseudonym = null,
  t,
  maxSharedSkillsPerRow = SHARED_SKILLS_DEFAULT_MAX,
} = {}) {
  const tr = translatorOr(t, 'circleNearby.js');
  const myKeyed = new Set(asArray(mySkills).map(pickSkillKey).filter(Boolean));
  const myPublishedSkills = asArray(mySkills).map(pickSkillText).filter(Boolean);

  const rows = asArray(peers)
    .filter((p) => p && typeof p === 'object')
    .map((peer) => {
      const skills = asArray(peer.skills).map(pickSkillText).filter(Boolean);
      const skillKeys = skills.map(pickSkillKeyFromText).filter(Boolean);
      const shared = skillKeys
        .filter((k) => myKeyed.has(k))
        .slice(0, Math.max(0, maxSharedSkillsPerRow | 0));
      // Map back to the user-facing text so rows show "fietsband plakken"
      // not the normalised key.
      const sharedText = shared.map((k) => skills[skillKeys.indexOf(k)]);
      return {
        id:           peer.pubKey ?? peer.id ?? null,
        pseudonym:    pickPeerLabel(peer) ?? tr('circle.nearbyScreen.anon_peer'),
        source:       isSource(peer.source) ? peer.source : 'unknown',
        proximity:    typeof peer.proximity === 'string' ? peer.proximity : null,
        sharedSkills: sharedText,
        allSkills:    skills,
        sharesAny:    sharedText.length > 0,
        lastSeen:     typeof peer.lastSeen === 'number' ? peer.lastSeen : null,
      };
    });

  // Sort: shares-any first (then by shared count desc), then anonymous
  // strangers, both buckets newest-first by lastSeen.
  rows.sort((a, b) => {
    if (a.sharesAny !== b.sharesAny) return a.sharesAny ? -1 : 1;
    if (a.sharedSkills.length !== b.sharedSkills.length) {
      return b.sharedSkills.length - a.sharedSkills.length;
    }
    return (b.lastSeen ?? 0) - (a.lastSeen ?? 0);
  });

  const total = rows.length;
  const sharingAny = rows.filter((r) => r.sharesAny).length;

  return {
    rows,
    counts: { total, sharingAny },
    ownProfile: {
      pseudonym:       typeof myPseudonym === 'string' && myPseudonym ? myPseudonym : null,
      publishedSkills: myPublishedSkills,
    },
    headerLabel: total === 0
      ? tr('circle.nearbyScreen.header_empty')
      : tr('circle.nearbyScreen.header', { total, sharing: sharingAny }),
  };
}

/* ──────────────────────────────────────────────────────────────────
 * Internals — exposed for tests.
 * ────────────────────────────────────────────────────────────────── */

/** Skill normalisation: same shape rule as findOfferingMatches but keyed. */
export function pickSkillText(s) {
  if (typeof s === 'string') return s.trim();
  if (!s || typeof s !== 'object') return null;
  for (const k of ['text', 'label', 'title', 'what']) {
    if (typeof s[k] === 'string' && s[k].trim()) return s[k].trim();
  }
  return null;
}

export function pickSkillKey(s) {
  return pickSkillKeyFromText(pickSkillText(s));
}
function pickSkillKeyFromText(t) {
  if (typeof t !== 'string' || !t.trim()) return null;
  return t.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function pickPeerLabel(peer) {
  if (!peer || typeof peer !== 'object') return null;
  for (const k of ['pseudonym', 'displayName', 'handle', 'label', 'name']) {
    if (typeof peer[k] === 'string' && peer[k].trim()) return peer[k].trim();
  }
  // Last resort: short-suffix the pubKey so rows are distinguishable
  // without leaking the whole identity.  Anonymous-by-default per design.
  if (typeof peer.pubKey === 'string' && peer.pubKey.length >= 8) {
    return `peer-${peer.pubKey.slice(0, 6)}`;
  }
  return null;
}

function asArray(v) { return Array.isArray(v) ? v : []; }
function isSource(s) { return s === 'mdns' || s === 'ble'; }
