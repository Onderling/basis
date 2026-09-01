/**
 * createdCard — the card for a thing an op just MADE.
 *
 * Two kinds of op put something in a conversation and they answer differently. `embed-time` builds its
 * card itself and returns it. A creator — `tasks:addTask`, and every app op that will follow it into
 * the "+" menu — returns `{ok, itemId}`, because creating is its job and the conversation is not its
 * business. Without this step, "+ → Task" would make a task that appears nowhere: the thing exists, in
 * the Tasks tab, and the conversation it was made in shows a bare "ok".
 *
 * The bridge is already declared, and has been since v0.5: an op that can be shown as a card says which
 * skill reads its snapshot (`surfaces.chat.embed.cardSnapshotSkill`), and `buildEmbed` turns a snapshot
 * into a card. This composes those two over the id the creator returned. No new contract — the missing
 * piece was that nothing walked from one to the other.
 *
 * Pure except for the injected `callSkill`; returns null when this op is not a creator with a card,
 * which is most of them.
 */
import { buildEmbed } from '../embed.js';

/** The id a creator's reply names, whichever way it names it. */
function createdId(reply) {
  const v = reply?.itemId ?? reply?.id ?? reply?.task?.id ?? reply?.item?.id ?? null;
  return typeof v === 'string' && v ? v : null;
}

/**
 * @param {object} a
 * @param {*} a.reply                   what the op returned
 * @param {object} a.op                 the op's own manifest declaration
 * @param {string} a.appOrigin          the app that ran it — the snapshot skill lives on the SAME app,
 *   which is why this takes it rather than searching the catalogue: `createEmbed` searches, takes the
 *   first snapshot declaration it finds, and so reads a task through whatever app happens to be first.
 * @param {(app:string, opId:string, args:object)=>Promise<any>} a.callSkill
 * @param {string} [a.localActor]       who is issuing the card
 * @returns {Promise<object|null>} the card, or null when there is none to build
 */
export async function cardForCreatedItem({ reply, op, appOrigin, callSkill, localActor } = {}) {
  if (!reply || reply.ok === false) return null;
  const snapshotSkill = op?.surfaces?.chat?.embed?.cardSnapshotSkill;
  if (typeof snapshotSkill !== 'string' || !snapshotSkill) return null;
  if (typeof callSkill !== 'function' || !appOrigin) return null;
  const id = createdId(reply);
  if (!id) return null;

  try {
    const snapshot = await callSkill(appOrigin, snapshotSkill, { id });
    if (!snapshot || snapshot.ok === false || typeof snapshot.id !== 'string') return null;
    return buildEmbed({ appOrigin, snapshot, issuedBy: localActor ?? 'me' });
  } catch {
    // The thing WAS created; only its card could not be read back. The caller falls through to the
    // op's own reply, so a person is told what happened rather than shown a silent failure.
    return null;
  }
}

export default cardForCreatedItem;
