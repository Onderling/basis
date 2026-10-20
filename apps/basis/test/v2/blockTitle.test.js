import { describe, it, expect, beforeAll } from 'vitest';
import { blockTitle, blockEmptyLine } from '../../src/v2/blockTitle.js';
import { initLocalisation, t as tr } from '../../src/localisation.js';

describe("a block's title and empty line (Vandaag polish)", () => {
  beforeAll(async () => { await initLocalisation({ lng: 'en' }); });
  const t = (k, v) => tr(k, v, 'en');
  it('never the TYPE: an empty generic list is called by its noun', () => {
    const line = blockEmptyLine({ type: 'items', status: 'empty', content: { noun: 'note', items: [] } }, t);
    expect(line).not.toMatch(/items/i);
    expect(line).toBe('Notes — nothing yet');
  });
  it('the agenda says nothing is planned, tasks that nothing is open, the news line that there is none', () => {
    expect(blockEmptyLine({ type: 'calendar', status: 'empty' }, t)).toBe('Agenda — nothing planned');
    expect(blockEmptyLine({ type: 'tasks', status: 'empty' }, t)).toBe('Tasks — nothing open');
    expect(blockEmptyLine({ type: 'circlesUnread', status: 'empty' }, t)).toBe('Circles with news — none');
    // …and a projected list of appointments or tasks says the same as its kind does
    expect(blockEmptyLine({ type: 'items', status: 'empty', content: { noun: 'calendar-event' } }, t)).toMatch(/— nothing planned$/);
    expect(blockEmptyLine({ type: 'items', status: 'empty', content: { noun: 'task' } }, t)).toMatch(/— nothing open$/);
  });
  it("a block's own title wins", () => {
    expect(blockTitle({ type: 'calendar', titleKey: 'circle.recipe.block.notes' }, t)).toBe('Notes');
  });
  it('and in Dutch', () => {
    const nl = (k, v) => tr(k, v, 'nl');
    expect(blockEmptyLine({ type: 'calendar', status: 'empty' }, nl)).toMatch(/niets gepland/);
    expect(blockEmptyLine({ type: 'tasks', status: 'empty' }, nl)).toMatch(/niets open/);
  });
});

describe("Vandaag's day header", () => {
  it('names the day, in the language the rest of the screen is: "dinsdag 20 oktober"', async () => {
    const { dayHeader } = await import('../../src/v2/whenWords.js');
    const at = new Date(2026, 9, 20, 11, 55).getTime();
    expect(dayHeader(at, { locale: 'nl-NL' })).toBe('dinsdag 20 oktober');
    expect(dayHeader(at, { locale: 'en-GB' })).toBe('Tuesday 20 October');
  });
});

describe("a row's maker tag", () => {
  it("an own row says nothing (it is the person's own); a circle's row names its circle", async () => {
    const { whereTag } = await import('../../src/v2/rowWhere.js');
    const t = (k) => k;
    expect(whereTag({ own: true, label: 'broodje pindakaas eten' }, t)).toBe('');
    expect(whereTag({ circleName: 'Huishouden' }, t)).toBe('Huishouden');
  });
});
