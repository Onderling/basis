import { describe, it, expect } from 'vitest';
import { resolveCircleLlm } from '../../src/v2/llmPicker.js';

const local = { id: 'local', invoke: () => {} };
const cloud = { id: 'cloud', invoke: () => {} };
const providers = { local, cloud };

describe('resolveCircleLlm — circle policy is authoritative', () => {
  it("circle 'off' → no LLM, even when the user wants one (privacy hard-stop)", () => {
    expect(resolveCircleLlm({ circlePolicy: { llmTool: 'off' }, userDefault: { mode: 'cloud' }, providers })).toBeNull();
  });

  it("circle 'local' → the local route for everyone (ignores the user default)", () => {
    expect(resolveCircleLlm({ circlePolicy: { llmTool: 'local' }, userDefault: { mode: 'cloud' }, providers })).toBe(local);
  });

  it("circle 'cloud' → the cloud route for everyone", () => {
    expect(resolveCircleLlm({ circlePolicy: { llmTool: 'cloud' }, userDefault: { mode: 'local' }, providers })).toBe(cloud);
  });
});

describe("resolveCircleLlm — circle 'user' delegates to the member's default", () => {
  it("'user' + userDefault local → local", () => {
    expect(resolveCircleLlm({ circlePolicy: { llmTool: 'user' }, userDefault: { mode: 'local' }, providers })).toBe(local);
  });

  it("'user' + userDefault cloud → cloud (e.g. the member's business proxy)", () => {
    expect(resolveCircleLlm({ circlePolicy: { llmTool: 'user' }, userDefault: { mode: 'cloud' }, providers })).toBe(cloud);
  });

  it("'user' + userDefault off → no LLM", () => {
    expect(resolveCircleLlm({ circlePolicy: { llmTool: 'user' }, userDefault: { mode: 'off' }, providers })).toBeNull();
  });

  it("'user' + NO userDefault → off (safe default, never silently picks a route)", () => {
    expect(resolveCircleLlm({ circlePolicy: { llmTool: 'user' }, providers })).toBeNull();
  });
});

describe('resolveCircleLlm — defensive', () => {
  it('missing/malformed circle policy → off', () => {
    expect(resolveCircleLlm({ providers })).toBeNull();
    expect(resolveCircleLlm({ circlePolicy: null, userDefault: { mode: 'local' }, providers })).toBeNull();
    expect(resolveCircleLlm({ circlePolicy: { llmTool: 42 }, providers })).toBeNull();
  });

  it('chosen mode but provider not configured → null', () => {
    expect(resolveCircleLlm({ circlePolicy: { llmTool: 'cloud' }, providers: { local } })).toBeNull();
    expect(resolveCircleLlm({ circlePolicy: { llmTool: 'user' }, userDefault: { mode: 'cloud' }, providers: { local } })).toBeNull();
  });

  it('no providers map → null', () => {
    expect(resolveCircleLlm({ circlePolicy: { llmTool: 'local' } })).toBeNull();
  });
});
