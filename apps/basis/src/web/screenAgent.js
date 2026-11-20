/**
 * The agent a SCREEN runs in a browser (the web app opened from a household bot's `/scherm` link): a bare secure agent
 * on the relay, its key kept in this browser (like a device key) — no person's identity, no pods, no circles. What the
 * screen does with it is `src/v2/screenView.js`.
 */
import { createSecureAgent, makeBrowserVault } from '@onderling/secure-agent';

export const makeBrowserScreenAgent = () => createSecureAgent({ vault: makeBrowserVault('onderling-screen:'), transportMode: 'relay', warnOnInsecure: false });

/**
 * This screen's key and grants in this browser, forgotten (L1115): for a key that is there but will not read, which is
 * never replaced on its own. The screen is a view with no identity of its own, so a new key and a new pairing lose
 * nothing; the grant at the bot ends by its own time or `/schermen los`.
 * @param {Storage} [storage]
 * @returns {number} how many entries were removed
 */
export function forgetScreenKey(storage = globalThis.localStorage) {
  const keys = [];
  try { for (let i = 0; i < storage.length; i += 1) { const k = storage.key(i); if (k && (k.startsWith('onderling-screen:') || k.startsWith('onderling.screen.'))) keys.push(k); } } catch { return 0; }
  for (const k of keys) { try { storage.removeItem(k); } catch { /* the rest still go */ } }
  return keys.length;
}
