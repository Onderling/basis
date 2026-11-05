/**
 * The circles a shell registers its presence in: every list it brings, minus the ones the fold says were left or
 * removed. One filter for web, mobile and the box.
 */
import { describe, it, expect } from 'vitest';
import { presenceCircleIds } from '../../src/v2/circleSecurityPriming.js';

describe('presenceCircleIds', () => {
  it('unions the lists and drops a left or removed circle, whichever list it came from', () => {
    const mine = { circles: ['kept'], left: ['left-one'], removed: [{ id: 'removed-one', name: 'Weg' }] };
    const cached = [{ id: 'left-one' }, { id: 'removed-one' }, { id: 'kept' }];
    expect(presenceCircleIds(mine, mine.circles, cached, ['just-joined'])).toEqual(['kept', 'just-joined']);
  });
  it('keeps every id when the answer could not be read', () => {
    expect(presenceCircleIds(null, ['a'], [{ groupId: 'b' }])).toEqual(['a', 'b']);
  });
});
