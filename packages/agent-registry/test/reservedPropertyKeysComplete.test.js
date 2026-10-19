/**
 * FITNESS: every property-key constant this package defines (`export const …_KEY`) is either the registry's own —
 * refused by the person-facing property ops — or named as person-settable. A new machine key that is in neither list
 * fails here, before a person's op can overwrite it.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isReservedPropertyKey, PERSON_SETTABLE_KEYS } from '../src/reservedProperties.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

describe('every registry property key is classed', () => {
  it('reserved or person-settable — none unclassed', () => {
    const keys = [];
    for (const f of readdirSync(SRC).filter((n) => n.endsWith('.js'))) {
      for (const m of readFileSync(path.join(SRC, f), 'utf8').matchAll(/export const ([A-Z_]+_KEY)\s*=\s*'([^']+)'/g)) keys.push({ name: m[1], value: m[2], file: f });
    }
    expect(keys.length, 'the scan finds the constants').toBeGreaterThan(3);
    const unclassed = keys.filter((k) => !isReservedPropertyKey(k.value) && !PERSON_SETTABLE_KEYS.includes(k.value));
    expect(unclassed, 'add each to RESERVED_PROPERTY_KEYS or PERSON_SETTABLE_KEYS (reservedProperties.js)').toEqual([]);
  });
});
