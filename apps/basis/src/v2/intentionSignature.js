/**
 * intentionSignature — the proof a planned row in a CIRCLE's store carries of who wrote it.
 *
 * A circle row's `actsAs` is a field any member can write; the sync proves who SENT a snapshot, not who wrote the row.
 * So the author signs the row's canonical fields `{id, actsAs, op, args, trigger}` with their circle key (the key every
 * lane statement of theirs is signed with), and the signature travels WITH the row — live, by catch-up, from a sibling.
 * A host runs it as `actsAs` only when the signature verifies, the roster binds that key to the author's ref, and the
 * author is the one it acts as (a household's own rows: the host itself). Whether THIS host may act for that person is
 * the host's own rule beside it. A row in a person's own store needs none of this: the host wrote it.
 */
import { AgentIdentity, b64encode } from '@onderling/core';

const DOMAIN = 'onderling/intention-row/v1';

/** JSON with sorted keys, so one row has one message wherever it is serialised. */
function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
}

/** What the author signs: the row's canonical fields, domain-separated (this signature means nothing elsewhere). */
export const intentionMessage = (row) => `${DOMAIN}\n${stable({ id: row?.id ?? null, actsAs: row?.actsAs ?? null, op: row?.op ?? null, args: row?.args ?? {}, trigger: row?.trigger ?? null })}`;

/**
 * The row with its author's signature.
 * @param {object} row  a row with its id
 * @param {{identity: {pubKey: string, sign: Function}, ref: string}} signer  the author's circle key and member ref
 */
export function signIntention(row, { identity, ref }) {
  if (!row?.id) throw new Error('signIntention: the row needs its id before it is signed');
  return { ...row, authorSig: { key: identity.pubKey, ref, sig: b64encode(identity.sign(intentionMessage(row))) } };
}

/**
 * True, or why not: 'unsigned' · 'signature' · 'acts-as-another' · 'not-a-member-key'.
 * @param {object} row
 * @param {object} a
 * @param {string} a.circleId
 * @param {(b: {author: string, ref: string, circleId: string}) => Promise<boolean>|boolean} a.bindingOk   the roster's key↔ref binding
 * @param {(actsAs: string, ref: string) => boolean} [a.actsAsAllowed]   whom a signer may make a row act as (default: themselves)
 */
export async function verifyIntention(row, { circleId, bindingOk, actsAsAllowed = (actsAs, ref) => actsAs === ref }) {
  const s = row?.authorSig;
  if (!s || typeof s.key !== 'string' || typeof s.ref !== 'string' || typeof s.sig !== 'string') return 'unsigned';
  let ok = false;
  try { ok = AgentIdentity.verify(intentionMessage(row), s.sig, s.key); } catch { ok = false; }
  if (!ok) return 'signature';
  if (!actsAsAllowed(row.actsAs, s.ref)) return 'acts-as-another';
  let bound = false;
  try { bound = Boolean(await bindingOk({ author: s.key, ref: s.ref, circleId })); } catch { bound = false; }
  return bound ? true : 'not-a-member-key';
}
