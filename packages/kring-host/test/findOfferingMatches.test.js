/**
 * skill-match source-side tests.
 */
import { describe, it, expect } from 'vitest';
import { findOfferingMatches, tokenize, MATCH_SOURCES } from '../src/findOfferingMatches.js';

describe('tokenize', () => {
  it('lowercases + splits on non-letters', () => {
    expect(tokenize('Fietsband plakken!')).toEqual(['fietsband', 'plakken']);
  });
  it('drops stopwords', () => {
    expect(tokenize('I have a flat tire')).toEqual(['flat', 'tire']);
    expect(tokenize('Mijn fietsband is lek')).toEqual(['fietsband', 'lek']);
  });
  it('keeps unicode letters (à-öø-ÿ)', () => {
    expect(tokenize('café-eigenaar')).toEqual(['café', 'eigenaar']);
  });
  it('returns [] for empty / non-string / pure punctuation', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(null)).toEqual([]);
    expect(tokenize('!?!')).toEqual([]);
  });
  it('drops single-letter noise', () => {
    expect(tokenize('a b c plakken')).toEqual(['plakken']);
  });
});

describe('findOfferingMatches', () => {
  const members = [
    { id: 'm1', displayName: 'Anne',   skills: [{ text: 'Fietsband plakken', openness: 'circle' }] },
    { id: 'm2', displayName: 'Bob',    skills: [{ text: 'Belasting-aangifte' }] },
    { id: 'm3', displayName: 'wielen-mei', skills: [{ text: 'Fiets-reparatie en onderhoud' }] },
  ];
  const agents = [
    { id: 'a1', displayName: 'Community workshop', skills: [{ text: 'Fietsen — algemeen onderhoud' }] },
  ];
  const hopCandidates = [
    { id: 'h1', displayName: 'Sjoerd', skills: [{ text: 'Fietsband repareren via Bert' }] },
  ];

  it('returns [] for an empty / non-skill query', () => {
    expect(findOfferingMatches({ query: '', members })).toEqual([]);
    expect(findOfferingMatches({ query: '   ', members })).toEqual([]);
    expect(findOfferingMatches({ query: null, members })).toEqual([]);
    expect(findOfferingMatches({ query: 'and the of', members })).toEqual([]); // all stopwords
  });

  it('ranks direct member matches first', () => {
    const out = findOfferingMatches({
      query: 'mijn fietsband is lek',
      members, agents, hopCandidates,
    });
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0].source).toBe('human');
    expect(out[0].label).toBe('Anne');
    expect(out[0].matchedTokens).toContain('fietsband');
  });

  it('attaches source labels (human/agent/via-hop) from the input slot', () => {
    const out = findOfferingMatches({ query: 'fietsband', members, agents, hopCandidates });
    const sources = out.map((m) => m.source);
    expect(sources).toContain('human');
    expect(sources).toContain('via-hop');
    // Agent matches with "fietsen onderhoud" — needs the "fietsen" token; our
    // query is "fietsband" only, so the agent shouldn't show.  This guards
    // against accidental fuzzy / substring matching.
    expect(sources).not.toContain('agent');
  });

  it('includes the agent when the query token overlaps the agent skill', () => {
    const out = findOfferingMatches({ query: 'fietsen onderhoud', members, agents });
    const labels = out.map((m) => m.label);
    expect(labels).toContain('Community workshop');
    expect(out.find((m) => m.label === 'Community workshop').source).toBe('agent');
  });

  it('breaks ties by source rank (human > agent > via-hop)', () => {
    const sameTokens = [
      { id: 'a', displayName: 'A', skills: [{ text: 'plakken' }] },
    ];
    const sameAgents = [
      { id: 'b', displayName: 'B', skills: [{ text: 'plakken' }] },
    ];
    const out = findOfferingMatches({ query: 'plakken', members: sameTokens, agents: sameAgents });
    expect(out[0].label).toBe('A');
    expect(out[0].source).toBe('human');
    expect(out[1].label).toBe('B');
    expect(out[1].source).toBe('agent');
  });

  it('respects maxResults', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`, displayName: `M${i}`, skills: [{ text: 'fietsband plakken' }],
    }));
    const out = findOfferingMatches({ query: 'fietsband', members: many, maxResults: 3 });
    expect(out).toHaveLength(3);
  });

  it('reports matchedTokens + chosen skill text per result', () => {
    const out = findOfferingMatches({ query: 'fietsband plakken', members });
    const anne = out.find((m) => m.label === 'Anne');
    expect(anne.matchedTokens.sort()).toEqual(['fietsband', 'plakken']);
    expect(anne.skill).toBe('Fietsband plakken');
  });

  it('picks the best-scoring skill when a member has multiple', () => {
    const mike = [
      { id: 'mike', displayName: 'Mike', skills: [
        { text: 'Belasting-aangifte' },
        { text: 'Fietsband plakken' },
      ] },
    ];
    const out = findOfferingMatches({ query: 'fietsband plakken', members: mike });
    expect(out[0].skill).toBe('Fietsband plakken');
  });

  it('handles a member with no usable skill text gracefully (skipped)', () => {
    const m = [
      { id: 'x', displayName: 'X', skills: [{ text: '   ' }, { foo: 'bar' }] },
      { id: 'y', displayName: 'Y', skills: [{ text: 'fietsband plakken' }] },
    ];
    const out = findOfferingMatches({ query: 'fietsband', members: m });
    expect(out.map((r) => r.label)).toEqual(['Y']);
  });

  it('accepts skills as plain strings too', () => {
    const m = [{ id: 'x', displayName: 'X', skills: ['Fietsband plakken'] }];
    const out = findOfferingMatches({ query: 'fietsband', members: m });
    expect(out[0].label).toBe('X');
  });

  it('falls back to webid / id when displayName/handle/label/name are absent', () => {
    const m = [{ webid: 'webid:anne', skills: [{ text: 'fietsband plakken' }] }];
    const out = findOfferingMatches({ query: 'fietsband', members: m });
    expect(out[0].label).toBe('webid:anne');
  });

  it('MATCH_SOURCES is re-exported for source-coercion in renderers', () => {
    expect(MATCH_SOURCES).toEqual(['human', 'agent', 'via-hop']);
  });
});
