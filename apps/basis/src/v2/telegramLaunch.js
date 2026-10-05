/**
 * telegramLaunch — a screen opened INSIDE Telegram (a Mini App, from the "Open het scherm" button in the person's own
 * chat with the bot) proves who opened it with Telegram's signed launch data, so it connects without the code to pick.
 *
 * Telegram opens the page with `#tgWebAppData=<initData>`: the person (`user`), when (`auth_date`) and a `hash` — an
 * HMAC-SHA256 of the other fields under a key derived from the BOT'S TOKEN, so only the bot can check it. The page sends
 * it to the bot in its offer (sealed to the bot's key, from the screen's own key); the bot checks it here:
 *   - the hash, compared in constant time;
 *   - `auth_date` within a minute of the bot's clock;
 *   - opened from a private chat: Telegram sends `chat_type` only for a launch from a link, and a button's web app exists
 *     only in a private chat with the bot — so absent, `private` or `sender` (the person's own chat) is taken, a group's not.
 * What the person may then do is the gate's, as for any screen: this proves who, nothing more.
 *
 * WebCrypto only (the box, a browser, a test): no secret leaves this module.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/** How old a launch may be when its offer arrives (seconds, either way of the bot's clock). */
export const TELEGRAM_LAUNCH_MAX_AGE_S = param({ key: 'assistant.telegramLaunchMaxAgeS', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 60 });

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
async function hmac(key, data) {
  const k = await globalThis.crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return globalThis.crypto.subtle.sign('HMAC', k, enc.encode(data));
}
/** Two hex strings, compared without stopping at the first difference. */
function sameHex(a, b) {
  const x = String(a ?? ''); const y = String(b ?? '');
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

/** The string Telegram signs: every field but `hash`, as `key=value`, sorted by key, one per line. */
const checkString = (params) => [...params].filter(([k]) => k !== 'hash').sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');

/** Telegram's hash of these fields under this bot's token (what a launch carries; a test makes one with it). */
export async function telegramLaunchHash(params, botToken) {
  const secret = await hmac('WebAppData', botToken);
  return hex(await hmac(secret, checkString(params)));
}

/**
 * @param {string} initData  as Telegram handed it to the page (a query string)
 * @param {object} a
 * @param {string} a.botToken
 * @param {() => number} [a.now]  ms
 * @returns {Promise<{ok: true, telegramId: string, hash: string, authDate: number}|{ok: false, reason: string}>}
 */
export async function verifyTelegramLaunch(initData, { botToken, now = Date.now } = {}) {
  if (typeof initData !== 'string' || !initData || initData.length > 4096) return { ok: false, reason: 'no-launch' };
  if (typeof botToken !== 'string' || !botToken) return { ok: false, reason: 'no-token' };
  let params;
  try { params = new URLSearchParams(initData); } catch { return { ok: false, reason: 'unreadable' }; }
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return { ok: false, reason: 'no-hash' };
  if (!sameHex(await telegramLaunchHash(params, botToken), hash)) return { ok: false, reason: 'bad-hash' };
  const authDate = Number(params.get('auth_date'));
  if (!Number.isInteger(authDate) || Math.abs(now() / 1000 - authDate) > TELEGRAM_LAUNCH_MAX_AGE_S) return { ok: false, reason: 'stale' };
  const chatType = params.get('chat_type');
  if (chatType != null && chatType !== 'private' && chatType !== 'sender') return { ok: false, reason: 'not-private' };
  let user = null;
  try { user = JSON.parse(params.get('user') ?? 'null'); } catch { /* below */ }
  const id = user?.id;
  if (!(Number.isSafeInteger(id) && id > 0)) return { ok: false, reason: 'no-user' };
  return { ok: true, telegramId: String(id), hash, authDate };
}

/** What Telegram put in the page's address: the launch data, or null (`#tgWebAppData=…&tgWebAppVersion=…`). */
export function launchDataFrom(hash) {
  const m = /[#&]tgWebAppData=([^&]*)/.exec(String(hash ?? ''));
  if (!m) return null;
  try { return decodeURIComponent(m[1]) || null; } catch { return null; }
}
