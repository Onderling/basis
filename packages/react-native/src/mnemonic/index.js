/**
 * @onderling/react-native/mnemonic — recovery-phrase substrate.
 *
 * Two pieces:
 *   - Pure-fn helpers (`normaliseMnemonic`, `mnemonicWords`,
 *     `hasValidWordCount`, `looksLikeMnemonic`, `statusFor`,
 *     `BIP39_WORD_COUNTS`) — lifted verbatim from
 *     apps/pinboard-mobile/src/lib/mnemonic.js.
 *   - `<MnemonicView words={[...]}>` — grid renderer with screenshot
 *     warning + copy-to-clipboard hook (consumer wires the actual
 *     clipboard write via the optional `onCopy` callback).
 *
 * The View component lives at the `/view` subpath (analogous to the
 * `qr/view` split) so test envs that don't load `react-native` keep
 * working.
 */

export {
  BIP39_WORD_COUNTS,
  normaliseMnemonic,
  mnemonicWords,
  hasValidWordCount,
  looksLikeMnemonic,
  statusFor,
} from './helpers.js';


// MnemonicView is a separate subpath (see `react-native/mnemonic/view`)
// because it pulls in `react-native` at module load.
