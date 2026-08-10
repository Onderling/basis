/**
 * basis — parameter-register multi-device JOURNEYS (#36 settable surface).
 *
 * These exercise the register's read/write surface THROUGH THE REAL COMPOSITION
 * (`createRealHouseholdAgent` → the `params` app-origin branch of `callSkill`),
 * not the paramsService in isolation. The point is what a real second device of a
 * real user actually sees.
 *
 * THE MECHANISM — shared settings store = one user, two (or more) devices:
 *   Two separate `createRealHouseholdAgent` instances that SHARE one
 *   `settingsDataSource` stand in for two devices of ONE user's pod. Each agent
 *   still boots its OWN random per-install `deviceId` (node has no localStorage,
 *   so each gets a fresh in-memory vault → a fresh UUID), exactly like two real
 *   installs. The register HYDRATES from that shared store at construction, so:
 *     • AGENT scope persists to the per-user `shared.json` — SAME path on the
 *       shared store, so it SYNCS: a device constructed after a set sees the value.
 *     • DEVICE scope persists to `devices/<deviceId>.json` — each agent's own
 *       random deviceId, so it stays LOCAL and does NOT cross to the other device.
 *   Construction is ordered on purpose: set on A, THEN build B, so B hydrates A's
 *   persisted value at boot. A fresh agent over the same store is also a "reboot".
 *
 * Facts the assertions rely on (registered kind:user params):
 *   • nearby.ask.defaultTtlMs — scope AGENT, default 30*60_000 (1800000)  → syncs
 *   • retention.chatDays      — scope DEVICE, default 14                  → local-only
 * The surface: agent.callSkill('params', 'set-param'|'get-param'|'list-user-params', args).
 */
import { describe, it, expect } from 'vitest';
import { memoryDataSource } from '@onderling/item-store';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';

const mk = (settingsDataSource) =>
  createRealHouseholdAgent({ seedHousehold: false, settingsDataSource });

const AGENT_KEY  = 'nearby.ask.defaultTtlMs';
const DEVICE_KEY = 'retention.chatDays';

describe('parameter register — multi-device journeys (#36, through the real composition)', () => {
  it('S1 — agent scope SYNCS across devices: B hydrates A\'s persisted value at boot', async () => {
    const shared = memoryDataSource();
    const A = await mk(shared);
    const set = await A.callSkill('params', 'set-param', { key: AGENT_KEY, value: 10 * 60_000 });
    expect(set.ok).toBe(true);
    expect(set.scope).toBe('agent');

    // Build B AFTER A's write — B hydrates the shared shared.json at construction.
    const B = await mk(shared);
    const got = await B.callSkill('params', 'get-param', { key: AGENT_KEY });
    expect(got).toEqual({ ok: true, key: AGENT_KEY, value: 10 * 60_000 });
  });

  it('S6 — reboot round-trip: a fresh agent over the SAME store hydrates the set value', async () => {
    const shared = memoryDataSource();
    const A = await mk(shared);
    await A.callSkill('params', 'set-param', { key: AGENT_KEY, value: 5 * 60_000 });

    // A fresh construction over the same store = a "reboot" of the same install/pod.
    const C = await mk(shared);
    const got = await C.callSkill('params', 'get-param', { key: AGENT_KEY });
    expect(got.ok).toBe(true);
    expect(got.value).toBe(5 * 60_000);
  });

  it('S2 — device scope is LOCAL-ONLY: B sees the default, not A\'s device set', async () => {
    const shared = memoryDataSource();
    const A = await mk(shared);
    const set = await A.callSkill('params', 'set-param', { key: DEVICE_KEY, value: 30 });
    expect(set.ok).toBe(true);
    expect(set.scope).toBe('device');
    // A's OWN read reflects the set (same device).
    expect((await A.callSkill('params', 'get-param', { key: DEVICE_KEY })).value).toBe(30);

    // B has a DIFFERENT random deviceId → its devices/<id>.json is empty → default 14.
    const B = await mk(shared);
    const got = await B.callSkill('params', 'get-param', { key: DEVICE_KEY });
    expect(got.ok).toBe(true);
    expect(got.value).toBe(14);
    expect(got.value).not.toBe(30);
  });

  it('S4 — kind gate refuses a non-user param, and nothing crosses to B', async () => {
    const shared = memoryDataSource();
    const A = await mk(shared);
    // nearby.ask.maxText is an internal cap — not in the settable register.
    const set = await A.callSkill('params', 'set-param', { key: 'nearby.ask.maxText', value: 9999 });
    expect(set.ok).toBe(false);

    // Nothing was written, so a second device can't observe it either.
    const B = await mk(shared);
    const got = await B.callSkill('params', 'get-param', { key: 'nearby.ask.maxText' });
    expect(got.ok).toBe(false);
  });

  it('S5 — an unknown key is refused with param-unknown', async () => {
    const shared = memoryDataSource();
    const A = await mk(shared);
    const set = await A.callSkill('params', 'set-param', { key: 'not.a.param', value: 1 });
    expect(set.ok).toBe(false);
    expect(set.error).toBe('param-unknown');
  });

  it('list-user-params includes both the agent- and device-scoped user params', async () => {
    const A = await mk(memoryDataSource());
    const res = await A.callSkill('params', 'list-user-params');
    expect(res.ok).toBe(true);
    const keys = res.params.map((p) => p.key);
    expect(keys).toContain(AGENT_KEY);
    expect(keys).toContain(DEVICE_KEY);
  });
});
