/**
 * The person's own acts in the REAL composition: one booted agent, its device log, the outer waist (`callSkill` as the
 * shells reach it). Crosses the branches `callSkill` answers itself (a list line, a setting), and the ones that pass
 * the dispatch membrane (pinboard): each act lands ONE `own-action`, a paint read lands none, the agent trail stays
 * empty of the owner, and the switch off writes nothing from then on.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { EventLog } from '../src/eventLog.js';
import { OWN_ACTION_KIND, OWN_RECORD_KEY } from '../src/ownActions.js';

const boot = (deviceLog) => createRealHouseholdAgent({
  seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), deviceLog,
});
// the log lists newest first; oldest first here, so a slice after `before` is what came after
const own = (log) => log.query().reverse().filter((e) => e.type === OWN_ACTION_KIND).map((e) => `${e.payload.app}.${e.payload.op}:${e.payload.outcome}`);

describe('own acts at the outer waist', () => {
  it('a setting changed and a profile written each land one entry; reads a screen makes land none; no agent-action for the owner', async () => {
    const deviceLog = new EventLog({ initial: [], muted: [] });
    const a = await boot(deviceLog);
    const before = own(deviceLog).length;
    await a.callSkill('params', 'set-param', { key: 'nearby.ask.defaultTtlMs', value: 123_000 });   // answered by callSkill itself
    await a.callSkill('pinboard', 'listMyCircles', {});                                           // a paint read: not an act
    await a.callSkill('pinboard', 'whoAmI', {});                                                  // a paint read
    await a.callSkill('pinboard', 'listMyCircles', {}, { door: 'slash' });                         // a read the person asked for
    const rows = own(deviceLog).slice(before);
    expect(rows).toEqual(['params.set-param:ok', 'pinboard.listMyCircles:ok']);
    expect(deviceLog.query().filter((e) => e.type === 'agent-action')).toHaveLength(0);
    expect(JSON.stringify(deviceLog.query().filter((e) => e.type === OWN_ACTION_KIND))).not.toContain('123000');
  });

  it('a call a door person makes is theirs, not the owner\'s: no own-action', async () => {
    const deviceLog = new EventLog({ initial: [], muted: [] });
    const a = await boot(deviceLog);
    const before = own(deviceLog).length;
    await a.callSkill('params', 'set-param', { key: 'nearby.ask.defaultTtlMs', value: 99_000 }, { caller: 'someone-else' }).catch(() => null);
    expect(own(deviceLog).slice(before)).toEqual([]);
  });

  it('the switch off writes nothing from then on (switching it off is the last act recorded)', async () => {
    const deviceLog = new EventLog({ initial: [], muted: [] });
    const a = await boot(deviceLog);
    await a.callSkill('params', 'set-param', { key: OWN_RECORD_KEY, value: false });
    const before = own(deviceLog).length;
    await a.callSkill('params', 'set-param', { key: 'nearby.ask.defaultTtlMs', value: 77_000 });
    expect(own(deviceLog).slice(before)).toEqual([]);
  });
});
