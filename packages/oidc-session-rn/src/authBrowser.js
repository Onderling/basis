/**
 * WHICH BROWSER OPENS THE SIGN-IN ON ANDROID — pure, so it is tested without a phone.
 *
 * The sign-in comes back to the app as a custom-scheme redirect (`org.onderling.basis://auth/callback`), which the
 * custom tab must hand to Android. Chrome's custom tabs do. The default browser need not: on a phone walk
 * (2026-11-28) DuckDuckGo's custom tab LOADED that address as a page, and the sign-in never came back. So Chrome opens
 * the sign-in when it is installed; else the phone's own preferred custom-tabs browser; else the library picks, as
 * before.
 *
 * Fed by `WebBrowser.getCustomTabsSupportingBrowsersAsync()` (expo-web-browser), whose shape this takes as it is.
 */

/** The custom-tabs browser known to hand a custom-scheme redirect back to the app. */
export const HAND_BACK_BROWSER = 'com.android.chrome';

/**
 * @param {{browserPackages?: string[], defaultBrowserPackage?: string, preferredBrowserPackage?: string}|null} found
 * @returns {string|undefined}  the package to pass as `browserPackage`, or undefined to let the library choose
 */
export function authBrowserPackage(found) {
  const f = found && typeof found === 'object' ? found : {};
  const listed = Array.isArray(f.browserPackages) ? f.browserPackages : [];
  if (listed.includes(HAND_BACK_BROWSER)) return HAND_BACK_BROWSER;
  return f.preferredBrowserPackage || f.defaultBrowserPackage || undefined;
}
