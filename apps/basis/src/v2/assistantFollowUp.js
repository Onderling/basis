/**
 * The circle composers' pending ask, as a claim on the assistant's lane.
 *
 * When the bot asks for one missing field ("which list?"), the member's next line is the answer. The web and mobile
 * composers hold that ask; this turns it into the engine's `claim` hook, so the check happens when the line's turn
 * comes in the circle's lane — after a turn that was still running when the line was typed, and may have asked. A line
 * typed during that turn is then the answer, not a new request and not a chat line for the circle.
 *
 * A slash command is never an answer. The door keeps the state; this module decides and completes, once for both.
 */
import { completeFollowUp } from '@onderling/kring-host/followUp';
import { coerceListArgs } from './circleGate.js';

/**
 * @param {object} a
 * @param {() => object|null} a.pending      the door's pending single-field ask (`beginFollowUp`'s result), or null
 * @param {() => void} a.clear               forget it
 * @param {(cmd: {opId: string, args: object}) => any} a.dispatchReady  run the completed command the door's way
 * @param {object|(() => object)} [a.catalogue]  the door's catalogue: a list named the way people say it
 *        ("boodschappen") becomes the declared value, as a typed command's does
 * @returns {(text: string) => (null | (() => Promise<{via: string}>))}  the engine's `claim`
 */
export function followUpClaim({ pending, clear, dispatchReady, catalogue }) {
  return (text) => {
    const line = String(text ?? '').trim();
    if (!line || line.startsWith('/') || !pending()) return null;
    return async () => {
      const p = pending();
      if (!p) return { via: 'none' };
      clear();
      const ready = completeFollowUp({ pending: p, text: line });
      const cat = typeof catalogue === 'function' ? catalogue() : catalogue;
      const cmd = cat ? coerceListArgs({ opId: ready.opId, args: ready.args }, cat) : { opId: ready.opId, args: ready.args };
      await dispatchReady(cmd);
      return { via: 'follow-up' };
    };
  };
}
