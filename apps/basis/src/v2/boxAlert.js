/**
 * The box's alert chat, from inside the device: the same Telegram line the box updater sends (`deploy/box/lib.sh`'s
 * `alert`), from the same pair of settings (`BOX_ALERT_TG_TOKEN` + `BOX_ALERT_TG_CHAT` in the box's `.env`). Unset →
 * null, and the caller says it elsewhere. A failed send says only that it failed: the bot API's URL carries the token.
 *
 * @param {object} a
 * @param {string} [a.token]
 * @param {string} [a.chat]
 * @param {string} [a.name]  the box's name in the line (`[box <name>] …`)
 * @param {typeof fetch} [a.fetchImpl]
 * @returns {((text: string) => Promise<void>)|null}
 */
export function createBoxAlert({ token, chat, name = 'box', fetchImpl = globalThis.fetch } = {}) {
  if (!token || !chat || typeof fetchImpl !== 'function') return null;
  return async (text) => {
    let ok = false;
    try {
      const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ chat_id: String(chat), text: `[box ${name}] ${text}` }).toString(),
        signal: AbortSignal.timeout(10_000),
      });
      ok = !!res?.ok;
    } catch { ok = false; }
    if (!ok) throw new Error('alert failed (telegram)');
  };
}
