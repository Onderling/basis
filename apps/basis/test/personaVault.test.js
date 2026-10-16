/**
 * A persona's slots in the device's chat vault: its chat seed, its person key, its delegation blob. The default persona
 * keeps the names every shell already reads (mobile's first-run check, the forget sweep, the restore path); another
 * persona's slots are `<key>:<id>`. Everything else in the vault is the device's, and passes through untouched.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { personaVault, PERSONA_SLOT_KEYS } from '../src/core/agent/personaVault.js';

describe('personaVault', () => {
  it('names the three persona slots', () => {
    expect([...PERSONA_SLOT_KEYS].sort()).toEqual(['agent-privkey', 'device-delegation-seed', 'person-key']);
  });
  it('the default persona reads and writes the bare names', async () => {
    const v = new VaultMemory();
    const d = personaVault(v, 'default');
    await d.set('agent-privkey', 'seed-d');
    expect(await v.get('agent-privkey')).toBe('seed-d');
    expect(await d.get('agent-privkey')).toBe('seed-d');
  });
  it('another persona gets its own slots, and cannot see the default\'s', async () => {
    const v = new VaultMemory();
    const p = personaVault(v, 'p-0123456789ab');
    await personaVault(v, 'default').set('person-key', 'pk-d');
    expect(await p.get('person-key')).toBeNull();
    await p.set('person-key', 'pk-p');
    expect(await v.get('person-key:p-0123456789ab')).toBe('pk-p');
    expect(await v.get('person-key')).toBe('pk-d');
    expect(await p.has('person-key')).toBe(true);
    expect(await p.list()).toEqual(expect.arrayContaining(['person-key']));
    expect(await p.list()).not.toContain('person-key:p-0123456789ab');
  });
  it('the device\'s other entries pass through for every persona', async () => {
    const v = new VaultMemory();
    await personaVault(v, 'p-0123456789ab').set('peer-bindings', 'x');
    expect(await v.get('peer-bindings')).toBe('x');
    expect(await personaVault(v, 'default').get('peer-bindings')).toBe('x');
  });
});
