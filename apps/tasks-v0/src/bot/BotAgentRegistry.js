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
  /** Resolves once the persisted revocation set has loaded; already-resolved without persistence. */
  #ready = Promise.resolve();
  /** The key that issued this registry's tokens before its agent took over (a re-issue's only valid signer). */
  #retiredIssuer = null;
  /** Optional appender port: called after every revoke with the revoked token (see constructor). */
  #onRevoked = null;

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
   * @param {(revoked: {chatId: string, tokens: Array<{id: string, subject: string}>}) => *} [args.onRevoked]
   *   — APPENDER port for cross-device binding, the same seam `TaskGrantManager` carries: called
   *   (awaited, best-effort) after every revoke with the cancelled token. The HOST (basis) appends
   *   the id to its grants lane, so unbinding a bot here refuses its token at the owner's other
   *   devices' doors too — not only at this one until TTL.
   */
  constructor({ bus, tasksAgent, dataSource, circleId, onRevoked = null, retiredIssuer = null }) {
    if (!bus) throw new TypeError('BotAgentRegistry: bus required');
    // The engine is what ENFORCES the tokens this registry issues (verify + revocation); a registry
    // whose agent has no gate would mint authority nothing checks. It is not wired here — see `isRevoked`.
    if (!tasksAgent?.policyEngine) {
      throw new TypeError('BotAgentRegistry: tasksAgent must have a PolicyEngine wired');
    }
    this.#bus = bus;
    this.#tasksAgent = tasksAgent;
    this.#dataSource = dataSource ?? null;
    this.#circleId     = circleId     ?? null;
    this.#onRevoked   = typeof onRevoked === 'function' ? onRevoked : null;
    this.#retiredIssuer = typeof retiredIssuer === 'string' && retiredIssuer ? retiredIssuer : null;
    // The revocation set is issuer-side TRUTH, so it hydrates with the registry: without this a
    // restart forgot every revoke while the token itself stayed signed and unexpired — the same
    // defect the grant managers in core had, fixed the same way. Best-effort: no persistence, no load.
    if (this.persisting) this.#ready = this.#loadRevoked();
  }

  /** One row, OUTSIDE `botAgents/` — `restoreAll` lists that directory as bindings. */
  #revokedPath() {
    return `mem://tasks/circles/${this.#circleId}/botRevoked.json`;
  }

  /** Hydrate the revocation set. Best-effort: a missing or corrupt row starts empty. */
  async #loadRevoked() {
    try {
      const raw = await this.#dataSource.read(this.#revokedPath());
      const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
      for (const id of (body?.revoked ?? [])) this.#revoked.add(id);
    } catch { /* no row yet, or unreadable → start empty; the next revoke re-establishes it */ }
  }

  /** Persist after a revoke. Best-effort: a failed write must not fail the revoke's in-memory effect. */
  async #persistRevoked() {
    if (!this.persisting) return;
    try {
      await this.#dataSource.write(this.#revokedPath(), JSON.stringify({ revoked: [...this.#revoked] }));
    } catch { /* best-effort */ }
  }

  /**
   * True iff the given tokenId has been revoked on this side.
   *
   * This registry is a revocation SOURCE, not a gate. It used to push this set into the tasks
   * agent's PolicyEngine from its own constructor, which REPLACED whatever revocation truth the
   * engine already had — the last registry built silently disarmed every earlier one. The engine
   * now takes one resolver at construction and `MeshAgent.buildMeshAgent` unions this source in
   * alongside every other circle's, so a second registry can no longer cancel the first.
   *
   * ASYNC: the answer awaits the persisted set's hydration first (immediate without persistence),
   * so a check racing boot answers from the real state rather than an empty one — the union in
   * `buildMeshAgent` awaits every source already.
   */
  /**
   * Adopt a bot this registry spun up on the tasks agent's bus, both ways (`adoptInProcessPeer`): the tasks layer learns
   * the key the registry minted, the bot learns the tasks agent's. Refused unless both are on this bus — never widened.
   */
  async #adoptBot(agent, identity) {
    const tasks = this.#tasksAgent;
    // The bot's key is `public` on the engine that judges it: its token's `bot.*` scope is all it reaches there. Left
    // unknown it would default to `authenticated` and reach every op of that tier token-less — on a host that is
    // every authenticated op of every app it carries. So no registry to say it in means no adoption, never a skip.
    const registry = tasks.policyEngine?.trustRegistry;
    if (typeof registry?.setTier !== 'function') throw new Error('BotAgentRegistry: the engine has no trust registry to hold the bot at public; not adopted');
    await registry.setTier(identity.pubKey, 'public');
    const theirs = tasks.security.adoptInProcessPeer(tasks.transport, agent.transport, identity);
    const ours = agent.security.adoptInProcessPeer(agent.transport, tasks.transport, tasks.identity);
    if (theirs === 'refused' || ours === 'refused') throw new Error('BotAgentRegistry: the bot could not be adopted on the tasks bus');
  }

  async isRevoked(tokenId) {
    await this.#ready;
    return this.#revoked.has(tokenId);
  }

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

    // 2. ADOPT the bot and the tasks agent both ways — the same bus, the objects themselves, no hello (a hello between
    //    two agents in one process proves nothing). The tasks layer hears only what its bus adopted, so this is also what
    //    admits the key this registry just minted. Bot does not need to be tier-elevated — default 'authenticated' is fine
    //    for `bot.*` skills' `requires-token` policy (the token is what authorises them).
    await this.#adoptBot(agent, identity);

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
    // …and the tasks layer forgets the bot's key: a revoked bot is a stranger on the bus again
    try { this.#tasksAgent.security?.unregisterPeer?.(entry.agent.address); } catch { /* noop */ }
    // follow-up C — also publish to the issuer-side revocation
    // list so PolicyEngine.checkInbound rejects any in-flight or
    // future call carrying the now-stale token.
    this.#revoked.add(entry.binding.tokenId);
    // The await is the DURABILITY: without it a restart re-admitted a holder this side had already
    // cut off, because deleting the binding row (below) only stops the bot re-spawning — it does
    // nothing to a token blob still held elsewhere.
    await this.#persistRevoked();
    this.#entries.delete(chatId);
    if (this.persisting) {
      try { await this.#dataSource.delete(this.#pathFor(chatId)); } catch { /* noop */ }
    }
    // The appender port (cross-device half) — best-effort AND loud, like the local write above.
    if (this.#onRevoked) {
      try {
        await this.#onRevoked({ chatId, tokens: [{ id: entry.binding.tokenId, subject: entry.binding.botPubKey }] });
      } catch (err) {
        console.warn(`[BotAgentRegistry] onRevoked appender failed for ${chatId} — the revoke holds on THIS device; other devices learn it only at catch-up/TTL: ${err?.message ?? err}`);
      }
    }
    return { ok: true };
  }

  /**
   * follow-up B — re-spawn bot agents from persisted snapshots.
   * Called from Circle boot AFTER the tasks agent + dataSource are up.
   * Skips entries whose token has already expired (the admin will need
   * to re-issue) and tears down their persistent rows.
   *
   * @returns {Promise<{restored: number, expired: number, failed: number, dropped: number, reissued: number}>}
   */
  async restoreAll() {
    if (!this.persisting) return { restored: 0, expired: 0, failed: 0, dropped: 0, reissued: 0 };
    const root = `mem://tasks/circles/${this.#circleId}/botAgents/`;
    let listing = [];
    try {
      const r = await this.#dataSource.list?.(root);
      listing = Array.isArray(r) ? r : (r?.items ?? []);
    } catch { return { restored: 0, expired: 0, failed: 0, dropped: 0, reissued: 0 }; }

    const out = { restored: 0, expired: 0, failed: 0, dropped: 0, reissued: 0 };
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
        await this.#adoptBot(agent, identity);

        // The stored record is only as good as its token. A token this agent signed must verify under this agent's
        // key; one a RETIRED issuer signed (the key this registry's agent replaced) is re-issued only when it verifies
        // under that key and says what the record says — the bot's own key, the person it acts as, the bot scope.
        // Anything else (a record edited at rest, an unverifiable token, no retired key to check against) is dropped
        // and counted, never re-signed: the record is sealed at rest but not signed, and an older copy could stand in.
        const parsed = (() => { try { return CapabilityToken.fromJSON(token); } catch { return null; } })();
        const saysTheRecord = (t) => t && t.subject === identity.pubKey && t.skill === 'bot.*'
          && t.constraints?.actingAs === binding.webid && t.constraints?.scope === 'bot';
        const ours = this.#tasksAgent.pubKey;
        const verifiedUnder = (key) => { try { return parsed.issuer === key && CapabilityToken.verify(parsed, key) === true; } catch { return false; } };
        if (!saysTheRecord(parsed) || !(verifiedUnder(ours) || (this.#retiredIssuer && parsed.agentId === this.#retiredIssuer && verifiedUnder(this.#retiredIssuer)))) {
          try { await agent.stop(); } catch { /* noop */ }
          try { await this.#dataSource.delete(uri); } catch { /* noop */ }
          out.dropped++;
          continue;
        }
        if (parsed.agentId !== ours) {
          for (const k of (await vault.list()).filter((k) => k.startsWith('token:'))) {
            await vault.delete(k);
          }
          // never longer than the token it replaces, never longer than a fresh one — with a second's margin, as `issue`
          // counts from its own now; a binding with no time left is expired, not stretched
          const until = Math.min(parsed.expiresAt ?? Infinity, Date.now() + DEFAULT_TTL_DAYS * MS_PER_DAY);
          const expiresIn = until - Date.now() - 1_000;
          if (expiresIn <= 0) {
            try { await agent.stop(); } catch { /* noop */ }
            try { await this.#dataSource.delete(uri); } catch { /* noop */ }
            out.expired++;
            continue;
          }
          const fresh = await this.#tasksAgent.issueCapabilityToken({
            subject:    identity.pubKey,
            skill:      'bot.*',
            expiresIn,
            constraints: { actingAs: binding.webid, scope: 'bot' },
          });
          await tokenRegistry.store(fresh);
          binding.tokenId   = fresh.id;
          binding.issuedAt  = fresh.issuedAt;
          binding.expiresAt = fresh.expiresAt;
          out.reissued++;
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
