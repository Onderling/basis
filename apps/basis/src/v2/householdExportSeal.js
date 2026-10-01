/**
 * householdExportSeal — the household's export file, sealed so the box can WRITE it every night but not READ it.
 *
 * The admin chooses a passphrase once, on the box itself (`bin/export-key.mjs set` — never through a chat: a bot's
 * chat passes through Telegram's servers and the bot's own thread memory). From it:
 *   - a fresh key (a core `Bootstrap`, its export key derived by label) — the box keeps only its PUBLIC half, and
 *     seals each night's file to it;
 *   - that key, sealed with the passphrase in core's `CloudBackup` envelope (argon2id + xsalsa20poly1305, the one the
 *     profile-registry export uses) — carried inside every sealed file, so a file opens on its own, even on a new
 *     box after the old one is gone.
 * Opening a file takes the passphrase (`bin/export-key.mjs unlock`): it leaves the opened key on the box for a short
 * while, for the admin's `/import`, and the import removes it.
 */
import nacl from 'tweetnacl';
import { Bootstrap, CloudBackup } from '@onderling/core';

export const SEALED_FORMAT = 'onderling-household-export-sealed';
const KEY_LABEL = 'household-export';
// base64 in every shell (a browser has no Buffer)
const enc = (u8) => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
const dec = (s) => Uint8Array.from(atob(String(s ?? '')), (c) => c.charCodeAt(0));

/** One-shot in-memory CloudAdapter — the sealed envelope's bytes, no cloud (as `exportRegistry` does). */
function bytesAdapter(initial = null) {
  let bytes = initial;
  return { async put(_ref, b) { bytes = b; return b; }, async get() { return bytes; }, bytes: () => bytes };
}

const boxKeyOf = (bootstrap) => nacl.box.keyPair.fromSecretKey(bootstrap.deriveAgentSeed(KEY_LABEL).slice(0, 32));

/**
 * A new export key, from the admin's passphrase: what the box keeps (`publicKey`) and what every file carries
 * (`sealedSecret`, opened only with the passphrase).
 * @param {{passphrase: string, argonOpts?: object}} a
 * @returns {Promise<{v: 1, publicKey: string, sealedSecret: string}>}
 */
export async function createExportKey({ passphrase, argonOpts } = {}) {
  if (typeof passphrase !== 'string' || passphrase.length < 8) throw new Error('export-key: a passphrase of at least 8 characters is required');
  const { bootstrap } = Bootstrap.create();
  const adapter = bytesAdapter();
  await new CloudBackup({ adapter, ...(argonOpts ? { argonOpts } : {}) }).upload({ bootstrap, passphrase });
  return { v: 1, publicKey: enc(boxKeyOf(bootstrap).publicKey), sealedSecret: enc(adapter.bytes()) };
}

/**
 * The key's secret half, opened with the passphrase — from the box's key, or from any sealed file (it carries it).
 * @returns {Promise<string>} the secret key (base64); throws `wrong-passphrase` when it does not open
 */
export async function unlockExportKey({ key, passphrase, argonOpts } = {}) {
  const sealedSecret = key?.sealedSecret ?? key?.key?.sealedSecret;
  if (!sealedSecret) throw new Error('export-key: no sealed key');
  let bootstrap;
  try { ({ bootstrap } = await new CloudBackup({ adapter: bytesAdapter(dec(sealedSecret)), ...(argonOpts ? { argonOpts } : {}) }).restore({ passphrase })); }
  catch { throw new Error('wrong-passphrase'); }
  return enc(boxKeyOf(bootstrap).secretKey);
}

/** Is this a sealed export (and not a plain one)? */
export const isSealedExport = (o) => Boolean(o && typeof o === 'object' && o.format === SEALED_FORMAT);

/**
 * Seal an export file to the key's public half (a fresh sender key per file). The box needs nothing secret for this.
 * @param {object} file  the plain export
 * @param {{publicKey: string, sealedSecret: string}} key
 */
export function sealExport(file, key) {
  const eph = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const body = nacl.box(new TextEncoder().encode(JSON.stringify(file)), nonce, dec(key.publicKey), eph.secretKey);
  return { format: SEALED_FORMAT, v: 1, exportedAt: file?.exportedAt ?? null, key: { publicKey: key.publicKey, sealedSecret: key.sealedSecret }, from: enc(eph.publicKey), nonce: enc(nonce), sealed: enc(body) };
}

/**
 * Open a sealed export with the key's secret half (from `unlockExportKey`).
 * @returns {object} the plain export; throws `not-this-key` when the key does not open it
 */
export function openExport(sealedFile, secretKey) {
  const plain = nacl.box.open(dec(sealedFile.sealed), dec(sealedFile.nonce), dec(sealedFile.from), dec(secretKey));
  if (!plain) throw new Error('not-this-key');
  return JSON.parse(new TextDecoder().decode(plain));
}
