/**
 * rulesUpdateLane — a circle's rules-doc UPDATE travels the peer governance lane (V1 closing
 * wave, row 2 — the #80 tail).
 *
 * The initial rules doc reaches a joiner at join (the invite carries it, mirrored into their
 * store), but an UPDATE used to travel only by store/pod sync — on a pod-free circle it reached
 * nobody, so a member's stale-banner ("accepted v1, current v2") could not light until some other
 * channel happened to carry the new doc. This closes that window with the machinery the lane
 * riders already proved:
 *
 *   write:  stoop's `editGroupRules` (the ONE rules writer — the governed changeRule enact routes
 *           through it too) calls the host-injected emitter below, which appends a SIGNED
 *           `rules-update` statement (payload = the full doc + the monotonic version) on the
 *           governance rail and fans it through the existing circle-governance broadcast.
 *   read:   the statement passes the rail's ingest gate like any governance statement; the APPLY
 *           step — kicked from the existing governance onChange sites (live fan + catch-up) —
 *           re-verifies, checks the author's roster role is ADMIN (receiver-enforced authority:
 *           the writer's admin-only check binds nobody else's device), picks the winning version
 *           (highest; tie → statement hash, convergent everywhere), and writes the local mirrored
 *           `group-rules` item iff strictly newer. The fold's rules gate, the stale banner and
 *           the consent screen all read that item — nothing downstream changes.
 *
 * The governance FOLD ignores this kind (it branches on propose/vote/resolve): a rules-update is
 * a carried fact, not a decision. Retention is the lane's (audit window) — the applied store item
 * is the durable head, exactly the task-lane relationship.
 */

/**
 * The write half: append + fan one rules-update statement. Built by the host (realAgent) over its
 * governance-lane rail; injected into stoop as `rulesUpdateEmit` (the membershipEmit pattern).
 *
 * @param {object} a
 * @param {{append: Function}} a.rail  a governance-lane rail (declared kinds include 'rules-update')
 * @param {(circleId: string, statement: object) => void|Promise<*>} [a.fan]  best-effort fan
 * @returns {(u: {groupId: string, rules: object, version: number}) => Promise<object|null>}
 */
export function makeRulesUpdateEmitter({ rail, fan = null } = {}) {
  if (!rail || typeof rail.append !== 'function') {
    throw new Error('makeRulesUpdateEmitter: a governance-lane rail is required');
  }
  return async function emitRulesUpdate({ groupId, rules, version } = {}) {
    if (typeof groupId !== 'string' || !groupId) return null;
    const v = Number.parseInt(version, 10);
    if (!Number.isFinite(v) || v < 1) return null;
    if (!rules || typeof rules !== 'object') return null;
    let res = null;
    try {
      res = await rail.append(groupId, {
        kind: 'rules-update',
        subject: `rules-v${v}`,
        payload: { rules, version: v },
      });
    } catch { res = null; }
    if (!res) return null;
    if (typeof fan === 'function') {
      try { await fan(groupId, res.statement); } catch { /* fan is best-effort — catch-up reconciles */ }
    }
    return res.statement;
  };
}

/**
 * The catch-up serve's durable-head hook: the preserved signed rules-update statement for a
 * circle, as an array `makeGovernanceCatchUp({ extraStatementsFor })` appends to its batch. The
 * final setting is never deletable — the lane's entry compacts with governance's audit window,
 * but the head (the local `group-rules` item) carries the ORIGINAL statement forever, so a member
 * offline past the window still converges, verifiably, from any peer.
 *
 * @param {object} a
 * @param {Function} a.callSkill
 * @param {string} a.circleId
 * @returns {Promise<object[]>}
 */
export async function preservedRulesStatementsFor({ callSkill, circleId } = {}) {
  if (typeof callSkill !== 'function' || typeof circleId !== 'string' || !circleId) return [];
  try {
    const r = await callSkill('stoop', 'getGroupRulesUpdateStatement', { groupId: circleId });
    return (r?.statement?.body && typeof r.statement.sig === 'string') ? [r.statement] : [];
  } catch { return []; }
}

/**
 * The read half: fold the lane's verified rules-update statements into the local store's
 * `group-rules` head. Idempotent and convergent — safe to call on every governance change signal.
 *
 * Authority is verified HERE, at the receiver (the enforceability doctrine): a statement only
 * counts when its author (resolved to their member ref by the rail's binding gate) currently
 * holds the ADMIN role on this device's roster. Deny-by-default: unknown ref, non-admin, or a
 * malformed payload simply never applies.
 *
 * @param {object} a
 * @param {{storedStatements: Function, readVerifiedBodies: Function}} a.rail  the receive-side governance rail
 * @param {Function} a.callSkill
 * @param {string} a.circleId
 * @returns {Promise<{applied: boolean, version?: number}>}
 */
export async function applyRulesUpdates({ rail, callSkill, circleId } = {}) {
  if (!rail || typeof callSkill !== 'function' || typeof circleId !== 'string' || !circleId) {
    return { applied: false };
  }
  // Cheap pre-scan: most governance churn is votes — do not run the verified read (which
  // re-verifies every statement on the lane) unless a rules-update is actually present.
  let present = false;
  try {
    present = rail.storedStatements(circleId).some((s) => s?.body?.kind === 'rules-update');
  } catch { present = false; }
  if (!present) return { applied: false };

  let bodies = [];
  try { bodies = (await rail.readVerifiedBodies(circleId))?.bodies ?? []; } catch { return { applied: false }; }
  const updates = bodies.filter((b) => b?.kind === 'rules-update'
    && b.payload && typeof b.payload === 'object'
    && b.payload.rules && typeof b.payload.rules === 'object'
    && Number.isFinite(Number.parseInt(b.payload.version, 10)));
  if (updates.length === 0) return { applied: false };

  // Receiver-enforced authority: the author must be an ADMIN on this device's roster.
  let admins = new Set();
  try {
    const r = await callSkill('stoop', 'listGroupMembers', { groupId: circleId });
    admins = new Set((Array.isArray(r?.members) ? r.members : [])
      .filter((m) => m && m.role === 'admin')
      .map((m) => m.webid ?? m.addr ?? m.ref)
      .filter(Boolean));
  } catch { admins = new Set(); }
  const authorised = updates.filter((b) => admins.has(b.author));
  if (authorised.length === 0) return { applied: false };

  // The winner: highest version; a version tie breaks on statement hash — deterministic, so two
  // admins racing the same bump converge to ONE doc on every device.
  const winner = authorised.reduce((a, b) => {
    const va = Number.parseInt(a.payload.version, 10);
    const vb = Number.parseInt(b.payload.version, 10);
    if (vb > va) return b;
    if (vb < va) return a;
    return b.hash > a.hash ? b : a;
  });
  const winnerVersion = Number.parseInt(winner.payload.version, 10);

  // The winner's ORIGINAL raw statement (the verified read resolves author→ref on the body; the
  // stored form keeps the signature) — preserved on the mirror item so THIS device can serve it
  // at catch-up after the lane's audit window compacts the entry away.
  let rawStatement = null;
  try {
    rawStatement = rail.storedStatements(circleId).find((s) => s?.body?.hash === winner.hash) ?? null;
  } catch { rawStatement = null; }

  // The version guard lives in ONE place — `recordGroupRulesUpdate` refuses anything at or below
  // the local head (idempotency + strictly-newer in the same owner; a second check here would be
  // the two-layers-one-fact drift). NB deliberately not `getGroupRules`: that op's answer is a
  // display projection on some compositions, not the raw item.
  try {
    const rec = await callSkill('stoop', 'recordGroupRulesUpdate', {
      // `updatedBy` = the statement's VERIFIED admin author (the rail resolved the binding, the
      // check above proved the role). The mirror item carries it so the roster's founder-authority
      // derivation works on THIS device too — the receiver's only rules item is the mirror, and an
      // authority fact from a signed, verified statement is exactly what that derivation wants.
      groupId: circleId, rules: winner.payload.rules, version: winnerVersion, updatedBy: winner.author,
      ...(rawStatement ? { statement: rawStatement } : {}),
    });
    if (rec?.error || rec?.applied !== true) return { applied: false };
    return { applied: true, version: winnerVersion };
  } catch { return { applied: false }; }
}
