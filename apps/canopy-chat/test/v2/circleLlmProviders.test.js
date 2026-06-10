import { describe, it, expect } from 'vitest';
import { buildCircleLlmProviders, normalizeBase } from '../../src/v2/circleLlmProviders.js';

describe('buildCircleLlmProviders', () => {
  it('returns an empty map when nothing is configured (bot stays inert)', () => {
    expect(buildCircleLlmProviders()).toEqual({});
    expect(buildCircleLlmProviders({ localBaseUrl: null })).toEqual({});
  });

  it('builds a local LlmClient (with invoke) when a base URL is given', () => {
    const providers = buildCircleLlmProviders({ localBaseUrl: 'http://127.0.0.1:11434/v1' });
    expect(providers.local).toBeTruthy();
    expect(typeof providers.local.invoke).toBe('function');
    expect(providers.cloud).toBeUndefined();
  });
});

describe('normalizeBase', () => {
  it('strips a trailing /v1 and slashes so both base conventions work', () => {
    expect(normalizeBase('http://127.0.0.1:11434')).toBe('http://127.0.0.1:11434');
    expect(normalizeBase('http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434');
    expect(normalizeBase('http://127.0.0.1:11434/v1/')).toBe('http://127.0.0.1:11434');
    expect(normalizeBase('https://proxy.example/v1')).toBe('https://proxy.example');
  });
});
