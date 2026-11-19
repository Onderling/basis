/**
 * PodImporter — restore a portable archive (produced by PodExporter) into
 * a (possibly different) Solid pod.  Track C / C3.
 *
 * Limitations (v1):
 *   - ACL re-establishment is OUT OF SCOPE.  This writes resource bytes
 *     only; Solid ACP/WAC handling is a follow-up.
 *   - Container creation is implicit — Solid servers create parent
 *     containers on first PUT; if your server doesn't, this will surface
 *     as per-entry errors in the result.
 *
 * TODO(C3-followup): ACL re-establishment.
 */
import { secretboxOpen } from '@onderling/core';   // secretbox behind the port a shell may speed up (L619)

import { Bootstrap } from '@onderling/core';
import { __archive } from './PodExporter.js';

const { ENC_INFO, decodeEntries, unframe, base64ToBytes } = __archive;

/**
 * Restores a portable archive produced by `PodExporter` into a (possibly different) Solid pod.
 * Decrypts the archive via the supplied `Bootstrap` when it is encrypted, writes each entry under
 * `podRoot`, and collects per-entry errors into the returned summary. ACL re-establishment is out
 * of scope in v1 — only resource bytes are written.
 */
export class PodImporter {
  /** @type {object} */ #podClient;
  /** @type {string} */ #podRoot;
  /** @type {Bootstrap | null} */ #bootstrap;

  /**
   * @param {object}    opts
   * @param {object}    opts.podClient   — `PodClient` instance.
   * @param {string}    opts.podRoot     — target pod root (trailing slash).
   * @param {Bootstrap} [opts.bootstrap] — required when archive is encrypted.
   */
  constructor({ podClient, podRoot, bootstrap = null } = {}) {
    if (!podClient || typeof podClient.write !== 'function') {
      throw new Error('PodImporter: podClient with .write is required');
    }
    if (typeof podRoot !== 'string' || podRoot.length === 0) {
      throw new Error('PodImporter: podRoot is required');
    }
    if (bootstrap !== null && !(bootstrap instanceof Bootstrap)) {
      throw new Error('PodImporter: bootstrap must be a Bootstrap instance');
    }
    this.#podClient = podClient;
    this.#podRoot   = podRoot.endsWith('/') ? podRoot : `${podRoot}/`;
    this.#bootstrap = bootstrap;
  }

  /**
   * Parse the archive, decrypt if needed, write each entry to the target
   * pod.  Errors are collected per-entry; the call resolves with a summary.
   *
   * @param   {Uint8Array} archiveBytes
   * @param   {object}    [opts]
   * @param   {boolean}   [opts.continueOnError=true]
   * @returns {Promise<{ entriesWritten: number, errors: Array<{ path: string, error: string }>, header: object }>}
   */
  async import(archiveBytes, opts = {}) {
    const continueOnError = opts.continueOnError !== false;
    const { header, body } = unframe(archiveBytes);

    let plaintext;
    if (header.encrypted) {
      if (!this.#bootstrap) {
        throw new Error('PodImporter.import: archive is encrypted but no bootstrap was provided');
      }
      const enc = header.encryption;
      if (!enc || enc.alg !== 'xsalsa20poly1305' || !enc.salt || !enc.nonce) {
        throw new Error('PodImporter.import: header.encryption is missing or unsupported');
      }
      const salt  = base64ToBytes(enc.salt);
      const nonce = base64ToBytes(enc.nonce);
      const key   = this.#bootstrap.deriveResourceKey(ENC_INFO, salt);
      const open  = secretboxOpen(body, nonce, key);
      if (!open) {
        throw new Error('PodImporter.import: decryption failed (wrong bootstrap or tampered archive)');
      }
      plaintext = open;
    } else {
      plaintext = body;
    }

    const entries = decodeEntries(plaintext, header.entryCount);

    let entriesWritten = 0;
    const errors = [];
    for (const entry of entries) {
      const targetUri = this.#absolutePath(entry.path);
      try {
        await this.#podClient.write(targetUri, entry.content, {
          contentType: entry.contentType,
          force: true,
        });
        entriesWritten += 1;
      } catch (err) {
        errors.push({ path: entry.path, error: err?.message || String(err) });
        if (!continueOnError) break;
      }
    }

    return { entriesWritten, errors, header };
  }

  #absolutePath(relativePath) {
    if (typeof relativePath !== 'string') return relativePath;
    if (/^https?:\/\//i.test(relativePath)) return relativePath;
    const rel = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
    return this.#podRoot + rel;
  }
}
