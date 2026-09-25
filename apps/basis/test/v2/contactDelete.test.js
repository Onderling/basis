/** The words above a returning turn (L114): "verwijderd" after a deletion, "verborgen" for a merely hidden contact. */
import { describe, it, expect } from 'vitest';
import { returnedMarkerKey } from '../../src/v2/contactDelete.js';

describe('returnedMarkerKey', () => {
  it('a turn that is not a return has no marker', () => {
    expect(returnedMarkerKey({ text: 'hoi' }, 5)).toBeNull();
  });
  it('a return after a deletion says "verwijderd"', () => {
    expect(returnedMarkerKey({ returned: true, ts: 10 }, 5)).toBe('circle.contacts.returned_deleted_marker');
  });
  it('a return from before a later deletion keeps its own words', () => {
    expect(returnedMarkerKey({ returned: true, ts: 3 }, 5)).toBe('circle.contacts.returned_marker');
  });
  it('a hidden, never-deleted contact says "verborgen"', () => {
    expect(returnedMarkerKey({ returned: true, ts: 3 }, null)).toBe('circle.contacts.returned_marker');
  });
});
