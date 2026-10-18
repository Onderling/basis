/**
 * InAppInboxBridge — Tasks V1 in-app inbox channel for the notifier.
 *
 * Implements the `MessagingBridge` shape (`start, stop, onMessage,
 * sendReply`) that `@onderling/chat-agent` defines and that
 * `@onderling/notifier` consumes for chat-shaped channels. The
 * notifier is agnostic about whether the bridge sends to Telegram,
 * to an LLM, or — as here — writes a notification item into a
 * per-user inbox `ItemStore`.
 *
 * **Why a bridge, not a notifier extension?** Notifier intentionally
 * ships only `NoopChannel` + `PushChannel` directly; chat-shaped
 * channels are bridges apps pass in. Tasks's inbox is exactly this
 * pattern — apps pass `new InAppInboxBridge({...})` into
 * `notifier.channels.inbox`. Same shape as
 * `chat-agent.TelegramBridge`.
 *
 * **Storage shape.** Each entry is a `type: 'inbox-item'` item in
 * an `ItemStore` rooted at the recipient's inbox container (default
 * `mem://user/inbox/`).  Per Tier B substrate alignment (2026-05-20):
 * the bridge stamps the substrate's `appliesTo` keys at write time
 * so consumers don't have to synthesize them at read time:
 *
 *   - `type: 'inbox-item'`    — matches the manifest's `appliesTo.type`
 *   - `kind: <eventType>`     — top-level mirror of `source.meta.eventType`
 *                                when present (used by the generic
 *                                gate, e.g. `appliesTo: { kind:
 *                                'subtask-proposal' }`)
 *   - `source.kind: 'inbox-entry'` — preserved for back-compat; legacy
 *                                consumers still recognize the sentinel
 *
 * The item's `text` is the notification body; `source` carries the
 * structured payload (event-type-specific data, action buttons, etc.).
 *
 * Pre-Tier-B (before commit b7951ab) the bridge wrote `type:
 * 'notification'` and `kind` was buried under `source.meta.eventType`;
 * consumers (InboxScreen, inbox.html) synthesised the substrate shape
 * at read time via `tagInboxItem` / `manifestAllows` helpers.  Those
 * helpers are now redundant — bridge writes the canonical shape.
 *
 * **Local-only by design** — no push, no relay, no network. The
 * inbox is FOR the user, persisted to their local cache (and
 * mirrored to their pod when one is attached, automatic via
 * `local-store.CachingDataSource`'s write-through queue).
 *
 * **Substrate-candidate flag**: when a 2nd consumer (Pinboard V2,
 * Household, future) wants the same shape, lift this into
 * `@onderling/chat-agent` as `InAppInboxBridge` alongside
 * `TelegramBridge` + `InMemoryBridge`. Tracked per the
 * `Project Files/Substrates/substrate-candidates.md` flagging rule.
 */

import { ulid } from '@onderling/item-store';

const DEFAULT_INBOX_CONTAINER = 'mem://user/inbox/';

export class InAppInboxBridge {
  /** @type {string} */
  id;
  /** @type {object} */ #store;
  /** @type {string} */ #recipient;
  /** @type {string} */ #container;

  /**
   * @param {object} args
   * @param {object} args.itemStore
   *   `core.DataSource`-shaped storage with `read/write/delete/list`.
   *   Typically the bundle's `localStoreBundle.cache`.
   * @param {string} args.recipient
   *   The local user's webid. The `chatId` argument to `sendReply`
   *   MUST equal this; cross-recipient delivery is rejected. The
   *   in-app inbox is per-user; broadcasting is somebody else's
   *   problem.
   * @param {string} [args.container]   default `mem://user/inbox/`
   * @param {string} [args.id='inbox']  channel name surfaced via `bridge.id`
   */
  constructor({ itemStore, recipient, container = DEFAULT_INBOX_CONTAINER, id = 'inbox' }) {
    if (!itemStore?.read || !itemStore?.write) {
      throw new TypeError('InAppInboxBridge: itemStore (read+write) required');
    }
    if (typeof recipient !== 'string' || !recipient) {
      throw new TypeError('InAppInboxBridge: recipient (webid) required');
    }
    this.id        = id;
    this.#store    = itemStore;
    this.#recipient = recipient;
    this.#container = container.endsWith('/') ? container : container + '/';
  }

  /** No inbound (one-way channel). */
  async start()   { /* noop */ }
  async stop()    { /* noop */ }
  onMessage()     { /* noop */ }

  /**
   * Send (write) an inbox entry.
   *
   * @param {object} args
   * @param {string} args.chatId               recipient webid; MUST equal the bridge's recipient
   * @param {string} args.text                 the body
   * @param {Array}  [args.buttons]            informational; persisted in `source.buttons`
   * @param {object} [args.meta]               opaque metadata; persisted in `source.meta`
   */
  async sendReply({ chatId, text, buttons, meta }) {
    if (typeof chatId !== 'string' || !chatId) {
      throw new TypeError('InAppInboxBridge.sendReply: chatId required');
    }
    if (chatId !== this.#recipient) {
      // Apps that want to send to multiple recipients construct one
      // bridge per recipient (one inbox per user).
      throw new Error(
        `InAppInboxBridge.sendReply: chatId ${chatId} does not match bridge recipient ${this.#recipient}`,
      );
    }
    const id = ulid();
    // Tier B (2026-05-20) — stamp the substrate's appliesTo keys at
    // write time.  `type: 'inbox-item'` matches the manifest's
    // section gate; `kind` mirrors `meta.eventType` for the
    // generic per-kind gate (subtask-proposal/request, etc.).
    const eventKind = (meta && typeof meta === 'object' && typeof meta.eventType === 'string')
      ? meta.eventType
      : null;
    const item = {
      id,
      type:    'inbox-item',
      ...(eventKind ? { kind: eventKind } : {}),
      text:    typeof text === 'string' ? text : '',
      addedBy: 'system',          // notifier-system entries; UI hides the attribution
      addedAt: Date.now(),
      source:  {
        kind:    'inbox-entry',
        ...(buttons ? { buttons } : {}),
        ...(meta    ? { meta    } : {}),
      },
    };
    await this.#store.write(`${this.#container}${id}.json`, JSON.stringify(item));
    return { jobId: id };
  }
}

export { DEFAULT_INBOX_CONTAINER };
