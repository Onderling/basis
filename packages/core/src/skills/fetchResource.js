/**
 * fetch-resource — generic peer-fetch skill factory.
 *
 * Core ships the **skill shape**; the substrate (typically
 * `@onderling/pseudo-pod`) supplies the **storage backing** via the
 * injected `read` callback. This way core never imports the
 * pseudo-pod substrate (strict layering: apps → substrates → core).
 *
 * Typical use:
 *
 *   import { makeFetchResourceSkill } from '@onderling/core';
 *   const skill = makeFetchResourceSkill({
 *     read: (uri) => pseudoPod.read(uri),     // pseudo-pod consumer
 *   });
 *   agent.skills.register(skill);
 *
 * Caller protocol (other side of the wire):
 *
 *   const parts = await agent.callSkill({
 *     target: peerAddress,
 *     skill:  'fetch-resource',
 *     args:   { uri: 'https://anne.pod/sharing/tasks/abc.ttl' },
 *   });
 *   // parts[0] is a DataPart with `{ uri, bytes, etag? }`
 *
 * **Peer-fetch gates.** Two opt-in
 * hooks gate outbound fetches:
 *
 *   - `groupCheck(uri, ctx) → boolean | Promise<boolean>`
 *     The caller is authorised if a shared group-membership exists.
 *     `ctx = { from, envelope, agent, parts }`. Default behaviour
 *     when omitted: no group check.
 *   - `capCheck(uri, ctx) → boolean | Promise<boolean>`
 *     Orthogonal cap-token verification. `ctx.capToken` is extracted
 *     from `[DataPart({ uri, capToken })]` if present. Default
 *     behaviour when omitted: no cap-token check.
 *
 * When BOTH gates are supplied, the fetch is allowed if EITHER
 * returns truthy (group OR cap-token). When NEITHER is supplied,
 * the skill falls back to **trust-the-transport** — the caller is
 * already past the SecurityLayer's hello/identity gate; back-compat
 * with apps that haven't migrated.
 *
 */

import { defineSkill } from './defineSkill.js';
import { DataPart }    from '../Parts.js';

/**
 * @typedef {object} FetchResourceResult
 * @property {string} uri          — echoed back for the caller's convenience
 * @property {Uint8Array|string|object} bytes — the resource value
 * @property {string} [etag]       — optional etag if the storage layer tracks one
 *
 * @typedef {object} FetchResourceGateCtx
 * @property {string}      [from]      — caller identity (webid / pubKey / agent URI)
 * @property {object}      [envelope]  — raw envelope (with `_from` etc.)
 * @property {object}      [agent]     — local agent
 * @property {Array}       [parts]     — original request parts
 * @property {*}           [capToken]  — cap-token extracted from parts (if any)
 */

/**
 * Build a 'fetch-resource' skill definition backed by an injected read(uri)
 * callback. Optional groupCheck/capCheck gates authorise each request (passing
 * either allows it); with neither supplied the skill trusts the transport-level
 * identity gate. The handler resolves to [DataPart({ uri, bytes, etag? })] and
 * throws coded errors (INVALID_ARGUMENT, FORBIDDEN, NOT_READABLE, NOT_FOUND).
 *
 * @param {object} opts
 * @param {(uri: string) => Promise<*|null>} opts.read
 *   Storage-backed reader. Returns the resource value (any shape) on hit,
 *   `null`/`undefined` on miss. Errors propagate as a
 *   `NOT_READABLE` skill error.
 * @param {(uri: string, ctx: FetchResourceGateCtx) => boolean|Promise<boolean>} [opts.groupCheck]
 *   Peer-fetch gate. When supplied,
 *   invoked per request — if truthy, the fetch is allowed. Used by
 *   apps that track group-membership rosters (Pinboard, etc.) to deny
 *   ex-members.
 * @param {(uri: string, ctx: FetchResourceGateCtx) => boolean|Promise<boolean>} [opts.capCheck]
 *   Peer-fetch gate. Orthogonal
 *   cap-token verification. When supplied, invoked per request with
 *   `ctx.capToken` populated from the request parts. If truthy, the
 *   fetch is allowed.
 * @param {string}   [opts.id='fetch-resource']
 * @param {'public'|'authenticated'|'trusted'|'private'} [opts.visibility='authenticated']
 * @param {string}   [opts.description]
 *
 * @returns {ReturnType<typeof defineSkill>} a skill definition ready
 *          to register with `agent.skills.register(...)`.
 */
export function makeFetchResourceSkill({
  read,
  groupCheck  = null,
  capCheck    = null,
  id          = 'fetch-resource',
  visibility  = 'authenticated',
  description = "Fetch a local resource by URI via the agent's pseudo-pod backing",
} = {}) {
  if (typeof read !== 'function') {
    throw Object.assign(
      new Error('makeFetchResourceSkill: `read` must be a function'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (groupCheck !== null && typeof groupCheck !== 'function') {
    throw Object.assign(
      new Error('makeFetchResourceSkill: `groupCheck` must be a function when supplied'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (capCheck !== null && typeof capCheck !== 'function') {
    throw Object.assign(
      new Error('makeFetchResourceSkill: `capCheck` must be a function when supplied'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

  const handler = async ({ parts, from, envelope, agent }) => {
    const uri = _extractUri(parts);
    if (!uri) {
      throw Object.assign(
        new Error(`${id}: requires { uri: string }`),
        { code: 'INVALID_ARGUMENT' },
      );
    }

    // Peer-fetch gates. Both opt-in; when either is
    // supplied, at least one must pass before the read happens.
    // When neither is supplied, we fall back to trust-the-transport
    // (the caller is past SecurityLayer's hello already).
    if (groupCheck || capCheck) {
      const ctx = {
        from,
        envelope,
        agent,
        parts,
        capToken: _extractCapToken(parts),
      };
      let allowed = false;
      let groupResult, capResult;
      if (groupCheck) {
        try {
          groupResult = await groupCheck(uri, ctx);
          if (groupResult) allowed = true;
        } catch (err) {
          // A check throwing is treated as a hard "deny" — apps that
          // want soft-fail should catch internally.
          throw Object.assign(
            new Error(`${id}: groupCheck failed for ${uri}: ${err?.message ?? err}`),
            { code: 'FORBIDDEN', uri, cause: err },
          );
        }
      }
      if (!allowed && capCheck) {
        try {
          capResult = await capCheck(uri, ctx);
          if (capResult) allowed = true;
        } catch (err) {
          throw Object.assign(
            new Error(`${id}: capCheck failed for ${uri}: ${err?.message ?? err}`),
            { code: 'FORBIDDEN', uri, cause: err },
          );
        }
      }
      if (!allowed) {
        throw Object.assign(
          new Error(`${id}: caller is not authorised to fetch ${uri}`),
          { code: 'FORBIDDEN', uri },
        );
      }
    }

    let value;
    try {
      value = await read(uri);
    } catch (err) {
      throw Object.assign(
        new Error(`${id}: read failed for ${uri}: ${err?.message ?? err}`),
        { code: 'NOT_READABLE', uri, cause: err },
      );
    }

    if (value === undefined || value === null) {
      throw Object.assign(
        new Error(`${id}: no resource at ${uri}`),
        { code: 'NOT_FOUND', uri },
      );
    }

    // Allow callers to return either a raw value or `{ bytes, etag }`
    // for storage layers that track etags. Normalise to a uniform shape.
    let bytes, etag;
    if (value && typeof value === 'object' && 'bytes' in value) {
      bytes = value.bytes;
      etag  = value.etag;
    } else {
      bytes = value;
    }

    return [DataPart({ uri, bytes, ...(etag != null ? { etag } : {}) })];
  };

  return defineSkill(id, handler, {
    description,
    visibility,
    tags: ['core', 'pseudo-pod', 'storage'],
  });
}

/**
 * Pull a `uri` out of skill input parts.
 *
 * Accepts:
 *   - `[DataPart({ uri })]`
 *   - `[TextPart('the-uri')]`  (convenience — naked URI in a text part)
 *
 * @param {Array} parts
 * @returns {string|null}
 */
function _extractUri(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return null;
  for (const p of parts) {
    if (p?.type === 'DataPart' && typeof p.data?.uri === 'string') return p.data.uri;
    if (p?.type === 'TextPart' && typeof p.text === 'string')      return p.text;
  }
  return null;
}

/**
 * Pull an optional `capToken` out of skill input parts. Returns
 * `undefined` if the caller didn't supply one.
 *
 * @param {Array} parts
 * @returns {*|undefined}
 */
function _extractCapToken(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return undefined;
  for (const p of parts) {
    if (p?.type === 'DataPart' && p.data?.capToken !== undefined) return p.data.capToken;
  }
  return undefined;
}
