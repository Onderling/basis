import { describe, it, expect } from 'vitest';
import { adoptions, constructions, agentCountProblems } from './lint-agent-count.mjs';

const TODAY = [
  'const adoptInProcess = (peer) => {};',
  'const hostAgent = new Agent({ identity: hostId, transport: new InternalTransport(bus, hostId.pubKey) });',
  'adoptInProcess(hostAgent);',
].join('\n');

describe('lint-agent-count', () => {
  it('reads the adoptions, not the helper\'s own definition', () => {
    expect(adoptions(TODAY)).toEqual(['hostAgent']);
  });
  it('counts the constructions per kind', () => {
    expect(constructions(TODAY)).toEqual({ 'new Agent({': 1, 'createBrowser…Agent(': 0, 'new InternalTransport(bus': 1 });
  });
  it('is quiet when the file matches its baseline', () => {
    expect(agentCountProblems(TODAY, ['hostAgent'], { 'new Agent({': 1, 'new InternalTransport(bus': 1 })).toEqual([]);
  });
  it('is red for a new in-process agent, adopted or only built', () => {
    const more = `${TODAY}\nconst x = await createBrowserNewAgent({ bus });\nadoptInProcess(x.agent);`;
    const problems = agentCountProblems(more, ['hostAgent'], { 'new Agent({': 1, 'new InternalTransport(bus': 1 });
    expect(problems.join('\n')).toMatch(/NEW in-process agent is adopted: x\.agent/);
    expect(problems.join('\n')).toMatch(/createBrowser…Agent\( \(baseline 0\)/);
  });
  it('is red until the baseline shrinks with the code', () => {
    const fewer = 'const adoptInProcess = (peer) => {};';
    const problems = agentCountProblems(fewer, ['hostAgent'], { 'new Agent({': 1, 'new InternalTransport(bus': 1 });
    expect(problems.join('\n')).toMatch(/no longer adopted — remove it/);
    expect(problems.join('\n')).toMatch(/lower CONSTRUCTION_BASELINE/);
  });
});
