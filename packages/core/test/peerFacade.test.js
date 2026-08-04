/**
 * peerFacade — Connectivity Phase 4, Wave B.
 *
 * The read-only projection presents the three peer stores (trail-roster,
 * MemberMap, PeerGraph) as ONE per-(circle,member) `Peer` keyed by the
 * per-circle `circleAddress`. These tests assert:
 *   - correct per-member Peers for a circle (the three-way left-join),
 *   - a member present in TWO circles yields two independent records with no
 *     shared/global id (Decision A),
 *   - PeerGraph liveness + transports flow through,
 *   - a trail member missing from PeerGraph still appears (membership = trail).
 */
import { describe, it, expect } from 'vitest';
import { peerFacade } from '../src/discovery/peerFacade.js';

// ── Representative inputs for circle X ──────────────────────────────────────
// Trail is the source of membership + per-circle crypto.
const trailX = [
  {
    webid: 'https://anna.example/me',
    role: 'admin',
    pubKey: 'anna-signing-pub',
    sealingPublicKey: 'anna-sealing-X',
    circleAddress: 'anna@circleX-addr',
    personaProperties: { buurt: 'oost' },
  },
  {
    webid: 'https://bram.example/me',
    role: 'member',
    pubKey: 'bram-signing-pub',
    sealingPublicKey: 'bram-sealing-X',
    circleAddress: 'bram@circleX-addr',
  },
  {
    // Joined before the liveness layer / gossip — has NO PeerGraph record.
    webid: 'https://cleo.example/me',
    role: 'member',
    pubKey: 'cleo-signing-pub',
    sealingPublicKey: 'cleo-sealing-X',
    circleAddress: 'cleo@circleX-addr',
  },
];

const memberMapX = [
  { webid: 'https://anna.example/me', displayName: 'Anna', relation: 'group-member', trustLevel: 'vertrouwd' },
  { webid: 'https://bram.example/me', displayName: 'Bram', relation: 'contact', nknAddr: 'nkn-bram-native' },
  { webid: 'https://cleo.example/me', displayName: 'Cleo', relation: 'agent' },
];

const peerGraphGlobal = [
  {
    pubKey: 'anna-signing-pub',
    reachable: true,
    tier: 'trusted',
    transports: { relay: { address: 'relay-anna-addr' }, nkn: 'nkn-anna-native' },
  },
  {
    pubKey: 'bram-signing-pub',
    reachable: false,
    transports: { relay: { address: 'relay-bram-addr' } },
  },
  // No record for cleo-signing-pub.
];

describe('peerFacade — per-circle projection', () => {
  it('projects one Peer per trail member, keyed by circleAddress', () => {
    const peers = peerFacade({
      trailRoster: trailX,
      memberMap: memberMapX,
      peerGraph: peerGraphGlobal,
      circleId: 'circleX',
    });

    expect(peers).toHaveLength(3);
    expect(peers.map(p => p.circleAddress).sort()).toEqual([
      'anna@circleX-addr',
      'bram@circleX-addr',
      'cleo@circleX-addr',
    ]);

    const anna = peers.find(p => p.webid === 'https://anna.example/me');
    expect(anna).toMatchObject({
      circleAddress: 'anna@circleX-addr',
      sealingKey: 'anna-sealing-X',
      reachability: true,
      relation: 'group-member',
      trust: 'trusted', // PeerGraph tier wins
      props: { buurt: 'oost' },
    });
  });

  it('flows PeerGraph liveness + flattens transports to name → address', () => {
    const peers = peerFacade({ trailRoster: trailX, memberMap: memberMapX, peerGraph: peerGraphGlobal, circleId: 'circleX' });

    const anna = peers.find(p => p.webid === 'https://anna.example/me');
    expect(anna.transports).toEqual({ relay: 'relay-anna-addr', nkn: 'nkn-anna-native' });
    expect(anna.reachability).toBe(true);

    const bram = peers.find(p => p.webid === 'https://bram.example/me');
    expect(bram.reachability).toBe(false);
    // PeerGraph supplies the relay address; the display-cache nknAddr backfills
    // the nkn transport PeerGraph didn't gossip yet.
    expect(bram.transports).toEqual({ relay: 'relay-bram-addr', nkn: 'nkn-bram-native' });
    // relation + trust fall back to the display cache when PeerGraph has none.
    expect(bram.relation).toBe('contact');
    expect(bram.trust).toBeNull();
  });

  it('keeps a trail member with NO PeerGraph record (membership comes from the trail)', () => {
    const peers = peerFacade({ trailRoster: trailX, memberMap: memberMapX, peerGraph: peerGraphGlobal, circleId: 'circleX' });

    const cleo = peers.find(p => p.webid === 'https://cleo.example/me');
    expect(cleo).toBeDefined();
    expect(cleo.circleAddress).toBe('cleo@circleX-addr');
    expect(cleo.reachability).toBeNull();   // liveness unknown, not "unreachable"
    expect(cleo.transports).toEqual({});     // no addresses yet
    expect(cleo.relation).toBe('agent');
    expect(cleo.sealingKey).toBe('cleo-sealing-X');
  });

  it('falls back to the display-cache nknAddr when the peer is not yet in PeerGraph', () => {
    // Bram has an nknAddr in MemberMap and only a relay transport in PeerGraph;
    // a peer entirely absent from PeerGraph but with an nknAddr should surface it.
    const peers = peerFacade({
      trailRoster: [trailX[2]], // cleo — no PeerGraph record
      memberMap: [{ webid: 'https://cleo.example/me', relation: 'group-member', nknAddr: 'nkn-cleo-native' }],
      peerGraph: peerGraphGlobal,
      circleId: 'circleX',
    });
    expect(peers[0].transports).toEqual({ nkn: 'nkn-cleo-native' });
  });
});

describe('peerFacade — per-circle keying, no global id (Decision A)', () => {
  it('a member in two circles yields two independent Peers with different circleAddresses', () => {
    // Same person (same signing pubKey — deliberately linked), two circles.
    const trailY = [
      {
        webid: 'https://anna.example/me',
        role: 'member',
        pubKey: 'anna-signing-pub',
        sealingPublicKey: 'anna-sealing-Y',
        circleAddress: 'anna@circleY-addr', // DIFFERENT per-circle address
        personaProperties: { klas: '3b' },  // a DIFFERENT per-circle disclosure
      },
    ];

    const inX = peerFacade({ trailRoster: [trailX[0]], memberMap: memberMapX, peerGraph: peerGraphGlobal, circleId: 'circleX' });
    const inY = peerFacade({ trailRoster: trailY, memberMap: memberMapX, peerGraph: peerGraphGlobal, circleId: 'circleY' });

    const annaX = inX[0];
    const annaY = inY[0];

    // Two independent records — the per-circle address differs, the sealing
    // key differs, the disclosed props differ, and NO field carries a shared
    // cross-circle id.
    expect(annaX.circleAddress).toBe('anna@circleX-addr');
    expect(annaY.circleAddress).toBe('anna@circleY-addr');
    expect(annaX.circleAddress).not.toBe(annaY.circleAddress);
    expect(annaX.sealingKey).not.toBe(annaY.sealingKey);
    expect(annaX.props).toEqual({ buurt: 'oost' });
    expect(annaY.props).toEqual({ klas: '3b' }); // per-circle disclosure, independent

    // No `stableId` / global id field on either record.
    expect(annaX).not.toHaveProperty('stableId');
    expect(annaY).not.toHaveProperty('stableId');
    expect(Object.keys(annaX)).not.toContain('stableId');

    // Liveness (keyed by the shared signing pubKey) is the SAME transport
    // identity — that is expected and does not create a Peer-level global id.
    expect(annaX.transports).toEqual(annaY.transports);
  });
});

describe('peerFacade — revealState (C7 reveal-state collapse, Wave B)', () => {
  // Real-name disclosure is driven by the member's own RELEASE (personaProperties) plus the
  // circle's revealPolicy: 'open' widens a release to every member; 'pairwise' shows it only
  // because the member released it here. A viewer preference never stands in for either.
  const readEnabled = (peer, ctx, key) => peer?.revealState?.perContext?.[ctx]?.[key]?.enabled === true;

  it('is a disclosure.js-shaped policy keyed by the circleId, handle floor always enabled', () => {
    const [anna] = peerFacade({ trailRoster: [trailX[0]], circleId: 'circleX' });
    // Shape parity with disclosure.js getDisclosure: perContext[ctx][key] = {enabled,rung,matchable,requestable}.
    expect(anna.revealState).toBeTypeOf('object');
    expect(anna.revealState.perContext).toHaveProperty('circleX');
    expect(anna.revealState.perContext.circleX.handle).toEqual({
      enabled: true, rung: null, matchable: false, requestable: false,
    });
    // handle is the always-shown floor; realName is withheld by default (pairwise, no reveals).
    expect(readEnabled(anna, 'circleX', 'handle')).toBe(true);
    expect(readEnabled(anna, 'circleX', 'realName')).toBe(false);
  });

  it("'open' policy discloses realName for every member", () => {
    const [anna] = peerFacade({ trailRoster: [trailX[0]], circleId: 'circleX', revealPolicy: 'open' });
    expect(readEnabled(anna, 'circleX', 'realName')).toBe(true);
  });

  it("'pairwise' policy discloses realName once the member RELEASED it to this circle", () => {
    // Revealing is the discloser's act: the release (personaProperties) carries the name and IS
    // the disclosure fact — a viewer-side preference can never stand in for it.
    const withRelease = { ...trailX[1], personaProperties: { realName: 'Bram de Wit' } };
    const [bram] = peerFacade({ trailRoster: [withRelease], circleId: 'circleX', revealPolicy: 'pairwise' });
    expect(readEnabled(bram, 'circleX', 'realName')).toBe(true);
    // …and stays withheld when nothing was released.
    const [bram0] = peerFacade({ trailRoster: [{ ...trailX[1] }], circleId: 'circleX' });
    expect(readEnabled(bram0, 'circleX', 'realName')).toBe(false);
  });

  it('keys revealState by the per-circle context (no cross-circle leakage of the policy)', () => {
    const [annaY] = peerFacade({ trailRoster: [{ ...trailX[0], circleAddress: 'anna@Y' }], circleId: 'circleY', revealPolicy: 'open' });
    expect(annaY.revealState.perContext).toHaveProperty('circleY');
    expect(annaY.revealState.perContext).not.toHaveProperty('circleX');
  });
});

describe('peerFacade — robustness', () => {
  it('returns [] for empty / missing inputs', () => {
    expect(peerFacade({})).toEqual([]);
    expect(peerFacade({ trailRoster: [] })).toEqual([]);
  });

  it('falls back to displayName cache circleAddress, then webid, when the trail row lacks one', () => {
    const peers = peerFacade({
      trailRoster: [{ webid: 'https://dan.example/me', pubKey: 'dan-pub' }],
      memberMap: [{ webid: 'https://dan.example/me', circleAddress: 'dan@cached-addr', relation: 'group-member' }],
      peerGraph: [],
      circleId: 'circleX',
    });
    expect(peers[0].circleAddress).toBe('dan@cached-addr');

    const peers2 = peerFacade({
      trailRoster: [{ webid: 'https://ed.example/me' }],
      circleId: 'circleX',
    });
    expect(peers2[0].circleAddress).toBe('https://ed.example/me');
  });
});
