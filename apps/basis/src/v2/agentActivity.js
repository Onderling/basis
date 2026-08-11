/**
 * The agent-detail ACTIVITY CARD's rows — one shared projection both shells paint
 * (invariant 1: the shells compose and paint, the selection logic lives here).
 *
 * A row says THAT an agent did something, to a pointer, under an authority — never
 * content (the trail's whitelist, see `makeAgentTrailEntry`). Empty without an
 * explicit actor by construction (`agentTrailRows` never falls open), which is the
 * self-surveillance guard: a viewer opens ONE agent's trail deliberately.
 */
import { agentTrailRows } from './circleStream.js';

/**
 * @param {object} a
 * @param {string} a.actor    the agent whose trail to open (pubKey / stable id)
 * @param {object[]} a.events the device log's entries (`eventLog.query()`)
 * @param {number} [a.limit=50]
 * @returns {Array<{id:string, ts:number, op:?string, via:?string, outcome:?string,
 *                  target:?string, kind:?string}>} newest-first display rows
 */
export function agentActivityRows({ actor, events, limit = 50 } = {}) {
  return agentTrailRows({ actor, events: events ?? [], circles: [] })
    .slice(0, limit)
    .map((r) => {
      const p = r.event?.payload && typeof r.event.payload === 'object' ? r.event.payload : {};
      return {
        id: r.id ?? r.event?.id ?? null,
        ts: r.ts ?? r.event?.ts ?? null,
        op: typeof p.op === 'string' ? p.op : null,
        via: typeof p.via === 'string' ? p.via : null,
        outcome: typeof p.outcome === 'string' ? p.outcome : null,
        target: typeof p.target?.ref === 'string' ? p.target.ref : null,
        kind: r.event?.type ?? null,
      };
    });
}
