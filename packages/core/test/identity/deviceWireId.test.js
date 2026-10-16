// The id a device shows on the wire is per persona, keyed by the persona's own SEED: the internal id never appears,
// two personas' records of one device are unrelated, and an old record plus a persona id give nothing without that
// persona's seed. The device seed derives from the wire id, so revocation works from the record plus the phrase alone.
import { describe, it, expect } from 'vitest';
import { Bootstrap } from '../../src/identity/Bootstrap.js';
import { wireDeviceId, deriveDeviceSeed } from '../../src/identity/deviceDelegation.js';
import { mintProfileId } from '../../src/identity/profileIds.js';

describe('wireDeviceId', () => {
  const root = Bootstrap.create().bootstrap;
  const persona = mintProfileId();
  const seedOf = (id) => root.deriveAgentSeed(id);
  const internal = 'c7e1f0a2-5b9d-4e3a-8f61-2d4c9b7a1e05';

  it('is stable for one device and persona, per persona, and shaped d-<32 hex>', () => {
    expect(wireDeviceId(seedOf('default'), internal)).toMatch(/^d-[0-9a-f]{32}$/);
    expect(wireDeviceId(seedOf(persona), internal)).toBe(wireDeviceId(seedOf(persona), internal));
    expect(wireDeviceId(seedOf('default'), internal)).not.toBe(wireDeviceId(seedOf(persona), internal));
    expect(wireDeviceId(seedOf('default'), internal)).not.toContain(internal);
  });

  it('needs the persona\'s seed: another root\'s seed for the same persona id and device gives another id', () => {
    const other = Bootstrap.create().bootstrap;
    expect(wireDeviceId(other.deriveAgentSeed(persona), internal)).not.toBe(wireDeviceId(seedOf(persona), internal));
  });

  it('the device seed derives from the wire id: the phrase + the record\'s id reproduce it anywhere', () => {
    const wire = wireDeviceId(seedOf('default'), internal);
    expect(deriveDeviceSeed(seedOf('default'), wire)).toEqual(deriveDeviceSeed(seedOf('default'), wire));
    expect(deriveDeviceSeed(seedOf('default'), wire)).not.toEqual(deriveDeviceSeed(seedOf('default'), internal));
  });

  it('refuses a seed that is not 32 bytes and an empty id', () => {
    expect(() => wireDeviceId(new Uint8Array(16), internal)).toThrow(/seed/);
    expect(() => wireDeviceId(seedOf('default'), '')).toThrow(/id/);
  });
});
