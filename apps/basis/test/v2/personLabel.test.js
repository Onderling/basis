/**
 * NEVER A KEY ON SCREEN. A person is shown by the name on their card, else the handle they use in a circle you share,
 * else "someone" — never their key or the first characters of it. A two-phone walk (2026-11-05) found keys in the
 * contact list, the chat title and composer, "Share with…", "… is now an admin" and the circle list's preview; each
 * site here is one of those, fed a person nobody has named.
 */
import { describe, it, expect } from 'vitest';
import { personLabel, isKeyLike, nameShown, SOMEONE_LABEL_KEY } from '../../src/v2/personLabel.js';
import { stampContactLabels, markRenames } from '../../src/v2/contactsSource.js';
import { pickableRecipients } from '../../src/v2/shareRecipients.js';
import { membershipNoticeRows } from '../../src/v2/membershipNotices.js';
import { revealedMemberLabel } from '../../src/v2/circleViewAs.js';
import { renderSubtitle } from '../../src/v2/circleTilePreviews.js';
import { stampSenderLabels } from '../../src/v2/circleStream.js';

const KEY = 'zWOPwK1R5XsnsQe3vT0b7yHk2LmN9pQrS4tUvWxYz01';   // an opaque 43-character key
const t = (k, a = {}) => (k === SOMEONE_LABEL_KEY ? 'iemand' : `${k}${a.name != null ? `(${a.name})` : ''}`);

describe('the one person-label resolver', () => {
  it('card name, then handle, then someone — in that order', () => {
    expect(personLabel({ displayName: 'Tester B', handle: 'tester-b', ids: [KEY] })).toEqual({ label: 'Tester B', labelKey: null });
    expect(personLabel({ handle: 'tester-b', ids: [KEY] })).toEqual({ label: '@tester-b', labelKey: null });
    expect(personLabel({ ids: [KEY] })).toEqual({ label: null, labelKey: SOMEONE_LABEL_KEY });
  });

  it('a key, a piece of one, and the old shortened forms are never a name', () => {
    expect(isKeyLike(KEY)).toBe(true);
    expect(isKeyLike(KEY.slice(0, 8), [KEY])).toBe(true);            // "zWOPwK1R" — what Contacts showed
    expect(isKeyLike(`${KEY.slice(0, 20)}…`, [KEY])).toBe(true);      // "Chat with zWOPwK1R5Xsns…"
    expect(isKeyLike('peer-4wFydl')).toBe(true);                      // the reveal ladder's old last resort
    expect(personLabel({ displayName: KEY.slice(0, 8), ids: [KEY] }).labelKey).toBe(SOMEONE_LABEL_KEY);
  });

  it('a name a person chose stays a name — a short one, a webid, a URL', () => {
    expect(isKeyLike('Ada')).toBe(false);
    expect(isKeyLike('webid:noor')).toBe(false);
    expect(isKeyLike('https://ada.example/profile#me')).toBe(false);
  });
});

describe('every site that showed a key now shows someone', () => {
  it('the contact list', () => {
    const [row] = stampContactLabels([{ contactId: KEY, name: KEY }]);
    expect(row.label).toBeNull();
    expect(row.labelKey).toBe(SOMEONE_LABEL_KEY);
    const [named] = stampContactLabels([{ contactId: KEY, name: 'Tester B' }]);
    expect(named.label).toBe('Tester B');
  });

  it('the rename marker never says "was: <key>"', () => {
    const [row] = markRenames([{ contactId: KEY, name: 'Tester B' }], { lastSeenNames: { [KEY]: { name: KEY.slice(0, 8) } } });
    expect(row.wasName).toBeUndefined();
  });

  it('the chat title and composer (the name a shell is handed)', () => {
    expect(nameShown({ name: KEY }, t, { ids: [KEY] })).toBe('iemand');
    expect(nameShown(null, t, { ids: [KEY] })).toBe('iemand');
    expect(nameShown({ name: 'Tester B' }, t)).toBe('Tester B');
  });

  it('Share with…', () => {
    const [r] = pickableRecipients([{ contactId: KEY, name: KEY, recipientNetworkKey: 'nk-1' }]);
    expect(r.label).toBeNull();
    expect(r.labelKey).toBe(SOMEONE_LABEL_KEY);
  });

  it('"… is now an admin" for a member this device has no row for', () => {
    const e = { id: 'e1', ts: 1, type: 'membership', circleId: 'c', payload: { circleId: 'c', body: { kind: 'role', subject: KEY, author: 'admin', payload: { role: 'admin' } } } };
    const [row] = membershipNoticeRows({ events: [e], circleId: 'c', viewerId: 'me', members: [], t });
    expect(row.event.payload.text).toBe('circle.membership.member_is_now_admin(iemand)');
    expect(row.event.payload.text).not.toContain(KEY.slice(0, 6));
  });

  it('the members list and the chat sender, for a member with no handle and no released name', () => {
    const l = revealedMemberLabel({ id: KEY }, { viewerId: null });
    expect(l.primary).toBeNull();
    expect(l.primaryKey).toBe(SOMEONE_LABEL_KEY);
    const [row] = stampSenderLabels([{ actor: KEY }], { members: [{ id: KEY, webid: KEY }] });
    expect(row.senderLabel).toBeNull();
    expect(row.senderLabelKey).toBe(SOMEONE_LABEL_KEY);
  });

  it('the circle list preview: the text, never "<key>: text"', () => {
    expect(renderSubtitle({ actor: KEY, payload: { text: 'hoi' } })).toBe('hoi');
    expect(renderSubtitle({ actor: KEY, payload: { text: 'hoi' } }, { actorLabel: () => '@tester-b' })).toBe('@tester-b: hoi');
  });
});
