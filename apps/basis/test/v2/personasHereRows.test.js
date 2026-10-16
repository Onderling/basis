/**
 * "Persona's op dit apparaat" — the selves this device holds, one row each, with the one act a row offers: pause a
 * running persona, resume a paused one; the primary (the self this device speaks as) offers none. One model, both
 * shells paint it.
 */
import { describe, it, expect } from 'vitest';
import { personasHereRows } from '../../src/v2/personasHere.js';

describe('the personas-here rows', () => {
  it('the primary first with no act; a running persona can be paused, a paused one resumed', () => {
    const rows = personasHereRows([
      { id: 'p-bbbbbbbbbbbb', name: 'Buurt', paused: true, running: false },
      { id: 'default', name: null, primary: true, running: true },
      { id: 'p-aaaaaaaaaaaa', name: 'Werk', running: true },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['default', 'p-aaaaaaaaaaaa', 'p-bbbbbbbbbbbb']);
    expect(rows[0]).toMatchObject({ nameKey: 'circle.switcher.you', stateKey: 'circle.receive_personas.primary', act: null });
    expect(rows[1]).toMatchObject({ name: 'Werk', act: { op: 'pausePersona', labelKey: 'circle.receive_personas.pause' } });
    expect(rows[2]).toMatchObject({ stateKey: 'circle.receive_personas.paused', act: { op: 'resumePersona', labelKey: 'circle.receive_personas.resume' } });
  });

  it('a removable persona (held here, running, not the primary, a delegated device) also offers removal — with the phrase', () => {
    const [, werk, buurt] = personasHereRows([
      { id: 'default', primary: true, running: true },
      { id: 'p-aaaaaaaaaaaa', name: 'Werk', running: true, removable: true },
      { id: 'p-bbbbbbbbbbbb', name: 'Buurt', paused: true, removable: false },
    ]);
    expect(werk.remove).toEqual({ op: 'removePersonaHere', labelKey: 'circle.receive_personas.remove', needsPhrase: true, warnKey: 'circle.receive_personas.remove_warn' });
    expect(buurt.remove).toBe(null);
  });
});
