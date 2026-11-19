/**
 * HOW FAR THE "+" GOES FOR THIS PERSONA: the row on a persona's card in Mij (the ceiling, `_plus.ceiling` in
 * @onderling/agent-registry plusCeiling.js). Four choices, the one in force marked (its own, else the general persona's,
 * else 3). What a tap writes is the row's to say (`write`), so a shell paints the row and calls what it is handed: the
 * ceiling's own op, which weighs as the person's control (the "+" never offers it). One shape both shells paint.
 */
import { PLUS_CEILING_KEY, plusCeilingFor } from '@onderling/agent-registry';

export const PLUS_CEILING_ROW = Object.freeze({
  key: PLUS_CEILING_KEY,
  labelKey: 'circle.mij.plus_ceiling',
  hintKey: 'circle.mij.plus_ceiling_hint',
  choices: Object.freeze([0, 1, 2, 3].map((value) => Object.freeze({ value, labelKey: `circle.mij.plus_ceiling_${value}` }))),
});

/**
 * A persona's row, with the value in force.
 * @param {{id: string, properties?: object}} persona  a registry-shaped entry (`properties` as stored)
 * @param {{general?: {id: string, properties?: object}|null}} [o]  the general persona, whose word a persona inherits
 * @returns {{key: string, labelKey: string, hintKey: string, choices: Array<{value: number, labelKey: string}>, value: number, write: (value: number) => {app: string, opId: string, args: object}}}
 */
export function plusCeilingRow(persona = {}, { general = null } = {}) {
  const byId = { ...(general?.id ? { [general.id]: general } : {}), ...(persona?.id ? { [persona.id]: persona } : {}) };
  const value = plusCeilingFor((id) => byId[id] ?? null, persona?.id, { defaultProfileId: general?.id ?? null });
  return {
    ...PLUS_CEILING_ROW,
    value,
    write: (v) => ({ app: 'agents', opId: 'setPlusCeiling', args: { id: persona?.id, ceiling: v } }),
  };
}
