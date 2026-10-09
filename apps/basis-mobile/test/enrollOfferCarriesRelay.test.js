/**
 * A phone's add-device offer names this device's relay — web parity (circleApp passes its live relay to
 * buildEnrollOffer). Mobile passed `{}`, so the offer carried no relay and the new device had no way to find this one
 * except NKN. With no relay known, the relay question asks before the offer is built.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the add-device offer on a phone', () => {
  const src = read('../src/screens/v2/EnrollDeviceModal.js');
  it('names the relay this device knows', () => {
    expect(src).toMatch(/const relayUrl = await currentRelayUrl\(\);/);
    expect(src).toMatch(/buildEnrollOffer', relayUrl \? \{ relayUrl \} : \{\}/);
    expect(src).not.toMatch(/buildEnrollOffer', \{\}\)/);
  });
  it('asks for a relay first when it knows none', () => {
    expect(src).toMatch(/await beforeOffer\?\.\(\)/);
    expect(read('../src/screens/v2/CircleMyDataScreen.js')).toMatch(/beforeOffer=\{askRelayIfNone\}/);
  });
});
