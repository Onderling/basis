/**
 * MATCHES UNDER MY OWN ASK — who in this circle offers what I asked for. Both shells paint these under the asker's
 * own open ask on the noticeboard; nobody else sees them, and nothing is written to the circle.
 *
 * The source is the roster only: a row's `offerings` are what that member RELEASED to this circle
 * (`normalizeCircleMembers`), so an offering kept private is matched by nobody. The match itself is the plain token
 * match of `findOfferingMatches`, computed on this device — no model in the path.
 *
 * Ask opens the contact thread with the match; Skip hides that match on THIS device (`createAskMatchSkips`).
 */
import { findOfferingMatches } from '@onderling/kring-host/findOfferingMatches';
import { noticeboardIntentOf } from '@onderling/item-types';
import { memberLabelFor } from './circleStream.js';
import { contactIdFor } from '../core/handlers/threadedChat.js';

/** The key a Skip is kept under: one match under one ask. */
export const askMatchSkipKey = (postId, webid) => `${postId}|${webid}`;

/**
 * @param {object} item  a pinboard item as `listOpen` returns it
 * @param {{viewerId?: string|null, members?: object[], policy?: string, skipped?: Iterable<string>}} [o]
 *   `members` = `normalizeCircleMembers` rows; `skipped` = this device's Skip keys
 * @returns {Array<{webid: string, address: string, label: string, offering: string, matchedTokens: string[]}>}
 *   only members with an address in this circle: a match nobody can ask is not shown
 */
export function askMatchChoices(item, { viewerId = null, members = [], policy = 'pairwise', skipped = [] } = {}) {
  if (!item || !viewerId || item.addedBy !== viewerId || item.completedAt) return [];
  if (noticeboardIntentOf(item) !== 'ask') return [];
  // who answered already carries an Accept; who I skipped stays hidden here
  const answered = new Set(Array.isArray(item.source?.responders) ? item.source.responders : []);
  const hidden = new Set(skipped ?? []);
  const others = (Array.isArray(members) ? members : [])
    .filter((m) => m?.id && m.id !== viewerId && m.circleAddress && !answered.has(m.id) && !hidden.has(askMatchSkipKey(item.id, m.id)));
  const addressOf = new Map(others.map((m) => [m.id, m.circleAddress]));
  return findOfferingMatches({ query: item.text ?? item.label ?? '', members: others })
    .filter((m) => typeof m.id === 'string' && addressOf.has(m.id))
    .map((m) => ({
      webid: m.id,
      address: addressOf.get(m.id),
      label: memberLabelFor(m.id, { members, viewerId, policy }) ?? m.label,
      offering: m.skill,
      matchedTokens: m.matchedTokens,
    }));
}

/**
 * The contact thread Ask opens: keyed by the PERSON behind the match's circle address (`identityOf`), so it is the
 * thread you already have with them when there is one — the same keying a reply to a post uses.
 */
export function askMatchThreadId(choice, { identityOf = null } = {}) {
  return choice?.address ? contactIdFor(identityOf, choice.address) : null;
}

/**
 * This device's Skips — `{load, save}` is the shell's storage (localStorage / AsyncStorage); nothing leaves the device.
 * @returns {{ list: () => Promise<string[]>, add: (postId: string, webid: string) => Promise<string[]> }}
 */
export function createAskMatchSkips({ load, save } = {}) {
  const read = async () => {
    try { const v = load ? await load() : null; return Array.isArray(v) ? v.filter((k) => typeof k === 'string') : []; } catch { return []; }
  };
  return {
    list: read,
    async add(postId, webid) {
      const key = askMatchSkipKey(postId, webid);
      const cur = await read();
      if (cur.includes(key)) return cur;
      const next = [...cur, key];
      if (save) { try { await save(next); } catch { /* best-effort persist */ } }
      return next;
    },
  };
}

const STORAGE_KEY = 'cc.askMatchSkips';

/** localStorage-backed IO (web). */
export function localStorageAskMatchSkipsIo(storage = globalThis.localStorage) {
  return {
    load: () => { try { const s = storage?.getItem(STORAGE_KEY); return s ? JSON.parse(s) : null; } catch { return null; } },
    save: (v) => { try { storage?.setItem(STORAGE_KEY, JSON.stringify(v)); } catch { /* private window */ } },
  };
}

/** AsyncStorage-backed IO (mobile). */
export function asyncStorageAskMatchSkipsIo(AsyncStorage) {
  return {
    load: async () => { const s = await AsyncStorage?.getItem(STORAGE_KEY); return s ? JSON.parse(s) : null; },
    save: (v) => AsyncStorage?.setItem(STORAGE_KEY, JSON.stringify(v)),
  };
}
