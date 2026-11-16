/**
 * Who a row this device writes names as its MAKER (`createdBy` / `by`), per place. One function; the calendar and the
 * lists both call it, on every shell.
 *
 * The local stamp 'me' never leaves this device in a CIRCLE's store: a receiver reads it as nobody, and then falls back
 * to whoever served the snapshot (a server, a sibling device), which is not who wrote the row. A row in a circle names
 * its maker by the address that circle's roster already holds for them: the circle's self on this device (no new
 * disclosure: the members have it). So:
 *
 *   - an ORDINARY circle: the actor the call names (a household bot's door person), else the circle's self;
 *   - a PAIR circle: its self only; a name the call passes must BE that self (anything else, 'me' included, is refused);
 *   - the person's OWN scope (`OWN_DEVICES_SCOPE`): the self the call was made as (the waist's checked `actAs`), else
 *     'me': that lane ends at the person's own devices, where 'me' is who it is.
 *
 * null means there is no writer here (this device holds no self for that circle): the write is refused with
 * `no-self`, never stamped 'me' and never stamped with the general key (a persona's circle would then carry the
 * general key, the defect the pair circle already guarded against).
 */
import { OWN_DEVICES_SCOPE } from './grantsManifest.js';
import { isPairCircleId } from './pairCircleId.js';

/** The local placeholder a writer's own device uses for "me"; never a maker in a circle's store. */
export const LOCAL_ME = 'me';

const named = (x) => (typeof x === 'string' && x && x !== LOCAL_ME ? x : null);

/**
 * @param {{ circleSelf?: (circleId: string) => ({webid?: string|null}|null) }} a  the agent's own `circleSelf`
 * @returns {(circleId: string|null, name?: string|null, o?: {actAs?: string|null}) => string|null}  `name`: the actor
 *   the call names (a door person, a caller); `actAs`: the self the call was made as (read in the own scope only: in a
 *   circle the maker is that circle's self)
 */
export function rowAuthorFor({ circleSelf } = {}) {
  const selfIn = (circleId) => { try { return circleSelf?.(circleId)?.webid ?? null; } catch { return null; } };
  return (circleId, name = null, { actAs = null } = {}) => {
    if (!circleId || circleId === OWN_DEVICES_SCOPE) return named(actAs) ?? named(name) ?? LOCAL_ME;
    const self = selfIn(circleId);
    if (isPairCircleId(circleId)) return self && (name == null || name === self) ? self : null;
    return named(name) ?? self;
  };
}
