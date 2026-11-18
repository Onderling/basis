/**
 * Whether the web app is inside another page's frame (ledger L1041): it runs only in a top-level window of its own.
 *
 * The rule a browser honours for this (`frame-ancestors`) is a response header only, and the web app's static host
 * sends none, so the app asks itself. A window whose top cannot be read is taken as framed.
 * @param {{top?: object, self?: object}} win
 * @returns {boolean}
 */
export function isFramed(win) {
  try { return win.top !== win.self; } catch { return true; }
}
