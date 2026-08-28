/**
 * basis v2 — one-shot circle create (shared web + mobile).
 *
 * "+ new circle" wants a circle now, not a 5-step wizard. This reuses the EXISTING create path: it
 * fills the create wizard's `initialState` defaults, sets the name and an id, and runs the wizard's own
 * `finalSubmit` (which dispatches `createGroupV2`). So a quick-create sends exactly the payload the
 * wizard would with default choices.
 *
 * `callSkill` here is the host's RAW 3-arg form `(appOrigin, opId, args)` — `finalSubmit` calls
 * `callSkill('stoop', 'createGroupV2', …)` itself.
 *
 * ── THE ID IS DERIVED FROM THE FOUNDER, NOT FROM THE NAME ────────────────────────────────────────────
 * It used to be `slugify(name)`. Two people who both call their circle "Proeftuin" — or "buurt", or
 * "thuis" — therefore both held `proeftuin`, and a device that learned of both MERGED them: one circle,
 * two unrelated groups of people, one roster. Frits and I walked into this twenty minutes into the first
 * session with a person on the real UI (2026-08-27), and it is a security shape rather than untidiness:
 * membership is meant to have exactly one door, and a name-derived id adds a second — pick the right
 * WORD and you are in someone's circle. Names are public and often obvious, so it is not a narrow one.
 *
 * `deriveCircleId` (in core, beside the per-circle address derivations) makes the class unrepresentable
 * instead of detectable: two founders collide only by finding two inputs with one SHA-256 digest.
 *
 * The name is not lost — it stays what people read, and the id becomes what machines match. The UI
 * already prefers the name and treats the id as a fallback, which is why this is cheap.
 */
import { initialState, finalSubmit } from '../core/wizards/createGroupState.js';
import { deriveCircleId } from '@onderling/core';

/** 16 random bytes, so one founder's two circles differ even when made in the same second. */
function freshNonce() {
  const b = new Uint8Array(16);
  (globalThis.crypto ?? {}).getRandomValues?.(b);
  return b;
}

/**
 * @param {object} a
 * @param {Function} a.callSkill        the host's raw `(appOrigin, opId, args)`
 * @param {string} a.name               what people will read
 * @param {string} [a.id]               pin a STABLE id — for a SYSTEM circle only (the help circle),
 *   where every device must independently arrive at the same one. A person's circle never pins.
 * @param {string} [a.founderPubKey]    the creating device's identity key; the id is derived from it
 * @returns {Promise<object>} `{ groupId, code, expiresAt, … }`
 */
export async function quickCreateCircle({ callSkill, name, id, founderPubKey } = {}) {
  const clean = String(name ?? '').trim();
  if (!clean) throw new Error('circle name required');
  const state = initialState();
  state.name = clean;

  if (typeof id === 'string' && id.trim()) {
    state.groupId = id.trim();                      // a system circle, pinned on purpose
  } else {
    // The founder's key is what makes this id theirs. Without it we would be back to deriving an id
    // from something a stranger can also produce, so ask the app rather than guessing — and if even
    // that cannot answer, refuse instead of silently falling back to the name.
    let key = typeof founderPubKey === 'string' && founderPubKey ? founderPubKey : null;
    if (!key && typeof callSkill === 'function') {
      try { key = (await callSkill('stoop', 'whoAmI', {}))?.webid ?? null; } catch { key = null; }
    }
    if (!key) throw new Error('circle create: no founder identity — a circle id must come from its founder');
    state.groupId = deriveCircleId(key, freshNonce());
  }

  const { result, state: after } = await finalSubmit({ state, callSkill });
  if (after.submitError) throw new Error(after.submitError);
  return result;
}
