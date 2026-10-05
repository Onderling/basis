/**
 * botRungs — a household bot's door checks, declared once, in the order of `GATE_LAYERS` (`refusal.js`).
 *
 * The door itself admits (a code) before anything reaches the waist; at the waist the host asks these three, in this
 * order, deny-wins — then the op's own rule and the door's settings answer inside the op, in the same refusal shape.
 */
import { refuse } from './refusal.js';

/** The layers the bot's door asks at the waist, in order. */
export const BOT_DOOR_RUNGS = Object.freeze(['tier', 'door-map', 'door-role']);

/**
 * The checks for one bot's door, in `BOT_DOOR_RUNGS` order.
 * @param {object} a
 * @param {(q: {callerId: string, skillId: string, skill: object, unknownAs: string}) => Promise<void>} a.checkCaller
 *        the host gate's tier check (throws a coded error to refuse)
 * @param {(opId: string) => ('authenticated'|'trusted'|null|undefined)} [a.opLevel]  the door's map: an op's level,
 *        null when it is not on this door; absent → every op is on it
 * @param {(role: string|null, opId: string) => boolean} [a.roleAllows]  the door's narrowing of a role (an observer reads)
 * @param {(caller: string) => (string|null)} [a.roleOf]  the role the door gave this caller
 * @returns {Array<(input: {opId: string, caller: string, visibility?: string}) => Promise<object|null>>}
 */
export function botDoorChecks({ checkCaller, opLevel = null, roleAllows = null, roleOf = () => null }) {
  const levelOf = (opId) => (typeof opLevel === 'function' ? opLevel(opId) : undefined);
  const byLayer = {
    tier: async ({ opId, caller, visibility }) => {
      const mapped = levelOf(opId);
      // an op whose ROLE decides (the admin's data column, under the roles preset): any admitted person passes the tier,
      // the role check below says who may
      const level = visibility ?? (mapped === 'by-role' ? 'authenticated' : mapped) ?? 'authenticated';
      try {
        await checkCaller({ callerId: caller, skillId: opId, skill: { id: opId, visibility: level, enabled: true }, unknownAs: 'public' });
        return null;
      } catch (e) { return refuse('tier', e?.code ?? 'refused'); }
    },
    // an op off the door's map is refused however it is asked for (an op declaring its own level is on the map)
    'door-map': async ({ opId, visibility }) => (levelOf(opId) === null && visibility === undefined ? refuse('door-map', 'not-on-this-door') : null),
    'door-role': async ({ opId, caller }) => {
      if (typeof roleAllows === 'function') return roleAllows(roleOf(caller), opId) ? null : refuse('door-role', 'role');
      // no role rule handed in: an op the role decides is the admin's alone (fail closed — never wider than the default)
      return levelOf(opId) === 'by-role' && roleOf(caller) !== 'admin' ? refuse('door-role', 'role') : null;
    },
  };
  return BOT_DOOR_RUNGS.map((layer) => byLayer[layer]);
}
