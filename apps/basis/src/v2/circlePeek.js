/**
 * circlePeek — the read-then-act step's "look", composed once for every shell.
 *
 * When the model picks a READ for a line that asks for an act ("haal de melk eraf" → listEntries), the engine looks
 * at that read without showing it and hands the answer back to the model once, so the turn can act on it
 * (`createCircleDispatch`'s `peek`). The look must go through the same gate as any dispatch the shell runs — a read
 * the person may not do is not looked at either — and must paint nothing. A shell supplies only its gate and its call.
 */
import { resolveDispatch } from '../router.js';

/**
 * @param {object} a
 * @param {() => object} a.catalogue  the merged catalogue the shell dispatches over (a getter: it is rescoped)
 * @param {(ready: object) => Promise<any>} a.run  the shell's gated call for a ready dispatch (no painting)
 * @param {(ready: object) => Promise<string|null|false>} [a.deny]  the shell's capability gate: truthy = refused
 * @returns {(cmd: {opId: string, args?: object, appOrigin?: string}) => Promise<any|null>}
 */
export function createPeek({ catalogue, run, deny = null }) {
  if (typeof run !== 'function') throw new TypeError('createPeek: run is required');
  return async (cmd) => {
    if (!cmd?.opId) return null;
    let ready;
    try { ready = resolveDispatch({ kind: 'slash', opId: cmd.opId, args: cmd.args ?? {}, appOrigin: cmd.appOrigin, command: '(peek)', body: '' }, catalogue()); }
    catch { return null; }
    if (ready?.kind !== 'ready') return null;
    if (typeof deny === 'function' && await deny(ready)) return null;
    try { return await run(ready); } catch { return null; }
  };
}
