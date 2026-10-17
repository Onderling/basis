/**
 * Phase 5.8 — selectLlmClient.
 *
 * Pure picker over the v2 `llmTool` axis (`off`/`local`/`cloud`).  Tests
 * cover the truth table + fail-closed behaviour on malformed policy.
 */
import { describe, it, expect } from 'vitest';
import { selectLlmClient } from '../../src/v2/llmPicker.js';

const LOCAL = { id: 'local' };
const CLOUD = { id: 'cloud' };

describe('selectLlmClient', () => {
  it("'off' → null (never reaches a provider)", () => {
    expect(selectLlmClient({ llmTool: 'off' }, { local: LOCAL, cloud: CLOUD })).toBeNull();
  });

  it("'local' → providers.local", () => {
    expect(selectLlmClient({ llmTool: 'local' }, { local: LOCAL, cloud: CLOUD })).toBe(LOCAL);
  });

  it("'cloud' → providers.cloud", () => {
    expect(selectLlmClient({ llmTool: 'cloud' }, { local: LOCAL, cloud: CLOUD })).toBe(CLOUD);
  });

  it("an unconfigured provider → null, EXCEPT cloud downgrades to a more-private local (31a32900)", () => {
    expect(selectLlmClient({ llmTool: 'local' }, {})).toBeNull();                 // local absent → null
    expect(selectLlmClient({ llmTool: 'cloud' }, { local: LOCAL })).toBe(LOCAL);  // privacy-safe fallback (cloud→local)
    expect(selectLlmClient({ llmTool: 'cloud' }, {})).toBeNull();                 // nothing configured at all → null
  });

  it('a missing / malformed policy fails closed (null)', () => {
    expect(selectLlmClient(null,         { local: LOCAL })).toBeNull();
    expect(selectLlmClient(undefined,    { local: LOCAL })).toBeNull();
    expect(selectLlmClient({},           { local: LOCAL })).toBeNull();
    expect(selectLlmClient({ llmTool: 42 }, { local: LOCAL })).toBeNull();
    expect(selectLlmClient({ llmTool: 'bogus' }, { local: LOCAL })).toBeNull();
  });

  it('a missing / malformed providers map fails closed (null)', () => {
    expect(selectLlmClient({ llmTool: 'local' }, null)).toBeNull();
    expect(selectLlmClient({ llmTool: 'local' }, 'oops')).toBeNull();
  });
});

// 5.8 integration — the realAgent seam exposes whatever `llmProviders`
// the host injected; the picker reads them off the live agent surface.
describe('createRealHouseholdAgent — llmProviders seam', () => {
  // realAgent boot composes the real tasks-v0 multi-circle runtime + pinboard
  // + folio → ~5s on this box; bump the per-test timeout so the
  // integration round-trip stays robust under concurrent vitest workers.
  it('round-trips an injected providers map onto agent.llmProviders', async () => {
    const { createRealHouseholdAgent } = await import('../../src/core/agent/realAgent.js');
    const agent = await createRealHouseholdAgent({
      llmProviders: { local: LOCAL, cloud: CLOUD },
    });
    expect(agent.llmProviders).toEqual({ local: LOCAL, cloud: CLOUD });
    // The picker reads from the live agent → host doesn't have to
    // re-thread the providers map at the call site.
    expect(selectLlmClient({ llmTool: 'local' }, agent.llmProviders)).toBe(LOCAL);
    expect(selectLlmClient({ llmTool: 'off'   }, agent.llmProviders)).toBeNull();
  }, 30_000);

  it('defaults agent.llmProviders to {} when none is supplied', async () => {
    const { createRealHouseholdAgent } = await import('../../src/core/agent/realAgent.js');
    const agent = await createRealHouseholdAgent();
    expect(agent.llmProviders).toEqual({});
    expect(selectLlmClient({ llmTool: 'local' }, agent.llmProviders)).toBeNull();
  }, 30_000);
});
