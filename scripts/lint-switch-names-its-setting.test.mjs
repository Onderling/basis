import { describe, it, expect } from 'vitest';
import { switchProblems } from './lint-switch-names-its-setting.mjs';

const facts = { ops: new Set(['setHolidayMode']), sourceText: "key: 'privacy.shareNknAddress'\nlocalStorage.getItem('basis.nearbyAllows')\n'sync.silo.chat'" };
const one = (line) => switchProblems([{ file: 'x.js', text: line }], facts);

describe('lint-switch-names-its-setting', () => {
  it('fails an orphan switch on either shell', () => {
    expect(one("box.type = 'checkbox';")).toHaveLength(1);
    expect(one("btn.setAttribute('role', 'switch');")).toHaveLength(1);
    expect(one('<Switch value={on} onValueChange={setOn} />')).toHaveLength(1);
  });
  it('fails a mark that names nothing real', () => {
    expect(one("box.type = 'checkbox';   // sets: op:noSuchOp")[0]).toMatch(/no manifest declares/);
    expect(one("box.type = 'checkbox';   // sets: param:no.such.key")[0]).toMatch(/nothing declares/);
    expect(one("box.type = 'checkbox';   // sets: local:never.read")[0]).toMatch(/nothing reads back/);
    expect(one("box.type = 'checkbox';   // sets: magic")[0]).toMatch(/unknown kind/);
  });
  it('passes a switch that says what it sets', () => {
    expect(one("box.type = 'checkbox';   // sets: op:setHolidayMode — your holiday")).toEqual([]);
    expect(one('<Switch /* sets: param:privacy.shareNknAddress */ value={x} />')).toEqual([]);
    expect(one("box.type = 'checkbox';   // sets: param:sync.* — a silo")).toEqual([]);
    expect(one("box.type = 'checkbox';   // sets: local:basis.nearbyAllows")).toEqual([]);
    expect(one("box.type = 'checkbox';   // sets: view — a filter")).toEqual([]);
  });
});
