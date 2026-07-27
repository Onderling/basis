/**
 * taskExchange.js — Task lifecycle: outbound invokeAgentSkill + inbound handleTaskRequest.
 *
 * Outbound (invokeAgentSkill):
 *   1. Create Task, register in StateManager
 *   2. Look up CapabilityToken for (peerId, skillId) if agent.tokenRegistry present
 *   3. Send RQ with { type:'task', taskId, skillId, parts, ttl?, _token? }
 *   4. RS arrives → Task._transition('completed'|'failed')
 *   5. IR arrives (OW) → Task._transition('input-required')
 *   6. ST/SE arrive (OW) → Task._pushChunk() / Task._closeStream()
 *   7. task-expired arrives (OW) → Task._transition('expired')
 *   8. Return Task immediately (caller awaits task.done() or task.stream())
 *
 * Inbound (handleTaskRequest):
 *   1. Extract { type, taskId, skillId, parts, ttl?, _token? } from RQ payload
 *   2. PolicyEngine.checkInbound (if available), passing token + agentPubKey
 *   3. Create AbortController; setup TTL expiry timer if effectiveTtl is finite
 *   4. Dispatch to skill handler with AbortSignal in ctx
 *   5. Regular handler → RS
 *   6. Generator handler → ST chunks + SE/RS; respects signal.aborted
 *   7. Task.InputRequired thrown → IR OW + wait for RI + resume (multi-round loop)
 *   8. TTL expiry: abort handler + reject any pending IR wait + send task-expired OW
 *
 * Envelope payload formats:
 *   RQ  { type:'task',          taskId, skillId, parts, ttl?, _token? }
 *   RS  { type:'task-result',   taskId, status:'completed'|'failed', parts, error? }
 *   OW  { type:'stream-chunk',  taskId, parts }       ← ST
 *   OW  { type:'stream-end',    taskId, parts? }      ← SE
 *   OW  { type:'input-required',taskId, parts }       ← IR
 *   OW  { type:'task-input',    taskId, parts }       ← RI
 *   OW  { type:'cancel',        taskId }              ← CX
 *   OW  { type:'task-expired',  taskId }              ← EX (receiver → caller)
 */
import { Task }             from './Task.js';
import { Parts }            from '../Parts.js';
import { genId }            from '../Envelope.js';
import { verifyOrigin }     from '../security/originSignature.js';
import { openTunnelOW }     from '../security/tunnelSeal.js';
import { InternalTransport } from '../transport/InternalTransport.js';

/** @param {object} x */
const isAsyncGen = x => x && typeof x[Symbol.asyncIterator] === 'function';

/** Reference to the AsyncGeneratorFunction constructor — used to detect
 *  streaming skill handlers WITHOUT invoking them (so the B★ fast-path can
 *  cleanly defer streaming skills to the wire path). */
const AsyncGeneratorFunction = Object.getPrototypeOf(async function* () {}).constructor;
const _isAsyncGenFn = fn => typeof fn === 'function' && fn instanceof AsyncGeneratorFunction;

/**
 * Compute effective TTL: min of what the caller requested and the agent's
 * configured ceiling.  Returns null when no finite limit applies.
 */
function _effectiveTtl(requested, ceiling) {
  const r   = (requested != null && isFinite(requested)) ? requested : Infinity;
  const c   = (ceiling   != null && isFinite(ceiling))   ? ceiling   : Infinity;
  const eff = Math.min(r, c);
  return isFinite(eff) ? eff : null;
}

// ── Outbound ──────────────────────────────────────────────────────────────────

/**
 * Call a skill on a remote peer. Returns a Task immediately.
 * Await task.done() for the final result, or iterate task.stream() for chunks.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {string}    peerId
 * @param {string}    skillId
 * @param {import('../Parts.js').Part[]} parts
 * @param {object}    [opts]
 * @param {number}    [opts.timeout=30000]
 * @param {number}    [opts.ttl]   — suggested task TTL ms (receiver may cap)
 * @returns {Task}
 */
export function invokeAgentSkill(agent, peerId, skillId, parts, opts = {}) {
  const taskId = genId();
  const task   = new Task({ taskId, skillId, agent, peerId, state: 'submitted' });
  agent.stateManager.createTask(taskId, task);
  task._transition('working');

  const timeout = opts.timeout ?? 30_000;

  (async () => {
    // Attach a capability token if the agent holds one for this peer + skill.
    let tokenJson = null;
    if (agent.tokenRegistry) {
      const token = await agent.tokenRegistry.get(peerId, skillId);
      if (token) tokenJson = token.toJSON();
    }

    const sentAt = Date.now();
    try {
      const t  = opts._overrideTransport ?? await agent.transportFor(peerId);

      // ── B★ fast-path: same-process, same-InternalBus call ───────────────────
      // Skip mkEnvelope/encrypt/decrypt/bus-hop and run the receiver-side gate
      // (runGatedSkill) directly on the target agent. Bounded to the common
      // request→result case; streaming skills defer to the wire path, and
      // InputRequired is driven in-process (see _runInProcess). Anything that
      // needs wire-level origin signatures (relay-forward) or an un-hello'd
      // peer falls back to the wire path below — unchanged semantics.
      const targetAgent = _fastPathTarget(agent, peerId, skillId, t, opts);
      if (targetAgent) {
        // The terminal transition is applied HERE (not inside _runInProcess) so
        // it lands one async hop after the result is known — mirroring the wire
        // path's `await t.request()` → transition deferral, so a caller that
        // awaits `task.send()` then `task.done()` still sees a pending Task
        // (done() rejects on failure rather than resolving a failed snapshot).
        const terminal = await _runInProcess(agent, targetAgent, task, taskId, skillId, parts, tokenJson, opts);
        if      (terminal?.status === 'completed') task._transition('completed', { parts: terminal.parts });
        else if (terminal?.status === 'failed')    task._transition('failed',    { error: terminal.error });
        return;
      }

      console.log(`[invokeAgentSkill] ${skillId} → ${peerId.slice(0,12)} via ${t?.constructor?.name}`);
      const rs = await t.request(
        peerId,
        {
          type: 'task', taskId, skillId, parts,
          ttl:     opts.ttl    ?? null,
          _token:  tokenJson,
          _origin:    opts.origin    ?? null,
          _originSig: opts.originSig ?? null,
          _originTs:  opts.originTs  ?? null,
        },
        timeout,
      );
      // Group EE — feed FallbackTable with measured latency so the next
      // call to this peer prefers the fastest live transport.
      _reportSuccess(agent, peerId, t, Date.now() - sentAt);
      const { status, parts: rParts = [], error } = rs.payload ?? {};
      if (status === 'completed') {
        task._transition('completed', { parts: rParts });
      } else {
        task._transition('failed', { error: error ?? 'Remote skill failed' });
      }
    } catch (err) {
      // Suppress security errors — expected when gossip contacts unhello'd peers.
      // Real transport failures (timeout, not-connected, etc.) both log AND
      // mark the (peer, transport) pair degraded for 30 s so the next call
      // via RoutingStrategy falls through to the next-best live transport.
      if (!err.message?.includes('pubKey')) {
        console.warn(`[invokeAgentSkill] ${skillId} → ${peerId.slice(0,12)} FAILED:`, err.message);
        if (!opts._overrideTransport) {
          _reportFailure(agent, peerId, err);
        }
      }
      task._transition('failed', { error: err.message });
    }
  })();

  return task;
}

// ── B★ in-process fast-path ─────────────────────────────────────────────────

/**
 * Decide whether a call can take the in-process fast-path, and if so return
 * the target Agent to run the gate on. Returns null → use the wire path.
 *
 * Eligible iff: the resolved transport is an InternalTransport; the target is
 * self or a peer on the SAME InternalBus (with a resolvable owner Agent); the
 * call carries no relay/origin-signature claim; the caller's SecurityLayer can
 * already reach the peer (so we don't skip a "hello first" failure the wire
 * path would raise); and the skill is not a streaming handler (streaming keeps
 * the wire ST/SE + cancel machinery).
 */
function _fastPathTarget(callerAgent, peerId, skillId, t, opts) {
  if (!(t instanceof InternalTransport)) return null;
  // Relay-forward / origin-signature calls verify a wire-level signature that
  // only exists post-encrypt (Group Z) → wire path.
  if (opts.origin) return null;

  let targetAgent;
  if (peerId === callerAgent.address) {
    targetAgent = callerAgent;                       // self-call — no transport involved either way
  } else {
    const peerT = t.peerTransport?.(peerId);
    if (!peerT || peerT.bus !== t.bus) return null;  // not a same-bus peer
    // The transport says it cannot reach this peer, so neither can we.
    //
    // Sharing a process is not the same as being connected. Without this check the shortcut delivers over a
    // transport that is disconnected, partitioned or disabled — a partition that does not partition — and it
    // does so INVISIBLY, because the wire path it skipped is the one that would have failed. `canReach` is
    // the port's own answer to "can I deliver to that peer right now", and an optimisation is only allowed
    // to be faster, never to be reachable where the thing it optimises is not.
    if (typeof peerT.canReach === 'function' && !peerT.canReach(peerId)) return null;
    if (typeof t.canReach     === 'function' && !t.canReach(peerId))     return null;
    targetAgent = peerT._ownerAgent;
  }
  if (!targetAgent || typeof targetAgent.skills?.get !== 'function') return null;

  const sec = t.securityLayer;
  if (sec && peerId !== callerAgent.address) {
    // Preserve the "hello first" requirement: if the caller's SecurityLayer
    // holds no key for the peer, the wire path would throw on encrypt — let
    // it, so behaviour is unchanged.
    if (!sec.getPeerKey(peerId)) return null;
    // Group FF+1: while EITHER side is in rotation grace, the SecurityLayer
    // attaches / consumes an inline rotation proof on the wire envelope. The
    // fast-path skips the SecurityLayer, so stay on the wire path to preserve
    // that auto-migration side-effect.
    if (sec.inlineProofActive || targetAgent.security?.inlineProofActive) return null;
  }

  // Streaming skills stay on the wire path (chunk/cancel machinery lives there).
  const skill = targetAgent.skills.get(skillId);
  if (skill && (skill.streaming === true || _isAsyncGenFn(skill.handler))) return null;

  return targetAgent;
}

/**
 * Run a call in-process against `targetAgent` via runGatedSkill. Returns a
 * terminal descriptor `{ status:'completed'|'failed', parts?, error? }` for the
 * caller to apply to its Task, or null when the Task was already settled here
 * (streaming pump) or elsewhere (cancel / TTL-expiry during IR).
 *
 * The receiver-side AbortController + TTL expiry are set up on the target (via
 * onGatePassed) exactly as the wire path does, so `ctx.signal` is a real
 * AbortSignal, a caller `task.cancel()` (a cancel OW over the shared bus)
 * aborts the handler, and a ceiling TTL still fires — all identical to wire.
 */
async function _runInProcess(callerAgent, targetAgent, task, taskId, skillId, parts, tokenJson, opts) {
  const from    = callerAgent.address;
  const targetT = await targetAgent.transportFor(from);

  let cleanup = () => {};
  const onGatePassed = () => {
    const controller = new AbortController();
    targetAgent.stateManager.createTask(`abort:${taskId}`, { controller });

    const effectiveTtl = _effectiveTtl(opts.ttl ?? null, targetAgent.maxTaskTtl);
    let expiryTimer = null;
    if (effectiveTtl !== null) {
      expiryTimer = setTimeout(async () => {
        controller.abort();
        const irEntry = targetAgent.stateManager.getTask(`ir:${taskId}`);
        if (irEntry?.rejecter) irEntry.rejecter(new Error('Task expired'));
        targetAgent.stateManager.deleteTask(`ir:${taskId}`);
        targetAgent.stateManager.deleteTask(`abort:${taskId}`);
        await targetT.sendOneWay(from, { type: 'task-expired', taskId }).catch(() => {});
      }, effectiveTtl);
    }
    cleanup = () => {
      clearTimeout(expiryTimer);
      targetAgent.stateManager.deleteTask(`abort:${taskId}`);
    };
    return controller.signal;
  };

  // Hand the handler an envelope whose `payload` mirrors the wire RQ
  // (handleTaskRequest passes the full decrypted envelope). Handlers that
  // read `envelope.payload._token` (e.g. cap-token `actingAs` resolution)
  // must behave identically on the fast-path and the wire path.
  const res = await runGatedSkill(targetAgent, {
    skillId, parts, from, token: tokenJson,
    taskId,
    envelope: {
      _from:   from,
      payload: { type: 'task', taskId, skillId, parts, _token: tokenJson },
    },
    onGatePassed,
  });

  switch (res.status) {
    case 'completed':
      cleanup();
      return { status: 'completed', parts: res.parts ?? [] };

    case 'failed':
      cleanup();
      if (res.handlerError) _emitSkillError(targetAgent, skillId, res.err);
      return { status: 'failed', error: res.error ?? 'Remote skill failed' };

    case 'stream':
      // Reached only if a handler returns a generator WITHOUT declaring itself
      // streaming (e.g. a connectSkill-wrapped generator). The generator has
      // not been consumed, so no side effects have run twice. Drive it into the
      // caller Task in-process.
      try {
        for await (const chunk of res.gen) {
          if (res.ctx.signal?.aborted) { await res.gen.return?.(); break; }
          const cp = chunk == null ? [] : Array.isArray(chunk) ? chunk : Parts.wrap(chunk);
          task._pushChunk(cp);
        }
        cleanup();
        task._transition('completed', { parts: [] });
      } catch (err) {
        cleanup();
        _emitSkillError(targetAgent, skillId, err);
        task._transition('failed', { error: err?.message ?? String(err) });
      }
      return null;

    case 'input-required':
      return _runInProcessInputRequired(targetAgent, targetT, taskId, skillId, from, res, cleanup);
  }
  return null;
}

/**
 * In-process InputRequired driver. Round 1 already ran on the target (inside
 * runGatedSkill, under the abort/TTL set up by _runInProcess); rounds 2+ reuse
 * the wire helper `_handleInputRequired`, with the target's own
 * transport-to-caller so input-required / task-input / cancel / task-expired
 * all flow over the shared bus exactly as on the wire.
 *
 * Returns the terminal descriptor (or null when the round ended via cancel /
 * TTL-expiry, where the caller Task was already settled by the cancel OW /
 * task-expired OW). The caller (invokeAgentSkill) applies the transition so the
 * failure lands one hop after done() is awaited — matching wire RS timing.
 */
async function _runInProcessInputRequired(targetAgent, targetT, taskId, skillId, from, res, cleanup) {
  const synthEnvelope = { _from: from, payload: { type: 'task', taskId, skillId } };
  let terminal = null;
  const resolveTerminal = (status, parts, error) => {
    if (status !== 'completed') _emitSkillError(targetAgent, skillId, error);
    terminal = status === 'completed'
      ? { status: 'completed', parts }
      : { status: 'failed', error: error?.message ?? String(error) };
  };

  await _handleInputRequired(
    targetT, targetAgent, synthEnvelope, taskId, res.skill, res.ctx, res.irErr,
    res.ctx.signal, cleanup, resolveTerminal,
  );
  return terminal;
}

// ── Inbound ───────────────────────────────────────────────────────────────────

/**
 * Handle an inbound RQ that carries a task request.
 * Returns false if the envelope is not a task RQ.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {object} envelope  — decrypted RQ envelope
 */
export async function handleTaskRequest(agent, envelope) {
  const payload = envelope.payload ?? {};
  if (payload.type !== 'task') return false;

  const {
    taskId,
    skillId,
    parts        = [],
    ttl: reqTtl  = null,
    _token       = null,
    _origin      = null,   // claim from relay-forward; verified below when _originSig present
    _originSig   = null,
    _originTs    = null,
  } = payload;

  // Reply on the same transport the request arrived on.
  // envelope._transport is tagged by Transport._receive(); fall back to routing
  // only if the tag is missing (e.g. unit tests that bypass Transport._receive).
  const t = envelope._transport ?? await agent.transportFor(envelope._from);
  console.log(`[handleTaskRequest] ${skillId} from ${envelope._from?.slice(0,12)} via ${t?.constructor?.name}`);

  // The gate + regular-handler path lives in runGatedSkill (shared with the
  // B★ in-process fast-path so semantics + error strings stay identical). The
  // wire path keeps ownership of the AbortController / TTL expiry (which needs
  // this transport) via the onGatePassed hook, fired AFTER the gate passes and
  // BEFORE the handler runs — exactly where it lived inline before.
  let cleanup = () => {};
  const onGatePassed = () => {
    const controller = new AbortController();
    agent.stateManager.createTask(`abort:${taskId}`, { controller });

    const effectiveTtl = _effectiveTtl(reqTtl, agent.maxTaskTtl);
    let expiryTimer    = null;
    if (effectiveTtl !== null) {
      expiryTimer = setTimeout(async () => {
        controller.abort();
        const irEntry = agent.stateManager.getTask(`ir:${taskId}`);
        if (irEntry?.rejecter) irEntry.rejecter(new Error('Task expired'));
        agent.stateManager.deleteTask(`ir:${taskId}`);
        agent.stateManager.deleteTask(`abort:${taskId}`);
        await t.sendOneWay(envelope._from, {
          type: 'task-expired', taskId,
        }).catch(() => {});
      }, effectiveTtl);
    }
    cleanup = () => {
      clearTimeout(expiryTimer);
      agent.stateManager.deleteTask(`abort:${taskId}`);
    };
    return controller.signal;
  };

  const res = await runGatedSkill(agent, {
    skillId, parts,
    from:      envelope._from,
    token:     _token,
    origin:    _origin,
    originSig: _originSig,
    originTs:  _originTs,
    taskId, envelope, onGatePassed,
  });

  // Async generator → streaming path.
  if (res.status === 'stream') {
    await _runStreamingHandler(t, agent, envelope, taskId, res.gen, res.ctx.signal, cleanup);
    return true;
  }

  // Handler paused for input → multi-round IR loop.
  if (res.status === 'input-required') {
    await _handleInputRequired(
      t, agent, envelope, taskId, res.skill, res.ctx, res.irErr, res.ctx.signal, cleanup,
    );
    return true;
  }

  if (res.status === 'completed') {
    cleanup();
    await t.respond(envelope._from, envelope._id, {
      type:   'task-result',
      taskId,
      status: 'completed',
      parts:  res.parts,
    }).catch(err => agent.emit('error', err));
    return true;
  }

  // Failed: gate denial (plain respond) vs handler error (warn + skill-error).
  cleanup();
  if (res.handlerError) {
    await _respondFailed(t, agent, envelope, taskId, res.err);
  } else {
    await t.respond(envelope._from, envelope._id, {
      type:   'task-result',
      taskId,
      status: 'failed',
      error:  res.error,
      parts:  [],
    }).catch(() => {});
  }
  return true;
}

/**
 * The transport-independent receiver-side gate + regular-handler result path.
 * Runs the SAME policy → skill-lookup → group-visibility → origin-verification
 * gate as the wire path, then invokes the skill handler for the common
 * request→result case. Shared by both handleTaskRequest (wire) and the B★
 * in-process fast-path so error strings + gate semantics are identical.
 *
 * Streaming / InputRequired handlers are NOT resolved here — they are returned
 * to the caller (`{ status:'stream' | 'input-required', ... }`) which owns the
 * transport-specific ST/SE + IR machinery.
 *
 * @param {import('../Agent.js').Agent} agent  — the RECEIVER agent
 * @param {object} p
 * @param {string} p.skillId
 * @param {import('../Parts.js').Part[]} [p.parts]
 * @param {string} p.from                       — caller address (envelope._from)
 * @param {object|null} [p.token]               — capability token JSON
 * @param {string|null} [p.origin]              — relay-forward origin claim
 * @param {string|null} [p.originSig]
 * @param {number|null} [p.originTs]
 * @param {string} [p.taskId]
 * @param {object|null} [p.envelope]
 * @param {(() => AbortSignal|undefined)|null} [p.onGatePassed]  — fired once the
 *        gate passes, before the handler runs; returns the handler's AbortSignal.
 * @returns {Promise<{status:'completed'|'failed'|'stream'|'input-required', ...}>}
 */
export async function runGatedSkill(agent, {
  skillId, parts = [], from, token = null,
  origin = null, originSig = null, originTs = null,
  taskId = null, envelope = null, onGatePassed = null,
}) {
  // ── Policy check ───────────────────────────────────────────────────────────
  if (agent.policyEngine) {
    try {
      await agent.policyEngine.checkInbound({
        peerPubKey:  from,
        skillId,
        action:      'call',
        token,
        agentPubKey: agent.pubKey,
      });
    } catch (err) {
      return { status: 'failed', error: err.message, parts: [] };
    }
  }

  // ── Skill lookup ───────────────────────────────────────────────────────────
  const skill = agent.skills.get(skillId);
  if (!skill || !skill.enabled) {
    return {
      status: 'failed',
      error:  skill ? `Skill "${skillId}" is disabled` : `Unknown skill: "${skillId}"`,
      parts:  [],
    };
  }

  // ── Group-visibility gate (Group X) ───────────────────────────────────────
  // If the skill is restricted to group members, verify the caller holds a
  // valid proof. Non-members receive the same error a missing skill would
  // produce — preserves "don't reveal existence" (aligned with the hello
  // gate in Group W).
  if (typeof skill.visibility === 'object' && Array.isArray(skill.visibility?.groups)) {
    const gm = agent.security?.groupManager;
    let isMember = false;
    if (gm) {
      for (const gid of skill.visibility.groups) {
        try {
          if (await gm.hasValidProof(from, gid)) { isMember = true; break; }
        } catch { /* fail-closed */ }
      }
    }
    if (!isMember) {
      return { status: 'failed', error: `Unknown skill: "${skillId}"`, parts: [] };
    }
  }

  // ── Origin signature verification (Group Z) ──────────────────────────────
  // Default: no verified origin. If the caller carries _origin + _originSig +
  // _originTs, verify against canonicalize({ v:1, target: agent.pubKey, skill,
  // parts, ts }). On success → trust the claim. On failure → fall back to the
  // relay's pubkey and emit a security-warning. Missing sig entirely is the
  // backward-compat case (pre-Z callers) — attribute to `from` silently.
  let verifiedOrigin   = false;
  let attributedOrigin = from;
  if (origin && originSig && typeof originTs === 'number') {
    const vres = verifyOrigin(
      {
        origin,
        sig:  originSig,
        body: { v: 1, target: agent.pubKey, skill: skillId, parts, ts: originTs },
      },
      { expectedPubKey: agent.pubKey },
    );
    if (vres.ok) {
      verifiedOrigin   = true;
      attributedOrigin = origin;
    } else {
      agent.emit('security-warning', {
        kind:   'origin-signature',
        reason: vres.reason,
        envelope,
      });
    }
  } else if (origin) {
    // _origin present but no sig → unverified claim; attribute to `from`.
    attributedOrigin = from;
  }

  // Gate passed. Let the wire path stand up its AbortController + TTL now
  // (exact original ordering: after the gate, before the handler).
  const signal = onGatePassed ? onGatePassed() : undefined;

  // If `origin` is set we came through a relay. Expose both the immediate
  // sender (`from` = the relay) and the original caller (originFrom).
  const ctx = {
    parts,
    from,
    originFrom:     attributedOrigin,
    originVerified: verifiedOrigin,
    relayedBy:      origin ? from : null,
    taskId,
    envelope,
    agent,
    signal,
  };

  let result;
  try {
    result = skill.handler(ctx);
  } catch (err) {
    return { status: 'failed', error: err?.message ?? String(err), parts: [], handlerError: true, err };
  }

  // Async generator → streaming; hand back to the caller's ST/SE machinery.
  if (isAsyncGen(result)) return { status: 'stream', gen: result, skill, ctx };

  let resolved;
  try {
    resolved = await result;
  } catch (err) {
    if (err?.name === 'InputRequired') return { status: 'input-required', irErr: err, skill, ctx };
    return { status: 'failed', error: err?.message ?? String(err), parts: [], handlerError: true, err };
  }

  const outParts = resolved == null    ? []
    : Array.isArray(resolved)          ? resolved
    : Parts.wrap(resolved);

  return { status: 'completed', parts: outParts, ctx };
}

// ── OW sub-type dispatcher ────────────────────────────────────────────────────

/**
 * Dispatch an inbound OW envelope that carries a task sub-type.
 * Returns true if handled.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {object} envelope  — decrypted OW/AS envelope
 */
export function handleTaskOneWay(agent, envelope) {
  const payload = envelope.payload ?? {};
  const { type, taskId, parts = [] } = payload;

  // Group CC3b: sealed-tunnel-ow OWs carry their taskId inside the
  // ciphertext — they're opaque to the bridge that forwards them.
  // Handle before the taskId guard.
  if (type === 'sealed-tunnel-ow') {
    return _dispatchSealedTunnelOW(agent, envelope, payload);
  }

  if (!taskId) return false;

  const task = agent.stateManager.getTask(taskId);

  switch (type) {
    case 'stream-chunk':
      if (task) task._pushChunk(parts);
      return true;

    case 'stream-end':
      if (task) {
        if (parts.length) task._pushChunk(parts);
        task._closeStream();
      }
      return true;

    case 'input-required':
      if (task) task._transition('input-required', { parts });
      return true;

    case 'task-expired':
      if (task) task._transition('expired');
      agent.stateManager.deleteTask(taskId);
      return true;

    // ── Group CC: terminal OW carrying Carol's final state through a bridge ──
    // Used by tunnel-open (bridge side) to deliver Carol's terminal to Alice
    // after the outer RQ/RS round-trip already closed with { tunnelId, ... }.
    case 'tunnel-result':
      if (task) {
        const status = payload.status ?? 'failed';
        if (status === 'completed') {
          task._transition('completed', { parts: payload.parts ?? [] });
        } else if (status === 'cancelled') {
          task._transition('cancelled');
        } else if (status === 'expired') {
          task._transition('expired');
        } else {
          task._transition('failed', { error: payload.error ?? 'tunnel-failed' });
        }
      }
      agent.stateManager.deleteTask(taskId);
      return true;

    case 'cancel':
      if (task) task._transition('cancelled');
      // Abort any running inbound handler.
      { const abortEntry = agent.stateManager.getTask(`abort:${taskId}`);
        if (abortEntry?.controller) abortEntry.controller.abort();
        agent.stateManager.deleteTask(`abort:${taskId}`);
      }
      // Unblock any pending input-required wait so the loop can exit cleanly.
      { const irEntry = agent.stateManager.getTask(`ir:${taskId}`);
        if (irEntry?.rejecter) irEntry.rejecter(new Error('Task cancelled'));
        agent.stateManager.deleteTask(`ir:${taskId}`);
      }
      agent.stateManager.deleteTask(taskId);
      return true;

    case 'task-input':
      // RI — resume inbound handler that was paused for input.
      { const entry = agent.stateManager.getTask(`ir:${taskId}`);
        if (entry?.resolver) entry.resolver(parts);
        agent.stateManager.deleteTask(`ir:${taskId}`);
      }
      return true;

    // sealed-tunnel-ow is handled above the taskId guard — its taskId
    // lives inside the ciphertext and is only known post-decrypt.

    default:
      return false;
  }
}

function _dispatchSealedTunnelOW(agent, envelope, payload) {
  const { tunnelId, sealed, nonce } = payload ?? {};
  if (!tunnelId || !sealed || !nonce) return false;

  const entry = agent._sealedTunnelKeys?.get(tunnelId);
  if (!entry) {
    // Drop unknown tunnels silently — may be a stale OW racing a
    // just-closed tunnel, or a mis-routed one.
    return true;
  }

  const innerOW = openTunnelOW({ key: entry.K, sealed, nonce });
  if (!innerOW) {
    agent.emit?.('security-warning', {
      kind:   'sealed-tunnel-ow',
      reason: 'open-failed',
      envelope,
    });
    return true;
  }

  // Inject the local taskId — the inner OW doesn't carry it (saves wire
  // bytes; the taskId is implied by the tunnelId ↔ task binding kept in
  // _sealedTunnelKeys).  Re-dispatch through handleTaskOneWay so the
  // standard switch above handles stream-chunk / IR / cancel / etc.
  const synthEnvelope = {
    ...envelope,
    payload: { ...innerOW, taskId: entry.taskId },
  };
  return handleTaskOneWay(agent, synthEnvelope);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function _runStreamingHandler(t, agent, envelope, taskId, gen, signal, cleanup) {
  try {
    for await (const chunk of gen) {
      if (signal?.aborted) {
        await gen.return?.();
        cleanup();
        return;
      }
      const chunkParts = chunk == null ? []
        : Array.isArray(chunk) ? chunk
        : Parts.wrap(chunk);
      await t.sendOneWay(envelope._from, {
        type:  'stream-chunk',
        taskId,
        parts: chunkParts,
      });
    }
    if (signal?.aborted) { cleanup(); return; }
    cleanup();
    await t.respond(envelope._from, envelope._id, {
      type:   'task-result',
      taskId,
      status: 'completed',
      parts:  [],
    });
  } catch (err) {
    cleanup();
    if (err?.name === 'AbortError' || signal?.aborted) return;
    await _respondFailed(t, agent, envelope, taskId, err);
  }
}

/**
 * Multi-round input-required loop.
 * Re-invokes the skill handler each time new parts arrive.
 * Loops until the handler returns a result, throws a non-InputRequired error,
 * is aborted (cancel/expiry), or times out.
 */
async function _handleInputRequired(t, agent, envelope, taskId, skill, ctx, irErr, signal, cleanup, resolveTerminal = null) {
  // `resolveTerminal` (B★ in-process fast-path) redirects the terminal
  // completion/failure to the caller Task instead of a wire RS. When null,
  // the wire path behaviour is byte-identical to before.
  const _completed = resolveTerminal
    ? (parts) => resolveTerminal('completed', parts, null)
    : (parts) => t.respond(envelope._from, envelope._id, {
        type: 'task-result', taskId, status: 'completed', parts,
      }).catch(() => {});
  const _failed = resolveTerminal
    ? (err) => resolveTerminal('failed', [], err)
    : (err) => _respondFailed(t, agent, envelope, taskId, err);

  while (true) {
    if (signal?.aborted) { cleanup(); return; }

    let inputParts;
    try {
      inputParts = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Input-required timeout')),
          120_000,
        );
        agent.stateManager.createTask(`ir:${taskId}`, {
          resolver: (p)   => { clearTimeout(timer); resolve(p); },
          rejecter: (err) => { clearTimeout(timer); reject(err); },
        });
        t.sendOneWay(envelope._from, {
          type:  'input-required',
          taskId,
          parts: irErr.parts ?? [],
        }).catch(err => { clearTimeout(timer); reject(err); });
      });
    } catch (err) {
      cleanup();
      if (err.message !== 'Task expired' && !signal?.aborted) {
        await _failed(err);
      }
      return;
    }

    if (signal?.aborted) { cleanup(); return; }

    const newCtx = { ...ctx, parts: inputParts };
    let resumed;
    try {
      resumed = await skill.handler(newCtx);
    } catch (err) {
      if (err?.name === 'InputRequired') {
        irErr = err;
        ctx   = newCtx;
        continue;
      }
      cleanup();
      await _failed(err);
      return;
    }

    cleanup();
    const outParts = resumed == null    ? []
      : Array.isArray(resumed)          ? resumed
      : Parts.wrap(resumed);

    await _completed(outParts);
    return;
  }
}

/** Log + emit a skill handler error (shared by wire + fast-path). */
function _emitSkillError(agent, skillId, err) {
  console.warn('[taskExchange] skill error:', skillId, err?.message);
  agent.emit('skill-error', { skillId, error: err });
}

async function _respondFailed(t, agent, envelope, taskId, err) {
  _emitSkillError(agent, envelope.payload?.skillId, err);
  await t.respond(envelope._from, envelope._id, {
    type:   'task-result',
    taskId,
    status: 'failed',
    error:  err?.message ?? String(err),
    parts:  [],
  }).catch(() => {});
}

// ── Routing feedback helpers (Group EE) ──────────────────────────────────────
// Both helpers are best-effort: any failure in reporting is swallowed so it
// never breaks the call.  Lookup by transport INSTANCE (not by name) so we
// don't depend on Agent.transportFor returning the name.

function _transportNameFor(agent, transportInstance) {
  if (!agent?.transportNames || !transportInstance) return null;
  for (const name of agent.transportNames) {
    if (agent.getTransport(name) === transportInstance) return name;
  }
  return null;
}

function _reportSuccess(agent, peerId, transportInstance, latencyMs) {
  try {
    const name = _transportNameFor(agent, transportInstance);
    if (!name || name === 'default') return;
    agent.routing?.fallbackTable?.record?.(peerId, name, latencyMs);
  } catch { /* never break the call path */ }
}

function _reportFailure(agent, peerId, err) {
  // We don't know which transport was chosen at failure time (transportFor
  // doesn't expose the name).  Conservative: mark the agent's primary
  // secondary transports degraded only if error suggests transport-level
  // failure, not an app-layer timeout from a downstream skill handler.
  try {
    const msg = err?.message ?? '';
    if (!/not connected|timeout|disconnected|unreachable|read property/i.test(msg)) return;
    const routing = agent?.routing;
    if (!routing?.onTransportFailure) return;
    // Without a name, we can't mark a specific pair degraded — but we can
    // at least nudge any transport whose canReach currently returns false.
    // The router will then filter them out next time via canReach anyway,
    // so this is defensive belt-and-braces.
    for (const name of agent.transportNames ?? []) {
      if (name === 'default') continue;
      const t = agent.getTransport(name);
      if (typeof t?.canReach === 'function' && !t.canReach(peerId)) {
        routing.onTransportFailure(peerId, name);
      }
    }
  } catch { /* never break the call path */ }
}
