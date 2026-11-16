/**
 * A PERSON'S OWN LISTS REACH THEIR OTHER DEVICE, AS THE SELF THAT MADE THEM, over a real relay. Anna's phone and her
 * always-on device hold the general self; the phone also holds Werk, the always-on device does not. A list made on the
 * phone as the general self is read on the always-on device (through the lists op, as there); a list made as Werk does
 * not arrive there (Werk's lane goes to Werk's devices only), and Bea never holds either. The device that DOES hold Werk
 * gets Werk's list: personaOwnLanes.relay.test.js (the same lane, a device enrolled with Werk).
 *
 * Branch named: the own lane carries EVERY own row by construction (the own store's mirror publishes each written item
 * on the lane of the self that wrote it, `wireOwnLane` in the agent: no type list), so a list needs no carry of its own.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { until } from '../support/pairRealAgents.js';
import { bootAnnaTwoDevices } from '../support/annaTwoDevices.js';
import { OWN_DEVICES_SCOPE } from '../../src/v2/grantsManifest.js';

const GROUP = 'anna-own-lists';
const OWN = OWN_DEVICES_SCOPE;

describe("a person's own lists between their devices", () => {
  let w;
  beforeAll(async () => { w = await bootAnnaTwoDevices({ group: GROUP }); }, 180_000);
  afterAll(async () => { await w?.close?.(); });

  it('a list made as the general self is read on the other device; one made as Werk does not go to a device without Werk', async () => {
    const made = await w.A.agent.callSkill('lists', 'createList', { circleId: OWN, text: 'Boodschappen' });
    expect(made?.ok, JSON.stringify(made)).toBe(true);
    expect((await w.A.agent.callSkill('lists', 'addToList', { circleId: OWN, list: 'Boodschappen', text: 'melk' }))?.ok).toBe(true);

    // WERK on the phone only (the always-on device was enrolled before Werk existed and does not hold it)
    const p = await w.A.agent.callSkill('agents', 'createProfile', { name: 'Werk' });
    const werk = w.A.agent.persona(p.id).chatId.pubKey;
    expect(w.A2.agent.persona?.(p.id) ?? null, 'the always-on device does not hold Werk').toBeFalsy();
    expect((await w.A.agent.callSkill('lists', 'createList', { circleId: OWN, text: 'Projecten' }, { actAs: werk }))?.ok).toBe(true);

    // the general self's list, read on the always-on device through the op (as the general self there)
    const read = await until(async () => {
      const r = await w.A2.agent.callSkill('lists', 'listEntries', { circleId: OWN, list: 'Boodschappen' });
      return r?.ok && r.items?.length ? r : null;
    }, { timeout: 20_000, step: 300 });
    expect(read?.items?.map((i) => i.label), 'the list and its entry crossed').toEqual(['melk']);

    // Werk's list: not on the always-on device (raw store, not only the view), and not on Bea's
    await new Promise((r) => { setTimeout(r, 2000); });
    const onBox = (await (await w.A2.agent.ownStore()).listByType('list')).map((l) => l.text);
    expect(onBox, 'the general self\'s list is there').toContain('Boodschappen');
    expect(onBox, 'Werk\'s list never reached a device without Werk').not.toContain('Projecten');
    expect((await (await w.B.agent.ownStore()).listByType('list')).length, 'Bea holds none of Anna\'s lists').toBe(0);
  }, 120_000);
});
