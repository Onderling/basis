/**
 * CONNECTIONS — the pairing surface for a remote view ("gekoppelde apparaten").
 *
 * A connection is a screen that is YOURS, somewhere else: a browser tab, a client on a machine you
 * host. It is not a device (no ceremony, no recovery phrase) and not a member (no roster row). It
 * holds a standing grant, and the whole product question is the two columns this module projects:
 *
 *      what it may SEE  → sections, which compile to a filtered sealed lane of the history mirror
 *      what it may DO   → ops, which compile to one signed capability token each
 *
 * ── Why there is no new declaration here (Frits, 2026-08-18) ────────────────────────────────────
 * The menu IS the manifest. An op a person can grant is an op some manifest already declares, so
 * `connectionOpChoices` derives the picker from the composed manifests — the same source the
 * advanced surface and the coverage snapshot read. Nothing new is declared to make composition
 * work, which is also why the boundary holds: a pick becomes a token others verify, not a claim in
 * the view's own code.
 *
 * ── Naming ─────────────────────────────────────────────────────────────────────────────────────
 * "Gekoppelde apparaten" / connected devices — Frits' word, because *"my subscriptions" sounds more
 * external than the thing actually is*. Deliberately NOT bare "verbindingen": `Verbindingspunten`
 * (relays) and `Verbinding & transport` already exist in settings and a third neighbour would blur
 * all three. Deliberately NOT "scherm" either — that is the Screens tab.
 *
 * Pure projections. The shells paint and dispatch; every write goes through the waist
 * (`grantSurface` · `revokeSurface` · `listSurfaceGrants`).
 */
import { NEVER_DELEGABLE } from '@onderling/app-manifest';

/** Sections a person can grant, beyond their circles. Kept tiny on purpose — a section is a thing
 *  someone can picture, not an entry-kind taxonomy. */
export const DEVICE_SECTION = 'device';

/**
 * The DO menu: which ops may be granted to a connection, derived from the composed manifests.
 *
 * Two ops are withheld from every connection, and the reason is the same for both: they are the
 * acts that would let a view escalate past the boundary it was given. Granting the phrase would
 * hand over the account itself; granting the pairing ops would let a connection mint connections.
 * A withheld op is not hidden — it is absent from the menu, so nothing can tick it.
 *
 * @param {object} a
 * @param {object[]} a.manifests  the composed manifests (appId + operations[])
 * @returns {Array<{id:string, app:string, op:string, label:string, description:string}>} sorted
 */
export function connectionOpChoices({ manifests = [] } = {}) {
  // ONE withhold list, shared with the A2A surface. It used to be a second copy here, and the copies
  // had already diverged: this one was missing `restoreOwnerPhrase` — the op that ADOPTS an identity
  // from a phrase — so the menu offered a connection the ability to overwrite the account, while the
  // surface refused it. Caught by connectionSurfaceAgreement.test.js on its first run. A menu that
  // merely omits an op is a convention anyway; the list is enforced at the door (`policy: 'never'`),
  // and reading the same constant is what keeps the two honest.
  const withheld = NEVER_DELEGABLE;
  const rows = [];
  for (const m of manifests) {
    if (!m || !Array.isArray(m.operations)) continue;
    const app = m.appId ?? m.app ?? '';
    for (const o of m.operations) {
      const op = o?.id ?? o?.op;
      if (typeof op !== 'string' || !op) continue;
      const id = `${app}.${op}`;
      if (withheld.has(id)) continue;
      rows.push({
        id, app, op,
        label: o.title ?? o.label ?? op,
        description: o.description ?? '',
      });
    }
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}

/**
 * The SEE menu: the sections a person can grant — their circles, plus device settings.
 * `circles` is whatever the shell already holds for the circle list ({id,name} shaped).
 *
 * @returns {Array<{id:string, kind:'circle'|'device', label:string}>}
 */
export function connectionSectionChoices({ circles = [] } = {}) {
  const rows = circles
    .filter((c) => c && (typeof c.id === 'string' || typeof c.groupId === 'string'))
    .map((c) => ({
      id: c.id ?? c.groupId,
      kind: 'circle',
      label: c.name ?? c.label ?? c.id ?? c.groupId,
    }));
  rows.push({ id: DEVICE_SECTION, kind: 'device', label: null });   // label comes from t() at paint
  return rows;
}

/**
 * Compile the two tick-lists into the `grantSurface` args. Returns `null` when the pick grants
 * NOTHING — a connection that can neither see nor do is not a thing to create, and refusing here
 * keeps the shells from having to decide what an empty grant means.
 *
 * @param {object} a
 * @param {string} a.viewPubKey
 * @param {string[]} a.ops            picked op ids (`app.op`)
 * @param {string[]} a.sections       picked section ids (circle ids and/or DEVICE_SECTION)
 * @param {string} [a.label]
 * @returns {object|null} args for `callSkill('household','grantSurface', …)`
 */
export function compileConnectionGrant({ viewPubKey, ops = [], sections = [], label = null } = {}) {
  const pickedOps = [...new Set(ops.filter((o) => typeof o === 'string' && o))];
  const circles = sections.filter((s) => typeof s === 'string' && s && s !== DEVICE_SECTION);
  const device = sections.includes(DEVICE_SECTION);
  if (pickedOps.length === 0 && circles.length === 0 && !device) return null;
  return {
    viewPubKey,
    ops: pickedOps,
    // No sections ticked → acting only, and NO lane is written. That is a real, useful shape
    // (a remote control that cannot read), so it is expressed as `reads: null` rather than refused.
    reads: (circles.length || device) ? { circles, device } : null,
    ...(label ? { label } : {}),
  };
}

/**
 * Project `listSurfaceGrants` into render-ready rows — the two columns, already worded as counts so
 * a shell never has to decide how to summarise. `sees` is null when the connection cannot read at
 * all, which the shells render as the honest "alleen bedienen" rather than as "0 onderdelen".
 *
 * @param {object} a
 * @param {Array<{viewPubKey:string,label:?string,ops:string[],reads:?object}>} a.surfaces
 * @param {Array<{id:string,name?:string}>} [a.circles]  to name a circle instead of showing its id
 * @returns {Array<{viewPubKey:string, label:string|null, short:string, opCount:number,
 *                  ops:string[], sees:{circles:string[], device:boolean}|null}>}
 */
export function connectionRows({ surfaces = [], circles = [] } = {}) {
  const nameOf = new Map(circles.filter(Boolean).map((c) => [c.id ?? c.groupId, c.name ?? c.label ?? null]));
  return surfaces.filter(Boolean).map((s) => ({
    viewPubKey: s.viewPubKey,
    label: s.label ?? null,
    // A key is not a name; showing a stub makes two connections tellable apart when neither was labelled.
    short: typeof s.viewPubKey === 'string' ? `${s.viewPubKey.slice(0, 8)}…` : '',
    opCount: Array.isArray(s.ops) ? s.ops.length : 0,
    ops: Array.isArray(s.ops) ? [...s.ops] : [],
    sees: s.reads
      ? {
        circles: (s.reads.circles === '*' ? ['*'] : (s.reads.circles ?? []))
          .map((id) => nameOf.get(id) ?? id),
        device: s.reads.device === true,
      }
      : null,
  }));
}
