/**
 * derivePodRootFromWebId — resolve writable Pod storage from the
 * WebID profile's pim:storage (device-pass #1 fix). Mocked fetch.
 */

import { describe, it, expect, vi } from 'vitest';
import { derivePodRootFromWebId } from '../src/lib/derivePodRoot.js';

const WEBID = 'https://id.inrupt.com/alice/profile/card#me';
const mkRes = (ok, body) => ({ ok, text: async () => body });

describe('derivePodRootFromWebId', () => {
  it('parses Turtle prefixed pim:storage', async () => {
    const fetch = vi.fn().mockResolvedValue(mkRes(true,
      '@prefix pim: <http://www.w3.org/ns/pim/space#>.\n<#me> pim:storage <https://storage.inrupt.com/uuid/>.'));
    expect(await derivePodRootFromWebId({ webid: WEBID, fetch }))
      .toBe('https://storage.inrupt.com/uuid/');
  });

  it('parses Turtle full-IRI pim:storage', async () => {
    const fetch = vi.fn().mockResolvedValue(mkRes(true,
      '<#me> <http://www.w3.org/ns/pim/space#storage> <https://storage.inrupt.com/u2/>.'));
    expect(await derivePodRootFromWebId({ webid: WEBID, fetch }))
      .toBe('https://storage.inrupt.com/u2/');
  });

  it('parses JSON-LD pim:storage', async () => {
    const fetch = vi.fn().mockResolvedValue(mkRes(true,
      JSON.stringify({ '@id': WEBID, 'http://www.w3.org/ns/pim/space#storage': { '@id': 'https://storage.inrupt.com/u3/' } })));
    expect(await derivePodRootFromWebId({ webid: WEBID, fetch }))
      .toBe('https://storage.inrupt.com/u3/');
  });

  it('appends a trailing slash when missing', async () => {
    const fetch = vi.fn().mockResolvedValue(mkRes(true, '<#me> pim:storage <https://storage.inrupt.com/u4>.'));
    expect(await derivePodRootFromWebId({ webid: WEBID, fetch }))
      .toBe('https://storage.inrupt.com/u4/');
  });

  it('falls back to the WebID origin on a non-ok profile', async () => {
    const fetch = vi.fn().mockResolvedValue(mkRes(false, ''));
    expect(await derivePodRootFromWebId({ webid: WEBID, fetch }))
      .toBe('https://id.inrupt.com/');
  });

  it('falls back to the WebID origin when fetch throws', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('network'));
    expect(await derivePodRootFromWebId({ webid: WEBID, fetch }))
      .toBe('https://id.inrupt.com/');
  });

  it('falls back to origin with no fetch; null for an unusable webid', async () => {
    expect(await derivePodRootFromWebId({ webid: WEBID })).toBe('https://id.inrupt.com/');
    expect(await derivePodRootFromWebId({ webid: '' })).toBeNull();
    expect(await derivePodRootFromWebId({})).toBeNull();
  });
});
