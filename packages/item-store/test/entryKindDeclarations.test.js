import { describe, it, expect } from 'vitest';
import {
  createEntryKindRegistry, declareManifestEntryKinds, entryKindRegistryFromManifests,
} from '../src/entryKindDeclarations.js';

// The declared route for LOG-ENTRY kinds: the manifest's `appends` rows populate the registry the rail
// consults at append + ingest — the third sibling beside entryKinds (lane/retention) and resolutionPolicy
// (field merge).

describe('entry-kind declarations', () => {
  it('declares from manifest appends rows and reads back per lane', () => {
    const m = { operations: [
      { id: 'a', appends: [{ lane: 'governance', kind: 'propose' }, { lane: 'governance', kind: 'vote' }] },
      { id: 'b', appends: [{ lane: 'governance', kind: 'resolve' }] },
      { id: 'c' },                                                   // no appends → declares nothing
      { id: 'd', appends: [{ lane: '', kind: 'x' }, { kind: 'y' }] }, // malformed rows skipped
    ] };
    const r = entryKindRegistryFromManifests(m);
    expect(r.kindsFor('governance')).toEqual(['propose', 'resolve', 'vote']);
    expect(r.has('governance', 'vote')).toBe(true);
    expect(r.has('governance', 'invented')).toBe(false);             // the ingest refusal test
    expect(r.has('other-lane', 'vote')).toBe(false);                 // kinds are per lane
    expect(r.lanes()).toEqual(['governance']);
  });

  it('multiple manifests layer into one registry (a third-party add-on declares its own lane)', () => {
    const addon = { operations: [{ id: 'x', appends: [{ lane: 'attest', kind: 'witness' }] }] };
    const core  = { operations: [{ id: 'y', appends: [{ lane: 'governance', kind: 'propose' }] }] };
    const r = entryKindRegistryFromManifests(core, addon);
    expect(r.lanes().sort()).toEqual(['attest', 'governance']);
    expect(r.has('attest', 'witness')).toBe(true);
  });

  it('declare validates its inputs', () => {
    const r = createEntryKindRegistry();
    expect(() => r.declare('', 'x')).toThrow(/lane/);
    expect(() => r.declare('l', '')).toThrow(/kind/);
    expect(declareManifestEntryKinds(r, null)).toBe(r);              // absent manifest is a no-op
  });
});
