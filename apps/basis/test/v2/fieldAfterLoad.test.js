import { describe, it, expect } from 'vitest';
import { fieldAfterLoad } from '../../src/v2/fieldAfterLoad.js';

describe('fieldAfterLoad — a load never wipes what the person typed', () => {
  it('an untouched field takes the loaded value', () => {
    expect(fieldAfterLoad({ current: '', drawn: '', loaded: 'Bea' })).toBe('Bea');
    expect(fieldAfterLoad({ current: 'Bea', drawn: 'Bea', loaded: 'Bea Jansen' })).toBe('Bea Jansen');
    expect(fieldAfterLoad({ current: null, drawn: null, loaded: 'Bea' })).toBe('Bea');
  });
  it('a field typed in since the last load keeps the typing', () => {
    expect(fieldAfterLoad({ current: 'Bea Jansen', drawn: '', loaded: 'Bea' })).toBe('Bea Jansen');
    expect(fieldAfterLoad({ current: '', drawn: 'Bea', loaded: 'Bea' }), 'cleared on purpose').toBe('');
  });
});
