/**
 * "Persona's op dit apparaat" — the selves this device holds (`listPersonasHere`), one row each, with the one act a row
 * offers: PAUSE a running persona, RESUME a paused one (both device ops, no phrase, taking effect at the next boot). The
 * primary — the self this device speaks as — comes first and offers none; the paused ones last. One model; both shells
 * paint it.
 */

/**
 * @param {Array<{id: string, name?: string|null, primary?: boolean, paused?: boolean, running?: boolean}>} listed
 * @returns {Array<{id: string, name?: string, nameKey?: string, stateKey: string|null, act: {op: string, labelKey: string}|null}>}
 */
export function personasHereRows(listed = []) {
  const rows = (Array.isArray(listed) ? listed : []).filter((p) => p && typeof p.id === 'string').map((p) => ({
    id: p.id,
    ...(p.id === 'default' ? { nameKey: 'circle.switcher.you' } : { name: p.name ?? p.id }),
    primary: p.primary === true,
    stateKey: p.primary ? 'circle.receive_personas.primary' : (p.paused ? 'circle.receive_personas.paused' : null),
    act: p.primary ? null
      : p.paused ? { op: 'resumePersona', labelKey: 'circle.receive_personas.resume' }
        : { op: 'pausePersona', labelKey: 'circle.receive_personas.pause' },
  }));
  // the primary first, then the running personas, then the paused ones
  const rank = (r) => (r.primary ? 0 : r.act?.op === 'pausePersona' ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b));
}
