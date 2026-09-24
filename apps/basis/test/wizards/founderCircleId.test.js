/**
 * A CIRCLE'S ID COMES FROM ITS FOUNDER — on every create path, from one helper (L126, 2026-09-24).
 *
 * Web fixed this on 2026-08-28: an id derived from the NAME let two people who both called their circle
 * "Proeftuin" hold one id, and a device that learned of both merged them — a second door into a circle. The
 * mobile create wizard never followed (it slugified the name, and offered an id field a person could type
 * anything into), and the web wizard called a `founderKey()` that was never defined. Three copies of one rule,
 * two of them wrong: the rule now lives once, and the fitness half below fails a wizard that names a circle by
 * what someone typed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveFounderKey, newFounderCircleId, isValidSlug } from '../../src/core/wizards/createGroupState.js';

describe('the founder-derived circle id', () => {
  it('two circles with the same name from the same founder never share an id', () => {
    const a = newFounderCircleId('founder-key');
    const b = newFounderCircleId('founder-key');
    expect(a).not.toBe(b);
    expect(isValidSlug(a)).toBe(true);
  });

  it('two founders never collide on a name, because the name is not an input', () => {
    expect(newFounderCircleId('alice')).not.toBe(newFounderCircleId('bob'));
  });

  it('refuses without a founder rather than falling back to anything a stranger could produce', () => {
    expect(() => newFounderCircleId('')).toThrow();
    expect(() => newFounderCircleId(null)).toThrow();
  });

  it('finds the founder: a pinned key, else the shell\'s peer address, else whoAmI', async () => {
    expect(await resolveFounderKey({ founderPubKey: 'pinned' })).toBe('pinned');
    expect(await resolveFounderKey({ getMyPeerAddr: () => 'peer' })).toBe('peer');
    expect(await resolveFounderKey({ getMyPeerAddr: () => null, callSkill: async () => ({ webid: 'me' }) })).toBe('me');
    expect(await resolveFounderKey({ callSkill: async () => { throw new Error('offline'); } })).toBeNull();
  });
});

describe('fitness — no create wizard names a circle by what someone typed', () => {
  const root = path.resolve(__dirname, '../../src');
  const wizards = ['web/wizards/createGroupWizard.js', 'rn/wizards/createGroupWizardModal.js'];

  for (const rel of wizards) {
    it(`${rel} takes its id from the founder`, () => {
      const src = readFileSync(path.join(root, rel), 'utf8');
      expect(src, 'derives the id through the shared helper').toMatch(/newFounderCircleId\(/);
      expect(src, 'never from the name').not.toMatch(/groupId[^\n]*slugify\(/);
      expect(src, 'and offers no id field to type into').not.toMatch(/onChangeText=\{\(v\) => setState\(\(s\) => \(\{ \.\.\.s, groupId: v/);
    });
  }
});
