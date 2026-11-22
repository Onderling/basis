/**
 * ONE MATERIALIZE PER LANDING. Vandaag's blocks are materialized from the page and the circles shown; on the phone
 * that took ~2.2 s of JS per run, and a landing ran it three times — the screen's effect fired again each time an
 * input became a NEW OBJECT with the same content (the page book after its refresh, the circle list, the seen-marks).
 * The landing key names what the blocks are made FROM; the screen materializes when it changes, not when an object's
 * identity does.
 */
import { describe, it, expect } from 'vitest';
import { vandaagLandingKey } from '../../src/v2/vandaag.js';

const page = { id: 'p1', name: 'Vandaag', blocks: [{ id: 'b1', type: 'calendar', config: { horizonDays: 7, limit: 5 } }, { id: 'b2', type: 'tasks', config: { scope: 'assigned-to-me', limit: 5 } }] };
const book = { activeId: 'p1', screens: [page] };
const circles = [{ id: 'c1', name: 'Huis' }, { id: 'c2', name: 'Straat' }];

describe('vandaagLandingKey', () => {
  it('the same page and circles in new objects: the same key (a refreshed book is not a new landing)', () => {
    const a = vandaagLandingKey({ book, circles, expandedBlockId: null, selves: ['default'] });
    const b = vandaagLandingKey({ book: structuredClone(book), circles: circles.map((c) => ({ ...c })), expandedBlockId: null, selves: ['default'] });
    expect(b).toBe(a);
  });

  it('the order the circles arrive in does not matter; a circle added or a block changed does', () => {
    const base = vandaagLandingKey({ book, circles, selves: ['default'] });
    expect(vandaagLandingKey({ book, circles: [...circles].reverse(), selves: ['default'] })).toBe(base);
    expect(vandaagLandingKey({ book, circles: [...circles, { id: 'c3' }], selves: ['default'] })).not.toBe(base);
    const changed = { ...book, screens: [{ ...page, blocks: [{ ...page.blocks[0], config: { horizonDays: 30, limit: 5 } }, page.blocks[1]] }] };
    expect(vandaagLandingKey({ book: changed, circles, selves: ['default'] })).not.toBe(base);
  });

  it('a block opened whole, another page, another set of selves: each is a new landing', () => {
    const base = vandaagLandingKey({ book, circles, selves: ['default'] });
    expect(vandaagLandingKey({ book, circles, expandedBlockId: 'b1', selves: ['default'] })).not.toBe(base);
    expect(vandaagLandingKey({ book, circles, selves: ['default', 'buurt'] })).not.toBe(base);
    expect(vandaagLandingKey({ book: { ...book, activeId: 'p2', screens: [page, { id: 'p2', blocks: [] }] }, circles, selves: ['default'] })).not.toBe(base);
  });

  it('no page yet: a key of its own (nothing to materialize), never a throw', () => {
    expect(typeof vandaagLandingKey({ book: null, circles: [] })).toBe('string');
  });
});

describe('the landing key and a host that learns its circles later (ledger L1051)', () => {
  it('changes when the circles become known, so a person in no circle gets the strip when the list was read', () => {
    const book = { screens: [{ id: 'v', blocks: [{ id: 'o', type: 'onboarding' }] }], activeId: 'v' };
    expect(vandaagLandingKey({ book, circles: [], circlesKnown: false })).not.toBe(vandaagLandingKey({ book, circles: [], circlesKnown: true }));
    // a host that does not say (the web) keeps the key it had
    expect(vandaagLandingKey({ book, circles: [] })).toBe(vandaagLandingKey({ book, circles: [] }));
    expect(vandaagLandingKey({ book, circles: [] })).not.toContain('circlesKnown');
  });
});

