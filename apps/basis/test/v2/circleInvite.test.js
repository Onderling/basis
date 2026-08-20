/**
 * v2 circle invite/join glue — reuses the classic membership core. Verifies the issue side
 * (build a onderling-invite:// URI from the current code) round-trips into the join side (decode +
 * run the shared finalSubmit chain), with callSkill mocked at the stoop-skill boundary.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildCircleInviteUri, joinCircleFromInvite } from '../../src/v2/circleInvite.js';

describe('buildCircleInviteUri', () => {
  it('reads the current code and encodes a onderling-invite:// URI with the admin address', async () => {
    const callSkill = vi.fn(async (app, op) =>
      (op === 'getCurrentMembershipCode' ? { code: 'OPEN-SESAME', expiresAt: 123 } : {}));
    const r = await buildCircleInviteUri({ callSkill, circleId: 'circle-1', adminPeerAddr: 'addr-admin' });
    expect(callSkill).toHaveBeenCalledWith('stoop', 'getCurrentMembershipCode', { groupId: 'circle-1' });
    expect(r.uri).toMatch(/^onderling-invite:\/\//);
  });

  it('B2 — carries BOTH addresses (pubKey adminPeerAddr + NKN adminNknAddr) when known; omits nkn otherwise', async () => {
    const callSkill = vi.fn(async (app, op) =>
      (op === 'getCurrentMembershipCode' ? { code: 'C', expiresAt: 1 } : {}));
    const decode = (uri) => JSON.parse(Buffer.from(
      uri.replace(/^onderling-invite:\/\//, '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    const both = await buildCircleInviteUri({ callSkill, circleId: 'c', adminPeerAddr: 'PUBKEY', adminNknAddr: 'nkn-addr' });
    const d = decode(both.uri);
    expect(d.adminPeerAddr).toBe('PUBKEY');
    expect(d.adminNknAddr).toBe('nkn-addr');
    // relay-only admin (no NKN up) → the nkn field is simply absent (older-invite shape).
    const relayOnly = await buildCircleInviteUri({ callSkill, circleId: 'c', adminPeerAddr: 'PUBKEY' });
    expect('adminNknAddr' in decode(relayOnly.uri)).toBe(false);
  });

  it('admin-only is terminal (does not try to mint); missing args rejected', async () => {
    const callSkill = vi.fn(async () => ({ error: 'admin-only' }));
    expect(await buildCircleInviteUri({ callSkill, circleId: 'c' })).toEqual({ error: 'admin-only' });
    expect(callSkill).toHaveBeenCalledTimes(1);   // no rotate attempt
    expect(await buildCircleInviteUri({})).toEqual({ error: 'missing-args' });
  });

  it('B/S4 — embeds the freedom template (capabilities + apps) when passed, so the joiner can opt out', async () => {
    const callSkill = vi.fn(async (app, op) =>
      (op === 'getCurrentMembershipCode' ? { code: 'C', expiresAt: 1 } : {}));
    const capabilities = { 'tasks complete task': { freedom: 'optional' } };
    const r = await buildCircleInviteUri({ callSkill, circleId: 'c', capabilities, apps: ['tasks'] });
    // decode the payload back out of the onderling-invite:// URI
    const b64 = r.uri.replace(/^onderling-invite:\/\//, '');
    const decoded = JSON.parse(Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    expect(decoded.capabilities).toEqual(capabilities);
    expect(decoded.apps).toEqual(['tasks']);
  });

  it('the pod disclosure rides the ENCODED URI, not just the invite object (the encoder-whitelist bug)', async () => {
    const callSkill = vi.fn(async (app, op) =>
      (op === 'getCurrentMembershipCode' ? { code: 'C', expiresAt: 1 } : {}));
    const decode = (uri) => JSON.parse(Buffer.from(
      uri.replace(/^onderling-invite:\/\//, '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    // encodeMembershipCodeUrl WHITELISTS fields; until 2026-07-28 it dropped podBacked/podUrl, so a
    // real pasted/scanned invite never carried the J-NP3 disclosure the object-path tests proved.
    const r = await buildCircleInviteUri({
      callSkill, circleId: 'c', podBacked: true, podUrl: 'https://pod.example/circles/c',
    });
    const d = decode(r.uri);
    expect(d.podBacked).toBe(true);
    expect(d.podUrl).toBe('https://pod.example/circles/c');
  });

  it('carries the RELAY endpoint when passed; junk or absent relay stays off the invite', async () => {
    const callSkill = vi.fn(async (app, op) =>
      (op === 'getCurrentMembershipCode' ? { code: 'C', expiresAt: 1 } : {}));
    const decode = (uri) => JSON.parse(Buffer.from(
      uri.replace(/^onderling-invite:\/\//, '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    // a pasted invite has no deep-link context — the relay endpoint must ride the invite itself (rule 1).
    const withRelay = await buildCircleInviteUri({ callSkill, circleId: 'c', relayUrl: ' wss://relay.example ' });
    expect(decode(withRelay.uri).relayUrl).toBe('wss://relay.example');   // trimmed
    for (const bad of [null, '', 'https://not-a-socket', 'relay.example']) {
      const r = await buildCircleInviteUri({ callSkill, circleId: 'c', relayUrl: bad });
      expect('relayUrl' in decode(r.uri)).toBe(false);
    }
  });

  it('B/S4 — omits the template when there is none (invite unchanged for un-configured circles)', async () => {
    const callSkill = vi.fn(async (app, op) =>
      (op === 'getCurrentMembershipCode' ? { code: 'C', expiresAt: 1 } : {}));
    const r = await buildCircleInviteUri({ callSkill, circleId: 'c', capabilities: {}, apps: [] });
    const b64 = r.uri.replace(/^onderling-invite:\/\//, '');
    const decoded = JSON.parse(Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    expect('capabilities' in decoded).toBe(false);
    expect('apps' in decoded).toBe(false);
  });

  it('fold-in C/Q3 — embeds offeringsMatching: true when passed; omits it otherwise (older-invite shape)', async () => {
    const callSkill = vi.fn(async (app, op) =>
      (op === 'getCurrentMembershipCode' ? { code: 'C', expiresAt: 1 } : {}));
    const decode = (uri) => JSON.parse(Buffer.from(
      uri.replace(/^onderling-invite:\/\//, '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    const on = await buildCircleInviteUri({ callSkill, circleId: 'c', offeringsMatching: true });
    expect(decode(on.uri).offeringsMatching).toBe(true);
    const off = await buildCircleInviteUri({ callSkill, circleId: 'c', offeringsMatching: false });
    expect('offeringsMatching' in decode(off.uri)).toBe(false);
    const absent = await buildCircleInviteUri({ callSkill, circleId: 'c' });
    expect('offeringsMatching' in decode(absent.uri)).toBe(false);
  });

  it('mints a fresh code (rotateMyGroupCode) when there is no active one', async () => {
    const callSkill = vi.fn(async (app, op) => {
      if (op === 'getCurrentMembershipCode') return { error: 'no-code' };
      if (op === 'rotateMyGroupCode') return { codeId: 'x', code: 'FRESH-CODE', expiresAt: 42 };
      return {};
    });
    const r = await buildCircleInviteUri({ callSkill, circleId: 'c', adminPeerAddr: 'a' });
    expect(callSkill).toHaveBeenCalledWith('stoop', 'rotateMyGroupCode', { groupId: 'c' });
    expect(r.uri).toMatch(/^onderling-invite:\/\//);
  });
});

describe('joinCircleFromInvite', () => {
  it('round-trips a built invite → local redeem → joined', async () => {
    const issuer = vi.fn(async (app, op) =>
      (op === 'getCurrentMembershipCode' ? { code: 'CODE-9', expiresAt: 9 } : {}));
    const { uri } = await buildCircleInviteUri({ callSkill: issuer, circleId: 'kaas', adminPeerAddr: 'a' });

    // joiner side — local redeemMembershipCode succeeds (has the code), no peer fallback needed.
    const joinSkill = vi.fn(async (app, op) => {
      if (op === 'setMyHandle') return { ok: true };
      if (op === 'redeemMembershipCode') return { ok: true };
      return {};
    });
    const r = await joinCircleFromInvite({ inviteUri: uri, rulesAccepted: true, callSkill: joinSkill, handle: 'frits' });
    expect(r.ok).toBe(true);
    expect(r.circleId).toBe('kaas');
    expect(joinSkill).toHaveBeenCalledWith('stoop', 'redeemMembershipCode', expect.objectContaining({ groupId: 'kaas', code: 'CODE-9' }));
  });

  it('requires a handle and rejects a bad invite', async () => {
    const callSkill = vi.fn();
    expect(await joinCircleFromInvite({ inviteUri: 'onderling-invite://x', rulesAccepted: true, callSkill, handle: '' })).toEqual({ error: 'handle-required' });
    const bad = await joinCircleFromInvite({ inviteUri: 'not-an-invite', rulesAccepted: true, callSkill, handle: 'me' });
    expect(bad.error).toBeTruthy();
    expect(callSkill).not.toHaveBeenCalled();
  });

  // ── Cross-circle linkability parity with the wizards (Decision B) ──────────
  const buildJoinFixture = async () => {
    const issuer = vi.fn(async (app, op) => (op === 'getCurrentMembershipCode' ? { code: 'CODE-9', expiresAt: 9 } : {}));
    const { uri } = await buildCircleInviteUri({ callSkill: issuer, circleId: 'kaas', adminPeerAddr: 'a' });
    const joinSkill = vi.fn(async (app, op) => (op === 'setMyHandle' || op === 'redeemMembershipCode' ? { ok: true } : {}));
    const redeemArgs = () => joinSkill.mock.calls.find(([, op]) => op === 'redeemMembershipCode')?.[2] ?? {};
    return { uri, joinSkill, redeemArgs };
  };

  it('continue-as-existing-self: presents the source circle key + a signing PROOF to the redeem', async () => {
    const { uri, joinSkill, redeemArgs } = await buildJoinFixture();
    const circleAddressFor = vi.fn((cid) => (cid === 'brood' ? 'ADDR-BROOD' : null));
    const signCircleLink = vi.fn((src, gid, addr) => `PROOF(${src},${gid},${addr})`);
    const r = await joinCircleFromInvite({
      inviteUri: uri, callSkill: joinSkill, handle: 'frits',
      rulesAccepted: true,   // task #80 — these tests simulate a joiner who ticked the rules
      linkChoice: 'brood', circles: [{ id: 'brood', name: 'Brood' }], circleAddressFor, signCircleLink,
    });
    expect(r.ok).toBe(true);
    expect(circleAddressFor).toHaveBeenCalledWith('brood');
    expect(signCircleLink).toHaveBeenCalledWith('brood', 'kaas', 'ADDR-BROOD');
    expect(redeemArgs()).toMatchObject({ circleAddress: 'ADDR-BROOD', circleAddressProof: 'PROOF(brood,kaas,ADDR-BROOD)' });
  });

  it('default is fresh/unlinkable — no circleAddress or proof reaches the redeem (back-compat)', async () => {
    const { uri, joinSkill, redeemArgs } = await buildJoinFixture();
    await joinCircleFromInvite({ inviteUri: uri, rulesAccepted: true, callSkill: joinSkill, handle: 'frits' });
    expect('circleAddress' in redeemArgs()).toBe(false);
    expect('circleAddressProof' in redeemArgs()).toBe(false);
  });

  it('deny-by-default: an unknown source circle falls back to fresh (no key presented)', async () => {
    const { uri, joinSkill, redeemArgs } = await buildJoinFixture();
    const circleAddressFor = vi.fn(() => 'X');
    await joinCircleFromInvite({
      inviteUri: uri, callSkill: joinSkill, handle: 'frits',
      rulesAccepted: true,   // task #80 — these tests simulate a joiner who ticked the rules
      linkChoice: 'a-circle-im-not-in', circles: [{ id: 'brood' }], circleAddressFor, signCircleLink: () => 'P',
    });
    // Deny-by-default is about NOT presenting the SOURCE circle's key: the chosen source is never resolved
    // to an address (so it can't be signed/presented), and nothing reaches the redeem. `circleAddressFor`
    // IS legitimately called with the JOINING circle's id to record local restore-data (the membership
    // registry) — a different, local-only use — so we assert on the source id, not "never called at all".
    expect(circleAddressFor).not.toHaveBeenCalledWith('a-circle-im-not-in');
    expect('circleAddress' in redeemArgs()).toBe(false);
  });

  it('existing-self WITHOUT the signing seam: presents the key but NO proof (admin drops the link)', async () => {
    const { uri, joinSkill, redeemArgs } = await buildJoinFixture();
    await joinCircleFromInvite({
      inviteUri: uri, callSkill: joinSkill, handle: 'frits',
      rulesAccepted: true,   // task #80 — these tests simulate a joiner who ticked the rules
      linkChoice: 'brood', circles: [{ id: 'brood' }], circleAddressFor: () => 'ADDR-BROOD',
    });
    expect(redeemArgs().circleAddress).toBe('ADDR-BROOD');
    expect('circleAddressProof' in redeemArgs()).toBe(false);
  });
});
