/**
 * H8 V0 integration test.  WiFi + on-LAN-agent attestation.
 *
 * Substrate composition:
 *   - L1b (item-store) — audit trail for issued attestations
 *
 * Substrates with stubbed I/O:
 *   - SDK transport routing (the prover's probeHomeAgent stub)
 *   - WiFi info (the prover's checkWifi stub)
 *
 * Real-device validation deferred per the H8 design notes (~1 week
 * of focused work for V0 with real WiFi/BLE/mDNS).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HomeAgent, ProverAgent } from '../src/index.js';

const HOME = 'https://id.example/home-de-roos';
const ANNE = 'https://id.example/anne';

let home;
beforeEach(() => {
  home = new HomeAgent({
    homeWebid:  HOME,
    locationId: 'household-de-roos',
    ttlMs:      5 * 60 * 1000,
  });
});

describe('H8 — happy path: WiFi + LAN → attestation', () => {
  it('issues a short-lived token when both signals pass', async () => {
    const probe = {
      checkWifi:        async () => ({ associated: true, ssidHash: 'abc' }),
      probeHomeAgent:   async () => ({ reachable: true, transport: 'lan' }),
    };
    const prover = new ProverAgent({
      subjectWebid:    ANNE,
      homeWebid:       HOME,
      probe,
      invokeHomeAgent: (args) => home.requestAttestation(args),
    });
    const result = await prover.attest();
    expect(result.subject).toBe(ANNE);
    expect(result.issuer).toBe(HOME);
    expect(result.location).toBe('household-de-roos');
    expect(result.signals).toEqual({ wifi: 'associated', lan: 'direct' });
    expect(result.expiresAt).toBeGreaterThan(result.issuedAt);
  });

  it('audit log records the attestation', async () => {
    const probe = {
      checkWifi:      async () => ({ associated: true }),
      probeHomeAgent: async () => ({ reachable: true, transport: 'lan' }),
    };
    const prover = new ProverAgent({
      subjectWebid:    ANNE,
      homeWebid:       HOME,
      probe,
      invokeHomeAgent: (args) => home.requestAttestation(args),
    });
    await prover.attest();
    const open = await home.listOpen();
    expect(open).toHaveLength(1);
    expect(open[0].text).toContain(ANNE);
    expect(open[0].source.presence.location).toBe('household-de-roos');
  });
});

describe('H8 — denial paths', () => {
  it('refuses when WiFi is not associated', async () => {
    const probe = {
      checkWifi:      async () => ({ associated: false }),
      probeHomeAgent: vi.fn(),
    };
    const prover = new ProverAgent({
      subjectWebid: ANNE, homeWebid: HOME, probe,
      invokeHomeAgent: (args) => home.requestAttestation(args),
    });
    const result = await prover.attest();
    expect(result.error).toBe('wifi-not-associated');
    expect(probe.probeHomeAgent).not.toHaveBeenCalled();
  });

  it('refuses when home agent is reachable only via relay', async () => {
    const probe = {
      checkWifi:      async () => ({ associated: true }),
      probeHomeAgent: async () => ({ reachable: true, transport: 'relay' }),
    };
    const prover = new ProverAgent({
      subjectWebid: ANNE, homeWebid: HOME, probe,
      invokeHomeAgent: (args) => home.requestAttestation(args),
    });
    const result = await prover.attest();
    expect(result.error).toBe('not-lan-reachable');
  });

  it('refuses when home agent is unreachable', async () => {
    const probe = {
      checkWifi:      async () => ({ associated: true }),
      probeHomeAgent: async () => ({ reachable: false, transport: 'unreachable' }),
    };
    const prover = new ProverAgent({
      subjectWebid: ANNE, homeWebid: HOME, probe,
      invokeHomeAgent: (args) => home.requestAttestation(args),
    });
    const result = await prover.attest();
    expect(result.error).toBe('not-lan-reachable');
  });

  it('home agent denies when prover claims false signals', async () => {
    const result = await home.requestAttestation({
      subject: ANNE,
      signals: { wifiAssociated: false, lanReachable: true },
    });
    expect(result.error).toBe('denied');
    expect(result.reason).toBe('wifi-not-associated');
  });
});

describe('H8 — token verification', () => {
  it('home agent verifies its own valid token', async () => {
    const probe = {
      checkWifi:      async () => ({ associated: true }),
      probeHomeAgent: async () => ({ reachable: true, transport: 'lan' }),
    };
    const prover = new ProverAgent({
      subjectWebid: ANNE, homeWebid: HOME, probe,
      invokeHomeAgent: (args) => home.requestAttestation(args),
    });
    const token = await prover.attest();
    const v = home.verify(token);
    expect(v.valid).toBe(true);
  });

  it('rejects tokens from a different issuer', () => {
    const v = home.verify({
      id: 'x', subject: ANNE, issuer: 'https://id.example/other',
      location: 'household-de-roos', issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('unknown-issuer');
  });

  it('rejects expired tokens', () => {
    const v = home.verify({
      id: 'x', subject: ANNE, issuer: HOME,
      location: 'household-de-roos',
      issuedAt: Date.now() - 10_000_000,
      expiresAt: Date.now() - 60_000,
    });
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('expired');
  });

  it('rejects tokens for a different location', () => {
    const v = home.verify({
      id: 'x', subject: ANNE, issuer: HOME,
      location: 'household-other',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('wrong-location');
  });
});

describe('H8 — TTL behaviour', () => {
  it('honours custom ttlMs', async () => {
    let now = 1_700_000_000_000;
    const customHome = new HomeAgent({
      homeWebid: HOME, locationId: 'household-de-roos',
      ttlMs: 30_000,                     // 30 seconds
      now: () => now,
    });
    const token = await customHome.requestAttestation({
      subject: ANNE,
      signals: { wifiAssociated: true, lanReachable: true },
    });
    expect(token.expiresAt - token.issuedAt).toBe(30_000);

    // Verify before expiry
    expect(customHome.verify(token).valid).toBe(true);
    // Advance time past expiry
    now += 31_000;
    expect(customHome.verify(token).valid).toBe(false);
  });
});
