/** The languages a person can fix a thread to; `auto` clears it (the reply follows how they write). One list, no imports:
 *  the agent reads it per call (an app's reply in the thread's language) without pulling in the door's machinery. */
export const THREAD_LANGS = Object.freeze(['nl', 'en']);
