/**
 * WHAT A HELD TURN COULD NOT KEEP, said once (Fable 2026-11-14). The contact door never drops a turn silently: a turn the
 * message request could not hold as it came is held anyway without what it could not keep, marked with the refusal's
 * code (`refused`). The person must not take such a turn for the whole message, so it carries a note, in the request and,
 * after Accept, on that turn in the thread, on every device of the person.
 *
 * The note is a closed set of what the PERSON needs to know, not the refusal code: 'cut' (the text was cut to the bound)
 * and 'file' (a file came with it and was left off). A refusal that changes nothing the person reads (a card left off)
 * has no note.
 */

/** The notes a held turn can carry. */
export const HELD_NOTES = Object.freeze(['cut', 'file']);
const NOTE_OF_REFUSAL = Object.freeze({ 'turn-too-large': 'cut', 'file-on-request': 'file' });

/** The note for a held turn's refusal code; null when the refusal changed nothing the person reads. */
export function heldNoteOf(refused) {
  return typeof refused === 'string' && Object.prototype.hasOwnProperty.call(NOTE_OF_REFUSAL, refused) ? NOTE_OF_REFUSAL[refused] : null;
}

/** A note from the wire or the store, kept only when it is one of the set. */
export function heldNoteValid(note) {
  return typeof note === 'string' && HELD_NOTES.includes(note) ? note : null;
}

/** The locale key a shell paints the note with: one plain line on that turn. Null for anything else. */
export function heldNoteKey(note) {
  const n = heldNoteValid(note);
  return n ? `circle.contacts.held.${n}` : null;
}
