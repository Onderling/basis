import { describe, it, expect } from 'vitest';
import {
  CIRCLE_LLM_ROUTE_PRESETS, resolveRoutePreset, buildProvidersFromRoutes,
} from '../../src/v2/circleLlmRoutes.js';
import { buildCircleLlmProviders } from '../../src/v2/circleLlmProviders.js';

describe('circleLlmProviders — cloud route', () => {
  it('builds local and/or cloud clients from endpoints', () => {
    const p = buildCircleLlmProviders({ localBaseUrl: 'http://127.0.0.1:11434', cloudBaseUrl: 'https://proxy.example/v1' });
    expect(typeof p.local.invoke).toBe('function');
    expect(typeof p.cloud.invoke).toBe('function');
    expect(buildCircleLlmProviders({})).toEqual({});               // nothing configured → inert
  });
});

describe('circleLlmRoutes — presets', () => {
  it('resolveRoutePreset returns a concrete config; unknown → off', () => {
    expect(resolveRoutePreset('local-ollama').mode).toBe('local');
    expect(resolveRoutePreset('local-ollama').baseUrl).toBe('http://127.0.0.1:11434');
    expect(resolveRoutePreset('nope').preset).toBe('off');
    expect(resolveRoutePreset('off').mode).toBe('off');
  });

  it('overrides fill a needsEndpoint preset (proxy / cloud)', () => {
    const proxy = resolveRoutePreset('confidential-proxy', { baseUrl: 'https://enclave.example/v1', model: 'm' });
    expect(proxy.mode).toBe('cloud');
    expect(proxy.baseUrl).toBe('https://enclave.example/v1');
    expect(proxy.model).toBe('m');
  });

  it('buildProvidersFromRoutes maps configs → the {local, cloud} providers map', () => {
    const providers = buildProvidersFromRoutes([
      resolveRoutePreset('local-ollama'),
      resolveRoutePreset('confidential-proxy', { baseUrl: 'https://enclave.example/v1' }),
    ]);
    expect(typeof providers.local.invoke).toBe('function');
    expect(typeof providers.cloud.invoke).toBe('function');
  });

  it('an unconfigured (no-endpoint / off) route contributes nothing', () => {
    expect(buildProvidersFromRoutes([resolveRoutePreset('confidential-proxy')])).toEqual({});  // proxy w/o endpoint
    expect(buildProvidersFromRoutes([resolveRoutePreset('off')])).toEqual({});
    expect(buildProvidersFromRoutes(resolveRoutePreset('local-ollama')).local).toBeTruthy();    // accepts a single config
  });

  it('every preset has a label + a valid mode', () => {
    for (const [, p] of Object.entries(CIRCLE_LLM_ROUTE_PRESETS)) {
      expect(typeof p.label).toBe('string');
      expect(['off', 'local', 'cloud']).toContain(p.mode);
    }
  });
});
