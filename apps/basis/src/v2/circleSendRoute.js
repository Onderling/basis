/**
 * How a circle-scoped send may speak — the privacy guarantee, decided once.
 *
 * A member reached at their circle address is spoken to as my circle address (`'circle'`). A member the fan could only
 * reach at their GLOBAL key (the pubkey/webid rung) is spoken to person to person, as my person key (`'person'`) — and
 * only when the person chose the address fallback. With the fallback off that send is refused (`'refuse'`): never my
 * circle address to their global key (a mix that is neither a circle message nor a personal one, which the circle
 * refuses and the relay can link), and never my global self speaking for a person who did not choose it.
 *
 * @param {{ asPerson?: boolean, fallbackOn?: boolean }} a
 * @returns {'circle'|'person'|'refuse'}
 */
export function circleSendRoute({ asPerson = false, fallbackOn = false } = {}) {
  if (!asPerson) return 'circle';
  return fallbackOn === true ? 'person' : 'refuse';
}
