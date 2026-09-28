/**
 * wireIssuerNotifications — schedule + dispatch issuer-facing
 * notifications for a Tasks circle.
 *
 * Wires the bundle's `Notifier` to `itemStore` events:
 *
 *   - `item-added` with `dueAt`     → schedule `due:<id>` at `dueAt`
 *                                     to alert the master/issuer that
 *                                     the deadline has passed without
 *                                     completion. Cancelled on
 *                                     `item-completed` / `item-removed`.
 *
 *   - `item-completed`              → notify `master ?? addedBy` that
 *                                     the task is done. (For
 *                                     `approval: 'self-mark'` items
 *                                     this fires on `markComplete`;
 *                                     for `'creator'` mode it fires
 *                                     after the approver signs off.)
 *
 *   - `item-submitted`              → notify the designated approver
 *                                     (resolved from `item.approval`)
 *                                     that a submission needs review.
 *
 *   - `item-revoked`                → notify the previous assignee
 *                                     with the reason + an "appeal"
 *                                     hint pointing at the
 *                                     `appealTask` skill.
 *
 *   - `item-rejected`               → notify the assignee that their
 *                                     submission was pushed back, with
 *                                     the reviewer's note.
 *
 * The function uses a per-recipient channel resolution: it looks up
 * (or creates) an `InAppInboxBridge` per webid and registers it with
 * the notifier under `inbox:<webid>`.
 *
 * optional push side-channel. When `pushChannel` + `pushPolicy`
 * + `tokenFor(webid)` are all supplied, every immediate notification
 * (completed/submitted/rejected/revoked) is also offered to the push
 * policy for the recipient's device token. Push is conservative: see
 * `@onderling/notifier`'s PushPolicy for the gating (humanInTheLoop +
 * per-day cap + quiet hours). If any link is missing (no token for
 * this webid, no policy) the inbox fires alone.
 *
 * Returns `{detach}` so apps can shut down the wiring cleanly.
 */

import { channelOfWebid } from '@onderling/item-types';
import { InAppInboxBridge } from '../bridges/InAppInboxBridge.js';

/**
 * @param {object} args
 * @param {import('@onderling/notifier').Notifier} args.notifier
 * @param {Record<string, object>} args.channels
 *   The same `channels` object that was passed into the Notifier
 *   constructor. wireIssuerNotifications mutates this map at
 *   runtime to register a per-recipient inbox bridge — Notifier
 *   resolves channel IDs lazily so the new entries become live
 *   immediately. Apps MUST pass the same reference here as they
 *   gave to the notifier (typical pattern: build the object once,
 *   pass it both places).
 * @param {object} args.itemStore
 * @param {object} args.dataSource         — bundle.cache (for inbox bridge writes)
 * @param {string} [args.fallbackChannel='inbox']  channel name prefix
 * @param {object} [args.pushChannel] — PushChannel (notifier substrate)
 * @param {object} [args.pushPolicy] — PushPolicy (notifier substrate)
 * @param {(webid: string) => string | null} [args.tokenFor]
 *   Optional resolver: webid → device push token. If it returns null
 *   /undefined for a recipient, push is silently skipped for that one.

 * @returns {{ detach: () => void }}
 */
export function wireIssuerNotifications({
  notifier,
  channels,
  itemStore,
  dataSource,
  fallbackChannel = 'inbox',
  pushChannel,
  pushPolicy,
  tokenFor,
}) {
  if (!notifier?.scheduleOnce) {
    throw new TypeError('wireIssuerNotifications: notifier with .scheduleOnce required');
  }
  if (!channels || typeof channels !== 'object') {
    throw new TypeError('wireIssuerNotifications: channels (the same object passed to Notifier) required');
  }
  if (!itemStore?.on) {
    throw new TypeError('wireIssuerNotifications: itemStore (Emitter) required');
  }
  if (!dataSource?.write) {
    throw new TypeError('wireIssuerNotifications: dataSource (for inbox bridge) required');
  }

  // Per-recipient bridge cache so we re-use one bridge per webid.
  const bridgesByWebid = new Map();

  function ensureBridgeFor(webid) {
    if (bridgesByWebid.has(webid)) return bridgesByWebid.get(webid);
    const channelId = `${fallbackChannel}:${webid}`;
    const bridge = new InAppInboxBridge({
      itemStore: dataSource,
      recipient: webid,
      id:        channelId,
    });
    channels[channelId] = bridge;
    bridgesByWebid.set(webid, bridge);
    return bridge;
  }

  const pushReady = !!(pushChannel?.sendReply && pushPolicy?.tryPush && typeof tokenFor === 'function');

  async function notify(recipientWebid, payload) {
    if (typeof recipientWebid !== 'string' || !recipientWebid) return;
    // A person admitted through a door (a contact id such as `telegram:123`, assigned by a host acting for
    // them) has no route from here yet: reaching them goes through the door that admitted them. Their notice
    // is skipped, not written into THIS device's inbox, where it would read as the owner's.
    if (channelOfWebid(recipientWebid)) return;
    const bridge = ensureBridgeFor(recipientWebid);
    try {
      await bridge.sendReply({ chatId: recipientWebid, ...payload });
    } catch (err) {
      // Non-fatal — apps surface delivery failures via observability.
      // The notifier's own `error` event covers schedule-side issues.
    }
    if (!pushReady) return;
    const token = tokenFor(recipientWebid);
    if (!token) return;
    try {
      await pushPolicy.tryPush({
        recipient: token,
        payload:   { humanInTheLoop: true, ...payload },
      });
    } catch { /* push is best-effort */ }
  }

  function approverFor(item) {
    const mode = item?.approval ?? 'self-mark';
    if (mode === 'self-mark') return null;        // no approver to nudge
    if (mode === 'creator')   return item.master ?? item.addedBy;
    if (typeof mode === 'string' && mode.startsWith('webid:')) {
      return mode.slice('webid:'.length);
    }
    return null;
  }

  function masterFor(item) {
    return item?.master ?? item?.addedBy ?? null;
  }

  // ── Listeners ────────────────────────────────────────────────────────────

  const onAdded = async (item) => {
    if (!Number.isFinite(item?.dueAt)) return;
    const recipient = masterFor(item);
    if (!recipient) return;
    ensureBridgeFor(recipient);
    await notifier.scheduleOnce({
      triggerAt: item.dueAt,
      recipient,
      channel:   `${fallbackChannel}:${recipient}`,
      cancelKey: `due:${item.id}`,
      builder:   async () => ({
        text: `Deadline missed: "${item.text}"`,
        meta: {
          eventType:  'missed-deadline',
          itemId:     item.id,
          dueAt:      item.dueAt,
        },
      }),
    });
  };

  const cancelDue = async (item) => {
    if (!item?.id) return;
    try { await notifier.cancel(`due:${item.id}`); } catch { /* noop */ }
  };

  const onCompleted = async (item) => {
    await cancelDue(item);
    const recipient = masterFor(item);
    if (!recipient) return;
    await notify(recipient, {
      text: `Task completed: "${item.text}"`,
      meta: { eventType: 'task-completed', itemId: item.id, by: item.completedBy },
    });
  };

  const onSubmitted = async (item) => {
    const recipient = approverFor(item);
    if (!recipient) return;
    await notify(recipient, {
      text: `Review needed: "${item.text}" was submitted`,
      meta: {
        eventType: 'task-submitted',
        itemId:    item.id,
        by:        _lastSubmitter(item),
      },
    });
  };

  const onRejected = async (item) => {
    const recipient = item?.assignee;
    if (!recipient) return;
    const lastReject = (item.reviewLog ?? []).slice().reverse().find((r) => r.decision === 'reject');
    await notify(recipient, {
      text: `Your submission was rejected: "${item.text}"`,
      meta: {
        eventType: 'task-rejected',
        itemId:    item.id,
        note:      lastReject?.note ?? null,
        by:        lastReject?.by ?? null,
      },
    });
  };

  const onRevoked = async ({ item, previousAssignee, reason }) => {
    if (!previousAssignee) return;
    await notify(previousAssignee, {
      text: `Your assignment on "${item.text}" was revoked`,
      buttons: [{ id: `appeal:${item.id}`, label: 'Appeal' }],
      meta: {
        eventType: 'task-revoked',
        itemId:    item.id,
        reason,
        master:    item.master ?? item.addedBy,
      },
    });
  };

  const onRemoved = async ({ item }) => {
    await cancelDue(item);
  };

  // ── Subscribe ───────────────────────────────────────────────────────────

  itemStore.on('item-added',      onAdded);
  itemStore.on('item-completed',  onCompleted);
  itemStore.on('item-submitted',  onSubmitted);
  itemStore.on('item-rejected',   onRejected);
  itemStore.on('item-revoked',    onRevoked);
  itemStore.on('item-removed',    onRemoved);

  return {
    detach() {
      itemStore.off?.('item-added',      onAdded);
      itemStore.off?.('item-completed',  onCompleted);
      itemStore.off?.('item-submitted',  onSubmitted);
      itemStore.off?.('item-rejected',   onRejected);
      itemStore.off?.('item-revoked',    onRevoked);
      itemStore.off?.('item-removed',    onRemoved);
    },
  };
}

function _lastSubmitter(item) {
  if (!Array.isArray(item?.reviewLog)) return null;
  for (let i = item.reviewLog.length - 1; i >= 0; i--) {
    if (item.reviewLog[i]?.decision === 'submit') return item.reviewLog[i].by;
  }
  return null;
}
