/**
 * The agent a SCREEN runs in a browser (the web app opened from a household bot's `/scherm` link): a bare secure agent
 * on the relay, its key kept in this browser (like a device key) — no person's identity, no pods, no circles. What the
 * screen does with it is `src/v2/screenView.js`.
 */
import { createSecureAgent, makeBrowserVault } from '@onderling/secure-agent';

export const makeBrowserScreenAgent = () => createSecureAgent({ vault: makeBrowserVault('onderling-screen:'), transportMode: 'relay', warnOnInsecure: false });
