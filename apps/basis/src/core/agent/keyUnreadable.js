/**
 * A KEY OR MARKER THIS DEVICE HOLDS COULD NOT BE READ AT A START (ledger L1115).
 *
 * Not "nothing stored". Every read in the boot that used to answer a failure as absent (and then generated a new key
 * over the old one) now throws this instead and writes nothing: the host key, the chat identity, the custody marker,
 * a vault's sentinel, the content key. The boot stops before any content store opens, and the shells say it in words
 * with "try again" (`bootFailureNotice`). A later start that reads it finds the same keys: nothing was changed.
 *
 * `code` is what a shell reads, also through a wrapping error's `cause` (the phone's bundle wraps every boot error):
 * `isKeyUnreadable`. `what` names which read failed, for the log, never for the person.
 */
export const KEY_UNREADABLE = 'key-unreadable';

export class KeyUnreadable extends Error {
  /** @param {string} what  which read failed ('host-key', 'chat-key', 'custody-marker', 'vault-sentinel', 'content-key') @param {unknown} [cause] */
  constructor(what, cause) {
    super(`A key on this device could not be read (${what}); nothing was changed`);
    this.name = 'KeyUnreadable';
    this.code = KEY_UNREADABLE;
    this.what = what;
    if (cause !== undefined) this.cause = cause;
  }
}

/** True for a KeyUnreadable, by its code, here or anywhere down its `cause` chain (a few links deep). */
export function isKeyUnreadable(err) {
  let e = err;
  for (let i = 0; e && i < 6; i += 1) {
    if (e instanceof KeyUnreadable || e?.code === KEY_UNREADABLE) return true;
    e = e?.cause;
  }
  return false;
}
