// Mobile shim for `@onderling/chat-agent/bridges/telegram`.
//
// The Telegram bridge is a Node-only server transport: it `import { Telegraf } from
// 'telegraf'` and does `class … extends Telegraf`. On Hermes, `telegraf` (a Node lib)
// doesn't load, so the extended base is `undefined` → "Super expression must either be
// null or a function" at module-eval → the whole agent boot fails. A re-export
// of TelegramBridge would land it in the RN bundle even though mobile never runs a
// Telegram bot. Per invariant #7 it stays server-side; the stub carries the named export
// Metro sees, and throws if anyone actually constructs it on-device.
// (Mirror of apps/basis/src/web/shims/telegramBridge.js for the web bundle.)
class MobileOnlyTelegramBridge {
  constructor() {
    throw new Error('TelegramBridge is a Node-only server transport — it does not run on mobile.');
  }
}
export const TelegramBridge = MobileOnlyTelegramBridge;
export default { TelegramBridge };
