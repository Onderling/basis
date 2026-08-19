/**
 * Multi-field inline form (mobile parity with web) — the v2 circle now renders an
 * inline form for a 2+-missing needsForm (the existing MultiFieldFormBubble,
 * previously only wired in the classic shell). The RN render is exercised on
 * device; here (portable vitest) we guard the shared substrate the wiring uses:
 * beginFormFollowUp builds a multi-field pending, completeMultiFieldFollowUp
 * round-trips it to a ready dispatch.
 */
import { describe, it, expect } from 'vitest';
import { beginFollowUp, beginFormFollowUp, completeMultiFieldFollowUp } from '../src/core/followUp.js';

const t = (k) => k;   // identity — labels resolve to keys

const needsForm = (missing) => ({
  kind: 'needsForm', opId: 'addEvent', appOrigin: 'calendar',
  missing,
  params: missing.map((name) => ({ name, kind: 'string' })),
  prefilledArgs: { circleId: 'c1' },
});

describe('multi-field needsForm → inline form substrate', () => {
  it('2+ missing fields → a multi-field pending (form), not the single-field path', () => {
    const dispatch = needsForm(['title', 'date']);
    expect(beginFollowUp({ dispatch, t })).toBeNull();          // single-field path declines
    const form = beginFormFollowUp({ dispatch, t });
    expect(form).toMatchObject({ kind: 'multi', opId: 'addEvent', appOrigin: 'calendar' });
    expect(form.fields.map((f) => f.name)).toEqual(['title', 'date']);
  });

  it('1 missing field → no form (the single-field conversational path handles it)', () => {
    expect(beginFormFollowUp({ dispatch: needsForm(['title']), t })).toBeNull();
  });

  it('completing the form merges the filled values onto the prefilled args → a ready dispatch', () => {
    const pending = beginFormFollowUp({ dispatch: needsForm(['title', 'date']), t });
    const ready = completeMultiFieldFollowUp({ pending, values: { title: 'Circle-bbq', date: '2026-07-01' } });
    expect(ready).toMatchObject({
      kind: 'ready', opId: 'addEvent',
      args: { circleId: 'c1', title: 'Circle-bbq', date: '2026-07-01' },
    });
  });
});
