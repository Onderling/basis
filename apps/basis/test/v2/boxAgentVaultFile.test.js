/**
 * THE BOX'S AGENT VAULT FILES: one file per vault name the agent asks for (`agent-vaults/<file>`). The file name keeps
 * only [a-z0-9-] of the register name, so its separators go (`cc-host-id:` → `cc-host-id.json`). Two names that differ
 * only in a dropped character would share one file, and one vault would read or overwrite the other's keys.
 *
 * @guard no two vault names of the storage register land on one box file
 */
import { describe, it, expect } from 'vitest';
import { boxAgentVaultFile } from '../../src/v2/boxStorage.js';
import { storageNames } from '../../src/v2/storageRegister.js';

// the two the agent still empties at every start (realAgent.js: the household and folio agents' retired keys)
const RETIRED = ['cc-household-agent-id:', 'cc-folio-id:'];

describe('the box\'s agent vault files', () => {
  it('keeps [a-z0-9-] and drops the rest (the separator is lost: why the next test exists)', () => {
    expect(boxAgentVaultFile('cc-host-id:')).toBe('cc-host-id.json');
    expect(boxAgentVaultFile('cc.circle-groupkey')).toBe('cccircle-groupkey.json');
    expect(boxAgentVaultFile('a:b')).toBe(boxAgentVaultFile('ab'));   // the risk, pinned
  });

  it('no two vault names of the register (and the retired ones) share a file', () => {
    const names = [...storageNames((r) => r.kind === 'vault'), ...RETIRED];
    expect(names.length).toBeGreaterThan(10);
    const byFile = new Map();
    for (const n of names) byFile.set(boxAgentVaultFile(n), [...(byFile.get(boxAgentVaultFile(n)) ?? []), n]);
    const shared = [...byFile].filter(([, ns]) => ns.length > 1).map(([f, ns]) => `${f} ← ${ns.join(' + ')}`);
    expect(shared, 'register names that land on one box file').toEqual([]);
  });
});
