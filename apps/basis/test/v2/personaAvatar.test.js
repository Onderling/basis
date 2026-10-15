/**
 * The header avatar: the active persona's picture (the `profilePicture` attribute) or, without one, its initials from
 * the name. One loader both shells call; the picture is a sealed ref each shell opens with its own opener.
 */
import { describe, it, expect } from 'vitest';
import { initialsOf, pictureRefOf, loadPersonaAvatar } from '../../src/v2/personaAvatar.js';

describe('the header avatar', () => {
  it('initials: the first letters of up to two words, upper case; a handle alone gives one', () => {
    expect(initialsOf('Frits de Roos')).toBe('FD');
    expect(initialsOf('  anna ')).toBe('A');
    expect(initialsOf('')).toBe('?');
    expect(initialsOf(null)).toBe('?');
  });

  it('the picture ref reads an attribute as stored ({value}) or bare', () => {
    expect(pictureRefOf({ profilePicture: { value: 'ref-1', mode: 'own' } })).toBe('ref-1');
    expect(pictureRefOf({ profilePicture: 'ref-2' })).toBe('ref-2');
    expect(pictureRefOf({})).toBe(null);
  });

  it('loads the name, the initials and the picture ref of the persona', async () => {
    const callSkill = async (app, op, args) => {
      if (app === 'stoop' && op === 'getMyProfile') return { entry: { handle: 'frits', displayName: 'Frits de Roos' } };
      if (app === 'agents' && op === 'getProfileProperties') return { properties: args?.id === 'default' ? { profilePicture: { value: 'pic' } } : {} };
      return null;
    };
    expect(await loadPersonaAvatar({ callSkill })).toEqual({ name: 'Frits de Roos', initials: 'FD', picture: 'pic' });
  });

  it('a call that fails still gives an avatar (the initials of nothing)', async () => {
    expect(await loadPersonaAvatar({ callSkill: async () => { throw new Error('down'); } })).toEqual({ name: null, initials: '?', picture: null });
  });
});
