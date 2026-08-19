import { describe, it, expect } from 'vitest';
import {
  buildCircleTabs, DEFAULT_CIRCLE_TAB,
  featureActionLabelKey, featureTabId, featureForTabId,
} from '../../src/v2/circleTabs.js';
import { DEFAULT_CIRCLE_POLICY } from '../../src/v2/circlePolicy.js';

const t = (k) => k;

describe('buildCircleTabs · SP-13.3', () => {
  it('exposes the canonical default-tab id', () => {
    expect(DEFAULT_CIRCLE_TAB).toBe('conversation');
  });

  it('default policy → CONVERSATION + NOTICEBOARD + MEMBERS (chat + noticeboard + memberDirectory are default on)', () => {
    // S1 #1 (2026-06-15): noticeboard flipped on by default now that its noticeboard surface exists.
    const tabs = buildCircleTabs(DEFAULT_CIRCLE_POLICY).map((t) => t.id);
    expect(tabs).toEqual(['conversation', 'noticeboard', 'members']);
  });

  it('circle-shape policy → CONVERSATION / NOTICEBOARD / MEMBERS (board Example 1)', () => {
    const policy = {
      features: { chat: true, noticeboard: true, memberDirectory: true },
    };
    expect(buildCircleTabs(policy).map((t) => t.id))
      .toEqual(['conversation', 'noticeboard', 'members']);
  });

  it('huishouden-shape policy → CONVERSATION / TAKEN / LIJSTEN (board Example 2)', () => {
    const policy = {
      // noticeboard explicitly off — a huishouden circle uses tasks/lists, not the circle noticeboard.
      features: { chat: true, noticeboard: false, tasks: true, lists: true, memberDirectory: false },
    };
    expect(buildCircleTabs(policy).map((t) => t.id))
      .toEqual(['conversation', 'taken', 'lijsten']);
  });

  it('privé-shape policy → CONVERSATION / NOTITIES / TAKEN (board Example 3)', () => {
    const policy = {
      features: { chat: true, noticeboard: false, notes: true, tasks: true, memberDirectory: false },
    };
    expect(buildCircleTabs(policy).map((t) => t.id))
      .toEqual(['conversation', 'taken', 'notities']);
  });

  it('CONVERSATION is always first even when the chat feature is explicitly off', () => {
    // v2 §1 — chat is the circle core; turning it "off" hides PUSH /
    // settings UI for chat-notifications but the tab itself stays
    // because every circle needs at least one reachable surface.
    const policy = { features: { chat: false, noticeboard: true } };
    const ids = buildCircleTabs(policy).map((t) => t.id);
    expect(ids[0]).toBe('conversation');
    expect(ids).toContain('noticeboard');
  });

  it('MEMBERS renders last when memberDirectory is on (per board ordering)', () => {
    const policy = {
      features: {
        chat: true, noticeboard: true, tasks: true,
        memberDirectory: true, lists: true,
      },
    };
    const ids = buildCircleTabs(policy).map((t) => t.id);
    expect(ids[ids.length - 1]).toBe('members');
  });

  it('all-features-on policy → full ordered tab list', () => {
    const policy = {
      features: {
        chat: true, noticeboard: true, tasks: true,
        lists: true, notes: true, calendar: true,
        memberDirectory: true, houseRules: true,
      },
    };
    // houseRules has NO tab — lives in `⋯` overflow as "Huisregels".
    expect(buildCircleTabs(policy).map((t) => t.id))
      .toEqual(['conversation', 'noticeboard', 'taken', 'lijsten', 'notities', 'agenda', 'members']);
  });

  it('houseRules does not produce a tab', () => {
    // Explicitly turn memberDirectory off so the only on-by-default
    // feature besides chat doesn't show up in the assertion.
    const policy = { features: { chat: true, noticeboard: false, houseRules: true, memberDirectory: false } };
    expect(buildCircleTabs(policy).map((t) => t.id)).toEqual(['conversation']);
  });

  it('includes resolved `label` strings only when a translator is passed', () => {
    const policy = { features: { chat: true } };
    expect(buildCircleTabs(policy)[0]).toEqual({
      id: 'conversation', feature: 'chat', labelKey: 'circle.tabs.conversation',
    });
    expect(buildCircleTabs(policy, t)[0]).toEqual({
      id: 'conversation', feature: 'chat',
      labelKey: 'circle.tabs.conversation',
      label:    'circle.tabs.conversation',
    });
  });

  it('handles null / empty / garbage policy gracefully (treats as defaults)', () => {
    expect(buildCircleTabs(null).map((t) => t.id)).toEqual(['conversation', 'noticeboard', 'members']);
    expect(buildCircleTabs(undefined).map((t) => t.id)).toEqual(['conversation', 'noticeboard', 'members']);
    expect(buildCircleTabs('nope').map((t) => t.id)).toEqual(['conversation', 'noticeboard', 'members']);
  });
});

describe('circleTabs · D1 (§5A) feature helpers', () => {
  it('featureActionLabelKey maps all 8 features + falls back to the raw key', () => {
    expect(featureActionLabelKey('chat')).toBe('circle.tabs.conversation');
    expect(featureActionLabelKey('tasks')).toBe('circle.tabs.taken');
    expect(featureActionLabelKey('memberDirectory')).toBe('circle.tabs.members');
    expect(featureActionLabelKey('houseRules')).toBe('circle.settings.feat.houseRules');
    expect(featureActionLabelKey('bogus')).toBe('bogus');
  });

  it('featureTabId maps tab features to ids; houseRules has no tab', () => {
    expect(featureTabId('chat')).toBe('conversation');
    expect(featureTabId('tasks')).toBe('taken');
    expect(featureTabId('memberDirectory')).toBe('members');
    expect(featureTabId('houseRules')).toBe(null);
    expect(featureTabId('bogus')).toBe(null);
  });

  it('featureForTabId is the inverse of featureTabId', () => {
    for (const f of ['chat', 'noticeboard', 'tasks', 'lists', 'notes', 'calendar', 'memberDirectory']) {
      expect(featureForTabId(featureTabId(f))).toBe(f);
    }
    expect(featureForTabId('bogus')).toBe(null);
  });
});
