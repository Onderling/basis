/**
 * `setResourceAccess` — declarative, best-effort access policy for a
 * single pod resource, composed over the existing `client.sharing.*`
 * primitives (Phase 52.16). This does NOT reimplement Solid ACL: it is
 * a thin orchestration layer that turns one policy object into the
 * `sharing.grant` calls that set it, reusing `universalAccess`
 * (ACP/WAC) under the hood.
 *
 * ── Why a primitive (and not raw `sharing.grant` at each call site) ──
 * The commons + registry resources (`@onderling/agent-registry`) each carry
 * a fixed access posture:
 *   - endorsement / community catalogues → **public-read + owner-write**
 *     (+ admin-write for a community's circle admins);
 *   - the agent registry (`/private/`) → **owner-only** (the pod's
 *     default — no grant needed; the owner already holds `control`).
 * Expressing that as one `{ public, agents }` policy — set idempotently,
 * best-effort — keeps every call site declarative and keeps the "which
 * grants make this posture" knowledge in ONE place.
 *
 * ── Best-effort by contract (SECURITY-relevant) ─────────────────────
 * Setting access must NEVER corrupt or block the resource write it
 * follows (mirrors pseudo-pod's best-effort version capture). So this
 * function never throws for a grant failure — it collects per-grant
 * outcomes into a report and (optionally) calls `onError`. The CALLER
 * decides what a partial result means. In particular:
 *   - `@inrupt/solid-client@3.0.0` is a **silent no-op against CSS-ACP**
 *     (verified 2026-05-16 / re-confirmed 2026-07-11: it correctly
 *     detects ACP but cannot write the CSS `.acr`; `sharing.grant`
 *     surfaces this as `SHARING_GRANT_NOOP`). That lands in
 *     `report.errors` — NOT silently swallowed, NOT treated as applied.
 *   - Against **WAC** pods (CSS default, older Inrupt) the grants DO
 *     land and are enforced (public-read → unauth 200; a non-granted
 *     agent's write → 403). That is the proven path
 *     (`test/sharing/setResourceAccess.css.test.js`).
 *
 * @typedef {{ read?: boolean, append?: boolean, write?: boolean, control?: boolean }} AccessFlags
 */

import { PodClientError } from '../Errors.js';

/** Turn an `{read,append,write,control}` flag object into the modes array
 *  `client.sharing.grant` expects. Returns `[]` when nothing is set. */
function flagsToModes(flags) {
  if (!flags || typeof flags !== 'object') return [];
  const modes = [];
  if (flags.read)    modes.push('read');
  if (flags.append)  modes.push('append');
  if (flags.write)   modes.push('write');
  if (flags.control) modes.push('control');
  return modes;
}

/**
 * Apply an access policy to a resource, best-effort.
 *
 * @param {object} opts
 * @param {{ grant: Function }} opts.sharing   — a `client.sharing` namespace
 *   (`podClient.sharing`) OR any object exposing a compatible `grant`.
 * @param {string} opts.resourceUri            — the resource to set access on.
 * @param {AccessFlags} [opts.public]          — public (unauthenticated) access,
 *   e.g. `{ read: true }` for a shared-readable commons resource.
 * @param {Record<string, AccessFlags>} [opts.agents]
 *   — per-WebID grants, e.g. `{ 'https://…/card#me': { read: true, write: true } }`
 *   for a community catalogue's circle admins.
 * @param {(err: Error, ctx: object) => void} [opts.onError]
 *   — invoked per failed grant (never throws out of here regardless).
 * @returns {Promise<{
 *   resourceUri: string,
 *   applied: Array<{ subject: 'public'|'agent', agent?: string, modes: string[] }>,
 *   errors:  Array<{ subject: 'public'|'agent', agent?: string, code?: string, message: string }>,
 * }>}
 */
export async function setResourceAccess({ sharing, resourceUri, public: pub, agents, onError } = {}) {
  if (!sharing || typeof sharing.grant !== 'function') {
    throw new PodClientError(
      'setResourceAccess: a `sharing` namespace with grant() is required (pass podClient.sharing)',
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (typeof resourceUri !== 'string' || resourceUri.length === 0) {
    throw new PodClientError(
      'setResourceAccess: resourceUri is required',
      { code: 'INVALID_ARGUMENT' },
    );
  }

  const applied = [];
  const errors  = [];

  // ── Route by access-control model (ADDITIVE — WAC path unchanged) ──
  // On an ACP resource, `@inrupt/solid-client`'s `universalAccess` (the
  // WAC path below) is a silent no-op — it detects ACP but can't write
  // the CSS `.acr`. So for ACP we use the direct `.acr` writer
  // (`sharing.applyAcp`), which is proven to ENFORCE (unauth read 200,
  // stranger write 403, owner write 205). WAC resources keep going
  // through `sharing.grant` (`universalAccess`) exactly as before, and
  // `SHARING_GRANT_NOOP` stays the safety net there.
  //
  // Detection reuses `sharing.capabilities` (→ `capabilities.js`). If the
  // sharing surface predates ACP routing (no `capabilities`/`applyAcp`),
  // or the probe fails, we fall through to the WAC grant path unchanged.
  let caps = null;
  if (typeof sharing.capabilities === 'function') {
    try { caps = await sharing.capabilities({ resourceUri }); } catch { caps = null; }
  }
  if (caps?.acp === true && typeof sharing.applyAcp === 'function') {
    const r = await sharing.applyAcp({ resourceUri, public: pub, agents });
    for (const a of (r?.applied ?? [])) applied.push(a);
    for (const e of (r?.errors ?? [])) {
      errors.push(e);
      if (typeof onError === 'function') {
        const err = Object.assign(new Error(e.message ?? 'ACP write failed'), { code: e.code });
        try { onError(err, { resourceUri, subject: e.subject, ...(e.agent ? { agent: e.agent } : {}) }); }
        catch { /* onError must not break us */ }
      }
    }
    return { resourceUri, applied, errors };
  }

  async function _grant(spec, ctx) {
    try {
      const g = await sharing.grant(spec);
      applied.push({ subject: ctx.subject, ...(ctx.agent ? { agent: ctx.agent } : {}), modes: g.modes });
    } catch (err) {
      const rec = {
        subject: ctx.subject,
        ...(ctx.agent ? { agent: ctx.agent } : {}),
        code: err?.code,
        message: err?.message ?? String(err),
      };
      errors.push(rec);
      if (typeof onError === 'function') {
        try { onError(err, { resourceUri, ...ctx }); } catch { /* onError must not break us */ }
      }
    }
  }

  // Public (unauthenticated) access — the commons "public-read".
  const publicModes = flagsToModes(pub);
  if (publicModes.length > 0) {
    await _grant({ resourceUri, public: true, modes: publicModes }, { subject: 'public' });
  }

  // Per-agent (WebID) grants — a community catalogue's admin-write set.
  if (agents && typeof agents === 'object') {
    for (const [webId, flags] of Object.entries(agents)) {
      const modes = flagsToModes(flags);
      if (modes.length === 0) continue;
      await _grant({ resourceUri, agent: webId, modes }, { subject: 'agent', agent: webId });
    }
  }

  return { resourceUri, applied, errors };
}
