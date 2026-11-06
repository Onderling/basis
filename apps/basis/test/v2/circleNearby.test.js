/**
 * "Nearby" model tests.
 */
import { describe, it, expect } from 'vitest';
import {
  buildNearbyModel, pickSkillText, pickSkillKey, pickPeerLabel,
} from '../../src/v2/circleNearby.js';

const t = (key, vars = {}) => {
  if (key === 'circle.nearbyScreen.header')      return `${vars.sharing} people here show what they offer`;
  if (key === 'circle.nearbyScreen.header_one')  return `${vars.name} shows what they offer`;
  if (key === 'circle.nearbyScreen.header_none') return `Nobody here is showing what they offer yet`;
  if (key === 'circle.nearbyScreen.header_empty') return `Nobody nearby right now.`;
  if (key === 'circle.nearbyScreen.anon_peer')   return `someone`;
  return key;
};

describe('pickSkillText', () => {
  it('reads string skills + first non-empty {text,label,title,what} key', () => {
    expect(pickSkillText('Fietsband plakken')).toBe('Fietsband plakken');
    expect(pickSkillText({ text: 'A' })).toBe('A');
    expect(pickSkillText({ label: 'B' })).toBe('B');
    expect(pickSkillText({ title: 'C' })).toBe('C');
    expect(pickSkillText({ what: 'D' })).toBe('D');
  });
  it('returns null on garbage / non-string fields', () => {
    expect(pickSkillText(null)).toBeNull();
    expect(pickSkillText('   ')).toBe('');           // trimmed
    expect(pickSkillText({ text: '   ' })).toBeNull();
    expect(pickSkillText({ foo: 'bar' })).toBeNull();
  });
});

describe('pickSkillKey', () => {
  it('lowercases + collapses whitespace', () => {
    expect(pickSkillKey('Fietsband  Plakken')).toBe('fietsband plakken');
    expect(pickSkillKey({ text: '  PLAKKEN ' })).toBe('plakken');
  });
  it('returns null when nothing usable', () => {
    expect(pickSkillKey(null)).toBeNull();
    expect(pickSkillKey({})).toBeNull();
  });
});

describe('pickPeerLabel', () => {
  it('prefers a labelled key', () => {
    expect(pickPeerLabel({ pseudonym: 'fietsband-helper-3' })).toBe('fietsband-helper-3');
    expect(pickPeerLabel({ displayName: 'Bob' })).toBe('Bob');
    expect(pickPeerLabel({ handle: 'bob' })).toBe('bob');
  });
  it('falls back to a `peer-<6chars>` from pubKey when no label is set', () => {
    expect(pickPeerLabel({ pubKey: 'abc1234567890' })).toBe('peer-abc123');
  });
  it('returns null when there is nothing to derive a label from', () => {
    expect(pickPeerLabel(null)).toBeNull();
    expect(pickPeerLabel({})).toBeNull();
    expect(pickPeerLabel({ pubKey: 'short' })).toBeNull();   // < 8 chars
  });
});

describe('buildNearbyModel', () => {
  it('returns an empty-state shape when no peers are present', () => {
    const m = buildNearbyModel({ peers: [], mySkills: ['Plakken'], myPseudonym: 'koffie-jaap', t });
    expect(m.rows).toEqual([]);
    expect(m.counts).toEqual({ total: 0, sharingAny: 0 });
    expect(m.ownProfile).toEqual({ pseudonym: 'koffie-jaap', publishedSkills: ['Plakken'] });
    expect(m.headerLabel).toBe('Nobody nearby right now.');
  });

  it('intersects peer.skills with mySkills + maps shared keys back to user-facing text', () => {
    const peers = [
      { pubKey: 'pk-anne', pseudonym: 'anne', skills: ['Fietsband plakken', 'koken'] },
      { pubKey: 'pk-bob',  pseudonym: 'bob',  skills: ['belasting-aangifte'] },
    ];
    const m = buildNearbyModel({
      peers, mySkills: ['Fietsband plakken', 'plantverzorging'], t,
    });
    expect(m.counts).toEqual({ total: 2, sharingAny: 1 });
    expect(m.rows[0].pseudonym).toBe('anne');
    expect(m.rows[0].sharedSkills).toEqual(['Fietsband plakken']);  // text not key
    expect(m.rows[0].sharesAny).toBe(true);
    expect(m.rows[1].pseudonym).toBe('bob');
    expect(m.rows[1].sharedSkills).toEqual([]);
  });

  it('sorts shares-any first, then by shared count desc, then newest-first', () => {
    const peers = [
      { pubKey: 'a', pseudonym: 'A', skills: ['x'],           lastSeen: 100 },
      { pubKey: 'b', pseudonym: 'B', skills: ['x', 'y', 'z'], lastSeen: 200 },
      { pubKey: 'c', pseudonym: 'C', skills: [],              lastSeen: 999 },
      { pubKey: 'd', pseudonym: 'D', skills: ['x'],           lastSeen: 300 },
    ];
    const m = buildNearbyModel({ peers, mySkills: ['x', 'y', 'z'], t });
    expect(m.rows.map((r) => r.pseudonym)).toEqual(['B', 'D', 'A', 'C']);
  });

  it('falls back to "someone" + peer-XXXXXX labels when no label is present', () => {
    const m = buildNearbyModel({
      peers: [
        { pubKey: 'abc1234567' /* no label */ },
        { /* no pubKey, no label */ },
      ],
      t,
    });
    expect(m.rows[0].pseudonym).toBe('peer-abc123');
    expect(m.rows[1].pseudonym).toBe('someone');
  });

  it('normalises source to mdns | ble | unknown', () => {
    const m = buildNearbyModel({
      peers: [
        { pubKey: 'a', source: 'mdns' },
        { pubKey: 'b', source: 'ble' },
        { pubKey: 'c', source: 'bogus' },
        { pubKey: 'd' },
      ],
      t,
    });
    const sources = m.rows.map((r) => r.source).sort();
    expect(sources).toEqual(['ble', 'mdns', 'unknown', 'unknown']);
  });

  it('caps sharedSkills per row by maxSharedSkillsPerRow', () => {
    const peers = [
      { pubKey: 'a', pseudonym: 'A', skills: ['x', 'y', 'z', 'w', 'v'] },
    ];
    const m = buildNearbyModel({
      peers, mySkills: ['x', 'y', 'z', 'w', 'v'], t, maxSharedSkillsPerRow: 2,
    });
    expect(m.rows[0].sharedSkills).toHaveLength(2);
  });

  it('header reports the right "N of M" copy when there are peers', () => {
    const peers = [
      { pubKey: 'a', skills: ['x'] },
      { pubKey: 'b', skills: ['y'] },
      { pubKey: 'c', skills: [] },
    ];
    const m = buildNearbyModel({ peers, mySkills: ['x'], t });
    expect(m.headerLabel).toBe('someone shows what they offer');
  });

  // 'offerings' never reaches the screen (the sitting's ruling): the header says who shows what they offer, by name when
  // one does, and says plainly when nobody does, instead of '0 of 1 share offerings with you'.
  it('header names the one person who shows what they offer, says when nobody does, and counts more than one', () => {
    const named = (id, name, skills) => ({ pubKey: id, name, skills });
    expect(buildNearbyModel({ peers: [named('a', 'tester-b', ['x'])], mySkills: ['x'], t }).headerLabel).toBe('tester-b shows what they offer');
    expect(buildNearbyModel({ peers: [named('a', 'tester-b', [])], mySkills: ['x'], t }).headerLabel).toBe('Nobody here is showing what they offer yet');
    expect(buildNearbyModel({ peers: [named('a', 'A', ['x']), named('b', 'B', ['x'])], mySkills: ['x'], t }).headerLabel).toBe('2 people here show what they offer');
  });

  it('rows carry lastSeen + proximity verbatim when supplied', () => {
    const peers = [{ pubKey: 'a', proximity: '<10m', lastSeen: 12345 }];
    const m = buildNearbyModel({ peers, t });
    expect(m.rows[0].proximity).toBe('<10m');
    expect(m.rows[0].lastSeen).toBe(12345);
  });

  it('drops garbage peer entries (non-object / null) without throwing', () => {
    const m = buildNearbyModel({
      peers: [null, { pubKey: 'a', skills: ['x'] }, 'string-not-a-peer'],
      mySkills: ['x'], t,
    });
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0].id).toBe('a');
  });

  it('returns null pseudonym in ownProfile when no name supplied', () => {
    const m = buildNearbyModel({ peers: [], mySkills: [], t });
    expect(m.ownProfile.pseudonym).toBeNull();
    expect(m.ownProfile.publishedSkills).toEqual([]);
  });
});
