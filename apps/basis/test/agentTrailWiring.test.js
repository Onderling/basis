/**
 * The trail WIRING in the real composition (one-log step E, batch-4 trail emitters):
 *
 *   • a successful `set-param` through the waist lands a SETTINGS-CHANGE entry on the
 *     device log — the param KEY as the target pointer, never the value;
 *   • the OWNER's own ops do NOT land agent-action entries, even though every GUI op
 *     crosses the same dispatch membrane in-process (a bot-audit surface must not
 *     become self-surveillance);
 *   • a foreign caller exercising a skill DOES land one, read back via agentTrailRows.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { EventLog } from '../src/eventLog.js';
import { agentTrailRows } from '../src/v2/circleStream.js';

const boot = (deviceLog) => createRealHouseholdAgent({
  seedHousehold: false,
  ownerRootVault: new VaultMemory(),
  chatVault: new VaultMemory(),
  deviceLog,
});

describe('trail emitters at the waist', () => {
  it('set-param lands a settings-change with the KEY, not the value', async () => {
    const deviceLog = new EventLog({ initial: [], muted: [] });
    const a = await boot(deviceLog);
    const res = await a.callSkill('params', 'set-param', { key: 'nearby.ask.defaultTtlMs', value: 123_000 });
    expect(res.ok).toBe(true);

    const rows = deviceLog.query().filter((e) => e.type === 'settings-change');
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({
      op: 'set-param', via: 'owner', outcome: 'ok',
      target: { kind: 'param', ref: 'nearby.ask.defaultTtlMs' },
    });
    expect(JSON.stringify(rows[0])).not.toContain('123000');   // the value never rides the trail
  });

  it('a REFUSED set-param (internal param) lands nothing', async () => {
    const deviceLog = new EventLog({ initial: [], muted: [] });
    const a = await boot(deviceLog);
    const res = await a.callSkill('params', 'set-param', { key: 'stoop.inviteRedemptionSystemCap', value: 9 });
    expect(res.ok).toBe(false);
    expect(deviceLog.query().filter((e) => e.type === 'settings-change')).toHaveLength(0);
  });

  it('the owner\'s own ops cross the membrane without an agent-action entry', async () => {
    const deviceLog = new EventLog({ initial: [], muted: [] });
    const a = await boot(deviceLog);
    await a.callSkill('household', 'listOpen', { type: 'shopping' });   // a real in-process dispatch
    expect(deviceLog.query().filter((e) => e.type === 'agent-action')).toHaveLength(0);
  });

  it('a FOREIGN caller\'s exercise lands an agent-action, readable via agentTrailRows', async () => {
    const deviceLog = new EventLog({ initial: [], muted: [] });
    const a = await boot(deviceLog);
    // Drive the wired sink exactly as the membrane does for a non-owner caller — the
    // membrane→sink crossing itself is pinned in packages/core/test/agentTrail.test.js;
    // here the subject is the app-side rule (filter + landing + read-back).
    a.sa.agent.trailSink({ actor: 'agent-key-xyz', op: 'listOpen', via: 'grant:tok-1', outcome: 'ok' });

    const rows = agentTrailRows({ actor: 'agent-key-xyz', events: deviceLog.query(), circles: [] });
    expect(rows).toHaveLength(1);
    expect(rows[0].event.payload).toMatchObject({ op: 'listOpen', via: 'grant:tok-1', outcome: 'ok' });
    // …and the owner lens stays empty without an explicit actor (never fall open).
    expect(agentTrailRows({ events: deviceLog.query(), circles: [] })).toHaveLength(0);
  });
});
