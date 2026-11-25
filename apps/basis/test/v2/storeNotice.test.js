/**
 * THE ONE NOTICE EVERY SHELL SHOWS WHEN A STORE ON THIS DEVICE HOLDS DATA IT COULD NOT READ.
 *
 * A store that could not read what it holds keeps it and refuses every save over it; the person must hear that, or
 * what they change meanwhile is lost without a word. One shared view decides the words: the reason picks the text (a
 * newer build's data: update the app; anything else: report a problem), and the cost line names WHAT is affected as
 * plain kind words, never a store's name or path. The register in local-store is what it reads.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { reportNotReadable, resetNotReadableStores, notReadableStores, mapSnapshotGate } from '@onderling/local-store';
import { storeNoticeView } from '../../src/v2/storeNotice.js';
import nl from '../../src/locales/circle.nl.json' with { type: 'json' };

/** The Dutch bundle as the shells' `t` reads it: `circle.a.b` → its text, `{{x}}` filled in. */
const t = (key, vars = {}) => {
  const node = key.split('.').slice(1).reduce((o, k) => o?.[k], nl);
  const text = typeof node?.text === 'string' ? node.text : key;
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ''));
};

describe('the not-readable notice', () => {
  beforeEach(() => resetNotReadableStores());

  it('nothing reported → no notice', () => {
    expect(storeNoticeView([], t)).toBeNull();
  });

  it('a newer build\'s data: update the app; the cost line names the kind', () => {
    const v = storeNoticeView([{ name: '/x/outbox.json', kind: 'messages', reason: 'version' }], t);
    expect(v.reason).toBe('version');
    expect(v.text).toBe('Een deel van wat dit apparaat bewaart is gemaakt door een nieuwere versie van Basis en kan hier niet gelezen worden. Er is niets veranderd. Werk de app bij.');
    expect(v.cost).toBe('Wat je hier nu verandert in berichten, wordt pas bewaard na de update.');
    expect(JSON.stringify(v)).not.toContain('outbox');   // a store's name is never shown
  });

  it('anything else: report a problem, and the kinds are listed once each, in a fixed order', () => {
    const v = storeNoticeView([
      { name: 'a', kind: 'settings', reason: 'unparseable' },
      { name: 'b', kind: 'messages', reason: 'read-failed' },
      { name: 'c', kind: 'messages', reason: 'shape' },
      { name: 'd', kind: 'lists', reason: 'unparseable' },
    ], t);
    expect(v.reason).toBe('unreadable');
    expect(v.text).toContain('Meld een probleem');
    expect(v.cost).toBe('Wat je hier nu verandert in berichten, lijsten en instellingen, wordt niet bewaard.');
  });

  it('one newer store among unreadable ones still says: update the app', () => {
    const v = storeNoticeView([{ name: 'a', kind: 'lists', reason: 'shape' }, { name: 'b', kind: 'lists', reason: 'version' }], t);
    expect(v.reason).toBe('version');
  });

  it('a gate that cannot read its snapshot reports into the register, with its kind; a readable read clears it', () => {
    const gate = mapSnapshotGate('cc-household', { kind: 'lists', warn: () => {} });
    gate.read(JSON.stringify({ v: 7, data: {} }));
    expect(notReadableStores()).toEqual([{ name: 'cc-household', kind: 'lists', reason: 'version' }]);
    gate.read(null);
    expect(notReadableStores()).toEqual([]);
  });

  it('an unknown kind is reported as other data', () => {
    reportNotReadable({ name: 'z', kind: 'weird', reason: 'shape' });
    expect(storeNoticeView(notReadableStores(), t).cost).toContain('andere gegevens');
  });
});

describe('the not-readable notice, both causes at once', () => {
  it('the kinds an update fixes and the kinds it does not each get their own cost line', () => {
    const v = storeNoticeView([
      { name: 'a', kind: 'lists', reason: 'version' },
      { name: 'b', kind: 'settings', reason: 'unparseable' },
    ], t);
    expect(v.reason).toBe('version');
    expect(v.cost).toBe('Wat je hier nu verandert in lijsten, wordt pas bewaard na de update. Wat je hier nu verandert in instellingen, wordt niet bewaard. Blijft dit staan, gebruik dan Meld een probleem.');
  });
});

describe('the not-readable notice, the report hint in the mixed case', () => {
  it('with both causes, the damaged part still gets its "report a problem" line', () => {
    const v = storeNoticeView([{ name: 'a', kind: 'lists', reason: 'version' }, { name: 'b', kind: 'settings', reason: 'unparseable' }], t);
    expect(v.cost.endsWith('Blijft dit staan, gebruik dan Meld een probleem.')).toBe(true);
  });
  it('a newer build alone has no report line', () => {
    const v = storeNoticeView([{ name: 'a', kind: 'lists', reason: 'version' }], t);
    expect(v.cost).not.toContain('Meld een probleem');
  });
});
