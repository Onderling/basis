/**
 * Restoring an identity from its 24-word phrase — ONE implementation, two doors.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────────────────────────────────
 * There were two restore paths and only one of them restored anything.
 *
 *   • The in-app wizard → `callSkill('household', 'restoreOwnerPhrase')` → **correct**: it writes the owner
 *     root and re-derives the default profile from it.
 *   • The FIRST-RUN door ("I have a recovery phrase" on the welcome screen) →
 *     `basis-mobile/src/core/restoreFromMnemonic.js` → **wrong**: it wrote only the chat vault, from the
 *     mnemonic's raw entropy, and never touched the owner root. The next boot found an empty owner-root
 *     vault, minted a fresh RANDOM root, and re-keyed every per-circle address.
 *
 * The cruel part is which door a real person reaches. Someone reinstalling the app has no identity yet, so
 * the working wizard is unreachable — **the only door available to them was the broken one.** And
 * `realAgent.js` already knew: its `restoreOwnerPhrase` comment says "NOT the shared `restoreFromMnemonic`
 * (legacy direct-seed)". The trap was documented and left wired up.
 *
 * So the restore is defined once, here, and both doors call it. A second implementation of "restore an
 * identity" is not a duplication problem, it is a losing-someone's-identity problem.
 *
 * ── What a restore IS ────────────────────────────────────────────────────────────────────────────────────
 * Exactly two writes, in this order:
 *   1. the owner root phrase — the ONE secret per install; everything else derives from it;
 *   2. the default profile's chat identity, derived from that root via `deriveAgentSeed('default')`.
 *
 * Write 2 is not optional and is not merely a cache: without it a stale chat identity from a previous
 * install would be picked up on the next boot in preference to the restored one.
 */

import { Bootstrap, AgentIdentity } from '@onderling/core';

/** The vault key the owner root phrase lives under. One name, so the two doors cannot disagree. */
export const OWNER_PHRASE_KEY = 'owner-phrase';

/** The profile the chat identity is derived from. */
export const DEFAULT_PROFILE = 'default';

/**
 * Restore an identity from its recovery phrase.
 *
 * Pure orchestration over two injected vaults, so it runs identically at first-run (no agent exists yet)
 * and from inside a booted agent.
 *
 * @param {object} a
 * @param {string} a.mnemonic         the 24-word phrase, already normalised by the caller
 * @param {object} a.ownerRootVault   vault for the owner root (`cc-owner-root:`)
 * @param {object} a.chatVault        vault for the default profile's chat identity (`cc-chat-id:`)
 * @returns {Promise<{ok: true, pubKey: string} | {ok: false, code: string, detail?: string}>}
 */
export async function restoreOwnerRoot({ mnemonic, ownerRootVault, chatVault } = {}) {
  if (typeof mnemonic !== 'string' || !mnemonic.trim()) return { ok: false, code: 'empty' };
  if (!ownerRootVault || !chatVault) return { ok: false, code: 'no-vault' };

  let root;
  try { root = Bootstrap.fromMnemonic(mnemonic.trim()); }
  catch { return { ok: false, code: 'invalid' }; }

  try {
    // 1. The root itself. Written FIRST: if step 2 fails, a boot still recovers the right identity from
    //    the phrase, where the reverse order would leave a chat key with no root to justify it.
    await ownerRootVault.set(OWNER_PHRASE_KEY, root.toMnemonic());
    // 2. The default profile, derived — never from the mnemonic's raw entropy. That was the other half of
    //    the bug: the chat key is a CHILD of the root (`deriveAgentSeed`), not the root re-encoded.
    const identity = await AgentIdentity.fromSeed(root.deriveAgentSeed(DEFAULT_PROFILE), chatVault);
    return { ok: true, pubKey: identity?.pubKey ?? null };
  } catch (err) {
    return { ok: false, code: 'storage', detail: err?.message ?? String(err) };
  }
}
