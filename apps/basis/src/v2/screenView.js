/**
 * screenView — a SCREEN connecting to a household bot (the person's own app, in a browser, with no account of its own).
 *
 * The person typed `/scherm` and got a one-time link (the bot's address, its relay, a nonce). Opened here:
 *   1. the link is read and NOTHING is sent: the shell shows which bot, and waits for the person's tap (a preview
 *      service that opens the page sends nothing);
 *   2. on the tap, a key for this browser (kept like a device key) sends the bot its offer over the relay, and the
 *      screen shows the CODE — the fingerprint of its key and the link's nonce — which the bot shows the person in their
 *      private chat with "is this the code on your screen?";
 *   3. after their yes the bot's grant arrives (one capability token per op of the person's role, acting as them); it is
 *      checked (`acceptConnectionGrant`) and kept, so a later visit acts without pairing again;
 *   4. the screen acts by calling the bot's ops with those tokens (`sa.peer.invoke`) — the bot's door decides each call
 *      as the person, the same gate as their typed line.
 *
 * Pure composition: the secure agent is made by the shell (`makeAgent`, a persistent key for this browser), the
 * tokens are kept in the shell's storage. Nothing here touches a page.
 */
import { DataPart } from '@onderling/core';
import { encodePairingOffer, acceptConnectionGrant, CONNECTION_GRANT_SUBTYPE } from './connectionPairing.js';
import { parseScreenLink, screenCode } from './botScreens.js';

/** The peer-message subtype a screen's offer travels as (the bot's router takes it). */
export const SCREEN_OFFER_SUBTYPE = 'screen-offer';

const storeKey = (botAddress) => `onderling.screen.${botAddress}`;

/**
 * Is this address a screen's? `#scherm=<link>` (pairing: the one-time link) or `#scherm-bot=<address>` (a later visit:
 * the address bar keeps only the bot's address — the link's secret is removed as soon as it is read).
 */
export function isScreenAddress(hash) {
  return /#scherm(?:-bot)?=/.test(String(hash ?? ''));
}
/** The address a screen keeps in its address bar once the link is read: the bot's, no secret. */
export const screenAddressFor = (botAddress) => `#scherm-bot=${encodeURIComponent(botAddress)}`;

/**
 * @param {object} a
 * @param {string} a.link  the address the screen was opened at (its `#scherm=` fragment), or a stored bot address
 * @param {() => Promise<object>} a.makeAgent  a secure agent (`createSecureAgent`, `transportMode: 'relay'`) with this browser's
 *   persistent key
 * @param {{getItem: Function, setItem: Function, removeItem?: Function}} a.storage  where the grant is kept
 */
export function createScreenView({ link, makeAgent, storage }) {
  const load = (botAddress) => { try { return JSON.parse(storage.getItem(storeKey(botAddress)) ?? 'null'); } catch { return null; } };
  // a later visit (`#scherm-bot=`): the bot's address, and the relay from the grant this browser kept
  const resolve = () => {
    const kept = /#scherm-bot=([^&]+)/.exec(String(link ?? ''));
    if (!kept) return parseScreenLink(link);
    const botAddress = decodeURIComponent(kept[1]);
    const rec = load(botAddress);
    return rec ? { ok: true, botAddress, relayUrl: rec.relayUrl ?? null, nonce: null, resumeOnly: true } : { ok: false, reason: 'no-kept-grant' };
  };
  const parsed = resolve();
  const kept = () => (parsed.ok ? load(parsed.botAddress) : null);
  let sa = null;
  let granted = null;          // { tokens, label, botAddress }
  let resolveGrant = null;
  const grantArrived = new Promise((resolve) => { resolveGrant = resolve; });

  return {
    /** What the link says (bot address, relay): `{ok, botAddress, relayUrl}` or `{ok: false, reason}`. No secret in it. */
    get link() { return parsed.ok ? { ok: true, botAddress: parsed.botAddress, relayUrl: parsed.relayUrl, botName: parsed.botName ?? kept()?.botName ?? null, resumeOnly: Boolean(parsed.resumeOnly) } : parsed; },

    /** A grant this browser already holds for this bot (a later visit), or null. */
    stored: () => (parsed.ok ? load(parsed.botAddress) : null),

    /**
     * The person tapped "connect": the key, the relay, the offer — and the code to compare in their chat. Resolves once
     * the offer is sent; `granted()` resolves when the bot's grant arrives (after the person's yes).
     * @returns {Promise<{code: string}>}
     */
    async connect({ label = null } = {}) {
      if (!parsed.ok || parsed.resumeOnly) throw new Error(`screenView: not a screen link (${parsed.reason ?? 'a kept grant resumes, it does not pair'})`);
      sa = await makeAgent();
      const viewPubKey = sa.agent.pubKey;
      await sa.relay.connect({
        relayUrl: parsed.relayUrl,
        onPeerMessage: ({ payload } = {}) => {
          if (payload?.subtype !== CONNECTION_GRANT_SUBTYPE) return;
          const r = acceptConnectionGrant(payload, { nonce: parsed.nonce, viewPubKey });
          if (!r.ok) return;
          granted = { botAddress: parsed.botAddress, relayUrl: parsed.relayUrl, botName: parsed.botName ?? null, tokens: r.tokens, label: r.label ?? null };
          try { storage.setItem(storeKey(parsed.botAddress), JSON.stringify(granted)); } catch { /* kept for this visit only */ }
          resolveGrant(granted);
        },
      });
      const offer = encodePairingOffer({ viewPubKey, relayUrl: parsed.relayUrl, nonce: parsed.nonce, label });
      await sa.peer.sendTo(parsed.botAddress, { subtype: SCREEN_OFFER_SUBTYPE, offer });
      return { code: await screenCode(viewPubKey, parsed.nonce) };
    },

    /** A later visit: this browser's key and the grant it kept, back on the relay — no pairing again. */
    async resume() {
      const kept = parsed.ok ? load(parsed.botAddress) : null;
      if (!kept) return false;
      sa = await makeAgent();
      await sa.relay.connect({ relayUrl: parsed.relayUrl });
      granted = kept;
      resolveGrant(granted);
      return true;
    },

    /** Resolves with the grant once the bot sent it (the person said yes). */
    granted: () => grantArrived,

    /** The ops this screen may call (`app.op`), from the grant. */
    ops: () => (granted?.tokens ?? []).map((t) => t.skill),

    /**
     * Call one of the bot's ops as the person (the bot's door decides it). Returns the op's answer.
     * @param {string} skill  `app.op`
     * @param {object} [args]
     */
    async call(skill, args = {}) {
      if (!granted) throw new Error('screenView: not connected');
      const token = granted.tokens.find((t) => t.skill === skill);
      if (!token) throw new Error(`screenView: no grant for ${skill}`);
      const parts = await sa.peer.invoke(granted.botAddress, skill, [DataPart(args)], { token });
      const data = (parts ?? []).map((p) => p?.data ?? p?.content).find((d) => d && typeof d === 'object');
      return data ?? null;
    },
  };
}
