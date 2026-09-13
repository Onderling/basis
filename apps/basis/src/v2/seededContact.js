/**
 * seededContact — a contact the app ships with, so a person has someone to write to on day one.
 *
 * The alpha's feedback path (Frits, 2026-09-09): feedback goes to Frits himself — his own account, on an
 * always-on device, added as an ordinary CONTACT in every fresh install. Not a bot, not a form: a person
 * in the Contacten list, reached the way any contact is, whose card was handed out with the app.
 *
 * The card is public information (the profile address, the key, a handle, where they can be found) and
 * rides a build-time variable beside the app-native relay: `VITE_SEEDED_CONTACT_CARD` on web,
 * `EXPO_PUBLIC_SEEDED_CONTACT_CARD` on mobile. On boot, when the card is set and the person is not yet
 * in the book, it goes in through the very path a scanned card takes (`addContactFromQr`) — so the
 * contact carries the card's address, name and points, and is a person, never a bot (a stoop contact
 * is always a person: `contactsSource.js`). Absent or malformed ⇒ nothing happens, quietly: an install
 * without a seeded contact is not an error state.
 *
 * Idempotent by construction: the book is checked by the card's webid first, so a reboot adds nothing
 * and a person who REMOVED the contact keeps it removed for that launch — and only that launch, which
 * is recorded as a limitation (a removal that should stick needs a remembered "declined" mark).
 *
 * Pure — no DOM, no RN, no env read; each shell hands in its variable.
 */
import { CONTACT_CARD_PREFIX } from './addBot.js';

/** The card's webid, or null when the payload is not a readable contact card. */
export function seededContactWebid(payload) {
  if (typeof payload !== 'string' || !payload.startsWith(CONTACT_CARD_PREFIX)) return null;
  const b64url = payload.slice(CONTACT_CARD_PREFIX.length);
  if (!b64url) return null;
  const std = b64url.replaceAll('-', '+').replaceAll('_', '/');
  const pad = std + '='.repeat((4 - (std.length % 4)) % 4);
  try {
    const bin = (typeof atob === 'function') ? atob(pad) : Buffer.from(pad, 'base64').toString('binary');
    const card = JSON.parse(bin);
    return (card && typeof card.webid === 'string' && card.webid) ? card.webid : null;
  } catch { return null; }
}

/**
 * Add the seeded contact if the card is set and the person is not in the book yet.
 *
 * @param {object} a
 * @param {string|null|undefined} a.payload   the build-time card (`onderling-contact://…`), or nothing
 * @param {(app: string, op: string, args: object) => Promise<any>} a.callSkill   the waist
 * @returns {Promise<{seeded: boolean, reason?: string, webid?: string}>}
 */
export async function seedContactCard({ payload, callSkill } = {}) {
  const trimmed = typeof payload === 'string' ? payload.trim() : '';
  if (!trimmed) return { seeded: false, reason: 'no-card' };
  if (typeof callSkill !== 'function') return { seeded: false, reason: 'unwired' };
  const webid = seededContactWebid(trimmed);
  if (!webid) return { seeded: false, reason: 'malformed-card' };
  let present = false;
  try {
    const r = await callSkill('stoop', 'listContacts', {});
    const rows = Array.isArray(r?.items) ? r.items : (Array.isArray(r?.contacts) ? r.contacts : []);
    present = rows.some((c) => c?.webid === webid);
  } catch { present = false; }
  if (present) return { seeded: false, reason: 'already-known', webid };
  try {
    const r = await callSkill('stoop', 'addContactFromQr', { payload: trimmed });
    if (r?.error) return { seeded: false, reason: r.error, webid };
    return { seeded: true, webid };
  } catch (err) {
    return { seeded: false, reason: err?.message ?? String(err), webid };
  }
}
