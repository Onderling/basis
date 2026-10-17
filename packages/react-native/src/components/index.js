/**
 * @onderling/react-native/components — UI primitives shared across
 * mobile apps.
 *
 * Lifted from apps/pinboard-mobile/src/components/* 2026-05-09 (Phase
 * 41.0.b B1–B4; Tasks-mobile is the second consumer).
 *
 * Components consume tokens via `useTheme()` from
 * `@onderling/react-native/theme`. Apps must wrap their tree in
 * `<ThemeProvider value={tokens}>` (or accept the substrate's
 * neutral defaults).
 *
 * The QrCodeView / MnemonicView land at their own subpaths
 * (`@onderling/react-native/qr/view` + `/mnemonic/view`) because
 * they're tied to specific feature substrates (Phase 41.0 L4 + L5).
 */

export { AvatarCircle } from './AvatarCircle.jsx';
export { ChipRow }      from './ChipRow.jsx';
export { ConfirmModal } from './ConfirmModal.jsx';
export { OfferingPicker }  from './OfferingPicker.jsx';
