/**
 * `actor` — the person a call is FOR, vouched for by the tasks engine's host.
 *
 * A host (a household bot, say) serves several people through one key. Every call it makes carries that
 * key as the authority: `from`, and from it `addedBy`, `master` and every role gate, unchanged. It may also
 * name the person the call is for in `args.actor` — a contact id such as `telegram:123`.
 *
 * THE RULE: the engine honours `args.actor` ONLY when the invoking peer IS its host — `from` equals the
 * circle's `hostKey`, the one key the composer declared (default: the engine's own agent key). From any
 * other peer the argument is REFUSED with `{ error: ACTOR_REFUSED, reason }`; it is never silently
 * dropped, because honouring it would let any peer attribute its writes to anyone, and ignoring it would
 * hide that the caller asked. A circle ADMIN is not the host: admin is a role in the circle, host is the
 * composition's own key.
 *
 * How strong the check is: it is as strong as `from`, which is the invoking peer as core hands it to the
 * skill — the same string every role gate in this app already trusts.
 *
 * What honours it (the task-store family in `./index.js`): `addTask` stamps `actor` on the item;
 * `claimTask` puts the actor into the co-owner set (the host's key passes the gate); `listMine` asks
 * "assigned to whom?" for the actor. Every other skill accepts it from the host and acts on the host's
 * authority alone.
 */

/** The refusal code — a peer that is not the host named an actor, or the actor is not a usable id. */
export const ACTOR_REFUSED = 'actor-refused';

/**
 * Decide whether this call may name an actor.
 *
 * @param {object|null} circle  the resolved CircleState (carries `hostKey`); null when routing missed
 * @param {object} args         the decoded call args
 * @param {string} from         the invoking peer
 * @returns {{ actor: string|null } | { error: string, reason: string }}
 *   `{ actor: null }` when no actor was named; `{ actor }` when the host named one; else the refusal.
 */
export function vouchedActor(circle, args, from) {
  if (!args || typeof args !== 'object' || !Object.prototype.hasOwnProperty.call(args, 'actor')
      || args.actor === undefined || args.actor === null) {
    return { actor: null };
  }
  if (typeof args.actor !== 'string' || args.actor.length === 0) {
    return { error: ACTOR_REFUSED, reason: 'actor must be a non-empty contact id' };
  }
  const host = circle?.hostKey ?? null;
  if (!host) {
    return { error: ACTOR_REFUSED, reason: 'no host is known for this circle, so nobody may name an actor' };
  }
  if (from !== host) {
    return { error: ACTOR_REFUSED, reason: 'only the host of this tasks engine may act on behalf of an actor' };
  }
  return { actor: args.actor };
}

/**
 * Wrap a pure task core `(circle, args, ctx)` so it applies the rule itself: a refusal returns before the
 * core runs; an accepted actor reaches the core as `ctx.onBehalfOf` (never read off `args` directly).
 */
export function honouringActor(core) {
  return function actorAwareCore(circle, args, ctx = {}) {
    const v = vouchedActor(circle, args, ctx.from);
    if (v.error) return v;
    return core(circle, args, v.actor ? { ...ctx, onBehalfOf: v.actor } : ctx);
  };
}

/**
 * Wrap a registered skill definition so a non-host's `actor` is refused before its handler runs — the net
 * under every skill, including the ones that do not use `actor`. The handler's own return (a value, a
 * promise, a stream) passes through untouched when there is nothing to refuse.
 *
 * @param {object} def                    a `defineSkill` definition
 * @param {(parts: Array, ctx: object) => object|null} bundleResolver  resolves the CircleState
 * @param {(parts: Array) => object} argsFromParts                      decodes the call args
 */
export function refusingForeignActor(def, bundleResolver, argsFromParts) {
  const handler = def.handler;
  return {
    ...def,
    handler(ctx) {
      const args = argsFromParts(ctx?.parts ?? []);
      if (args && Object.prototype.hasOwnProperty.call(args, 'actor')) {
        const circle = bundleResolver(ctx.parts ?? [], { envelope: ctx.envelope, from: ctx.from });
        const v = vouchedActor(circle, args, ctx.from);
        if (v.error) return v;
      }
      return handler(ctx);
    },
  };
}
