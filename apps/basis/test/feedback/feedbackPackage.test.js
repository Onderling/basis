/**
 * The lazy feedback door: memoised load, a sync accessor that refuses to hand out nothing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { loadFeedbackPackage, getFeedbackPackage, isFeedbackPackageLoaded, __resetFeedbackPackage } from '../../src/feedback/feedbackPackage.js';

describe('feedbackPackage — the lazy door', () => {
  beforeEach(() => __resetFeedbackPackage());

  it('the accessor refuses before anything loaded it — a factory can never build against nothing', () => {
    expect(isFeedbackPackageLoaded()).toBe(false);
    expect(() => getFeedbackPackage()).toThrow(/not loaded/);
  });

  it('loads once and memoises; the accessor then returns the same module', async () => {
    const a = await loadFeedbackPackage();
    const b = await loadFeedbackPackage();
    expect(a).toBe(b);
    expect(isFeedbackPackageLoaded()).toBe(true);
    expect(getFeedbackPackage()).toBe(a);
    expect(typeof a.InMemoryCentralPod).toBe('function');
  });
});
