/**
 * The items lane's judge: an arrived statement is applied, refused or parked by the circle's switches at its own place
 * on the content line. The settings changes it is judged by are the ones the settings lane KEPT, recorded per DEVICE
 * (its log), so three agents in one process never share them.
 */
import { describe, it, expect } from 'vitest';
import { EventLog } from '../../src/eventLog.js';
import { judgeItemStatement } from '../../src/v2/contentJudge.js';
import { noteKeptPolicyChanges, keptPolicyChangesOf, onKeptPolicyChanges } from '../../src/v2/keptPolicyChanges.js';
import { POLICY_UPDATE_KIND } from '../../src/v2/policyUpdateLane.js';

import { allManifests } from '../../src/v2/manifestSources.js';

const manifests = allManifests();
const change = (version, policy, items, hash) => ({ kind: POLICY_UPDATE_KIND, author: 'admin', hash, payload: { policy, version, contentUpTo: { items, chat: [] } } });
const on = {};
const addOff = { capabilities: { 'tasks add task': { enabled: false } } };
const appOff = { features: { tasks: false } };
// a lane: s1 ← s2 (s2 made after s1), s3 a later statement on top of s2
const lane = { s1: { parent: null, deps: [] }, s2: { parent: 's1', deps: [] }, s3: { parent: 's2', deps: [] } };
const linksOf = (h) => lane[h] ?? null;
const body = (hash) => ({ hash, kind: 'snapshot', payload: { item: { id: 'r1', type: 'task' } } });

describe('the kept settings changes, per device', () => {
  it('two devices in one process never share them; a note is heard by that device only', () => {
    const a = new EventLog({ initial: [], muted: [] });
    const b = new EventLog({ initial: [], muted: [] });
    const heard = [];
    onKeptPolicyChanges(a, (cid) => heard.push(cid));
    noteKeptPolicyChanges(a, 'c1', [change(1, on, [], 'p1')]);
    expect(keptPolicyChangesOf(a, 'c1')).toHaveLength(1);
    expect(keptPolicyChangesOf(b, 'c1')).toBeUndefined();   // not known on b
    noteKeptPolicyChanges(b, 'c1', []);
    expect(heard).toEqual(['c1']);
  });
});

describe('judging an items statement', () => {
  it('settings not known yet: parked', () => {
    expect(judgeItemStatement({ body: body('s3'), act: 'add', linksOf, kept: undefined, manifests }).verdict).toBe('park');
  });

  it('no settings change at all: applied (nothing to judge by)', () => {
    expect(judgeItemStatement({ body: body('s3'), act: 'add', linksOf, kept: [], manifests }).verdict).toBe('apply');
  });

  it('an add made before the switch-off (behind its line) stays; one made after is refused', () => {
    const kept = [change(1, on, [], 'p1'), change(2, addOff, ['s2'], 'p2')];
    expect(judgeItemStatement({ body: body('s1'), act: 'add', linksOf, kept, manifests }).verdict).toBe('apply');
    const late = judgeItemStatement({ body: body('s3'), act: 'add', linksOf, kept, manifests });
    expect(late.verdict).toBe('refuse');
  });

  it('a change of a held row is taken while a change atom is on, even with add off', () => {
    const kept = [change(1, on, [], 'p1'), change(2, addOff, ['s2'], 'p2')];
    expect(judgeItemStatement({ body: body('s3'), act: 'change', linksOf, kept, manifests }).verdict).toBe('apply');
  });

  it('unknown place where the readings disagree: parked; where they agree: decided', () => {
    const gap = (h) => (h === 's3' ? { parent: 'missing', deps: [] } : null);
    const kept = [change(1, on, [], 'p1'), change(2, addOff, ['s2'], 'p2')];
    expect(judgeItemStatement({ body: body('s3'), act: 'add', linksOf: gap, kept, manifests }).verdict).toBe('park');
    expect(judgeItemStatement({ body: body('s3'), act: 'change', linksOf: gap, kept, manifests }).verdict).toBe('apply');
  });

  it('a served head (a catch-up answer this device asked for) is judged only by its app being on', () => {
    const kept = [change(1, on, [], 'p1'), change(2, addOff, ['s2'], 'p2')];
    expect(judgeItemStatement({ body: body('s3'), act: 'add', linksOf, kept, manifests, served: true }).verdict).toBe('apply');
    const offKept = [change(1, on, [], 'p1'), change(2, appOff, ['s2'], 'p2')];
    expect(judgeItemStatement({ body: body('s3'), act: 'add', linksOf, kept: offKept, manifests, served: true }).verdict).toBe('refuse');
  });
});
