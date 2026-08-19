import { describe, it, expect } from 'vitest';
import {
  buildCircleTabs, DEFAULT_CIRCLE_TAB,
  featureActionLabelKey, featureTabId, featureForTabId,
} from '../../src/v2/circleTabs.js';
import { DEFAULT_CIRCLE_POLICY } from '../../src/v2/circlePolicy.js';

const t = (k) => k;

describe('buildCircleTabs · SP-13.3', () => {
  it('exposes the canonical default-tab id', () => {
    expect(DEFAULT_CIRCLE_TAB).toBe('gesprek');
  });

  it('default policy → GESPREK + PRIKBORD + LEDEN (chat + noticeboard + memberDirectory are default on)', () => {
    // S1 #1 (2026-06-15): noticeboard flipped on by default now that its prikbord surface exists.
    const tabs = buildCircleTabs(DEFAULT_CIRCLE_POLICY).map((t) => t.id);
    expect(tabs).toEqual(['gesprek', 'prikbord', 'leden']);
  });

  it('buurt-shape policy → GESPREK / PRIKBORD / LEDEN (board Voorbeeld 1)', () => {
    const policy = {
      features: { chat: true, noticeboard: true, memberDirectory: true },
    };
    expect(buildCircleTabs(policy).map((t) => t.id))
      .toEqual(['gesprek', 'prikbord', 'leden']);
  });

  it('huishouden-shape policy → GESPREK / TAKEN / LIJSTEN (board Voorbeeld 2)', () => {
    const policy = {
      // noticeboard explicitly off — a huishouden circle uses tasks/lists, not the buurt prikbord.
      features: { chat: true, noticeboard: false, tasks: true, lists: true, memberDirectory: false },
    };
    expect(buildCircleTabs(policy).map((t) => t.id))
      .toEqual(['gesprek', 'taken', 'lijsten']);
  });

  it('privé-shape policy → GESPREK / NOTITIES / TAKEN (board Voorbeeld 3)', () => {
    const policy = {
      features: { chat: true, noticeboard: false, notes: true, tasks: true, memberDirectory: false },
    };
    expect(buildCircleTabs(policy).map((t) => t.id))
      .toEqual(['gesprek', 'taken', 'notities']);
  });

  it('GESPREK is always first even when the chat feature is explicitly off', () => {
    // v2 §1 — chat is the circle core; turning it "off" hides PUSH /
    // settings UI for chat-notifications but the tab itself stays
    // because every circle needs at least one reachable surface.
    const policy = { features: { chat: false, noticeboard: true } };
    const ids = buildCircleTabs(policy).map((t) => t.id);
    expect(ids[0]).toBe('gesprek');
    expect(ids).toContain('prikbord');
  });

  it('LEDEN renders last when memberDirectory is on (per board ordering)', () => {
    const policy = {
      features: {
        chat: true, noticeboard: true, tasks: true,
        memberDirectory: true, lists: true,
      },
    };
    const ids = buildCircleTabs(policy).map((t) => t.id);
    expect(ids[ids.length - 1]).toBe('leden');
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
      .toEqual(['gesprek', 'prikbord', 'taken', 'lijsten', 'notities', 'agenda', 'leden']);
  });

  it('houseRules does not produce a tab', () => {
    // Explicitly turn memberDirectory off so the only on-by-default
    // feature besides chat doesn't show up in the assertion.
    const policy = { features: { chat: true, noticeboard: false, houseRules: true, memberDirectory: false } };
    expect(buildCircleTabs(policy).map((t) => t.id)).toEqual(['gesprek']);
  });

  it('includes resolved `label` strings only when a translator is passed', () => {
    const policy = { features: { chat: true } };
    expect(buildCircleTabs(policy)[0]).toEqual({
      id: 'gesprek', feature: 'chat', labelKey: 'circle.tabs.gesprek',
    });
    expect(buildCircleTabs(policy, t)[0]).toEqual({
      id: 'gesprek', feature: 'chat',
      labelKey: 'circle.tabs.gesprek',
      label:    'circle.tabs.gesprek',
    });
  });

  it('handles null / empty / garbage policy gracefully (treats as defaults)', () => {
    expect(buildCircleTabs(null).map((t) => t.id)).toEqual(['gesprek', 'prikbord', 'leden']);
    expect(buildCircleTabs(undefined).map((t) => t.id)).toEqual(['gesprek', 'prikbord', 'leden']);
    expect(buildCircleTabs('nope').map((t) => t.id)).toEqual(['gesprek', 'prikbord', 'leden']);
  });
});

describe('circleTabs · D1 (§5A) feature helpers', () => {
  it('featureActionLabelKey maps all 8 features + falls back to the raw key', () => {
    expect(featureActionLabelKey('chat')).toBe('circle.tabs.gesprek');
    expect(featureActionLabelKey('tasks')).toBe('circle.tabs.taken');
    expect(featureActionLabelKey('memberDirectory')).toBe('circle.tabs.leden');
    expect(featureActionLabelKey('houseRules')).toBe('circle.settings.feat.houseRules');
    expect(featureActionLabelKey('bogus')).toBe('bogus');
  });

  it('featureTabId maps tab features to ids; houseRules has no tab', () => {
    expect(featureTabId('chat')).toBe('gesprek');
    expect(featureTabId('tasks')).toBe('taken');
    expect(featureTabId('memberDirectory')).toBe('leden');
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
