import { describe, it, expect } from 'vitest';
import { renderCoverage, coverageGaps, formatCoverageMarkdown } from '../src/index.js';

const manifest = {
  appId: 'demo',
  operations: [
    { id: 'addThing', verb: 'add', surfaces: {
        chat: { hint: 'add' },
        slash: { command: '/add', match: { verbs: ['add', 'voeg'], body: 'text-only' } },
        ui: { control: 'button', label: 'Add' } } },
    { id: 'listThings', verb: 'list', surfaces: { chat: { hint: 'list' }, slash: { command: '/list' } } },
    { id: 'pokeThing', verb: 'poke', surfaces: { ui: { control: 'button', label: 'Poke' } } },
    { id: 'newThing', verb: 'add', surfaces: {} },     // creative verb → web/mobile even w/o surfaces.ui
    { id: 'ghost', verb: 'noop', surfaces: {} },        // no surface at all
  ],
};

describe('renderCoverage', () => {
  const cov = renderCoverage(manifest);
  const byId = Object.fromEntries(cov.rows.map((r) => [r.op, r]));

  it('detects each surface from the op declarations', () => {
    expect(byId.addThing).toMatchObject({ chat: true, slash: true, gate: true, screen: true, inline: true });
    expect(byId.addThing.gateVerbs).toEqual(['add', 'voeg']);
    expect(byId.listThings).toMatchObject({ chat: true, slash: true, gate: false, screen: false, inline: false });
    expect(byId.pokeThing).toMatchObject({ chat: false, slash: false, gate: false, screen: true, inline: true });
  });

  it('a creative verb (add/register) surfaces on web/mobile even without surfaces.ui', () => {
    expect(byId.newThing.screen).toBe(true);
    expect(byId.newThing.inline).toBe(false);
  });

  it('an op with no surfaces is all-false', () => {
    expect(byId.ghost).toMatchObject({ chat: false, slash: false, gate: false, screen: false, inline: false });
  });

  it('totals count present cells', () => {
    expect(cov.totals.ops).toBe(5);
    expect(cov.totals.chat).toBe(2);
    expect(cov.totals.gate).toBe(1);
    expect(cov.totals.screen).toBe(3);   // addThing(ui) + pokeThing(ui) + newThing(creative)
    expect(cov.totals.inline).toBe(2);
  });

  it('coverageGaps lists the ops missing a surface', () => {
    expect(coverageGaps(cov, 'gate').map((g) => g.op)).toEqual(['listThings', 'pokeThing', 'newThing', 'ghost']);
  });

  it('several manifests merge, each row tagged with its app', () => {
    const cov2 = renderCoverage([manifest, { appId: 'other', operations: [{ id: 'x', verb: 'list', surfaces: { chat: {} } }] }]);
    expect(cov2.rows.at(-1)).toMatchObject({ app: 'other', op: 'x', chat: true });
  });

  it('formatCoverageMarkdown renders a table with header + totals row', () => {
    const md = formatCoverageMarkdown(cov);
    expect(md).toContain('| app | op | verb | chat | slash | gate | web/mobile | inline | gate verbs |');
    expect(md).toContain('`addThing`');
    expect(md).toContain('**totals**');
  });
});
