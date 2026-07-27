/**
 * The entry-kind table — the one place that says how a logged entry behaves.
 *
 * Before this, `silent` was stamped by hand at each append site, the wake rule was re-derived per call site
 * (twice, across a package boundary), and retention was one number for everything. Behaviour decided in
 * four places drifts, and this drift is invisible: a silent entry that wakes a phone, or a roster ping
 * appearing in a conversation, both read as ordinary bugs rather than a missing rule.
 */
import { describe, it, expect } from 'vitest';
import {
  ENTRY_KINDS, LANE, RETAIN, UNKNOWN_KIND,
  entryKind, isSystemKind, isAuditKind, retentionOf, conversationKinds, kindWakes, governanceWakes,
} from '../src/entryKinds.js';

describe('the table answers all four questions per kind', () => {
  it('every declared kind has a complete descriptor', () => {
    for (const [kind, d] of Object.entries(ENTRY_KINDS)) {
      expect(Object.values(LANE), `${kind}.lane`).toContain(d.lane);
      expect(Object.values(RETAIN), `${kind}.retain`).toContain(d.retain);
      expect(typeof d.wakes, `${kind}.wakes`).toBe('boolean');
      expect(typeof d.audit, `${kind}.audit`).toBe('boolean');
    }
  });

  it('a conversation kind is human-facing and may wake; a system kind is neither', () => {
    expect(entryKind('chat-message')).toMatchObject({ lane: LANE.HUMAN, wakes: true });
    expect(entryKind('roster-updated')).toMatchObject({ lane: LANE.SYSTEM, wakes: false });
  });

  it('conversationKinds is DERIVED, so adding a human kind cannot forget the chat surface', () => {
    const derived = conversationKinds();
    expect(derived).toContain('chat-message');
    expect(derived).not.toContain('governance');
    expect(derived).toEqual(Object.keys(ENTRY_KINDS).filter((k) => ENTRY_KINDS[k].lane === LANE.HUMAN));
  });
});

describe('an unknown kind fails SAFE', () => {
  it('never wakes and never reads as conversation', () => {
    expect(entryKind('something-new-in-2027')).toEqual(UNKNOWN_KIND);
    expect(kindWakes('something-new-in-2027')).toBe(false);
    expect(isSystemKind('something-new-in-2027')).toBe(true);
  });

  it('junk input does not throw', () => {
    for (const bad of [null, undefined, 42, {}, '']) {
      expect(() => entryKind(bad)).not.toThrow();
      expect(kindWakes(bad)).toBe(false);
    }
  });
});

describe('the governance exception is explicit, not a second table', () => {
  it('a decision OPENING wakes; the votes that follow do not', () => {
    expect(kindWakes('governance', { event: 'propose' })).toBe(true);
    expect(kindWakes('governance', { event: 'vote' })).toBe(false);
    expect(kindWakes('governance', { event: 'resolve' })).toBe(false);
  });

  it('the table alone says governance does not wake — the payload is what lifts it', () => {
    // Non-vacuous: if the exception were dropped, the first assertion above would fail rather than the
    // whole kind silently becoming wake-worthy.
    expect(ENTRY_KINDS.governance.wakes).toBe(false);
    expect(kindWakes('governance', null)).toBe(false);
  });

  it('governanceWakes is the same rule, callable on its own', () => {
    for (const e of [{ event: 'propose' }, { event: 'vote' }, null, undefined, {}]) {
      expect(governanceWakes(e)).toBe(kindWakes('governance', e));
    }
  });

  it('a REPORT never wakes, whatever it carries — it is about a person', () => {
    expect(kindWakes('report', { event: 'report' })).toBe(false);
    expect(kindWakes('report', { event: 'propose' })).toBe(false);
  });
});

describe('auditability and retention', () => {
  it('governance, reports, key events and the agent trail are AUDITABLE', () => {
    for (const k of ['governance', 'report', 'key-event', 'membership', 'agent-action', 'settings-change']) {
      expect(isAuditKind(k), k).toBe(true);
      expect(retentionOf(k), k).toBe(RETAIN.AUDIT);   // audit kinds compact rather than drop
    }
  });

  it('conversation is NOT auditable — chat relies on replace-on-redelivery', () => {
    // If chat became audit-immutable, an idempotent re-delivery would stop collapsing and duplicate.
    expect(isAuditKind('chat-message')).toBe(false);
    expect(retentionOf('chat-message')).toBe(RETAIN.CHAT);
  });

  it('pure plumbing is short-lived and not auditable', () => {
    for (const k of ['roster-updated', 'delivery-state']) {
      expect(retentionOf(k), k).toBe(RETAIN.SHORT);
      expect(isAuditKind(k), k).toBe(false);
    }
  });

  it('an unknown kind is not auditable — immutability is opt-in, never assumed', () => {
    expect(isAuditKind('mystery')).toBe(false);
  });
});
