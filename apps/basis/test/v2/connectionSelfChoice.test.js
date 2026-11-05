/**
 * WHICH SELF A SCREEN IS PAIRED FOR — the pairing form's one decision, shared by both shells. A persona issues its grants
 * as itself, so a device holding several selves asks, with the active self preselected; with one self it asks nothing;
 * with several and none active it preselects nothing (never a silent default). The grant args carry the self chosen.
 */
import { describe, it, expect } from 'vitest';
import { connectionSelfChoice, compileConnectionGrant } from '../../src/v2/connections.js';

const held = [{ id: 'default', name: null }, { id: 'p-000000000001', name: 'Werk' }];

describe('which self a screen is paired for', () => {
  it('one self: nothing to ask', () => {
    expect(connectionSelfChoice({ held: [held[0]], on: ['default'] })).toEqual({ required: false, options: [held[0]], preset: 'default' });
  });
  it('two selves, one active: asked, the active one preselected', () => {
    expect(connectionSelfChoice({ held, on: ['p-000000000001'] })).toMatchObject({ required: true, preset: 'p-000000000001' });
  });
  it('two selves, both active: asked, nothing preselected', () => {
    expect(connectionSelfChoice({ held, on: ['default', 'p-000000000001'] })).toMatchObject({ required: true, preset: null });
  });
  it('the grant args carry the self chosen, and nothing when none', () => {
    expect(compileConnectionGrant({ viewPubKey: 'V', ops: ['a.b'], persona: 'p-000000000001' })).toMatchObject({ persona: 'p-000000000001' });
    expect(compileConnectionGrant({ viewPubKey: 'V', ops: ['a.b'] })).not.toHaveProperty('persona');
  });
});
