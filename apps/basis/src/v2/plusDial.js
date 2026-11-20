/**
 * THE "+" DOCKED IN THE TAB BAR, OPENING INTO ROUND BUTTONS — the one model both shells paint (web `circleTabBar.js`,
 * mobile `CircleTabBar.js`).
 *
 * The manifest declares it once (`manifest.plus`: its place in the bar, its buttons, the default for its own spot);
 * the person's choice of what sits on that spot is a device setting (`plus.middle`) that overlays the default. This
 * module says what the bar holds, which button sits where, and what a press does. A shell paints and runs the target
 * it is handed; it decides nothing.
 *
 * The "+" is there for every persona. The persona's ceiling (how far the "+" goes: 0 = no model) is not read here on
 * purpose: a ceiling of 0 means the conversation has no model, never that there is no "+".
 */
import { renderWeb } from '@onderling/app-manifest';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';
import { alphaTabs } from './alphaSurface.js';

/** The setting: which dial button sits on the "+"'s own spot on this device. */
export const PLUS_MIDDLE_KEY = 'plus.middle';
/** The value for "nothing in the middle": the middle is the "+" itself, and a second tap closes it. */
export const PLUS_MIDDLE_NONE = 'none';
/** Its declaration; the default equals the manifest's `plus.middle` (a test pins the agreement). */
export const PLUS_MIDDLE = param({ key: PLUS_MIDDLE_KEY, scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.USER, default: 'chat' });

/** The choices the settings row offers, in the dial's order, then none (their words are the buttons' own). */
export const PLUS_MIDDLE_CHOICES = Object.freeze([
  Object.freeze({ value: 'chat', labelKey: 'circle.plus.chat' }),
  Object.freeze({ value: 'scan', labelKey: 'circle.plus.scan' }),
  Object.freeze({ value: 'share', labelKey: 'circle.plus.my_qr' }),
  Object.freeze({ value: PLUS_MIDDLE_NONE, labelKey: 'circle.plus.middle_none' }),
]);

/**
 * The "+" as the manifest declares it, projected: `{ place, middle, dial }`, or null when the manifest has none.
 * @param {object} manifest
 * @param {Function} [renderer]  `renderWeb` | `renderMobile`
 */
export function plusDeclared(manifest, renderer = renderWeb) {
  const p = renderer(manifest)?.plus;
  return p && Array.isArray(p.dial) && p.dial.length > 0 ? p : null;
}

/**
 * The bar, in order: each slot a tab (`{kind:'tab', tab}`) or the "+" (`{kind:'plus'}`). The tabs are the painted ones
 * (`alphaTabs`); the "+" goes where the declaration says. 'bar-middle' keeps the larger half on the left, so three tabs
 * read Vandaag · Kringen · + · Contacten and four read two on each side.
 * @param {object} manifest
 * @param {{renderer?: Function, hasMesh?: boolean, plus?: boolean}} [o]  `plus: false` for a screen without the "+"
 */
export function barSlots(manifest, { renderer = renderWeb, hasMesh = false, plus = true } = {}) {
  const nav = renderer(manifest);
  const slots = alphaTabs(Array.isArray(nav.tabs) ? nav.tabs : [], { hasMesh }).map((tab) => ({ kind: 'tab', tab }));
  const declared = plusDeclared(manifest, renderer);
  if (!plus || !declared) return slots;
  const at = declared.place === 'bar-end' ? slots.length : Math.ceil(slots.length / 2);
  slots.splice(at, 0, { kind: 'plus' });
  return slots;
}

/**
 * Which button sits on the middle spot and which sit around it.
 * @param {object} manifest
 * @param {{middle?: string|null, hasChat?: boolean, renderer?: Function}} [o]
 *   `middle`  — the person's setting (`plus.middle`); unknown or absent → the declared default; `'none'` → nothing
 *   `hasChat` — false for a persona with no conversation: no Chat button, and (with chat wanted there) an empty middle
 * @returns {{middle: object|null, around: object[]}}
 */
export function plusDialFor(manifest, { middle, hasChat = true, renderer = renderWeb } = {}) {
  const declared = plusDeclared(manifest, renderer);
  if (!declared) return { middle: null, around: [] };
  const dial = declared.dial.filter((b) => hasChat || b.id !== 'chat');
  let want = middle === PLUS_MIDDLE_NONE ? null : (declared.dial.some((b) => b.id === middle) ? middle : declared.middle);
  // the wanted middle is not on this dial (chat, for a persona without one): the spot stays empty, nothing moves up
  // into it (Frits 2026-11-20), so a second tap on the "+" closes it
  if (want && !dial.some((b) => b.id === want)) want = null;
  return { middle: dial.find((b) => b.id === want) ?? null, around: dial.filter((b) => b.id !== want) };
}

/**
 * What a press does. `pressed` is 'plus' (the "+"'s own spot), a button id, or 'outside' (a touch outside the
 * buttons, the back gesture, Escape). Returns the new open state and the button whose target to run (or null).
 * @param {boolean} open
 * @param {{middle: object|null, around: object[]}} dial
 * @param {string} pressed
 * @returns {{open: boolean, run: object|null}}
 */
export function plusPress(open, dial, pressed) {
  if (!open) return { open: pressed === 'plus', run: null };
  if (pressed === 'plus') return { open: false, run: dial?.middle ?? null };
  return { open: false, run: (dial?.around ?? []).find((b) => b.id === pressed) ?? null };
}
