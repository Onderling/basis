/**
 * ONE ADD BUTTON ON CONTACTS (Frits 2026-11-20; Fable's ruling 2026-11-25): the scanned or pasted text says what it is.
 * A 'bot' kind sits LAST in the one table. A peer address (an Ed25519 key or an NKN address, `addr` or `addr|Name`) is a
 * bot everywhere: it is not a link. A bare https URL is a bot ONLY in the Contacts add field (`for: 'contacts-add'`);
 * the general Scan keeps it unknown, never opened by itself. Contact and invite codes keep their own kinds there.
 * Nothing is fetched before the person confirms: the shared words name the host or the address first.
 */
import { describe, it, expect } from 'vitest';
import { routeScan, SCAN_CLASSIFIERS, SCAN_TARGETS, SCAN_PURPOSES, scanSayKey, botAddConfirm } from '../../src/v2/scanRoute.js';

const KEY = 'A'.repeat(43);
const NKN = `relay.${'a1'.repeat(32)}`;

describe('the bot kind, last in the table', () => {
  it('comes after every scheme', () => {
    expect(SCAN_CLASSIFIERS.at(-1).kind).toBe('bot');
  });
  it('a peer address is a bot everywhere, with or without a name', () => {
    expect(routeScan(KEY)).toMatchObject({ kind: 'bot', payload: KEY, target: { id: 'addBot' } });
    expect(routeScan(`${NKN}|Wilfred`)).toMatchObject({ kind: 'bot', payload: `${NKN}|Wilfred` });
  });
  it('a word, a sentence or a near-key is not an address', () => {
    expect(routeScan('hello').kind).toBe('unknown');
    expect(routeScan('A'.repeat(42)).kind).toBe('unknown');
    expect(routeScan('two words').kind).toBe('unknown');
  });
  it('a bare https URL is unknown on the general Scan, never opened by itself', () => {
    expect(routeScan('https://bot.example.org/.well-known/agent.json').kind).toBe('unknown');
  });
  it('the target records why it is a view: no op adds a bot, the shared add runs after a confirm', () => {
    expect(SCAN_TARGETS.bot).toMatchObject({ kind: 'view', id: 'addBot' });
    expect(String(SCAN_TARGETS.bot.reason ?? '')).toMatch(/confirm/);
  });
});

describe('the Contacts add field', () => {
  const add = (t) => routeScan(t, { for: 'contacts-add' });
  it('takes a bare https URL as a bot', () => {
    expect(add('https://bot.example.org')).toMatchObject({ kind: 'bot', payload: 'https://bot.example.org', target: { id: 'addBot' } });
  });
  it('keeps a contact card and an invite as what they are', () => {
    expect(add('onderling-contact://AYEgabc')).toMatchObject({ kind: 'contact', target: { id: 'add-contact' } });
    expect(add('onderling-invite://eyJ4Ijox').kind).toBe('invite');
  });
  it('refuses a screen code there, in words', () => {
    const r = add('onderling-connect://eyJ2IjoxfQ');
    expect(r.refused).toBe('not-for-here');
    expect(scanSayKey(r)).toBe('circle.scan.not_for_here');
  });
  it('declares what each purpose takes', () => {
    expect(SCAN_PURPOSES['contacts-add']).toEqual(['contact', 'invite', 'bot']);
    expect(SCAN_PURPOSES.screen).toEqual(['screen']);
    expect(SCAN_PURPOSES.pair).toEqual(['pair']);
  });
});

describe('nothing is fetched before the person confirms', () => {
  it('a URL is asked about by its host', () => {
    expect(botAddConfirm('https://bot.example.org/a/b')).toEqual({ key: 'circle.contacts.add_bot_confirm_host', params: { host: 'bot.example.org' } });
  });
  it('an address is asked about by its name, or its start', () => {
    expect(botAddConfirm(`${KEY}|Wilfred`)).toEqual({ key: 'circle.contacts.add_bot_confirm_addr', params: { addr: 'Wilfred' } });
    expect(botAddConfirm(KEY).params.addr).toBe(`${KEY.slice(0, 8)}…`);
  });
});
