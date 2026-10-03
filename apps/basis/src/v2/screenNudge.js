/**
 * screenNudge — a household change reaches a connected screen as a nudge that names nothing.
 *
 * The bot sends each of its screens `{subtype: 'screen-nudge'}` a moment after the last write (a burst of writes is one
 * nudge): no item, no list, no person. The screen reads again through its own calls, so what it sees is still what that
 * person may see — the nudge itself carries nothing anyone could read.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/** The peer-message subtype of a nudge. */
export const SCREEN_NUDGE_SUBTYPE = 'screen-nudge';
/** How long after the last write the screens are nudged (a burst of writes is one nudge). */
export const SCREEN_NUDGE_DELAY_MS = param({ key: 'assistant.screenNudgeDelayMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 1500 });

/**
 * @param {object} a
 * @param {() => Promise<Array<{viewPubKey: string}>>} a.listScreens  the screens connected now (their active grants)
 * @param {(viewPubKey: string, payload: object) => Promise<void>} a.send
 * @param {(fn: Function, ms: number) => any} [a.setTimer]
 * @param {(h: any) => void} [a.clearTimer]
 */
export function createScreenNudge({ listScreens, send, setTimer = (fn, ms) => { const h = setTimeout(fn, ms); h?.unref?.(); return h; }, clearTimer = (h) => clearTimeout(h) }) {
  let timer = null;
  const nudgeAll = async () => {
    timer = null;
    const screens = (await listScreens().catch(() => [])) ?? [];
    for (const key of new Set(screens.map((s) => s?.viewPubKey).filter(Boolean))) {
      try { await send(key, { subtype: SCREEN_NUDGE_SUBTYPE }); } catch { /* a screen that is away reads again when it comes back */ }
    }
  };
  return {
    /** Something in a circle's store changed. */
    touched() {
      if (timer) clearTimer(timer);
      timer = setTimer(nudgeAll, SCREEN_NUDGE_DELAY_MS);
    },
  };
}
