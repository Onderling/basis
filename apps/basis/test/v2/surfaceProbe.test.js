/**
 * surfaceProbe — the machine-readable affordance list.
 *
 * The property under test is not "it returns a list"; it is that the probe answers the SAME question
 * the screens answer. A probe that could report a button the UI does not paint would make a walk's
 * findings worthless, which is the failure this whole seam exists to prevent.
 */
import { describe, it, expect } from 'vitest';
import { probeSurface } from '../../src/v2/surfaceProbe.js';
import { itemRowButtons } from '@onderling/app-manifest';

const manifest = {
  app: 'demo',
  operations: [
    { id: 'addThing',    verb: 'add',      params: [{ name: 'text', required: true }],
      surfaces: { ui: { control: 'button', label: 'Add' } } },
    { id: 'openList',    verb: 'list',     surfaces: { ui: { control: 'page' }, page: { labelKey: 'demo.list' } } },
    { id: 'markDone',    verb: 'complete', appliesTo: { type: ['chore'] },
      surfaces: { ui: { control: 'button', label: 'Done' } } },
    { id: 'removeThing', verb: 'remove',   appliesTo: { type: ['chore'] },
      surfaces: { ui: { control: 'button', label: 'Remove', confirm: { severity: 'warn' } } } },
    { id: 'silent',      verb: 'get' },                       // no ui surface → not an affordance
  ],
};
const byOrigin = { demo: manifest };

describe('what a person is offered, as data', () => {
  it('reports a row action per row, never as a standing affordance', () => {
    const s = probeSurface({ manifestsByOrigin: byOrigin, items: [{ id: 'c1', type: 'chore', label: 'Bins' }] });
    expect(s.actions.map((a) => a.opId).sort(), 'appliesTo ops must not appear as global actions')
      .toEqual(['addThing', 'openList']);
    expect(s.rows[0].actions.map((a) => a.opId).sort()).toEqual(['markDone', 'removeThing']);
  });

  it('does not offer an op with no ui surface at all', () => {
    expect(probeSurface({ manifestsByOrigin: byOrigin }).actions.some((a) => a.opId === 'silent')).toBe(false);
  });

  it('gives a row only the actions its TYPE matches — the inert-card case', () => {
    const s = probeSurface({ manifestsByOrigin: byOrigin, items: [{ id: 'm1', type: 'member', label: 'Frits' }] });
    // This shape is what makes "the member card offers nothing" a FINDING: the probe reports the
    // emptiness rather than failing to look.
    expect(s.rows[0].actions, 'a member row earns no chore actions').toEqual([]);
    expect(s.rows[0].type).toBe('member');
  });

  it('agrees with itemRowButtons — it may not invent or omit a row action', () => {
    const item = { id: 'c2', type: 'chore' };
    const fromProjector = itemRowButtons(manifest, item).map((b) => b.opId).sort();
    const fromProbe = probeSurface({ manifestsByOrigin: byOrigin, items: [item] })
      .rows[0].actions.map((a) => a.opId).sort();
    expect(fromProbe).toEqual(fromProjector);
  });

  it('declares required params and confirms, so a walk knows what a tap will ask for', () => {
    const s = probeSurface({ manifestsByOrigin: byOrigin });
    expect(s.actions.find((a) => a.opId === 'addThing').needsArgs).toBe(true);
    expect(s.actions.find((a) => a.opId === 'openList').needsArgs).toBeUndefined();
  });

  it('takes pages from the projector, so an unprojected page is reported unreachable', () => {
    const s = probeSurface({ manifestsByOrigin: byOrigin });
    expect(s.pages.some((pg) => pg.opId === 'openList'), 'a declared page surface must project').toBe(true);
    expect(s.pages.every((pg) => pg.appOrigin === 'demo')).toBe(true);
  });

  it('echoes where it was standing, so a walk log can say so', () => {
    const s = probeSurface({ manifestsByOrigin: byOrigin, where: { circleId: 'proeftuin', screen: 'members' } });
    expect(s.where).toEqual({ circleId: 'proeftuin', screen: 'members' });
  });
});

describe('the composer attach menu', () => {
  const attachManifest = {
    app: 'basis',
    operations: [
      { id: 'embed', verb: 'add', params: [{ name: 'itemId', required: true }],
        surfaces: { attach: { label: 'circle.attach.card', itemType: 'chore' }, ui: { control: 'button' } } },
      { id: 'embed-time', verb: 'add', params: [{ name: 'title', required: true }, { name: 'when', required: true }],
        surfaces: { attach: { label: 'circle.attach.appointment', itemType: 'event' }, ui: { control: 'button' } } },
    ],
  };

  it('names the op behind each entry, and what a tap will need first', () => {
    const s = probeSurface({ manifestsByOrigin: { basis: attachManifest } });
    const byOp = Object.fromEntries(s.attach.map((a) => [a.opId, a]));
    // The walk found both of these dead-ending with "I couldn't turn that into an action". The probe's
    // job is to say WHY that is possible: an entry whose op needs arguments cannot act on a bare tap.
    expect(byOp['embed'].needsArgs).toEqual(['itemId']);
    expect(byOp['embed-time'].needsArgs).toEqual(['title', 'when']);
    expect(byOp['embed'].label).toBe('circle.attach.card');
  });

  it('is empty for a manifest that declares no attach surface', () => {
    expect(probeSurface({ manifestsByOrigin: byOrigin }).attach).toEqual([]);
  });
});

describe('the ⋯ roster', () => {
  const navManifest = {
    app: 'basis',
    actions: [
      { id: 'invite',  labelKey: 'circle.invite.menu', target: { kind: 'nav', to: 'invite' } },
      { id: 'rules',   labelKey: 'circle.rules.title', target: { kind: 'nav', to: 'rules' }, requires: ['houseRules'] },
      { id: 'unwired', labelKey: 'circle.nope',        target: { kind: 'nav', to: 'nope' } },
    ],
  };

  it('is reported only where BOTH the manifest projects it and the host wired it', () => {
    const s = probeSurface({
      manifestsByOrigin: byOrigin, navManifest,
      policy: { features: { houseRules: false } },
      wiredActionIds: ['invite', 'rules'],          // `unwired` has no host callback
    });
    const ids = s.nav.map((n) => n.id);
    expect(ids.includes('invite'), 'a projected + wired action must be reported').toBe(true);
    expect(ids.includes('unwired'), 'an unwired action is not on screen, so must not be reported').toBe(false);
    expect(ids.includes('rules'), 'a requires-gated action must respect the policy gate').toBe(false);
  });

  it('is simply empty with no navManifest, never invented', () => {
    expect(probeSurface({ manifestsByOrigin: byOrigin }).nav).toEqual([]);
  });
});
