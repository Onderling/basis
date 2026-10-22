import { describe, it, expect } from 'vitest';
import { normalizeCircleMembers } from '../src/circleMembers.js';
import { findOfferingMatches } from '../src/findOfferingMatches.js';

// Offerings are persona DRIVERS since 2026-10-15 (kind 'offering'), and they reach a co-member's roster row only as the
// member's RELEASE for this circle (`personaProperties`). The matcher reads `offerings`; nothing turned the release into
// that, so /find's member matches (and an ask's) came back empty for every member.
const roster = { members: [
  { webid: 'bram', handle: 'bram', personaProperties: { dogwalk: { kind: 'offering', text: 'Walk your dog', tags: ['pets', 'dogs'] }, realName: 'Bram' } },
  { webid: 'cato', handle: 'cato' },
  { webid: 'dirk', handle: 'dirk', personaProperties: { motto: { kind: 'interest', text: 'dogs are great' } } },
] };

describe("a member's offerings are what they released to this circle", () => {
  it('a released offering is on the member row; a row that released none has no offerings key', () => {
    const [bram, cato, dirk] = normalizeCircleMembers(roster);
    expect(bram.offerings).toEqual([{ kind: 'offering', text: 'Walk your dog', tags: ['pets', 'dogs'], key: 'dogwalk' }]);
    expect('offerings' in cato).toBe(false);
    expect('offerings' in dirk, 'only kind offering counts — an interest is not something offered').toBe(false);
  });
  it('the matcher finds the member who offers it', () => {
    const m = findOfferingMatches({ query: 'dog walk', members: normalizeCircleMembers(roster) });
    expect(m.map((x) => x.id)).toEqual(['bram']);
    expect(m[0].skill).toBe('Walk your dog');
  });
  it('only the RELEASE is read: offerings held anywhere else on a row are not matched', () => {
    // a row that also carries unreleased data (drivers, skills, a profile copy) — none of it may reach the matcher
    const leaky = { members: [{ webid: 'eva', handle: 'eva',
      drivers: { ladder: { kind: 'offering', text: 'Lend a ladder' } },
      skills: [{ text: 'Lend a ladder' }],
      profile: { offerings: [{ text: 'Lend a ladder' }] },
    }] };
    expect(findOfferingMatches({ query: 'ladder', members: normalizeCircleMembers(leaky) })).toEqual([]);
  });
  it('the match carries the released text, and nothing the release did not say', () => {
    const [bram] = normalizeCircleMembers(roster);
    const [m] = findOfferingMatches({ query: 'dog', members: [bram] });
    expect(m.skill).toBe('Walk your dog');
    expect(Object.keys(m).sort()).toEqual(['id', 'label', 'matchedTokens', 'score', 'skill', 'source']);
  });
});
