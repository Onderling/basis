/**
 * circleConsent — B ·: the join-time consent model over the freedom template.
 *
 * The model lists the circle's OPT-OUTABLE caps (admin freedom 'optional' OR a privacy floor),
 * NEVER the mandatory ones; declining a cap yields a validated capabilityOptOuts array; a
 * non-opt-outable / unknown key can never be recorded as an opt-out.
 */
import { describe, it, expect } from 'vitest';
import {
  buildJoinConsentModel, optOutsFromDeclined, hasConsentChoices, EMPTY_CONSENT_MODEL,
} from '../../src/v2/circleConsent.js';
import { effectiveCapabilities, checkCapability } from '../../src/v2/capabilityGate.js';

const tasks = {
  app: 'tasks', itemTypes: ['task'],
  nouns: { task: { atoms: ['add', 'complete'] } },
  operations: [
    { id: 'addTask', verb: 'add', appliesTo: { type: 'task' } },
    { id: 'doneTask', verb: 'complete', appliesTo: { type: 'task' } },
  ],
};
const pinboard = {
  app: 'pinboard', itemTypes: ['post'],
  nouns: { post: { atoms: ['add'] } },
  operations: [{ id: 'postRequest', verb: 'add', appliesTo: { type: 'post' } }],
};
const sources = [{ manifest: tasks }, { manifest: pinboard }];

// Admin template: 'add task' REQUIRED (mandatory), 'complete task' OPTIONAL (opt-outable),
// 'add post' has a PRIVACY FLOOR (always opt-outable, even though asked required).
const policy = {
  apps: ['tasks', 'pinboard'],
  capabilities: {
    'tasks add task':      { freedom: 'required' },
    'tasks complete task': { freedom: 'optional' },
    'pinboard add post':      { freedom: 'required', privacyFloor: true },
  },
};

describe('buildJoinConsentModel', () => {
  it('lists only the OPT-OUTABLE caps (optional OR privacy floor), never the mandatory ones', () => {
    const model = buildJoinConsentModel(sources, policy);
    expect(model.keys.sort()).toEqual(['pinboard add post', 'tasks complete task']);
    // the required, un-floored cap is NOT offered
    expect(model.keys).not.toContain('tasks add task');
    const post = model.items.find((i) => i.key === 'pinboard add post');
    expect(post.privacyFloor).toBe(true);   // floor wins → opt-outable despite 'required'
  });

  it('empty for no sources or no enabled/opt-outable caps', () => {
    expect(buildJoinConsentModel([], policy)).toEqual({ items: [], keys: [] });
    // a template that makes everything required + un-floored ⇒ nothing to opt out of
    const allRequired = {
      apps: ['tasks'],
      capabilities: { 'tasks add task': { freedom: 'required' }, 'tasks complete task': { freedom: 'required' } },
    };
    expect(hasConsentChoices(buildJoinConsentModel(sources, allRequired))).toBe(false);
  });

  it('pre-marks already-declined caps as optedOut', () => {
    const model = buildJoinConsentModel(sources, policy, { optOuts: ['tasks complete task'] });
    expect(model.items.find((i) => i.key === 'tasks complete task').optedOut).toBe(true);
    expect(model.items.find((i) => i.key === 'pinboard add post').optedOut).toBe(false);
  });
});

describe('optOutsFromDeclined', () => {
  const model = buildJoinConsentModel(sources, policy);

  it('keeps only opt-outable keys; drops mandatory / unknown ones', () => {
    const out = optOutsFromDeclined(model, ['tasks complete task', 'tasks add task', 'bogus key']);
    expect(out).toEqual(['tasks complete task']);   // mandatory + unknown dropped
  });

  it('de-dupes and is order-stable', () => {
    const out = optOutsFromDeclined(model, ['pinboard add post', 'tasks complete task', 'pinboard add post']);
    expect(out).toEqual(['pinboard add post', 'tasks complete task']);
  });

  it('accepts a Set and an empty/garbage input', () => {
    expect(optOutsFromDeclined(model, new Set(['tasks complete task']))).toEqual(['tasks complete task']);
    expect(optOutsFromDeclined(model, [])).toEqual([]);
    expect(optOutsFromDeclined(EMPTY_CONSENT_MODEL, ['tasks complete task'])).toEqual([]);
  });
});

describe('feeds the gate — effective = admin-template ∩ user-opt-outs', () => {
  it('a declined opt-outable cap is dropped from the effective set; the mandatory cap survives', () => {
    const model = buildJoinConsentModel(sources, policy);
    const optOuts = optOutsFromDeclined(model, ['tasks complete task']);

    const eff = effectiveCapabilities(sources, {
      apps: policy.apps, capabilities: policy.capabilities, optOuts,
    });
    // declined optional cap → denied
    const denied = checkCapability(
      { op: { verb: 'complete', appliesTo: { type: 'task' } }, appOrigin: 'tasks' }, eff,
    );
    expect(denied.allow).toBe(false);
    expect(denied.code).toBe('capability-denied');

    // mandatory cap the joiner could NOT decline → still allowed
    const allowed = checkCapability(
      { op: { verb: 'add', appliesTo: { type: 'task' } }, appOrigin: 'tasks' }, eff,
    );
    expect(allowed.allow).toBe(true);
  });

  it('opt-out-nothing ⇒ the effective set is unchanged (every enabled cap allowed)', () => {
    const eff = effectiveCapabilities(sources, {
      apps: policy.apps, capabilities: policy.capabilities, optOuts: [],
    });
    for (const cap of [
      { verb: 'add', type: 'task' }, { verb: 'complete', type: 'task' }, { verb: 'add', type: 'post' },
    ]) {
      const app = cap.type === 'post' ? 'pinboard' : 'tasks';
      const r = checkCapability({ op: { verb: cap.verb, appliesTo: { type: cap.type } }, appOrigin: app }, eff);
      expect(r.allow).toBe(true);
    }
  });
});
