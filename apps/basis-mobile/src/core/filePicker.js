/**
 * Mobile file-picker adapter for Bundle F +
 * followup-2.
 *
 * Wraps the substrate `@onderling/react-native/picker` and exposes a
 * single `openFilePicker()` that returns a payload compatible with
 * basis's `localBuiltins.sendFile` / `createFileEmbed` —
 * `{name, type, size, dataB64}`.  This mirrors web's
 * `<input type="file">` flow (`File` object).
 *
 * Defaults to the generic document picker (followup-2) so users
 * can pick PDFs, text files, archives, etc.  Image-only flows
 * (pinboard compose, avatar) use `pickAndResize` directly — they don't
 * route through this adapter.
 *
 * Why live in basis-mobile and not the substrate?  Because
 * the *contract translation* (PickedDocument → File-like shape
 * localBuiltins expects) is specific to chat-shell host-op needs.
 * The substrate stays generic; the chat-shell adapts.  Matches the
 * basis-unifier principle: substrate is portable, app-shell
 * does the gluing.
 */
import { pickOneDocument } from '@onderling/react-native/picker';

/**
 * Open the OS document picker, return a File-like object compatible
 * with `localBuiltins.sendFile` / `createFileEmbed`.  Returns null
 * on cancel.
 *
 * @returns {Promise<{name: string, type: string, size: number, dataB64: string}|null>}
 */
export async function openFilePicker() {
  const picked = await pickOneDocument();
  if (!picked) return null;
  return {
    name:    picked.name,
    type:    picked.mime,
    size:    picked.bytes,
    dataB64: picked.dataB64,
  };
}
