/**
 * S6.A — reply → inline manifest buttons. Uses the REAL tasks manifest so the
 * appliesTo gating (a task's state decides which buttons show) is verified
 * against the contract the bot actually composes.
 */
import { describe, it, expect } from 'vitest';
import { snapshotsFromReply, embedButtonsForReply, embedsFromReply, embedButtonText } from '../src/v2/replyEmbeds.js';
import { mockTasksManifest } from '../src/core/manifests/mockManifests.js';
import { buildCapabilityMatrix, capabilityKey } from '@onderling/app-manifest';

const manifestsByOrigin = { 'tasks': mockTasksManifest };

describe('snapshotsFromReply', () => {
  it('extracts a single created task + defaults its type from the appOrigin', () => {
    const snaps = snapshotsFromReply({ task: { id: 't1', state: 'open', label: 'boodschappen' } }, { appOrigin: 'tasks' });
    expect(snaps).toEqual([{ id: 't1', type: 'task', state: 'open', label: 'boodschappen', fields: { id: 't1', state: 'open', label: 'boodschappen' } }]);
  });
  it('extracts a list (items/tasks) + dedups by id', () => {
    const snaps = snapshotsFromReply({ items: [{ id: 'a', state: 'open' }, { id: 'b', state: 'claimed' }, { id: 'a', state: 'open' }] }, { appOrigin: 'tasks' });
    expect(snaps.map((s) => s.id)).toEqual(['a', 'b']);
  });
  it('reads payload-wrapped replies + non-object → []', () => {
    expect(snapshotsFromReply({ payload: { tasks: [{ id: 'x', state: 'open' }] } }, { appOrigin: 'tasks' })[0].id).toBe('x');
    expect(snapshotsFromReply(null, { appOrigin: 'tasks' })).toEqual([]);
  });
});

describe('embedButtonsForReply (real tasks manifest, appliesTo-gated)', () => {
  it('an OPEN task offers Claim (state=open button) not Mark complete (state=claimed)', () => {
    const btns = embedButtonsForReply({ reply: { task: { id: 't1', state: 'open', label: 'boodschappen' } }, appOrigin: 'tasks', manifestsByOrigin });
    const ops = btns.map((b) => b.opId);
    expect(ops).toContain('claimTask');
    expect(ops).not.toContain('completeTask');   // gated out: completeTask is state:['claimed']
    expect(btns[0]).toMatchObject({ opId: 'claimTask', itemId: 't1' });
    expect(btns.find((b) => b.opId === 'claimTask').label).toMatch(/Claim/);
  });

  it('a CLAIMED task offers Mark complete + Submit, not Claim', () => {
    const btns = embedButtonsForReply({ reply: { task: { id: 't2', state: 'claimed', label: 'lekkage' } }, appOrigin: 'tasks', manifestsByOrigin });
    const ops = btns.map((b) => b.opId);
    expect(ops).toContain('completeTask');
    expect(ops).toContain('submitTask');
    expect(ops).not.toContain('claimTask');
  });

  it('builds one button set per item across a list, keyed opId:itemId', () => {
    const btns = embedButtonsForReply({
      reply: { tasks: [{ id: 'a', state: 'open' }, { id: 'b', state: 'claimed' }] },
      appOrigin: 'tasks', manifestsByOrigin,
    });
    expect(btns.some((b) => b.id === 'claimTask:a')).toBe(true);
    expect(btns.some((b) => b.id === 'completeTask:b')).toBe(true);
  });

  it('returns [] without a manifest or appOrigin', () => {
    expect(embedButtonsForReply({ reply: { task: { id: 't', state: 'open' } } })).toEqual([]);
  });
});

describe('embedsFromReply', () => {
  it('builds one embed for the ACTED-ON task (singular key), title from the reply', () => {
    const out = embedsFromReply({ task: { id: 't2', state: 'open', text: 'Fix the gate' } }, { appOrigin: 'tasks' });
    expect(out).toEqual([{ type: 'task', ref: 't2', title: 'Fix the gate' }]);
  });

  it('maps a calendar event snapshot type → calendar-event', () => {
    const out = embedsFromReply({ event: { id: 'e1', type: 'event', title: 'Lunch' } }, { appOrigin: 'calendar' });
    expect(out).toEqual([{ type: 'calendar-event', ref: 'e1', title: 'Lunch' }]);
  });

  it('does NOT spawn chips for a LIST reply (only the acted-on singular item)', () => {
    expect(embedsFromReply({ tasks: [{ id: 'a' }, { id: 'b' }] }, { appOrigin: 'tasks' })).toEqual([]);
  });

  it('handles itemId/eventId id aliases + a missing title', () => {
    expect(embedsFromReply({ event: { eventId: 'e9' } }, { appOrigin: 'calendar' }))
      .toEqual([{ type: 'calendar-event', ref: 'e9' }]);
  });

  it('returns [] for an empty / error reply', () => {
    expect(embedsFromReply(null)).toEqual([]);
    expect(embedsFromReply({ error: 'nope' })).toEqual([]);
  });
});

describe('embedButtonsForReply — B/S4 4c capability consequence', () => {
  const APP = mockTasksManifest.app;   // === 'tasks'
  const CLAIM = capabilityKey(APP, 'claim', 'task');
  const reply = { task: { id: 't1', state: 'open', label: 'x' } };

  it('hides an affordance whose cap is disabled with consequence hidden', () => {
    const matrix = buildCapabilityMatrix([{ manifest: mockTasksManifest }], { template: { [CLAIM]: { enabled: false, consequence: 'hidden' } } });
    const btns = embedButtonsForReply({ reply, appOrigin: APP, manifestsByOrigin, capabilityMatrix: matrix });
    expect(btns.map((b) => b.opId)).not.toContain('claimTask');
  });

  it('greys (disabled:true) an affordance the member opted out of (consequence greyed)', () => {
    const matrix = buildCapabilityMatrix([{ manifest: mockTasksManifest }], { template: { [CLAIM]: { freedom: 'optional', consequence: 'greyed' } }, optOuts: [CLAIM] });
    const btns = embedButtonsForReply({ reply, appOrigin: APP, manifestsByOrigin, capabilityMatrix: matrix });
    const claim = btns.find((b) => b.opId === 'claimTask');
    expect(claim).toBeTruthy();
    expect(claim.disabled).toBe(true);
  });

  it('no matrix ⇒ every appliesTo-gated button shows (unchanged)', () => {
    const btns = embedButtonsForReply({ reply, appOrigin: APP, manifestsByOrigin });
    expect(btns.some((b) => b.opId === 'claimTask' && !b.disabled)).toBe(true);
  });
});

describe('a reply button carries its labelKey and paints translated, with the item name beside it', () => {
  // Walked 2026-09-14: the assistant's task answer showed "Claim · brood halen" and "circle.item.share · brood
  // halen" — the LITERAL label composed in, the key dropped, nothing translated. Both shells now paint through one
  // helper: the translated key when there is one, the literal otherwise, the item name after it either way.
  it('embedButtonsForReply keeps labelKey and itemLabel beside the composed literal', () => {
    const btns = embedButtonsForReply({ reply: { task: { id: 't1', state: 'open', label: 'boodschappen' } }, appOrigin: 'tasks', manifestsByOrigin });
    const claim = btns.find((b) => b.opId === 'claimTask');
    expect(claim.labelKey).toBe('circle.button.tasks.claimTask');
    expect(claim.itemLabel).toBe('boodschappen');
    expect(claim.label).toMatch(/Claim · boodschappen/);          // the literal composition stays for consumers that have no translator
  });

  it('embedButtonText translates the key and keeps the item name; falls back to the literal; never paints a bare key', () => {
    const t = (k) => (k === 'circle.button.tasks.claimTask' ? 'Oppakken' : k);
    expect(embedButtonText({ labelKey: 'circle.button.tasks.claimTask', itemLabel: 'boodschappen', label: 'Claim · boodschappen' }, t)).toBe('Oppakken · boodschappen');
    expect(embedButtonText({ label: 'All tasks →' }, t)).toBe('All tasks →');
    expect(embedButtonText({ labelKey: 'circle.button.unknown', itemLabel: 'x', label: 'Fallback · x' }, t), 'an unresolved key falls back to the literal').toBe('Fallback · x');
    expect(embedButtonText({ opId: 'x.y' }, t)).toBe('x.y');
  });
});
