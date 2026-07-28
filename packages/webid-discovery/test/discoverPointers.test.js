/**
 * discoverPointers + parseWebIdPointers — unit tests.
 *
 * Covers:
 *   - JSON-LD profile (full IRI key)
 *   - JSON-LD profile (short-name key)
 *   - JSON-LD with @id wrapper
 *   - JSON-LD with array-of-objects
 *   - Turtle profile (full IRI predicate)
 *   - Turtle profile (`dec:` prefix predicate)
 *   - Empty / malformed bodies
 *   - HTTP error response from fetch
 *   - Invalid arguments
 */

import { describe, it, expect } from 'vitest';
import { discoverPointers, parseWebIdPointers } from '../src/discoverPointers.js';

const WEBID = 'https://alice.example/profile/card#me';

/* ────────────────────────────────────────────────────────────────────────── */

describe('parseWebIdPointers — JSON-LD', () => {
  it('extracts pointers using full-IRI keys', () => {
    const body = JSON.stringify({
      '@id': WEBID,
      'https://onderling.org/ns#storage-mapping-uri': 'https://alice.pod/private/storage-mapping',
      'https://onderling.org/ns#agent-registry-uri':  'https://alice.pod/private/agent-registry',
    });
    expect(parseWebIdPointers(body, WEBID)).toEqual({
      storageMappingUri: 'https://alice.pod/private/storage-mapping',
      agentRegistryUri:  'https://alice.pod/private/agent-registry',
    });
  });

  it('extracts pointers using short-name keys', () => {
    const body = JSON.stringify({
      '@id': WEBID,
      'storage-mapping-uri': 'https://alice.pod/private/storage-mapping',
    });
    expect(parseWebIdPointers(body, WEBID)).toEqual({
      storageMappingUri: 'https://alice.pod/private/storage-mapping',
    });
  });

  it('extracts URIs from @id-wrapped JSON-LD objects', () => {
    const body = JSON.stringify({
      '@id': WEBID,
      'https://onderling.org/ns#agent-registry-uri': [{ '@id': 'https://alice.pod/private/agent-registry' }],
    });
    expect(parseWebIdPointers(body, WEBID)).toEqual({
      agentRegistryUri: 'https://alice.pod/private/agent-registry',
    });
  });

  it('handles JSON-LD arrays at the top level', () => {
    const body = JSON.stringify([
      { '@id': 'https://other/' },  // irrelevant subject; we don't filter by subject here
      { '@id': WEBID, 'storage-mapping-uri': 'https://alice.pod/private/storage-mapping' },
    ]);
    expect(parseWebIdPointers(body, WEBID)).toEqual({
      storageMappingUri: 'https://alice.pod/private/storage-mapping',
    });
  });

  it('returns empty object when no recognised predicate is present', () => {
    const body = JSON.stringify({ '@id': WEBID, foaf: 'https://xmlns.com/foaf/0.1/' });
    expect(parseWebIdPointers(body, WEBID)).toEqual({});
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('parseWebIdPointers — Turtle', () => {
  it('extracts pointers using full-IRI predicates', () => {
    const body = `
      <${WEBID}> <https://onderling.org/ns#storage-mapping-uri> <https://alice.pod/private/storage-mapping> .
      <${WEBID}> <https://onderling.org/ns#agent-registry-uri>  <https://alice.pod/private/agent-registry> .
    `;
    expect(parseWebIdPointers(body, WEBID)).toEqual({
      storageMappingUri: 'https://alice.pod/private/storage-mapping',
      agentRegistryUri:  'https://alice.pod/private/agent-registry',
    });
  });

  it('extracts pointers using dec: prefix predicates', () => {
    const body = `
      @prefix dec: <https://onderling.org/ns#> .
      <${WEBID}> dec:storage-mapping-uri <https://alice.pod/private/storage-mapping> .
      <${WEBID}> dec:audit-log-uri       <https://alice.pod/private/audit-log> .
    `;
    expect(parseWebIdPointers(body, WEBID)).toEqual({
      storageMappingUri: 'https://alice.pod/private/storage-mapping',
      auditLogUri:       'https://alice.pod/private/audit-log',
    });
  });

  it('returns empty object when no recognised predicate is present', () => {
    const body = `
      @prefix foaf: <http://xmlns.com/foaf/0.1/> .
      <${WEBID}> foaf:name "Alice" .
    `;
    expect(parseWebIdPointers(body, WEBID)).toEqual({});
  });

  it('returns empty for empty body', () => {
    expect(parseWebIdPointers('', WEBID)).toEqual({});
  });

  it('returns empty for non-string body', () => {
    expect(parseWebIdPointers(null, WEBID)).toEqual({});
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('discoverPointers — fetch integration', () => {
  it('fetches the WebID profile and returns parsed pointers + raw body', async () => {
    const body = `<${WEBID}> <https://onderling.org/ns#storage-mapping-uri> <https://alice.pod/private/storage-mapping> .`;
    const fakeFetch = async (url) => {
      expect(String(url)).toBe(WEBID);
      return new Response(body, { status: 200, headers: { 'content-type': 'text/turtle' } });
    };
    const { pointers, raw } = await discoverPointers(WEBID, { fetch: fakeFetch });
    expect(pointers).toEqual({
      storageMappingUri: 'https://alice.pod/private/storage-mapping',
    });
    expect(raw).toBe(body);
  });

  it('passes an Accept header that prefers Turtle', async () => {
    let observedAccept = null;
    const fakeFetch = async (_url, init) => {
      observedAccept = init?.headers?.Accept;
      return new Response('', { status: 200 });
    };
    await discoverPointers(WEBID, { fetch: fakeFetch });
    expect(observedAccept).toMatch(/text\/turtle/);
    expect(observedAccept).toMatch(/application\/ld\+json/);
  });

  it('throws FETCH_FAILED with the status code when the profile returns non-2xx', async () => {
    const fakeFetch = async () => new Response('not found', { status: 404 });
    await expect(discoverPointers(WEBID, { fetch: fakeFetch }))
      .rejects.toMatchObject({ code: 'FETCH_FAILED', status: 404 });
  });

  it('throws INVALID_ARGUMENT when webidUri is missing', async () => {
    await expect(discoverPointers('', { fetch: async () => new Response() }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('throws INVALID_ARGUMENT when fetch is not a function', async () => {
    await expect(discoverPointers(WEBID, { fetch: null }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
