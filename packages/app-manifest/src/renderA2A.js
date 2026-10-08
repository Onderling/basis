/**
 * renderA2A — project a manifest into KERNEL SKILL definitions, so an agent elsewhere can invoke an op.
 *
 * The family's sixth face. `renderChat` gives the LLM its tools, `renderSlash` the /commands, `renderGate`
 * the deterministic verbs, `renderWeb`/`renderMobile` the screens — and this one gives **another agent**
 * the same ops, over the kernel's existing A2A path (`agent.invoke` → `handleTaskRequest` →
 * `PolicyEngine.checkInbound` → the handler). One declaration, one more projection.
 *
 * WHY THIS EXISTS. There was already a way for an agent to invoke another agent's skill, with capability
 * tokens and revocation, and basis already uses it in-process (`chatAgent.invoke(stoopAgent.address, …)`).
 * What was missing is narrow: no manifest op was ever REGISTERED as a kernel skill, so that path could not
 * reach the waist. A second envelope + a second gate got built beside it instead. This closes the gap the
 * way the architecture asks — a projection of the one declaration — so there is one gate for host, peer,
 * contact and external callers alike (PLAN-homes, Surfaces).
 *
 * THE SCOPING FALLS OUT. `checkInbound` gates by skillId and a `CapabilityToken` carries the skill it is
 * for, matched through `offeringMatches` (exact · `prefix.*` · `*`). Registering ONE skill per op — id
 * `group.op` — therefore makes a grant for `params.set-param` a grant for exactly that, with no new
 * scoping mechanism. A token minted for one op cannot name another.
 *
 * THE WITHHOLD LIST BECOMES A GATE. Ops that must never be delegated (revealing a recovery phrase,
 * enrolling or revoking a device, granting a connection) were withheld by a UI menu that simply did not
 * offer them. That is a convention: a different client would ask anyway. Declared here as
 * `policy: 'never'`, `checkInbound` refuses them unconditionally, whatever the caller runs and whatever
 * token it holds — the enforceability test, satisfied at the place it binds.
 */

/** Ops that may never be reached by an external caller, whatever token it presents. */
export const NEVER_DELEGABLE = Object.freeze(new Set([
  // Secret material: the phrase IS the account. Handing it to a paired screen would hand over the account.
  'household.revealOwnerPhrase',
  'household.restoreOwnerPhrase',
  // Device ceremonies: adding or cutting off a device is the custody boundary itself.
  'household.enrollDevice',
  'household.revokeDevice',
  // Ownership of a node: claiming a companion makes the person's root its owner — a peer must not be able to make
  // someone the owner of a node of the peer's choosing (2026-10-09).
  'household.claimCompanion',
  // …and what that node lets another agent do there: granting it, or reading its choices, has THIS device sign a
  // statement for the person's node — a peer must not get the person's device to sign for it.
  'household.grantCompanion',
  'household.companionGrantChoices',
  'household.companionGrantList',
  'household.revokeCompanionGrant',
  // Authority over authority: a connection that could grant connections is a connection that owns you.
  'household.grantSurface',
  'household.revokeSurface',
  'household.listSurfaceGrants',
  // The pod session (2026-09-01). Signing in navigates a browser to an identity provider and signing out
  // ends the session every other grant is read under — neither is a thing to do TO someone from
  // somewhere else. Withheld here rather than merely omitted from the connection manifest list, because
  // omission is a convention and this is a refusal: `checkInbound` turns them down before a token is
  // read, whatever the caller presents.
  'basis.signin',
  'basis.signout',
]));

/**
 * @param {import('./schema.js').Manifest|import('./schema.js').Manifest[]} manifestOrList
 * @param {object} args
 * @param {(appOrigin:string, opId:string, args:object)=>Promise<any>} args.callSkill — the waist
 * @param {object} [opts]
 * @param {(opId:string)=>boolean} [opts.isNeverDelegable] — override the withhold predicate (tests)
 * @param {(parts:any)=>object} [opts.readArgs] — how to read args off the inbound Parts
 * @param {(handlerCtx:object, op:{appOrigin:string, opId:string})=>Promise<object|null>|object|null} [opts.ctxFor] — who
 *   a peer's call runs AS: the waist's ctx, from the verified call (its token's `actingAs`). Returning nothing refuses
 *   the call before the op (`not-bound`), and only the op's declared params pass. Absent → no ctx and the args as sent,
 *   as before (a person's own agent: its screen IS the owner).
 * @param {Iterable<string>} [opts.never] — the shell's own withheld ops (`app.opId`), besides the kernel's
 * @returns {Array<{id:string, handler:Function, visibility:string, policy:string, description:string}>}
 *   Skill definitions, ready for `SkillRegistry.register`. NOT registered here — this is a projector, and
 *   deciding WHICH agent exposes them is the composing app's call, not the manifest's.
 */
export function renderA2A(manifestOrList, args, opts = {}) {
  const list = Array.isArray(manifestOrList) ? manifestOrList : [manifestOrList];
  const { callSkill } = args || {};
  if (typeof callSkill !== 'function') throw new Error('renderA2A: callSkill required');
  const extraNever = new Set(opts.never ?? []);
  const isNever = opts.isNeverDelegable ?? ((opId) => NEVER_DELEGABLE.has(opId) || extraNever.has(opId));
  const ctxFor = typeof opts.ctxFor === 'function' ? opts.ctxFor : null;
  const readArgs = opts.readArgs ?? defaultReadArgs;

  const out = [];
  const seen = new Set();
  for (const manifest of list) {
    if (!manifest || !Array.isArray(manifest.operations)) continue;
    const appOrigin = manifest.appId ?? manifest.app;
    if (!appOrigin) continue;
    for (const op of manifest.operations) {
      if (!op?.id) continue;
      const id = `${appOrigin}.${op.id}`;
      if (seen.has(id)) continue;          // first declaration wins, as everywhere else
      seen.add(id);
      out.push({
        id,
        // `requires-token` for everything reachable: an external caller must PRESENT authority, it is
        // never inferred from being able to reach us. `never` short-circuits before any token is even read.
        policy:      isNever(id) ? 'never' : 'requires-token',
        visibility:  'authenticated',
        description: op.surfaces?.chat?.hint ?? `${op.verb ?? 'call'} ${op.id}`,
        handler:     async (hctx) => {
          if (!ctxFor) return callSkill(appOrigin, op.id, readArgs(hctx?.parts));
          // the shell answers as a person: no person for this call → refused before the op, never run as the host
          const ctx = await ctxFor(hctx ?? {}, { appOrigin, opId: op.id });
          if (!ctx) return { ok: false, error: 'not-bound', refusal: { layer: 'admission', code: 'not-bound' } };
          return callSkill(appOrigin, op.id, declaredOnly(readArgs(hctx?.parts), op), ctx);
        },
      });
    }
  }
  return out;
}

/**
 * A peer acting as a person sends the op's DECLARED params, nothing else — the manifest is the contract. A screen is
 * someone else's code: a `circleId` would aim the op at another circle on this node, an `actor` or `threadId` at
 * another person, and the token says neither. `preview` passes where the op declares a confirm preview (a read).
 */
function declaredOnly(args, op) {
  const names = new Set((op.params ?? []).map((p) => p?.name).filter(Boolean));
  if (op.surfaces?.ui?.confirm?.preview === true) names.add('preview');
  return Object.fromEntries(Object.entries(args ?? {}).filter(([k]) => names.has(k)));
}

/** Read `{...args}` off the inbound Parts — a DataPart's data, or the first object-shaped part. */
function defaultReadArgs(parts) {
  const arr = Array.isArray(parts) ? parts : (parts ? [parts] : []);
  for (const p of arr) {
    const d = p?.data ?? p?.content ?? null;
    if (d && typeof d === 'object' && !Array.isArray(d)) return d;
  }
  return {};
}
