// SealedPodClient — transparent seal-on-write / open-on-read over any PodClient-shaped client.
//
// Only resource BODIES are sealed; structure (uris, containers, ACLs, etags) stays cleartext, so Solid
// semantics + the host's request-driven serving are unchanged — the host stores ciphertext it can't
// read (P2/P3). Content is treated as an opaque string: the caller serializes (pass a string to write;
// get the opened string back from read), matching how `project-seal` is used.
//
// The seal/open STRATEGY is injected (recipient-wrap or group-key) so key custody lives outside (e.g.
// @canopy/vault): the writer needs only public keys (or the group key); the reader needs a private key
// (or the group key). `open` passes plaintext through, so a pod with mixed sealed/legacy data still reads.

import {
  seal as recipientSeal, open as recipientOpen,
  sealWithGroupKey, openWithGroupKey,
} from './envelope.js';

/**
 * @param {object} inner   a PodClient (or compatible: read/write/append/list/...)
 * @param {{ seal: (text:string)=>string, open: (text:string)=>string }} strategy
 */
export function createSealedPodClient(inner, strategy) {
  if (!inner || typeof inner.read !== 'function' || typeof inner.write !== 'function') {
    throw new Error('createSealedPodClient: a PodClient with read/write is required');
  }
  if (!strategy || typeof strategy.seal !== 'function' || typeof strategy.open !== 'function') {
    throw new Error('createSealedPodClient: a { seal, open } strategy is required');
  }
  const { seal, open } = strategy;

  const api = {
    /** Seal the body, then write. Content is serialized to a string first (caller owns the shape). */
    async write(uri, content, opts = {}) {
      return inner.write(uri, seal(String(content)), opts);
    },
    /** Read raw (the sealed envelope is text), then open. Plaintext passes through. */
    async read(uri, opts = {}) {
      const res = await inner.read(uri, { ...opts, decode: 'text' });
      return { ...res, content: open(res?.content) };
    },
    /** Seal each appended line (one envelope per line). */
    async append(uri, line, opts = {}) {
      if (typeof inner.append !== 'function') throw new Error('SealedPodClient: inner has no append');
      return inner.append(uri, seal(String(line)), opts);
    },
    /** Expose the strategy so callers can seal/open out-of-band (e.g. a sealed index blob). */
    seal, open,
  };

  // Forward the rest of the surface unchanged — structure ops + event plumbing don't touch bodies.
  for (const m of ['list', 'patch', 'createContainer', 'delete', 'deleteLocal', 'close',
                   'on', 'off', 'once', 'removeAllListeners', 'listenerCount']) {
    if (typeof inner[m] === 'function' && !(m in api)) {
      api[m] = (...args) => inner[m](...args);
    }
  }
  api.inner = inner;
  return api;
}

/** Recipient-wrap strategy: seal to public keys (host-blind writer), open with a private key. */
export function recipientStrategy({ recipients, privateKey } = {}) {
  return {
    seal: (text) => {
      if (!recipients || (Array.isArray(recipients) && recipients.length === 0)) {
        throw new Error('recipientStrategy: recipients (public keys) required to seal');
      }
      return recipientSeal(text, recipients);
    },
    open: (text) => {
      if (!privateKey) throw new Error('recipientStrategy: a private key is required to open');
      return recipientOpen(text, privateKey);
    },
  };
}

/** Group-key strategy: seal/open under one shared symmetric key (the household shared pod). */
export function groupKeyStrategy({ groupKey } = {}) {
  if (!groupKey) throw new Error('groupKeyStrategy: a group key is required');
  return {
    seal: (text) => sealWithGroupKey(text, groupKey),
    open: (text) => openWithGroupKey(text, groupKey),
  };
}
