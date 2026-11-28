/**
 * WHICH BROWSER OPENS THE SIGN-IN ON ANDROID. The phone walk (2026-11-28, a Samsung whose default browser is
 * DuckDuckGo): the provider sent the browser back to org.onderling.basis://auth/callback, and DuckDuckGo's custom tab
 * LOADED that address as a page instead of handing it to the app, so the sign-in never came back. Chrome's custom tabs
 * hand a custom-scheme redirect to Android. So the sign-in opens in Chrome when it is installed, else in the phone's own
 * preferred custom-tabs browser.
 */
import { describe, it, expect } from 'vitest';
import { authBrowserPackage, HAND_BACK_BROWSER } from '../src/authBrowser.js';

describe('the sign-in\'s browser on Android', () => {
  it('Chrome when it is installed, even when another browser is the default', () => {
    expect(authBrowserPackage({
      browserPackages: ['com.duckduckgo.mobile.android', 'com.android.chrome'],
      defaultBrowserPackage: 'com.duckduckgo.mobile.android',
      preferredBrowserPackage: 'com.duckduckgo.mobile.android',
    })).toBe(HAND_BACK_BROWSER);
  });
  it('without Chrome: the phone\'s preferred custom-tabs browser, then its default', () => {
    expect(authBrowserPackage({ browserPackages: ['org.mozilla.firefox'], preferredBrowserPackage: 'org.mozilla.firefox' })).toBe('org.mozilla.firefox');
    expect(authBrowserPackage({ browserPackages: [], defaultBrowserPackage: 'x.y' })).toBe('x.y');
  });
  it('nothing known: undefined, so the library picks as before', () => {
    expect(authBrowserPackage({})).toBeUndefined();
    expect(authBrowserPackage(null)).toBeUndefined();
  });
});
