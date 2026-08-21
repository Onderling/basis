/**
 * ENROLL OFFER — the add-a-device QR (`onderling-enroll://`): the transport bootstrap a fresh
 * install needs so the enrolled boot can reach the world without hand-carried knowledge.
 *
 * The ceremony itself is untouched: the recovery PHRASE is typed on the NEW device, never
 * transmitted — that is the enrollment authority, and it stays out of this offer entirely. What
 * the offer carries is the NON-SECRET context the new device cannot derive from the phrase:
 *
 *   • a relay hint — where this person's circles are reachable;
 *   • per circle: the id, the handle used there, and the EXISTING device's per-circle address —
 *     the SIBLING the new device announces its own fresh address to, and pulls membership +
 *     governance catch-up from (the roster rebuilds by fold admission; the rules doc arrives by
 *     the rules-update rider).
 *
 * Public by design, exactly like the connect offer: whoever holds it learns circle ids and one
 * member's per-circle addresses — the same facts every circle member already holds — and can DO
 * nothing with it: enrolling still takes the phrase. A DISTINCT scheme from `onderling-connect://`
 * on purpose (recorded rule): enrolling makes a DEVICE (keys, ceremony, phrase), connecting makes
 * a CONNECTION (ticks only), and a QR code is the one moment a person is choosing between them.
 *
 *   existing device                          new device (fresh install)
 *   ───────────────                          ──────────────────────────
 *   buildEnrollOffer → show QR / copy ──▶    scan or paste, STASH (plain storage — non-secret)
 *                                            type the PHRASE (the ceremony, unchanged) → reload
 *                                            boot: consumeEnrollOffer —
 *                                              registry membership records (future boots reopen)
 *                                              install per-circle identities
 *                                              announce own address to the sibling
 *                                              pull membership + governance catch-up from it
 */
import { CIRCLE_ADDRESS_ANNOUNCE_KIND, ownAnnouncementFor } from './circleAddressAnnounce.js';
import { MEMBERSHIP_CATCHUP_SUBTYPES } from './membershipRail.js';
import { GOV_CATCHUP_REQUEST } from './governanceCatchUp.js';

/** The scheme. Distinct from `onderling-connect://` — see the header. */
export const ENROLL_SCHEME = 'onderling-enroll://';

/** Where a scanned/pasted offer waits out the ceremony reload (plain storage — it is public data). */
export const ENROLL_OFFER_STORAGE_KEY = 'onderling.enrollOffer';

const b64url = {
  encode(obj) {
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(str) {
    const pad = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  },
};

/**
 * Build the offer URI the existing device shows.
 * @param {object} a
 * @param {string[]} [a.relays]   relay url hint(s)
 * @param {Array<{id: string, handle?: ?string, address: string}>} a.circles
 *   per circle: the id, the handle this person uses there (null when unknown — the registry write
 *   is then skipped at consume, the live bootstrap still runs), and the EXISTING device's proven
 *   per-circle address (the sibling target).
 * @returns {string} an `onderling-enroll://…` URI
 */
export function encodeEnrollOffer({ relays = [], circles = [] } = {}) {
  const c = (Array.isArray(circles) ? circles : [])
    .filter((x) => x && typeof x.id === 'string' && x.id && typeof x.address === 'string' && x.address)
    .map((x) => ({ id: x.id, ...(typeof x.handle === 'string' && x.handle ? { h: x.handle } : {}), a: x.address }));
  if (c.length === 0) throw new Error('encodeEnrollOffer: at least one circle with an address is required');
  const r = (Array.isArray(relays) ? relays : []).filter((u) => typeof u === 'string' && u);
  return ENROLL_SCHEME + b64url.encode({ v: 1, ...(r.length ? { r } : {}), c });
}

/**
 * Parse an offer. Deny-safe: every failure is a REASON, never a partial object.
 * @param {string} uri
 * @returns {{ok:true, relays:string[], circles:Array<{id:string, handle:?string, address:string}>}
 *          |{ok:false, reason:'not-an-enroll-uri'|'unreadable'|'wrong-version'|'incomplete'}}
 */
export function parseEnrollOffer(uri) {
  if (typeof uri !== 'string' || !uri.trim().startsWith(ENROLL_SCHEME)) return { ok: false, reason: 'not-an-enroll-uri' };
  let body;
  try { body = b64url.decode(uri.trim().slice(ENROLL_SCHEME.length)); }
  catch { return { ok: false, reason: 'unreadable' }; }
  if (!body || typeof body !== 'object') return { ok: false, reason: 'unreadable' };
  if (body.v !== 1) return { ok: false, reason: 'wrong-version' };
  const circles = (Array.isArray(body.c) ? body.c : [])
    .filter((x) => x && typeof x.id === 'string' && x.id && typeof x.a === 'string' && x.a)
    .map((x) => ({ id: x.id, handle: typeof x.h === 'string' && x.h ? x.h : null, address: x.a }));
  if (circles.length === 0) return { ok: false, reason: 'incomplete' };
  const relays = (Array.isArray(body.r) ? body.r : []).filter((u) => typeof u === 'string' && u);
  return { ok: true, relays, circles };
}

/* ── The link form — the same offer as a clickable https URL ──────────────────────────────────
 * A custom scheme is scannable but not clickable in a browser; the LINK form wraps the identical
 * payload in the web app's own URL (`…/#enroll=<payload>`), so the person chooses how to share:
 * scan the QR, or send the link. The web app reads the hash at load, stashes the offer, and opens
 * the enroll flow. Same public-by-design posture — the link carries exactly what the QR carries. */

export const ENROLL_LINK_PARAM = 'enroll';

/**
 * The clickable form of an offer URI.
 * @param {string} appUrl  the web app's base URL (origin + path, no hash)
 * @param {string} uri     an `onderling-enroll://…` offer (validated)
 * @returns {{ok:true, link:string}|{ok:false, reason:string}}
 */
export function enrollOfferLink(appUrl, uri) {
  const parsed = parseEnrollOffer(uri);
  if (!parsed.ok) return parsed;
  if (typeof appUrl !== 'string' || !/^https?:\/\//.test(appUrl)) return { ok: false, reason: 'bad-app-url' };
  const base = appUrl.split('#')[0];
  return { ok: true, link: `${base}#${ENROLL_LINK_PARAM}=${uri.trim().slice(ENROLL_SCHEME.length)}` };
}

/**
 * Recover the offer from a link (or from a raw location hash). Accepts a full href, a bare
 * `#enroll=…` hash, or — for one paste box that takes anything — a raw `onderling-enroll://` URI.
 * @param {string} hrefOrHash
 * @returns {{ok:true, uri:string, relays:string[], circles:object[]}|{ok:false, reason:string}}
 */
export function enrollOfferFromLink(hrefOrHash) {
  if (typeof hrefOrHash !== 'string' || !hrefOrHash) return { ok: false, reason: 'not-an-enroll-link' };
  const s = hrefOrHash.trim();
  if (s.startsWith(ENROLL_SCHEME)) {
    const parsed = parseEnrollOffer(s);
    return parsed.ok ? { ...parsed, uri: s } : parsed;
  }
  const hashIdx = s.indexOf('#');
  const hash = hashIdx >= 0 ? s.slice(hashIdx + 1) : s;
  const m = new RegExp(`(?:^|&)${ENROLL_LINK_PARAM}=([^&]+)`).exec(hash);
  if (!m) return { ok: false, reason: 'not-an-enroll-link' };
  const uri = ENROLL_SCHEME + m[1];
  const parsed = parseEnrollOffer(uri);
  return parsed.ok ? { ...parsed, uri } : parsed;
}

/* ── The stash — the offer must survive the ceremony's reload ─────────────────────────────────
 * `storage` is duck-typed {getItem, setItem, removeItem} (localStorage on web, AsyncStorage on
 * mobile — both shapes work; results are awaited). Plain storage on purpose: the offer is public
 * data, and the sealed vaults are re-keyed mid-ceremony — exactly the wrong home for it. */

export async function stashEnrollOffer(storage, uriOrLink) {
  // One paste box takes anything: the raw `onderling-enroll://` code OR the clickable link form.
  const parsed = enrollOfferFromLink(uriOrLink);
  if (!parsed.ok) return parsed;
  await storage.setItem(ENROLL_OFFER_STORAGE_KEY, parsed.uri);
  return parsed;
}

export async function pendingEnrollOffer(storage) {
  let raw = null;
  try { raw = await storage.getItem(ENROLL_OFFER_STORAGE_KEY); } catch { raw = null; }
  if (typeof raw !== 'string' || !raw) return null;
  const parsed = parseEnrollOffer(raw);
  return parsed.ok ? parsed : null;
}

export async function clearEnrollOffer(storage) {
  try { await storage.removeItem(ENROLL_OFFER_STORAGE_KEY); } catch { /* best-effort */ }
}

const SEND = { guarantee: 'hold-forward' };

/**
 * The consume half — run by the shells once per boot, AFTER the agent is up and the transport is
 * connected. A no-op when nothing is stashed. For each circle in the offer:
 *
 *   1. write the registry membership record (handle + THIS device's own derived address) through
 *      the waist — the standing reopenMemberCircles then owns every future boot;
 *   2. install the per-circle signing identity + open the circle (this boot);
 *   3. announce this device's own per-circle address to the SIBLING — the roster-set growth that
 *      makes this device reachable (the boot re-announce reaches the rest as the roster hydrates);
 *   4. pull membership + governance catch-up from the sibling — the roster folds in, and the
 *      rules doc arrives (live or from the preserved head).
 *
 * Best-effort per circle; the stash is CLEARED only when every circle bootstrapped without error,
 * so a half-failed boot retries on the next one. Returns an honest per-circle report.
 */
export async function consumeEnrollOffer({ agent, callSkill, sendPeerMessage, storage, registerCirclePresence = null } = {}) {
  if (!agent || typeof callSkill !== 'function' || typeof sendPeerMessage !== 'function' || !storage) {
    return { consumed: false, reason: 'unwired' };
  }
  const offer = await pendingEnrollOffer(storage);
  if (!offer) return { consumed: false, reason: 'nothing-pending' };

  const report = [];
  let allOk = true;
  for (const c of offer.circles) {
    const row = { circleId: c.id, ok: true, steps: [] };
    try {
      const ownAddress = agent.circleAddressFor?.(c.id) ?? null;
      // 1 — the registry record (what reopenMemberCircles reads on every future boot). Skipped
      // without a handle (the record requires one); the live bootstrap below still runs.
      if (c.handle && ownAddress) {
        try {
          const r = await callSkill('agents', 'setProfileCircleMembership', {
            id: 'default', circleId: c.id, handle: c.handle, address: ownAddress,
            ...(offer.relays.length ? { relays: offer.relays } : {}),
          });
          row.steps.push(r?.ok ? 'registry' : 'registry-skipped');
        } catch { row.steps.push('registry-skipped'); }
      }
      // 2 — identities + presence for THIS boot.
      try { await agent.installCircleIdentities?.([c.id]); row.steps.push('identity'); } catch { /* derive-only; boot heals */ }
      try { await registerCirclePresence?.([c.id]); } catch { /* alias binding is best-effort */ }
      // 2b — THE ROSTER SEED (pod-less enroll S1): ask the sibling for the circle's trail rows —
      // without them this device cannot project a roster, and the rails refuse every fanned
      // statement for want of binding rows. Then WAIT (briefly) for the roster to derive before
      // sending the pulls below, so the served statements bind on arrival instead of being
      // refused and re-pulled on some later reconnect. Best-effort with a bounded wait: a seed
      // that never comes must not hang the boot.
      if (agent.rosterSeed && ownAddress) {
        try {
          const req = await agent.rosterSeed.buildRequest(c.id, ownAddress);
          if (req) {
            await sendPeerMessage(c.address, req, SEND);
            row.steps.push('seed-requested');
            const deadline = Date.now() + 8000;
            let derived = false;
            while (Date.now() < deadline) {
              try {
                const r = await callSkill('stoop', 'listGroupMembers', { groupId: c.id });
                if ((Array.isArray(r?.members) ? r.members : []).some((m) => m?.circleAddress || m?.circleAddresses?.length)) {
                  derived = true;
                  break;
                }
              } catch { /* keep waiting */ }
              await new Promise((resolve) => setTimeout(resolve, 250));
            }
            if (derived) row.steps.push('roster-derived');
          }
        } catch { /* the pulls below still go out; the next boot retries the seed */ }
      }
      // 3 — announce our fresh per-circle address to the sibling (the proven-set growth).
      const mine = ownAnnouncementFor({ agent, circleId: c.id });
      if (mine) {
        await sendPeerMessage(c.address, {
          type: 'p2p-chat', subtype: CIRCLE_ADDRESS_ANNOUNCE_KIND, circleId: c.id,
          msgId: `enroll-announce-${c.id}`, ts: Date.now(), announcements: [mine],
        }, SEND);
        row.steps.push('announce');
      }
      // 4 — pull the circle's truth from the sibling.
      await sendPeerMessage(c.address, { subtype: MEMBERSHIP_CATCHUP_SUBTYPES.request, circleId: c.id }, SEND);
      await sendPeerMessage(c.address, { subtype: GOV_CATCHUP_REQUEST, circleId: c.id }, SEND);
      row.steps.push('catch-up');
    } catch (err) {
      row.ok = false;
      row.error = err?.message ?? String(err);
      allOk = false;
    }
    report.push(row);
  }
  if (allOk) await clearEnrollOffer(storage);
  return { consumed: true, cleared: allOk, circles: report };
}
