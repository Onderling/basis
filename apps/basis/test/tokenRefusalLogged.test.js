/**
 * A refused token is told to the shell's log: the agent hands its `onTokenDenied` the op, the reason, whether the grants
 * lane had folded, and the time since boot — never the token, a key, or the args (L196: a screen's "Token has been
 * revoked" was seen only on the screen). The box writes it to the walk log.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('a refused token reaches the walk log', () => {
  it('the agent wires the engine\'s onDenied to opts.onTokenDenied with op · reason · grantsFolded · msSinceBoot only', () => {
    const src = read('../src/core/agent/realAgent.js');
    expect(src).toMatch(/onDenied: \(\{ code, reason, skillId \}\) => opts\.onTokenDenied\(\{/);
    const at = src.indexOf('opts.onTokenDenied({');
    const call = src.slice(at + 'opts.onTokenDenied({'.length, src.indexOf('}),', at));   // the fields only
    expect(call).toMatch(/op: skillId/);
    expect(call).toMatch(/grantsFolded:/);
    expect(call).toMatch(/msSinceBoot:/);
    expect(call).not.toMatch(/token|args|pubKey|peer/i);
  });
  it('the secure agent forwards onDenied to the engine; the box writes the line', () => {
    expect(read('../../../packages/secure-agent/src/createSecureAgent.js')).toMatch(/onDenied:\s+peOpts\.onDenied/);
    expect(read('../bin/device-runner.mjs')).toMatch(/onTokenDenied: \(e\) => walkLog\(\{ kind: 'token-refused', \.\.\.e \}\)/);
  });
});
