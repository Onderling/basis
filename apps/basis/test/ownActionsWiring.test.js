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
  it('a setting a door names lands one entry, a door-less one none; reads a screen makes land none; no agent-action for the owner', async () => {
    const deviceLog = new EventLog({ initial: [], muted: [] });
    const a = await boot(deviceLog);
    const before = own(deviceLog).length;
    await a.callSkill('params', 'set-param', { key: 'nearby.ask.defaultTtlMs', value: 123_000 }, { door: 'tap' });   // answered by callSkill itself
    await a.callSkill('params', 'set-param', { key: 'nearby.ask.defaultTtlMs', value: 124_000 });                    // no door: background, not recorded
    await a.callSkill('pinboard', 'listMyCircles', {}, { door: 'tap' });                          // a paint read: not an act
    await a.callSkill('pinboard', 'whoAmI', {});                                                  // a paint read
    await a.callSkill('pinboard', 'listMyCircles', {}, { door: 'slash' });                         // a read the person asked for
    const rows = own(deviceLog).slice(before);
    expect(rows).toEqual(['params.set-param:ok', 'pinboard.listMyCircles:ok']);
    expect(deviceLog.query().filter((e) => e.type === 'agent-action')).toHaveLength(0);
    expect(JSON.stringify(deviceLog.query().filter((e) => e.type === OWN_ACTION_KIND))).not.toContain('123000');
  });

  it('an act in a circle lands with that circle, whichever name the op gives it (groupId to make it, circleId to add a line)', async () => {
    const deviceLog = new EventLog({ initial: [], muted: [] });
    const a = await boot(deviceLog);
    const made = await a.callSkill('pinboard', 'createGroupV2', { groupId: 'thuis', name: 'Thuis', rules: { text: 't' } }, { door: 'tap' });
    expect(made?.ok ?? true, JSON.stringify(made)).not.toBe(false);
    await a.callSkill('lists', 'addToList', { circleId: 'thuis', item: 'melk' }, { door: 'phrase' });
    const rows = deviceLog.query().reverse().filter((e) => e.type === OWN_ACTION_KIND).map((e) => [e.payload.op, e.circleId]);
    expect(rows).toEqual(expect.arrayContaining([['createGroupV2', 'thuis'], ['addToList', 'thuis']]));
    expect(JSON.stringify(deviceLog.query().filter((e) => e.type === OWN_ACTION_KIND))).not.toContain('melk');
  });

  it('a call a door person makes is theirs, not the owner\'s: no own-action', async () => {
    const deviceLog = new EventLog({ initial: [], muted: [] });
    const a = await boot(deviceLog);
    const before = own(deviceLog).length;
    await a.callSkill('params', 'set-param', { key: 'nearby.ask.defaultTtlMs', value: 99_000 }, { caller: 'someone-else', door: 'bot' }).catch(() => null);
    expect(own(deviceLog).slice(before)).toEqual([]);
  });

  it('the switch off writes nothing from then on (switching it off is the last act recorded)', async () => {
    const deviceLog = new EventLog({ initial: [], muted: [] });
    const a = await boot(deviceLog);
    await a.callSkill('params', 'set-param', { key: OWN_RECORD_KEY, value: false }, { door: 'tap' });
    const before = own(deviceLog).length;
    await a.callSkill('params', 'set-param', { key: 'nearby.ask.defaultTtlMs', value: 77_000 }, { door: 'tap' });
    expect(own(deviceLog).slice(before)).toEqual([]);
  });

  it('My data reads the record, exports it as one file and wipes it: the wipe takes this kind only', async () => {
    const deviceLog = new EventLog({ initial: [], muted: [] });
    const a = await boot(deviceLog);
    await a.callSkill('params', 'set-param', { key: 'nearby.ask.defaultTtlMs', value: 55_000 }, { door: 'tap' });
    await a.callSkill('lists', 'addToList', { circleId: 'thuis', item: 'melk' }, { door: 'phrase' });
    const rows = a.ownActionRows();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const file = JSON.parse(a.exportOwnActions());
    expect(file).toMatchObject({ format: 'onderling-own-actions', version: 1 });
    expect(file.rows).toEqual(rows);
    expect(JSON.stringify(file)).not.toMatch(/melk|55000/);
    const others = deviceLog.query().filter((e) => e.type !== OWN_ACTION_KIND).length;
    expect(a.wipeOwnActions()).toBe(rows.length);
    expect(a.ownActionRows()).toEqual([]);
    expect(deviceLog.query().filter((e) => e.type !== OWN_ACTION_KIND).length, 'nothing else went').toBe(others);
  });
});
