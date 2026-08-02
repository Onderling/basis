/**
 * 5.9b-followup — boot-time BIP39 restore on mobile.
 *
 * Pure orchestrator that takes a user-typed 24-word BIP39 mnemonic,
 * validates it (BIP39 wordlist + checksum), and seeds the chat-side
 * vault with the derived Ed25519 keypair under the same key that
 * `bootAgentBundle` consults on the NEXT boot (`cc-chat-id:agent-privkey`).
 *
 * Once this resolves with { ok: true } the caller flips the first-run
 * gate to 'dismissed' and lets bootAgentBundle proceed — it will find
 * the seeded vault and use it instead of generating a fresh keypair.
 *
 * Errors map to a stable `code` so the UI can render a localized
 * message without depending on the underlying BIP39 library's wording:
 *
 *   - 'empty'         — input is empty or whitespace
 *   - 'wrong-length'  — not 24 words
 *   - 'invalid'       — fails BIP39 wordlist or checksum check
 *   - 'storage'       — AsyncStorage threw while persisting
 *
 * The helper is pure (DI'd AsyncStorage) so vitest covers the full
 * decision tree against a Map-backed mock — no RN runtime needed.
 */
import { validateMnemonic } from '@onderling/core';
import { VaultAsyncStorage } from '@onderling/react-native/identity/VaultAsyncStorage';
import { restoreOwnerRoot } from '../../../basis/src/core/agent/ownerRootRestore.js';

const REQUIRED_WORDS = 24;
const CHAT_VAULT_PREFIX = 'cc-chat-id:';
// Must match `realAgent`'s owner-root vault prefix — a restore that writes the phrase anywhere else is a
// restore that silently does nothing.
const OWNER_ROOT_VAULT_PREFIX = 'cc-owner-root:';

/**
 * Restore the chat-side identity from a user-typed mnemonic.
 *
 * @param {object} opts
 * @param {string} opts.mnemonic              — raw text (will be trimmed + collapsed)
 * @param {object} opts.asyncStorage          — AsyncStorage adapter
 * @returns {Promise<{ok: true} | {ok: false, code: string}>}
 */
export async function restoreFromMnemonic({ mnemonic, asyncStorage }) {
  const normalized = normalizeMnemonic(mnemonic);
  if (!normalized) return { ok: false, code: 'empty' };

  const words = normalized.split(' ');
  if (words.length !== REQUIRED_WORDS) {
    return { ok: false, code: 'wrong-length' };
  }
  if (!validateMnemonic(normalized)) {
    return { ok: false, code: 'invalid' };
  }

  // 2026-08-02 — this used to write ONLY the chat vault, from the mnemonic's raw entropy, and never
  // touched the owner root. The next boot then found an empty owner-root vault, minted a fresh RANDOM
  // root, and re-keyed every per-circle address — so the phrase restored nothing that mattered, and the
  // 24 words the app would show next were neither the typed ones nor the new root's. Since a reinstaller
  // has no identity yet, the working in-app wizard was unreachable and this was the ONLY door they had.
  // Now it runs the same `restoreOwnerRoot` the wizard's skill runs.
  const r = await restoreOwnerRoot({
    mnemonic: normalized,
    ownerRootVault: new VaultAsyncStorage({ prefix: OWNER_ROOT_VAULT_PREFIX, asyncStorage }),
    chatVault:      new VaultAsyncStorage({ prefix: CHAT_VAULT_PREFIX,       asyncStorage }),
  });
  if (!r.ok) return { ok: false, code: r.code === 'invalid' ? 'invalid' : 'storage', detail: r.detail };
  return { ok: true };
}

/**
 * Trim, lowercase, and collapse internal whitespace so users can paste
 * with double spaces / line breaks / mixed case without surprises.
 */
export function normalizeMnemonic(input) {
  if (typeof input !== 'string') return '';
  return input.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}

/** Quick word-count read (no validation) — drives the live progress hint in the UI. */
export function countMnemonicWords(input) {
  const n = normalizeMnemonic(input);
  return n === '' ? 0 : n.split(' ').length;
}

export const MNEMONIC_WORD_COUNT = REQUIRED_WORDS;
export const CHAT_VAULT_KEY_PREFIX = CHAT_VAULT_PREFIX;
