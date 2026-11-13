/**
 * THE "+" LINE ACTS WHERE ITS TARGET IS UNAMBIGUOUS, AND ASKS WHERE IT IS NOT. A line that names something of the
 * person's own is an own act. A line that names something living in a circle reads to that circle's act: at once when
 * exactly one of the person's circles reads it (or the line names the circle), otherwise as a card with a circle
 * chooser. The outcome carries the command; the shell runs it as the person through `callSkill` (the circle's own
 * doors and governance apply), or shows the card. A circle reads a line with the SAME phrase table the box reads
 * (`listsGateRules` over that circle's lists), then its manifests' own gate.
 */
import { describe, it, expect } from 'vitest';
import { plusLineOutcome } from '../../src/v2/vandaagPlus.js';
import { listsGateRules } from '../../src/v2/circleGate.js';
import { catalogueManifests } from '../../src/v2/manifestSources.js';

const byOrigin = Object.fromEntries(catalogueManifests().filter((m) => m?.app).map((m) => [m.app, m]));
const circle = (id, name, apps, lists = []) => ({ id, name, lists, manifestsByOrigin: Object.fromEntries(apps.map((a) => [a, byOrigin[a]])) });
const SHOP = { name: 'Boodschappen', kind: 'shopping' };

describe('the "+" line: own acts, else the circle act — at once when the circle is clear, else a card', () => {
  it("an own act stays the sheet's own (an appointment, a note)", () => {
    const r = plusLineOutcome('notitie: sleutel bij de buren', { circles: [circle('c1', 'Straat', ['pinboard'])] });
    expect(r).toMatchObject({ kind: 'own', actId: expect.any(String) });
  });

  it('exactly one circle holds the list the line names: the act runs at once there', () => {
    const r = plusLineOutcome('zet melk op de boodschappen', { circles: [circle('c1', 'Thuis', ['lists'], [SHOP]), circle('c2', 'Werk', ['lists'], [])] });
    expect(r).toEqual({
      kind: 'circle', atOnce: true, circleId: 'c1', to: [{ circleId: 'c1', name: 'Thuis' }],
      command: { appOrigin: 'lists', opId: 'addToList', args: { list: 'Boodschappen', text: 'melk', circleId: 'c1' } },
    });
  });

  it("a circle with the lists app but NOT that list does not read it (the lists table decides holding, not the manifest's gate)", () => {
    // found in the browser: the person's Help circle has no Boodschappen, but the tasks manifest's own phrasing reads
    // "zet melk op …" as a new task "melk", so a card asked "Help or Plus Kring"
    const r = plusLineOutcome('zet melk op de boodschappen', { circles: [circle('help', 'Help', ['lists', 'tasks'], []), circle('c1', 'Thuis', ['lists', 'tasks'], [SHOP])] });
    expect(r).toMatchObject({ kind: 'circle', atOnce: true, circleId: 'c1' });
  });

  it('two circles hold it: a card with both to choose from, nothing runs', () => {
    const r = plusLineOutcome('zet melk op de boodschappen', { circles: [circle('c1', 'Thuis', ['lists'], [SHOP]), circle('c2', 'Ouders', ['lists'], [SHOP])] });
    expect(r).toMatchObject({ kind: 'circle', atOnce: false, circleId: null, to: [{ circleId: 'c1', name: 'Thuis' }, { circleId: 'c2', name: 'Ouders' }] });
    expect(r.command).toMatchObject({ appOrigin: 'lists', opId: 'addToList', args: { list: 'Boodschappen', text: 'melk' } });
  });

  it("a pick on the card runs in THAT circle, on its own list (the reading names the list by name, not a circle-local id)", async () => {
    const { plusCircleOp } = await import('../../src/v2/vandaagPlus.js');
    const both = [circle('c1', 'Thuis', ['lists'], [SHOP]), circle('c2', 'Ouders', ['lists'], [SHOP])];
    const r = plusLineOutcome('zet melk op de boodschappen', { circles: both });
    const second = plusCircleOp(r.command, r.to[1].circleId);
    expect(second).toEqual({ app: 'lists', opId: 'addToList', args: { list: 'Boodschappen', text: 'melk', circleId: 'c2' } });
    // and the second circle read the line to the same command on its own (nothing of the first circle rides along)
    const own = plusLineOutcome('zet melk op de boodschappen', { circles: [both[1]] });
    expect(second).toEqual(plusCircleOp(own.command, 'c2'));
  });

  it('the line names one of them ("<circle>: …"): that circle, at once', () => {
    const r = plusLineOutcome('ouders: zet melk op de boodschappen', { circles: [circle('c1', 'Thuis', ['lists'], [SHOP]), circle('c2', 'Ouders', ['lists'], [SHOP])] });
    expect(r).toMatchObject({ kind: 'circle', atOnce: true, circleId: 'c2', command: { args: { list: 'Boodschappen', text: 'melk', circleId: 'c2' } } });
    // a name no circle has is just words: the line is read as it stands
    expect(plusLineOutcome('zolder: zet melk op de boodschappen', { circles: [circle('c1', 'Thuis', ['lists'], [SHOP])] })).toBeNull();
  });

  it("a circle's manifest phrasing still reads (a request on the pinboard), only where the circle offers it", () => {
    const r = plusLineOutcome('vraag: wie heeft een boor?', { circles: [circle('c1', 'Straat', ['pinboard']), circle('c2', 'Werk', ['tasks'])] });
    expect(r).toMatchObject({ kind: 'circle', atOnce: true, circleId: 'c1', command: { appOrigin: 'pinboard' } });
  });

  it('only what works there: a circle whose availability hides the op is not offered', () => {
    const hidden = { ...circle('c1', 'Straat', ['pinboard']), availability: { of: () => ({ state: 'hidden' }) } };
    expect(plusLineOutcome('vraag: wie heeft een boor?', { circles: [hidden, circle('c3', 'Buurt', ['pinboard'])] })).toMatchObject({ circleId: 'c3', atOnce: true });
  });

  it('a line no circle reads is no reading (the fields stay empty)', () => {
    expect(plusLineOutcome('vraag: wie heeft een boor?', { circles: [circle('c2', 'Werk', ['tasks'])] })).toBeNull();
  });

  it('ONE phrase table: the "+" and the box read a circle\'s lists to the same {opId, args}', () => {
    const lists = [SHOP, { name: 'Klusjes', defaultChild: 'task' }];
    const box = listsGateRules('nl', lists);
    for (const line of ['zet melk op de boodschappen', 'nieuwe taak: ramen lappen', 'wat staat er op de boodschappen']) {
      const rule = box.find((x) => x.test(line));
      const boxCmd = rule ? rule.command(line) : null;
      const plus = plusLineOutcome(line, { circles: [circle('c1', 'Thuis', ['lists', 'tasks'], lists)] });
      expect(boxCmd, line).not.toBeNull();
      const { circleId, ...args } = plus?.command?.args ?? {};
      expect({ opId: plus?.command?.opId, args }, line).toEqual({ opId: boxCmd.opId, args: boxCmd.args });
    }
  });
});

describe('a MODEL reading never acts in a circle', () => {
  it("the model is asked the own scope's acts only; its answer naming a circle's op is no reading", async () => {
    const { plusReadWithModel } = await import('../../src/v2/vandaagPlus.js');
    let bounds = null;
    const ask = async (_line, b) => { bounds = b; return { actId: 'addToList', values: { list: 'Boodschappen', text: 'melk', circleId: 'c1' } }; };
    expect(await plusReadWithModel('melk halen voor thuis', { ask })).toBeNull();
    expect(bounds.scope).not.toMatch(/^c1$/);
    expect(bounds.acts.map((a) => a.actId)).not.toContain('addToList');
  });
});

describe("the sheet's own acts, most used first (this device's counts, an 'own' key space)", () => {
  it('orders by the own counts; acts never used keep their declared order after', async () => {
    const { orderedPlusActs, PLUS_ACTS, OWN_USAGE_SCOPE } = await import('../../src/v2/vandaagPlus.js');
    const { createActionFrequencyStore } = await import('../../src/v2/actionFrequency.js');
    const f = createActionFrequencyStore();
    const last = PLUS_ACTS.at(-1);
    f.bump(OWN_USAGE_SCOPE, last.id, 3);
    expect(orderedPlusActs(PLUS_ACTS, f)[0].id).toBe(last.id);
    expect(orderedPlusActs(PLUS_ACTS, null).map((a) => a.id)).toEqual(PLUS_ACTS.map((a) => a.id));
  });
});
