/**
 * "only you" vs "whole circle" message scope — the data property the badge renders.
 */
import { describe, it, expect } from 'vitest';
import { scopeForVerb, scopeForReply, normalizeMessageScope } from '../src/v2/messageScope.js';

describe('scopeForVerb', () => {
  it('read verbs are private (self)', () => {
    for (const v of ['list', 'help', 'get', 'search', 'brief', 'whoami']) expect(scopeForVerb(v)).toBe('self');
  });
  it('mutating verbs reach the circle', () => {
    for (const v of ['add', 'post', 'claim', 'complete', 'submit', 'approve', 'assign', 'cancel']) {
      expect(scopeForVerb(v)).toBe('circle');
    }
  });
  it('unknown / missing verb defaults to self', () => {
    expect(scopeForVerb(undefined)).toBe('self');
    expect(scopeForVerb('')).toBe('self');
  });
});

describe('scopeForReply', () => {
  it('a mutating op reply reaches the circle', () => {
    expect(scopeForReply({ verb: 'add' })).toBe('circle');
  });
  it('a read op reply is private', () => {
    expect(scopeForReply({ verb: 'list' })).toBe('self');
  });
  it('an error / clarification is always private (between you and the bot)', () => {
    expect(scopeForReply({ verb: 'add', error: true })).toBe('self');
  });
});

describe('normalizeMessageScope', () => {
  it('keeps valid scopes, defaults the rest to self', () => {
    expect(normalizeMessageScope('circle')).toBe('circle');
    expect(normalizeMessageScope('self')).toBe('self');
    expect(normalizeMessageScope('bogus')).toBe('self');
    expect(normalizeMessageScope(undefined)).toBe('self');
  });
});
