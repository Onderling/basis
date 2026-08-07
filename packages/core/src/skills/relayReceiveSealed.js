/**
 * relayReceiveSealed — inbound half of blind-forward (Group BB3).
 *
 * Registers the `relay-receive-sealed` skill on an agent. When a bridge
 * invokes this skill, the handler:
 *   1. Opens the sealed payload (nacl.box) with the agent's identity.
 *   2. Cross-checks the outer `sender` against the inner `origin`
 *      (packSealed authenticates on sender key; mismatch → drop).
 *   3. Verifies the Group Z origin signature.
 *   4. Dispatches the inner skill invocation through the agent's normal
 *      skill registry, with ctx.originFrom set to the verified origin
 *      and ctx.originVerified = true.
 *   5. Returns the handler's result as its own return value, so the
 *      bridge can forward it back to the original caller.
 *
 * See Design-v3/blind-forward.md §5.
 */
import { Parts, DataPart }  from '../Parts.js';
import { openSealed }       from '../security/sealedForward.js';
import { verifyOrigin, ORIGIN_SIG_VERSION } from '../security/originSignature.js';

/**
 * Register the `relay-receive-sealed` skill on `agent`.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {object} [opts]
 * @param {'public'|'authenticated'|'trusted'|'private'} [opts.visibility='authenticated']
 *        Who may invoke the receiver. Defaults to 'authenticated' — the
 *        bridge has already completed a hello with us. Content-privacy
 *        comes from nacl.box, not from this gate.
 */
export function registerRelayReceiveSealed(agent, opts = {}) {
  if (agent.skills.get('relay-receive-sealed')) return;

  const visibility = opts.visibility ?? 'authenticated';

  agent.register('relay-receive-sealed', async ({ parts, from, envelope }) => {
    const d = Parts.data(parts);
    if (!d?.sealed || !d?.nonce || !d?.sender) {
      return [DataPart({ error: 'missing sealed / nonce / sender' })];
    }

    // ── 1-2. Open the seal (also does sender/origin cross-check) ───────────
    let inner;
    try {
      inner = openSealed({
        identity:     agent.identity,
        sealed:       d.sealed,
        nonce:        d.nonce,
        senderPubKey: d.sender,
      });
    } catch (err) {
      agent.emit('security-warning', {
        kind:   'sealed-forward-open',
        reason: err.message,
        envelope,
      });
      return [DataPart({ error: `seal-open-failed: ${err.message}` })];
    }

    // ── 3. Verify origin signature ─────────────────────────────────────────
    const res = verifyOrigin(
      {
        origin: inner.origin,
        sig:    inner.originSig,
        body: {
          v:      ORIGIN_SIG_VERSION,
          target: agent.pubKey,
          skill:  inner.skill,
          parts:  inner.parts,
          ts:     inner.originTs,
        },
      },
      { expectedPubKey: agent.pubKey },
    );
    if (!res.ok) {
      agent.emit('security-warning', {
        kind:   'sealed-forward-origin',
        reason: res.reason,
        envelope,
      });
      return [DataPart({ error: `origin-verify-failed: ${res.reason}` })];
    }

    agent.emit('sealed-forward-received', {
      origin:    inner.origin,
      skill:     inner.skill,
      relayedBy: from,
    });

    // ── 4. Look up the inner skill ─────────────────────────────────────────
    const innerSkill = agent.skills.get(inner.skill);
    if (!innerSkill || !innerSkill.enabled) {
      return [DataPart({
        error: innerSkill ? `Skill "${inner.skill}" is disabled`
                          : `Unknown skill: "${inner.skill}"`,
      })];
    }

    // ── 4b. Group-visibility gate ──────────────────────────────────────────
    // Check the VERIFIED origin's group membership, not the bridge's — blind
    // forward must preserve the "could Alice have called this directly?"
    // question when deciding visibility.
    const vis = innerSkill.visibility;
    if (typeof vis === 'object' && Array.isArray(vis?.groups)) {
      const gm = agent.security?.groupManager;
      let isMember = false;
      if (gm) {
        for (const gid of vis.groups) {
          try {
            if (await gm.hasValidProof(inner.origin, gid)) { isMember = true; break; }
          } catch { /* fail closed */ }
        }
      }
      if (!isMember) {
        return [DataPart({ error: `Unknown skill: "${inner.skill}"` })];
      }
    }

    // ── 5. Dispatch the inner skill handler ────────────────────────────────
    // We deliberately keep this lean: no TTL, no InputRequired, no streaming
    // over the sealed path for now. Those are composable extensions but
    // chat/receive-message uses a regular async handler which is all we need.
    const ctx = {
      parts:          inner.parts,
      from,                                 // immediate bridge caller
      originFrom:     inner.origin,         // verified end-to-end origin
      originVerified: true,
      relayedBy:      from,
      envelope,
      agent,
      signal:         new AbortController().signal,
    };

    try {
      const result   = await innerSkill.handler(ctx);
      const outParts = result == null          ? []
        : Array.isArray(result)                ? result
        : Parts.wrap(result);
      return outParts;
    } catch (err) {
      agent.emit('skill-error', { skillId: inner.skill, error: err });
      return [DataPart({ error: `skill-failed: ${err?.message ?? err}` })];
    }
  }, {
    visibility,
    description: 'Receive a sealed skill invocation forwarded by a bridge (blind-forward)',
  });
}
