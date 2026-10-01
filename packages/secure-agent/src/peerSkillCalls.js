/**
 * peerSkillCalls — the kernel's own task exchange, carried on the secure channel.
 *
 * The secure agent owns its transports (the relay, NKN, …) and wires their receive side itself
 * (`makeReceiveHandler`); it deliberately does not register them with the kernel `Agent`, whose
 * `addTransport` would clobber that wiring. So a kernel task request (`payload.type === 'task'` —
 * what `agent.invoke(peer, skill, parts)` sends, with its `taskId`, ttl and capability token)
 * arriving over the relay used to reach the app as an ordinary peer message, unrouted, and the
 * caller waited for an answer that never came.
 *
 * This hands such a request to the kernel's own `handleTaskRequest`, on the transport it arrived on,
 * so the gate is the kernel's (`runGatedSkill` → `PolicyEngine.checkInbound`: the token, its subject
 * = the caller, the skill, the issuer, revocation) and the answer goes back the way the request came.
 * The caller is the envelope's `_from` — the sender the security layer authenticated — never a field
 * of the payload. No second protocol: the request and the answer are the kernel's task envelopes.
 *
 * OFF by default: a composition switches it on (`acceptPeerSkillCalls`). A cap on the parts' size and
 * on calls per sender keep one peer from flooding the door; a refused request is answered as a failed
 * task, so the caller hears why instead of waiting out its timeout.
 */
import { handleTaskRequest } from '@onderling/core';
import { createRateLimiter } from './rateLimit.js';

const PEER_SKILL_CALL_DEFAULTS = Object.freeze({
  /** The largest `parts` a call may carry (serialised), in bytes. */
  maxPartsBytes: 64 * 1024,
  /** Calls per sender: a burst, then this many per second (30 a minute). */
  perPeer: Object.freeze({ burst: 10, refillPerSec: 0.5 }),
});

/**
 * @param {object} a
 * @param {import('@onderling/core').Agent} a.agent   the kernel agent whose skills answer
 * @param {number} [a.maxPartsBytes]
 * @param {{burst: number, refillPerSec: number}} [a.perPeer]
 * @param {(e: {from: string, skillId: string|null, reason: string}) => void} [a.onRefused]
 * @param {() => number} [a.now]
 * @returns {(env: object, tx: object) => Promise<void>}  takes a task envelope and the transport it came on
 */
export function makePeerSkillCalls({ agent, maxPartsBytes = PEER_SKILL_CALL_DEFAULTS.maxPartsBytes, perPeer = PEER_SKILL_CALL_DEFAULTS.perPeer, onRefused = null, now } = {}) {
  if (!agent) throw new TypeError('makePeerSkillCalls: agent required');
  const limiter = createRateLimiter({ perPeer, global: false, ...(now ? { now } : {}) });
  return async function acceptPeerSkillCall(env, tx) {
    const from = env?._from;
    if (typeof from !== 'string' || !from || !tx) return;
    const p = env.payload ?? {};
    const refuse = async (reason) => {
      try { onRefused?.({ from, skillId: typeof p.skillId === 'string' ? p.skillId : null, reason }); } catch { /* a listener must not take the door down */ }
      await tx.respond?.(from, env._id, { type: 'task-result', taskId: p.taskId ?? null, status: 'failed', error: reason, parts: [] }).catch(() => {});
    };
    let size = Infinity;
    try { size = JSON.stringify(p.parts ?? []).length; } catch { /* unserialisable → too large */ }
    if (size > maxPartsBytes) return refuse('too-large');
    if (!limiter.check(from)) return refuse('rate-limited');
    await handleTaskRequest(agent, { ...env, _transport: tx });
  };
}
