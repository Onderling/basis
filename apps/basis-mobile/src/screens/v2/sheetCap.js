/**
 * THE PHONE'S SHEETS: how high a sheet's card may be, and how its scroll behaves inside it. One source for every sheet.
 *
 * A card capped with a PERCENTAGE (`maxHeight: '85%'`) did not bound it on Android 16 (measured with Detox on a
 * 2,400 px screen: the Customise sheet's scroll was 3,894 px tall, never scrolled, and "Add a block" was off-screen).
 * A cap in WINDOW pixels does, and the scroll inside must be allowed to shrink to it (React Native's flexShrink is 0 by
 * default). `scripts/lint-sheet-cap.mjs` refuses a percentage cap on a phone sheet.
 */
import { useWindowDimensions } from 'react-native';

/**
 * The card's cap, in pixels of the window.
 * @param {number} [fraction]  the share of the window's height the card may take (0.85: the sheet leaves the top visible)
 * @returns {{ maxHeight: number }}
 */
export function useSheetCap(fraction = 0.85) {
  const { height } = useWindowDimensions();
  return { maxHeight: Math.round(height * fraction) };
}

/** The scroll inside a capped card: it may shrink to the card, so it scrolls instead of running off the screen. */
export const SHEET_SCROLL = Object.freeze({ flexShrink: 1 });
