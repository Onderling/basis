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

/**
 * Whether a shell starts in this window. The main app (a person's keys, no reason to be framed) starts only in a window
 * of its own. A SCREEN address starts framed too: Telegram's web client and some desktop clients show the screen's Web
 * App ('Open het scherm', `?scherm-tg=`) in a frame, a framing page cannot read into a frame of another origin, and a
 * screen holds one screen's grant, never a person's keys.
 * @param {{top?: object, self?: object}} win
 * @param {{screen: boolean}} o  whether this address is a screen's
 * @returns {boolean}
 */
export function startsWhenFramed(win, { screen }) {
  return screen === true || !isFramed(win);
}
