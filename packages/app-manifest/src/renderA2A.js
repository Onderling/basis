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
  // Authority over authority: a connection that could grant connections is a connection that owns you.
  'household.grantSurface',
  'household.revokeSurface',
  'household.listSurfaceGrants',
]));

/**
 * @param {import('./schema.js').Manifest|import('./schema.js').Manifest[]} manifestOrList
 * @param {object} args
 * @param {(appOrigin:string, opId:string, args:object)=>Promise<any>} args.callSkill — the waist
 * @param {object} [opts]
 * @param {(opId:string)=>boolean} [opts.isNeverDelegable] — override the withhold predicate (tests)
 * @param {(parts:any)=>object} [opts.readArgs] — how to read args off the inbound Parts
 * @returns {Array<{id:string, handler:Function, visibility:string, policy:string, description:string}>}
 *   Skill definitions, ready for `SkillRegistry.register`. NOT registered here — this is a projector, and
 *   deciding WHICH agent exposes them is the composing app's call, not the manifest's.
 */
export function renderA2A(manifestOrList, args, opts = {}) {
  const list = Array.isArray(manifestOrList) ? manifestOrList : [manifestOrList];
  const { callSkill } = args || {};
  if (typeof callSkill !== 'function') throw new Error('renderA2A: callSkill required');
  const isNever = opts.isNeverDelegable ?? ((opId) => NEVER_DELEGABLE.has(opId));
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
        handler:     async ({ parts }) => callSkill(appOrigin, op.id, readArgs(parts)),
      });
    }
  }
  return out;
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
