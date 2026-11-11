/**
 * The phone's inbound wiring as SOURCE TEXT, for the fitness tests that compare what each shell composes.
 *
 * The phone composes its receive path in three places, outermost first:
 *   1. ChatScreen.js            the screen: its paint (the main-thread bubble, the catch-up dialog) and the router;
 *   2. src/core/phoneInboundWiring.js   the phone's composition around the shared map (the governance rail, the lane
 *                               options, the receipt receiver) — the SAME function the Node harness boots;
 *   3. src/v2/inboundWiring.js  the handler map every shell shares.
 * A test that asks "does the phone wire X" reads all of it, following the calls: a layer is included only when the
 * layer above calls into it, so a screen that stopped calling the shared function stops getting credit for it.
 * One reader, so the next move between these layers changes this file instead of every test that reads them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

export const PHONE_SCREEN_FILE = 'apps/basis-mobile/src/screens/ChatScreen.js';
export const PHONE_CORE_FILE   = 'apps/basis-mobile/src/core/phoneInboundWiring.js';
export const SHARED_WIRING_FILE = 'apps/basis/src/v2/inboundWiring.js';

export const readPhoneScreen = () => read('../../../basis-mobile/src/screens/ChatScreen.js');
export const readPhoneCore   = () => read('../../../basis-mobile/src/core/phoneInboundWiring.js');
export const readSharedWiring = () => read('../../src/v2/inboundWiring.js');

/**
 * The phone's composition reached from `screenText` (default: the whole ChatScreen): the text itself, plus the phone
 * core when it calls `buildPhoneInboundWiring(`, plus the shared map when either calls `buildInboundWiring(`.
 */
export function phoneWiringSource(screenText = readPhoneScreen()) {
  let src = screenText;
  if (/buildPhoneInboundWiring\(/.test(src)) src += `\n${readPhoneCore()}`;
  if (/buildInboundWiring\(/.test(src)) src += `\n${readSharedWiring()}`;
  return src;
}
