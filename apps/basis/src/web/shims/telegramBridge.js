/**
 * Browser-safe shim for `@onderling/chat-agent/bridges/telegram`.
 *
 * The Telegram bridge is a SERVER-side chat transport (long-polls the Telegram
 * Bot API, reads `process.env`, etc.). A re-export for Node
 * consumers would put the bare specifier in the web bundle's import graph even
 * though the browser never runs a Telegram bot — and the module's top-level
 * `process` access throws `ReferenceError: process is not defined`, blanking the app.
 *
 * Per invariant #7 (functionality placed by trust + latency, never default-to-browser),
 * this stays server-side. The shim carries the named export Rollup sees at build
 * time; constructing it in the browser is a wiring bug, so it throws clearly.
 *
 * Aliased in vite.config.js `resolve.alias`.
 */
class BrowserOnlyTelegramBridge {
  constructor() {
    throw new Error(
      'TelegramBridge is a Node-only server transport (Telegram Bot API) — it does not run in the browser.',
    );
  }
}

export const TelegramBridge = BrowserOnlyTelegramBridge;
export default { TelegramBridge };
