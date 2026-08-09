/**
 * BotAgentRegistry — cap-token-bound bot agent management.
 *
 * Each binding has its OWN in-process `core.Agent`:
 *   - Fresh `AgentIdentity` (Ed25519 keypair) per binding.
 *   - Holds exactly ONE `CapabilityToken` issued by the tasks agent
 *     to the bot's pubKey, with `constraints.actingAs = webid`.
 *     Wildcard skill scope (trade-off — see CHANGELOG); the
 *     role-policy gate on each Tasks skill still applies because
 *     the bot's pubKey is not a circle member webid.
 *   - Shares the tasks agent's `InternalBus`, so bot.invoke(tasksPubKey, ...)
 *     routes through the real protocol stack: outbound `callSkill`
 *     attaches the held token, inbound `handleTaskRequest` runs
 *     PolicyEngine.checkInbound which verifies signature + expiry +
 *     subject + issuer trust.
 *
 * Why one bot agent per binding (not one shared bot agent with N
 * tokens):
 *   - `TokenRegistry.get(peerId, skillId)` returns the latest-expiring
 *     non-expired matching token. With many tokens for the same agentId
 *     and skill='*', the lookup can't distinguish "act as Anne" from
 *     "act as the author". Per-binding identities sidestep the problem.
 *
 * Persistence (follow-up B): when a `dataSource` is supplied,
 * each bot agent's vault snapshot + binding metadata is written to
 * `mem://tasks/circles/<circleId>/botAgents/<chatId>.json`. On Circle
 * boot, `restoreAll()` loads them and re-spawns the bot agents
 * against the same identity, so cap-token bindings survive a CLI
 * restart. Without `dataSource`, bot identities stay ephemeral
 * (the baseline behaviour).
 */

import { Agent, AgentIdentity, InternalTransport, TrustRegistry, PolicyEngine, TokenRegistry, CapabilityToken } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — bot cap-token default TTL in days (scope:device, kind:internal).
const DEFAULT_TTL_DAYS = param({ key: 'tasksV0.ttlDays', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 30 });
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * @typedef {object} BotBinding
 * @property {string} chatId
 * @property {string} webid
 * @property {string} botPubKey
 * @property {string} tokenId
 * @property {number} issuedAt    unix-ms
 * @property {number} expiresAt   unix-ms
 */

/**
 * @typedef {object} BotEntry
 * @property {import('@onderling/core').Agent} agent
 * @property {object} identity
 * @property {object} vault
 * @property {object} tokenRegistry
 * @property {BotBinding} binding
 */

export class BotAgentRegistry {
  #bus;
  #tasksAgent;
  #dataSource;
  #circleId;
  /** Map<chatId, BotEntry> */
  #entries = new Map();
  /** follow-up C — issuer-side revocation list. Set<tokenId>. */
  #revoked = new Set();

  /**
   * @param {object} args
   * @param {import('@onderling/core').InternalBus} args.bus
   * @param {import('@onderling/core').Agent}        args.tasksAgent
   * @param {object} [args.dataSource]
   *   follow-up B — when supplied, bindings persist under
   *   `mem://tasks/circles/<circleId>/botAgents/<chatId>.json` so
   *   cap-token bindings survive CLI restarts. Caller must pass
   *   `circleId` alongside.
   * @param {string} [args.circleId]
   */
  constructor({ bus, tasksAgent, dataSource, circleId }) {
    if (!bus) throw new TypeError('BotAgentRegistry: bus required');
    if (!tasksAgent?.policyEngine) {
      throw new TypeError('BotAgentRegistry: tasksAgent must have a PolicyEngine wired');
    }
    this.#bus = bus;
    this.#tasksAgent = tasksAgent;
    this.#dataSource = dataSource ?? null;
    this.#circleId     = circleId     ?? null;
    // follow-up C — feed the tasks agent's PolicyEngine our
    // local revocation set so revoked tokens fail at the verifier
    // even if the holder still has the blob stored.
    if (typeof tasksAgent.policyEngine?.setRevocationCheck === 'function') {
      tasksAgent.policyEngine.setRevocationCheck((tokenId) => this.#revoked.has(tokenId));
    }
  }

  /** True iff the given tokenId has been revoked on this side. */
  isRevoked(tokenId) { return this.#revoked.has(tokenId); }

  /** True when `dataSource` was supplied — bindings will be persisted. */
  get persisting() { return !!(this.#dataSource && this.#circleId); }

  #pathFor(chatId) {
    return `mem://tasks/circles/${this.#circleId}/botAgents/${encodeURIComponent(chatId)}.json`;
  }

  /**
   * Issue a token-bound bot agent for `(chatId, webid)`. Replaces any
   * existing binding for the same chatId (caller is responsible for
   * confirming the rebind).
   *
   * @param {object} args
   * @param {string} args.chatId
   * @param {string} args.webid
   * @param {number} [args.ttlDays=30]
   * @returns {Promise<BotBinding>}
   */
  async issue({ chatId, webid, ttlDays = DEFAULT_TTL_DAYS }) {
    if (typeof chatId !== 'string' || !chatId.trim()) throw new TypeError('chatId required');
    if (typeof webid  !== 'string' || !webid.trim())  throw new TypeError('webid required');
    if (!Number.isFinite(ttlDays) || ttlDays <= 0)    throw new TypeError('ttlDays must be > 0');

    // If a binding for this chatId already exists, tear it down first
    // so the new identity replaces it cleanly.
    if (this.#entries.has(chatId)) {
      await this.revoke({ chatId }).catch(() => { /* best effort */ });
    }

    // 1. Spin up the bot agent.
    const vault    = new VaultMemory();
    const identity = await AgentIdentity.generate(vault);
    const transport = new InternalTransport(this.#bus, identity.pubKey, { identity });
    const trustRegistry = new TrustRegistry(vault);
    const tokenRegistry = new TokenRegistry(vault);
    const agent = new Agent({
      identity,
      transport,
      trustRegistry,
      tokenRegistry,
      label: `Bot(${chatId.slice(0, 8)}→${webid})`,
    });
    // PolicyEngine on the bot is for completeness; bot doesn't expose
    // skills to anyone, but Agent.start() doesn't require one.

    await agent.start();

    // 2. Hello the tasks agent so SecurityLayer establishes a session.
    //    Bot does not need to be tier-elevated — default 'authenticated'
    //    is fine for `bot.*` skills' `requires-token` policy (the token
    //    is what authorises them).
    await agent.hello(this.#tasksAgent.address);

    // 3. Issue the token. Tasks agent issues; bot holds.
    //    follow-up A — scope to `bot.*` instead of wildcard so
    //    a stolen token can only invoke the chat-bot surface, not
    //    arbitrary tasks skills. PolicyEngine + TokenRegistry both
    //    honour the prefix via `offeringMatches` (core).
    const expiresIn = ttlDays * MS_PER_DAY;
    const token = await this.#tasksAgent.issueCapabilityToken({
      subject:    identity.pubKey,
      skill:      'bot.*',
      expiresIn,
      constraints: { actingAs: webid, scope: 'bot' },
    });
    await tokenRegistry.store(token);

    const binding = {
      chatId,
      webid,
      botPubKey: identity.pubKey,
      tokenId:   token.id,
      issuedAt:  token.issuedAt,
      expiresAt: token.expiresAt,
    };

    this.#entries.set(chatId, {
      agent,
      identity,
      vault,
      tokenRegistry,
      binding,
    });

    // follow-up B — persist (best-effort).
    if (this.persisting) {
      try {
        await this.#dataSource.write(this.#pathFor(chatId), JSON.stringify({
          binding,
          vault:   vault.snapshot(),
          token:   token.toJSON(),
        }));
      } catch { /* persistence failure must not break the in-memory binding */ }
    }
    return binding;
  }

  /**
   * Revoke + tear down the binding for `chatId`. Token revocation
   * is recorded in the bot's TokenRegistry (so subsequent calls
   * skip the token); the bot agent then stops.
   *
   * @param {object} args
   * @param {string} args.chatId
   * @returns {Promise<{ok: true} | {error: string}>}
   */
  async revoke({ chatId }) {
    if (typeof chatId !== 'string' || !chatId.trim()) throw new TypeError('chatId required');
    const entry = this.#entries.get(chatId);
    if (!entry) return { error: 'not found' };
    try { await entry.tokenRegistry.revoke(entry.binding.tokenId); } catch { /* noop */ }
    try { await entry.agent.stop(); } catch { /* noop */ }
    // follow-up C — also publish to the issuer-side revocation
    // list so PolicyEngine.checkInbound rejects any in-flight or
    // future call carrying the now-stale token.
    this.#revoked.add(entry.binding.tokenId);
    this.#entries.delete(chatId);
    if (this.persisting) {
      try { await this.#dataSource.delete(this.#pathFor(chatId)); } catch { /* noop */ }
    }
    return { ok: true };
  }

  /**
   * follow-up B — re-spawn bot agents from persisted snapshots.
   * Called from Circle boot AFTER the tasks agent + dataSource are up.
   * Skips entries whose token has already expired (the admin will need
   * to re-issue) and tears down their persistent rows.
   *
   * @returns {Promise<{restored: number, expired: number, failed: number}>}
   */
  async restoreAll() {
    if (!this.persisting) return { restored: 0, expired: 0, failed: 0 };
    const root = `mem://tasks/circles/${this.#circleId}/botAgents/`;
    let listing = [];
    try {
      const r = await this.#dataSource.list?.(root);
      listing = Array.isArray(r) ? r : (r?.items ?? []);
    } catch { return { restored: 0, expired: 0, failed: 0 }; }

    const out = { restored: 0, expired: 0, failed: 0 };
    for (const item of listing) {
      const uri = typeof item === 'string' ? item : item?.uri ?? item?.path;
      if (!uri || !uri.endsWith('.json')) continue;
      try {
        const raw = await this.#dataSource.read(uri);
        const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const { binding, vault: vaultSnap, token } = body ?? {};
        if (!binding || !vaultSnap || !token) {
          out.failed++;
          continue;
        }
        if (typeof binding.expiresAt === 'number' && binding.expiresAt <= Date.now()) {
          // expired — drop the persistent row, admin re-issues
          try { await this.#dataSource.delete(uri); } catch { /* noop */ }
          out.expired++;
          continue;
        }

        const vault    = VaultMemory.fromSnapshot(vaultSnap);
        const identity = await AgentIdentity.restore(vault);
        const transport = new InternalTransport(this.#bus, identity.pubKey, { identity });
        const trustRegistry = new TrustRegistry(vault);
        const tokenRegistry = new TokenRegistry(vault);
        const agent = new Agent({
          identity,
          transport,
          trustRegistry,
          tokenRegistry,
          label: `Bot(${binding.chatId.slice(0, 8)}→${binding.webid})`,
        });
        await agent.start();
        await agent.hello(this.#tasksAgent.address);

        // with persisted tasks-agent identity (Circle.js writes
        // the agent vault to `mem://tasks/circles/<circleId>/agent/
        // identity-vault.json` on first boot and restores from it
        // afterwards), the token's `agentId` matches the current
        // tasks agent's pubKey across restarts; the auto-rotate
        // branch from follow-up B is gone. Defensive fallback
        // remains: if the snapshot was generated before (or
        // the user wiped the agent vault but kept the bot vaults),
        // re-issue rather than fail.
        if (token?.agentId !== this.#tasksAgent.pubKey) {
          for (const k of (await vault.list()).filter((k) => k.startsWith('token:'))) {
            await vault.delete(k);
          }
          const remainingMs = Math.max(60_000, binding.expiresAt - Date.now());
          const fresh = await this.#tasksAgent.issueCapabilityToken({
            subject:    identity.pubKey,
            skill:      'bot.*',
            expiresIn:  remainingMs,
            constraints: { actingAs: binding.webid, scope: 'bot' },
          });
          await tokenRegistry.store(fresh);
          binding.tokenId   = fresh.id;
          binding.issuedAt  = fresh.issuedAt;
          binding.expiresAt = fresh.expiresAt;
          if (this.persisting) {
            try {
              await this.#dataSource.write(uri, JSON.stringify({
                binding,
                vault: vault.snapshot(),
                token: fresh.toJSON(),
              }));
            } catch { /* noop */ }
          }
        }

        this.#entries.set(binding.chatId, {
          agent,
          identity,
          vault,
          tokenRegistry,
          binding,
        });
        out.restored++;
      } catch {
        out.failed++;
      }
    }
    return out;
  }

  /**
   * @param {string} chatId
   * @returns {BotEntry | null}
   */
  get(chatId) {
    return this.#entries.get(chatId) ?? null;
  }

  /**
   * @returns {BotBinding[]}
   */
  list() {
    return [...this.#entries.values()].map((e) => ({ ...e.binding }));
  }

  /**
   * Tear down ALL bot agents. Called from `Circle.close()`.
   */
  async closeAll() {
    for (const entry of this.#entries.values()) {
      try { await entry.agent.stop(); } catch { /* noop */ }
    }
    this.#entries.clear();
  }
}

export { CapabilityToken };
