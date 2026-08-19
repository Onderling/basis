/**
 * adaptForCanonical + validateCanonical (Phase 52.7).
 */

import { describe, it, expect } from 'vitest';
import {
  adaptForCanonical,
  validateCanonical,
  validate,
} from '../index.js';

describe('adaptForCanonical', () => {
  it('maps addedAt (number) → createdAt (ISO string)', () => {
    const out = adaptForCanonical({ addedAt: 1715419200000 });
    expect(out.createdAt).toBe(new Date(1715419200000).toISOString());
    expect(out.addedAt).toBe(1715419200000);   // input untouched
  });

  it('maps addedBy → createdBy', () => {
    const out = adaptForCanonical({ addedBy: 'agent://anne' });
    expect(out.createdBy).toBe('agent://anne');
  });

  it('maps completedAt → updatedAt; completedBy → updatedBy', () => {
    const out = adaptForCanonical({
      addedAt:     1715419200000,
      addedBy:     'agent://anne',
      completedAt: 1715419260000,
      completedBy: 'agent://bob',
    });
    expect(out.updatedAt).toBe(new Date(1715419260000).toISOString());
    expect(out.updatedBy).toBe('agent://bob');
  });

  it('does NOT overwrite if createdAt/createdBy already present', () => {
    const out = adaptForCanonical({
      addedAt:   1715419200000,
      addedBy:   'agent://anne',
      createdAt: '2026-05-11T10:00:00.000Z',
      createdBy: 'agent://different',
    });
    expect(out.createdAt).toBe('2026-05-11T10:00:00.000Z');
    expect(out.createdBy).toBe('agent://different');
  });

  it('returns the input verbatim for non-objects', () => {
    expect(adaptForCanonical(null)).toBe(null);
    expect(adaptForCanonical(undefined)).toBe(undefined);
    expect(adaptForCanonical('not an item')).toBe('not an item');
  });

  it('never mutates the caller object', () => {
    const input = Object.freeze({ addedAt: 1, addedBy: 'x', type: 'task' });
    const out = adaptForCanonical(input);
    expect(out).not.toBe(input);
    expect(input.createdAt).toBeUndefined();
  });

  it('maps text → body (for Stoop / Folio / message-shaped types)', () => {
    const out = adaptForCanonical({ type: 'announcement', text: 'hello circle' });
    expect(out.body).toBe('hello circle');
    expect(out.text).toBe('hello circle');     // input field preserved
  });

  it('does NOT clobber body when both are set', () => {
    const out = adaptForCanonical({ type: 'note', text: 'short', body: 'authoritative' });
    expect(out.body).toBe('authoritative');
  });

  it('skips text→body when text is not a string', () => {
    const out = adaptForCanonical({ type: 'note', text: 42 });
    expect(out.body).toBeUndefined();
  });
});

describe('validateCanonical', () => {
  it('adapts then validates — an item-store-shaped task validates', () => {
    const result = validateCanonical({
      type:        'task',
      id:          'dec:item/task/abc',
      addedAt:     1715419200000,
      addedBy:     'agent://anne/laptop',
      text:        'paint the fence',
    });
    expect(result.ok).toBe(true);
  });

  it('still rejects items missing required body fields', () => {
    const result = validateCanonical({
      type:    'task',
      id:      'dec:item/task/abc',
      addedAt: 1715419200000,
      addedBy: 'agent://anne',
      // missing `text`
    });
    expect(result.ok).toBe(false);
  });

  it('raw validate (no adapter) rejects item-store shape; validateCanonical accepts', () => {
    const item = {
      type:    'task',
      id:      'dec:item/task/abc',
      addedAt: 1715419200000,
      addedBy: 'agent://anne',
      text:    'x',
    };
    expect(validate(item).ok).toBe(false);          // raw rejects (missing createdAt)
    expect(validateCanonical(item).ok).toBe(true);  // adapter saves the day
  });
});
