/**
 * THE "+" LINE TALKS TO THE PERSON'S OWN AGENT ONLY. A line that names something that lives in a circle ("vraag: wie
 * heeft een boor?" is a circle's request) is answered with a REFERRAL — "that is for <circle> → open" — never with an
 * act in that circle from here: the outcome carries no op, so nothing the sheet does can invoke it.
 */
import { describe, it, expect } from 'vitest';
import { plusLineOutcome } from '../../src/v2/vandaagPlus.js';
import { catalogueManifests } from '../../src/v2/manifestSources.js';

const byOrigin = Object.fromEntries(catalogueManifests().filter((m) => m?.app).map((m) => [m.app, m]));
const circle = (id, name, apps) => ({ id, name, manifestsByOrigin: Object.fromEntries(apps.map((a) => [a, byOrigin[a]])) });

describe('the "+" line: own acts, else a referral — never an act elsewhere', () => {
  it("an own act stays the sheet's own (an appointment, a note)", () => {
    const r = plusLineOutcome('notitie: sleutel bij de buren', { circles: [circle('c1', 'Straat', ['pinboard'])] });
    expect(r).toMatchObject({ kind: 'own', actId: expect.any(String) });
  });
  it("a circle's op named on the line is a REFERRAL to the circle that offers it — no op, nothing to invoke", () => {
    const r = plusLineOutcome('vraag: wie heeft een boor?', { circles: [circle('c1', 'Straat', ['pinboard']), circle('c2', 'Werk', ['tasks'])] });
    expect(r).toEqual({ kind: 'referral', to: [{ circleId: 'c1', name: 'Straat' }] });
    expect(JSON.stringify(r)).not.toMatch(/opId|args|callSkill/);
  });
  it("only what works there: a circle whose availability hides the op is not offered", () => {
    const hidden = { ...circle('c1', 'Straat', ['pinboard']), availability: { of: () => ({ state: 'hidden' }) } };
    expect(plusLineOutcome('vraag: wie heeft een boor?', { circles: [hidden, circle('c3', 'Buurt', ['pinboard'])] })).toEqual({ kind: 'referral', to: [{ circleId: 'c3', name: 'Buurt' }] });
  });
  it('a line no circle offers is no reading (the fields stay empty)', () => {
    expect(plusLineOutcome('vraag: wie heeft een boor?', { circles: [circle('c2', 'Werk', ['tasks'])] })).toBeNull();
  });
});
