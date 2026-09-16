/**
 * botBindings — admin management of `circle.bot.chatBindings`.
 *
 * Three skills:
 *
 *   - `getBotChatBindings()`            — admin/coordinator. Read.
 *   - `setBotChatBinding({chatId, webid})` — admin only. Add or
 *                                         overwrite a binding.
 *   - `removeBotChatBinding({chatId})`  — admin only. Remove one.
 *
 * Mutates `liveCircle.bot.chatBindings` through the same `circleMutator`
 * pattern circleControls / customRoles already use. Restart-survival
 * comes via the existing circle-config persistence (whatever path the
 * caller wired up) — these skills don't touch storage directly.
 *
 * Validation:
 *   - `chatId` must be a non-empty string. Telegram chatIds are
 *     numeric, but other bridges may use other shapes — we accept
 *     anything non-empty and let the bridge reject malformed ids
 *     at dispatch time.
 *   - `webid` must be a non-empty string AND be a known circle member.
 *     Binding to a non-member is almost certainly a typo; rejecting
 *     it early surfaces the mistake before the user wonders why
 *     their commands are silently denied.
 */

import { defineSkill } from '@onderling/core';

import { argsFromParts } from '../bundleResolver.js';
import { makeRoleOf } from './roleOf.js';

function liveBot(circle) {
  if (circle?.bot && typeof circle.bot === 'object') {
    const cb = circle.bot.chatBindings && typeof circle.bot.chatBindings === 'object'
      ? circle.bot.chatBindings
      : {};
    return { ...circle.bot, chatBindings: { ...cb } };
  }
  return { chatBindings: {} };
}

/**
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 */
export function buildBotBindingSkills({ bundleResolver, roleOf = makeRoleOf(null) } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildBotBindingSkills: bundleResolver(parts, ctx) required');
  }

  return [
    defineSkill('getBotChatBindings', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const role = await roleOf(circle, from);
      if (role !== 'admin' && role !== 'coordinator') {
        return { error: 'admin or coordinator required' };
      }
      const lc = circle.liveCircle ?? {};
      const bindings = lc.bot?.chatBindings ?? {};
      const botAgentRegistry = circle.botAgentRegistry;
      // Index any cap-token bindings by chatId for the mode column.
      const tokenIndex = new Map();
      if (botAgentRegistry) {
        for (const b of botAgentRegistry.list()) {
          tokenIndex.set(b.chatId, b);
        }
      }
      const now = Date.now();
      const items = Object.entries(bindings).map(([chatId, webid]) => {
        const tok = tokenIndex.get(chatId);
        if (!tok) return { chatId, webid, mode: 'trust' };
        if (tok.expiresAt <= now) {
          return {
            chatId, webid,
            mode:        'expired',
            tokenId:     tok.tokenId,
            issuedAt:    tok.issuedAt,
            expiresAt:   tok.expiresAt,
          };
        }
        return {
          chatId, webid,
          mode:        'cap-token',
          tokenId:     tok.tokenId,
          issuedAt:    tok.issuedAt,
          expiresAt:   tok.expiresAt,
        };
      });
      return { items, capTokenAvailable: !!botAgentRegistry };
    }, {
      description: 'Read the current bot.chatBindings map (with V1.5 cap-token status).',
      visibility:  'authenticated',
    }),

    defineSkill('setBotChatBinding', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const role = await roleOf(circle, from);
      if (role !== 'admin') return { error: 'admin required' };

      const a = argsFromParts(parts);
      if (typeof a.chatId !== 'string' || !a.chatId.trim()) {
        return { error: 'chatId required' };
      }
      if (typeof a.webid !== 'string' || !a.webid.trim()) {
        return { error: 'webid required' };
      }
      const chatId = a.chatId.trim();
      const webid  = a.webid.trim();

      const lc = circle.liveCircle ?? {};
      const isMember = (lc.members ?? []).some((m) => m?.webid === webid);
      if (!isMember) {
        return { error: 'webid is not a circle member', webid };
      }

      const nextBot = liveBot(lc);
      nextBot.chatBindings[chatId] = webid;
      circle.circleMutator({ bot: nextBot });

      return { ok: true, chatId, webid };
    }, {
      description: 'Bind a chatId to a circle member webid (admin only).',
      visibility:  'authenticated',
    }),

    defineSkill('removeBotChatBinding', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const role = await roleOf(circle, from);
      if (role !== 'admin') return { error: 'admin required' };

      const a = argsFromParts(parts);
      if (typeof a.chatId !== 'string' || !a.chatId.trim()) {
        return { error: 'chatId required' };
      }
      const chatId = a.chatId.trim();

      const lc = circle.liveCircle ?? {};
      const nextBot = liveBot(lc);
      if (!(chatId in nextBot.chatBindings)) {
        return { error: 'chatId not bound', chatId };
      }
      delete nextBot.chatBindings[chatId];
      circle.circleMutator({ bot: nextBot });

      // also revoke any cap-token bot agent for this chatId.
      // Best-effort; the binding itself is gone regardless.
      const botAgentRegistry = circle.botAgentRegistry;
      if (botAgentRegistry?.get(chatId)) {
        try { await botAgentRegistry.revoke({ chatId }); } catch { /* noop */ }
      }
      return { ok: true, chatId };
    }, {
      description: 'Remove a chatId binding (admin only).',
      visibility:  'authenticated',
    }),

    /**
     * promote a binding from "trust map" to cap-token mode.
     * Spawns a per-binding bot agent (in-process, separate identity)
     * and issues a `CapabilityToken` to its pubKey, scoped wildcard
     * with `constraints.actingAs = webid` and `scope: 'bot'`. The
     * existing chatBinding entry is preserved so legacy callers still
     * see the chatId → webid mapping; the dispatcher prefers the
     * cap-token path when a binding has one.
     *
     * Replaces any existing cap-token for the same chatId (rotates).
     */
    defineSkill('issueBotToken', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const role = await roleOf(circle, from);
      if (role !== 'admin') return { error: 'admin required' };
      const botAgentRegistry = circle.botAgentRegistry;
      if (!botAgentRegistry) {
        return { error: 'cap-token mode not available — bus or PolicyEngine missing' };
      }

      const a = argsFromParts(parts);
      if (typeof a.chatId !== 'string' || !a.chatId.trim()) {
        return { error: 'chatId required' };
      }
      const chatId = a.chatId.trim();
      const lc = circle.liveCircle ?? {};
      const webid = lc.bot?.chatBindings?.[chatId];
      if (!webid) {
        return { error: 'chatId is not bound; setBotChatBinding first', chatId };
      }
      const ttlDays = Number.isFinite(a.ttlDays) && a.ttlDays > 0 ? a.ttlDays : 30;

      try {
        const binding = await botAgentRegistry.issue({ chatId, webid, ttlDays });
        return {
          ok:        true,
          chatId,
          webid,
          tokenId:   binding.tokenId,
          botPubKey: binding.botPubKey,
          issuedAt:  binding.issuedAt,
          expiresAt: binding.expiresAt,
          ttlDays,
        };
      } catch (err) {
        return { error: `issueBotToken failed: ${err?.message ?? err}` };
      }
    }, {
      description: 'Issue a capability token for a bound chatId, promoting it to cap-token mode (admin only).',
      visibility:  'authenticated',
    }),

    /**
     * revoke the cap-token for a binding (returns it to
     * "trust map" mode). The chatBinding entry stays. To remove the
     * binding entirely, call `removeBotChatBinding` instead.
     */
    defineSkill('revokeBotToken', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const role = await roleOf(circle, from);
      if (role !== 'admin') return { error: 'admin required' };
      const botAgentRegistry = circle.botAgentRegistry;
      if (!botAgentRegistry) {
        return { error: 'cap-token mode not available' };
      }
      const a = argsFromParts(parts);
      if (typeof a.chatId !== 'string' || !a.chatId.trim()) {
        return { error: 'chatId required' };
      }
      const chatId = a.chatId.trim();
      const r = await botAgentRegistry.revoke({ chatId });
      if (r?.error) return { error: r.error, chatId };
      return { ok: true, chatId };
    }, {
      description: 'Revoke the cap-token for a bound chatId, returning it to trust-map mode (admin only).',
      visibility:  'authenticated',
    }),
  ];
}
