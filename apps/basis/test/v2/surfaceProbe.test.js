/**
 * surfaceProbe — the machine-readable affordance list.
 *
 * The property under test is not "it returns a list"; it is that the probe answers the SAME question
 * the screens answer. A probe that could report a button the UI does not paint would make a walk's
 * findings worthless, which is the failure this whole seam exists to prevent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('a row action is reported per row, never as a standing affordance', () => {
  const s = probeSurface({ manifestsByOrigin: byOrigin, items: [{ id: 'c1', type: 'chore', label: 'Bins' }] });
  const global = s.actions.map((a) => a.opId);
  assert.deepEqual(global.sort(), ['addThing', 'openList'], 'appliesTo ops must not appear as global actions');
  assert.deepEqual(s.rows[0].actions.map((a) => a.opId).sort(), ['markDone', 'removeThing']);
});

test('an op with no ui surface is not offered at all', () => {
  const s = probeSurface({ manifestsByOrigin: byOrigin });
  assert.ok(!s.actions.some((a) => a.opId === 'silent'));
});

test('a row earns only the actions its TYPE matches — the inert-card case', () => {
  const s = probeSurface({ manifestsByOrigin: byOrigin, items: [{ id: 'm1', type: 'member', label: 'Frits' }] });
  assert.deepEqual(s.rows[0].actions, [], 'a member row earns no chore actions');
  // And this is the shape that makes "the member card offers nothing" a FINDING: the probe reports
  // the emptiness rather than failing to look.
  assert.equal(s.rows[0].type, 'member');
});

test('the probe agrees with itemRowButtons — it may not invent or omit a row action', () => {
  const item = { id: 'c2', type: 'chore' };
  const fromProjector = itemRowButtons(manifest, item).map((b) => b.opId).sort();
  const fromProbe = probeSurface({ manifestsByOrigin: byOrigin, items: [item] })
    .rows[0].actions.map((a) => a.opId).sort();
  assert.deepEqual(fromProbe, fromProjector);
});

test('required params and confirms are declared, so a walk knows what a tap will ask for', () => {
  const s = probeSurface({ manifestsByOrigin: byOrigin, items: [{ id: 'c3', type: 'chore' }] });
  assert.equal(s.actions.find((a) => a.opId === 'addThing').needsArgs, true);
  assert.equal(s.actions.find((a) => a.opId === 'openList').needsArgs, undefined);
});

test('pages come from the projector, so an unprojected page is reported unreachable', () => {
  const s = probeSurface({ manifestsByOrigin: byOrigin });
  assert.ok(s.pages.some((p) => p.opId === 'openList'), 'a declared page surface must project');
  assert.ok(s.pages.every((p) => p.appOrigin === 'demo'));
});

test('where is echoed back, so a walk log says where it was standing', () => {
  const s = probeSurface({ manifestsByOrigin: byOrigin, where: { circleId: 'proeftuin', screen: 'members' } });
  assert.deepEqual(s.where, { circleId: 'proeftuin', screen: 'members' });
});

test('the ⋯ roster is reported only where BOTH the manifest projects it and the host wired it', () => {
  const navManifest = {
    app: 'basis',
    actions: [
      { id: 'invite',   labelKey: 'circle.invite.menu',  target: { kind: 'nav', to: 'invite' } },
      { id: 'rules',    labelKey: 'circle.rules.title',  target: { kind: 'nav', to: 'rules' }, requires: ['houseRules'] },
      { id: 'unwired',  labelKey: 'circle.nope',         target: { kind: 'nav', to: 'nope' } },
    ],
  };
  const s = probeSurface({
    manifestsByOrigin: byOrigin, navManifest,
    policy: { features: { houseRules: false } },
    wiredActionIds: ['invite', 'rules'],          // `unwired` has no host callback
  });
  const ids = s.nav.map((n) => n.id);
  assert.ok(ids.includes('invite'), 'a projected + wired action must be reported');
  assert.ok(!ids.includes('unwired'), 'an unwired action is not on screen, so it must not be reported');
  assert.ok(!ids.includes('rules'), 'a requires-gated action must respect the policy gate');
});

test('with no navManifest the roster is simply empty, never invented', () => {
  assert.deepEqual(probeSurface({ manifestsByOrigin: byOrigin }).nav, []);
});
