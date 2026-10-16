/**
 * WHO ENTERS THE NEARBY ROOM follows the switcher's set: one self ticked → that self, no question; several → the room
 * asks once, and the last answer (kept per device) is the default while it is still ticked. The face then names THAT
 * self. Until the room has an address per self, this is a label — the screen says so.
 */
import { describe, it, expect } from 'vitest';
import { nearbyRoomSelf, createNearbyIdentity, roomSelfFor } from '../../src/v2/nearbyIdentity.js';

const held = [{ id: 'default', name: null }, { id: 'p-aaaaaaaaaaaa', name: 'Werk' }];

describe('who enters the room', () => {
  it('one self in the set: that one, no question', () => {
    expect(nearbyRoomSelf({ active: ['p-aaaaaaaaaaaa'], held })).toEqual({ self: 'p-aaaaaaaaaaaa', ask: false, choices: ['p-aaaaaaaaaaaa'] });
  });
  it('several: the remembered answer while it is still ticked, else the room asks', () => {
    expect(nearbyRoomSelf({ active: ['default', 'p-aaaaaaaaaaaa'], held, remembered: 'p-aaaaaaaaaaaa' })).toMatchObject({ self: 'p-aaaaaaaaaaaa', ask: false });
    expect(nearbyRoomSelf({ active: ['default', 'p-aaaaaaaaaaaa'], held, remembered: null })).toMatchObject({ self: null, ask: true, choices: ['default', 'p-aaaaaaaaaaaa'] });
    expect(nearbyRoomSelf({ active: ['default'], held, remembered: 'p-aaaaaaaaaaaa' }), 'a remembered self no longer ticked does not win').toMatchObject({ self: 'default', ask: false });
  });
  it('the face names the room self: a persona by its own name; the general persona as before; nobody stays nobody', async () => {
    const callSkill = async (app, op) => (op === 'getMyProfile' ? { entry: { displayName: 'Frits', handle: 'frits' } } : null);
    const as = (self, choice = 'name') => createNearbyIdentity({ readChoice: () => choice, callSkill, roomSelf: () => self }).myFace();
    expect(await as({ id: 'p-aaaaaaaaaaaa', name: 'Werk' })).toEqual({ label: 'Werk' });
    expect(await as({ id: 'p-aaaaaaaaaaaa', name: 'Werk' }, 'handle'), 'a persona has no handle of the general persona').toEqual({ label: 'Werk' });
    expect(await as({ id: 'default' })).toEqual({ label: 'Frits' });
    expect(await as(null)).toEqual({ label: 'Frits' });
    expect(await as({ id: 'p-aaaaaaaaaaaa', name: 'Werk' }, 'none')).toBe(null);
  });
  it('what the shells hand the face: the chosen self, or ASKING while the room asks — never an absence', () => {
    expect(roomSelfFor(nearbyRoomSelf({ active: ['default', 'p-aaaaaaaaaaaa'], held }), held)).toEqual({ asking: true });
    expect(roomSelfFor(nearbyRoomSelf({ active: ['p-aaaaaaaaaaaa'], held }), held)).toEqual({ id: 'p-aaaaaaaaaaaa', name: 'Werk' });
  });

  it('while the room ASKS, no face is broadcast — never the general persona by default', async () => {
    const callSkill = async (app, op) => (op === 'getMyProfile' ? { entry: { displayName: 'Frits', handle: 'frits' } } : null);
    const face = await createNearbyIdentity({ readChoice: () => 'name', callSkill, roomSelf: () => ({ asking: true }) }).myFace();
    expect(face, 'the question first; the room is entered as nobody').toBe(null);
  });
});
