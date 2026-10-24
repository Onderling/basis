/**
 * wireBotChannel — Tasks chat-bot wiring.
 *
 * Mirrors the retired household agent's start() shape, but
 * for Tasks's surface. Generic over `MessagingBridge` instances —
 * works with `chat-agent.TelegramBridge` (production), `chat-agent.InMemoryBridge`
 * (tests), or any other MessagingBridge a future app introduces.
 *
 * Caller supplies a `chatBindings: {<chatId>: <webid>}` map (typically
 * sourced from the circle config under `circle.bot.chatBindings`). When
 * the bot receives a message:
 *   1. Look up the sender's chatId in the bindings.
 *   2. If unbound: reply with a friendly "you're not bound to a webid"
 *      hint + the chatId so the admin can add it.
 *   3. Parse the text via `dispatch()`.
 *   4. Invoke the matching `bot.*` skill with `from = boundWebid`.
 *   5. Post the result text + buttons back via `bridge.sendReply`.
 *
 * Returns `{detach}` so apps can stop the bridge handlers cleanly on
 * circle shutdown.
 */

import { dispatch } from './dispatch.js';

/**
 * @param {object} args
 * @param {object} args.agent         — the Tasks agent (for skills.get)
 * @param {Array<{bridge: object, name?: string}>} args.bridges
 * @param {Object<string, string> | (() => Object<string, string>)} args.chatBindings
 *   Maps `chatId` → webid. Pass a function if the binding map can
 *   change at runtime (e.g. via the setBotChatBinding skill).
 * @param {object} [args.botAgentRegistry]
 *   when supplied, bindings that have a cap-token (queried via
 *   `botAgentRegistry.get(chatId)`) dispatch via the bot agent's
 *   `invoke()` so PolicyEngine actually verifies the held token.
 *   Bindings WITHOUT a token fall back to the legacy direct-call
 *   path. Without a registry, all dispatch is direct (baseline).
 * @returns {Promise<{detach: () => Promise<void>}>}
 */
export async function wireBotChannel({ agent, bridges, chatBindings, botAgentRegistry }) {
  if (!agent?.skills?.get) throw new TypeError('wireBotChannel: agent required');
  if (!Array.isArray(bridges) || bridges.length === 0) {
    throw new TypeError('wireBotChannel: bridges[] required');
  }
  if (typeof chatBindings !== 'function'
      && (!chatBindings || typeof chatBindings !== 'object')) {
    throw new TypeError('wireBotChannel: chatBindings (object or () => object) required');
  }
  const bindingsOf = typeof chatBindings === 'function'
    ? () => (chatBindings() ?? {})
    : () => chatBindings;

  /** Per-bridge handler attached at start. */
  const attached = [];

  async function handleIncoming(msg, bridge) {
    if (!msg || typeof msg.text !== 'string') return;
    const chatId = String(msg.chatId ?? '');
    const webid  = bindingsOf()[chatId];

    if (!webid) {
      await bridge.sendReply({
        chatId,
        text: `You're not bound to a webid yet. An admin can add you with chatId \`${chatId}\`.`,
      });
      return;
    }

    const action = dispatch(msg.text);
    if (action.kind === 'reply') {
      await bridge.sendReply({ chatId, text: action.text });
      return;
    }
    if (action.kind === 'unknown') {
      await bridge.sendReply({
        chatId,
        text: 'Sorry, I didn\'t understand. Type `help` for the command list.',
      });
      return;
    }
    // action.kind === 'skill'
    const def = agent.skills.get(action.skillId);
    if (!def) {
      await bridge.sendReply({
        chatId,
        text: `Internal error: bot skill \`${action.skillId}\` is not registered. (Tip: start with \`--circle\` so V1.5 bot.* skills register.)`,
      });
      return;
    }

    // cap-token mode if a bot agent + held token exists for
    // this chatId, else legacy direct-call. The two paths return the
    // same shape (`{text, buttons?}`) so downstream is uniform.
    const entry = botAgentRegistry?.get(chatId) ?? null;
    let reply;
    try {
      if (entry) {
        const parts = await entry.agent.invoke(
          agent.address,
          action.skillId,
          [{ type: 'DataPart', data: action.args }],
          { timeout: 15_000 },
        );
        // Skill replies wrap the JSON return value into a single
        // DataPart. Unwrap it the same way agent.call consumers do.
        const dp = (parts ?? []).find((p) => p?.type === 'DataPart');
        reply = dp?.data ?? {};
      } else {
        reply = await def.handler({
          parts:    [{ type: 'DataPart', data: action.args }],
          from:     webid,
          agent,
          envelope: null,
        });
      }
    } catch (err) {
      // Most commonly: PermissionDeniedError from the role-policy gate
      // (legacy path) or PolicyDeniedError (cap-token path).
      reply = { text: `Error: ${err?.message ?? String(err)}` };
    }
    if (!reply?.text) {
      await bridge.sendReply({ chatId, text: '(no reply text)' });
      return;
    }
    await bridge.sendReply({
      chatId,
      text: reply.text,
      ...(reply.buttons ? { buttons: reply.buttons } : {}),
    });
  }

  for (const entry of bridges) {
    const bridge = entry.bridge;
    if (!bridge?.onMessage || !bridge?.sendReply) {
      throw new TypeError(`wireBotChannel: bridge "${entry.name ?? '?'}" missing onMessage/sendReply`);
    }
    if (typeof bridge.start === 'function') await bridge.start();
    bridge.onMessage((msg) => handleIncoming(msg, bridge));
    attached.push(bridge);
  }

  return {
    async detach() {
      for (const bridge of attached) {
        try { if (typeof bridge.stop === 'function') await bridge.stop(); } catch { /* noop */ }
        // No formal "off" on MessagingBridge in V1; bridges are
        // expected to no-op once stopped. This mirrors household's
        // shape.
      }
    },
  };
}
