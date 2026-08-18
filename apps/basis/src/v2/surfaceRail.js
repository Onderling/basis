/**
 * surfaceRail — the remote surface's acting door: a paired view drives THIS agent's waist.
 *
 * The remote surface is another interface compiling to the one dispatch: what travels is
 * `{op, args}` plus the presented capability token, and what runs is `callSkill` — never a
 * second dispatch path. The trust boundary is entirely on the ACTING side (this file's
 * handler): the view's code is untrusted by construction, so every act is verified here
 * against the tokens the owner materialized (`surfaceGrants.js`) before anything dispatches.
 *
 * Reading is NOT this rail: a view reads through the sealed history mirror (it hydrates like
 * a restoring device) and is nudged to re-pull; this rail carries only acts and their
 * replies. The reply confirms/refuses the act — durable state reaches the view via the
 * mirror, not via a subscription.
 *
 * Verification ladder, in refusal order (each names its code so the view can render an
 * honest reason):
 *   bad-shape          the envelope is missing its parts
 *   bad-token          token signature/expiry fails, or it binds a different acting agent
 *   untrusted-issuer   the token was not issued by THIS agent's granting identity — a view
 *                      cannot self-issue authority (the enforceability test's teeth)
 *   revoked            the owner revoked this surface; the blob the view holds is dead
 *   wrong-subject      the sender claims a key the token was not issued to
 *   bad-signature      the envelope body was not signed by the claimed view key (or was
 *                      tampered after signing)
 *   out-of-scope       the op is outside this token's granted skill (`offeringMatches` —
 *                      the same matcher `PolicyEngine` applies to presented tokens)
 *   replay             a request id this door has already dispatched
 *   not-ready          the grant registry has not loaded yet, so the door cannot know what was
 *                      revoked — and "I don't know" must read as no, not as yes
 */
import { CapabilityToken, AgentIdentity, offeringMatches, b64encode, b64decode } from '@onderling/core';

/** Wire subtypes (`makePeerRouter` keys). */
export const SURFACE_ACT_SUBTYPES = Object.freeze({
  request: 'surface-act-request',
  result:  'surface-act-result',
});

/** The CONTENTLESS re-pull nudge: "your edition has a new batch — come read". Carries the lane
 *  id and NOTHING else (no entries, no counts of what changed, no circle names) — content
 *  reaches a view only through its sealed lane, never through a wake channel. */
export const SURFACE_NUDGE_SUBTYPE = 'surface-lane-nudge';

/** Deterministic byte serialisation for signing: JSON with sorted keys, utf-8. */
function canonicalBytes(obj) {
  const sorted = (v) => {
    if (Array.isArray(v)) return v.map(sorted);
    if (v && typeof v === 'object') {
      return Object.keys(v).sort().reduce((acc, k) => { acc[k] = sorted(v[k]); return acc; }, {});
    }
    return v;
  };
  return new TextEncoder().encode(JSON.stringify(sorted(obj)));
}

let seq = 0;

/**
 * The view side: build, sign, and send acts; resolve replies.
 *
 * @param {object} a
 * @param {{pubKey: string, sign: Function}} a.identity  the view's keypair (the token subject)
 * @param {(payload: object) => (void|Promise<void>)} a.send  delivers the envelope to the
 *   acting agent (production: the peer transport; tests: the harness bridge)
 * @param {number} [a.timeoutMs=8000]
 */
export function makeSurfaceActClient({ identity, send, timeoutMs = 8000 } = {}) {
  if (!identity || typeof identity.sign !== 'function') {
    throw new Error('makeSurfaceActClient: a signing identity is required');
  }
  /** requestId → {resolve, timer} */
  const pending = new Map();

  return {
    viewPubKey: identity.pubKey,

    /**
     * Send one act. Resolves with the reply payload `{ok, parts?|code?}`; refusals resolve
     * (not reject) so a surface can render them.
     * @param {object} act
     * @param {string} act.group   waist group (e.g. 'params')
     * @param {string} act.op      op id within the group (e.g. 'set-param')
     * @param {object} [act.args]
     * @param {object} act.token   the CapabilityToken JSON covering `group.op`
     */
    act({ group, op, args = {}, token } = {}) {
      const requestId = `sa-${Date.now().toString(36)}-${(seq += 1)}`;
      const body = { requestId, group, op, args, ts: Date.now() };
      const sig = b64encode(identity.sign(canonicalBytes(body)));
      const payload = {
        subtype: SURFACE_ACT_SUBTYPES.request,
        body, sig, token,
        viewPubKey: identity.pubKey,
      };
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          resolve({ ok: false, code: 'timeout' });
        }, timeoutMs);
        pending.set(requestId, { resolve, timer });
        Promise.resolve(send(payload)).catch(() => {
          clearTimeout(timer);
          pending.delete(requestId);
          resolve({ ok: false, code: 'send-failed' });
        });
      });
    },

    /** Register the re-pull reaction (typically: hydrate the lane again). One listener. */
    onNudge(cb) { this._nudgeCb = typeof cb === 'function' ? cb : null; },

    /** Router hook for `surface-lane-nudge` payloads — fires the registered re-pull. */
    handleNudge(payload) {
      if (!this._nudgeCb) return false;
      this._nudgeCb({ laneId: payload?.laneId ?? null });
      return true;
    },

    /** Router hook for `surface-act-result` payloads. */
    handleResult(payload) {
      const entry = pending.get(payload?.requestId);
      if (!entry) return false;
      clearTimeout(entry.timer);
      pending.delete(payload.requestId);
      entry.resolve({ ok: payload.ok === true, ...(payload.parts !== undefined ? { parts: payload.parts } : {}), ...(payload.code ? { code: payload.code } : {}) });
      return true;
    },
  };
}

/**
 * The acting side: the verification door in front of `callSkill`.
 *
 * @param {object} a
 * @param {string} a.agentPubKey   this acting agent's pubKey (the token `agentId` binding)
 * @param {string} a.issuerPubKey  the granting identity's pubKey — the ONLY trusted issuer
 * @param {(tokenId: string) => boolean} a.isRevoked  the grant registry's revocation answer
 * @param {() => boolean} [a.isReady]  whether the registry has loaded; while false the door
 *   refuses everything, because an unloaded revocation set cannot answer "was this revoked?"
 * @param {(group: string, op: string, args: object) => Promise<*>} a.callSkill
 * @param {(payload: object) => (void|Promise<void>)} a.reply  delivers the result back to the view
 * @returns {(fromAddr: string, payload: object) => Promise<void>} a `makePeerRouter` handler
 *   for the `surface-act-request` subtype
 */
export function makeSurfaceActHandler({ agentPubKey, issuerPubKey, isRevoked, isReady, callSkill, reply } = {}) {
  if (!agentPubKey || !issuerPubKey) throw new Error('makeSurfaceActHandler: agentPubKey + issuerPubKey required');
  if (typeof callSkill !== 'function' || typeof reply !== 'function') {
    throw new Error('makeSurfaceActHandler: callSkill + reply required');
  }
  const revoked = typeof isRevoked === 'function' ? isRevoked : () => false;
  const registryReady = typeof isReady === 'function' ? isReady : () => true;
  /** Dispatched request ids (replay refusal). Bounded: pruned when large. */
  const seen = new Map();
  const SEEN_CAP = 2048;

  const refuse = (requestId, code) => reply({ subtype: SURFACE_ACT_SUBTYPES.result, requestId, ok: false, code });

  return async function handleSurfaceAct(fromAddr, payload) {
    const { body, sig, token, viewPubKey } = payload ?? {};
    const requestId = body?.requestId;
    if (!requestId || typeof body.group !== 'string' || typeof body.op !== 'string'
      || typeof sig !== 'string' || !token || typeof viewPubKey !== 'string') {
      return refuse(requestId ?? 'unknown', 'bad-shape');
    }
    // Before any token check: if the durable registry has not loaded, this door cannot say
    // whether the token was revoked, and an unanswerable revocation question is a NO.
    if (!registryReady()) return refuse(requestId, 'not-ready');
    // Token: signature + expiry + this-agent binding, then issuer trust, revocation, subject.
    if (!CapabilityToken.verify(token, agentPubKey)) return refuse(requestId, 'bad-token');
    if (token.issuer !== issuerPubKey)               return refuse(requestId, 'untrusted-issuer');
    if (revoked(token.id))                           return refuse(requestId, 'revoked');
    if (token.subject !== viewPubKey)                return refuse(requestId, 'wrong-subject');
    // Envelope: the sender must PROVE it holds the subject key, over the exact body it sent.
    let sigOk = false;
    try { sigOk = AgentIdentity.verify(canonicalBytes(body), b64decode(sig), viewPubKey); } catch { sigOk = false; }
    if (!sigOk) return refuse(requestId, 'bad-signature');
    // Scope: the op must fall inside the token's granted skill.
    if (!offeringMatches(token.skill, `${body.group}.${body.op}`)) return refuse(requestId, 'out-of-scope');
    // Replay: one dispatch per request id.
    if (seen.has(requestId)) return refuse(requestId, 'replay');
    if (seen.size >= SEEN_CAP) {
      const cutoff = [...seen.entries()].sort((a, b) => a[1] - b[1]).slice(0, SEEN_CAP / 2);
      for (const [k] of cutoff) seen.delete(k);
    }
    seen.set(requestId, Date.now());

    try {
      const parts = await callSkill(body.group, body.op, body.args ?? {});
      await reply({ subtype: SURFACE_ACT_SUBTYPES.result, requestId, ok: true, parts });
    } catch (e) {
      await reply({ subtype: SURFACE_ACT_SUBTYPES.result, requestId, ok: false, code: 'op-failed', error: e?.message ?? 'op-failed' });
    }
  };
}
