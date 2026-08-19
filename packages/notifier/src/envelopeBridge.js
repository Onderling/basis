/**
 * ⚠ DELETION CANDIDATE (decided: mark, don't delete). Its premise was retracted days after it was built,
 * production routed around it (`substrateMirror` publishes directly), and it is stale against the current
 * channel contract (`sendReply`). The one reusable fact: `notifier.scheduleOnce` + `notifyEnvelope.publish`
 * COMPOSE — the scheduled-digests idea in the companion note builds on that sentence, not on this file.
 * createEnvelopeBridge — pair the scheduler with notify-envelope.
 *
 * Phase 52.9.1: apps that want time-shifted envelope delivery
 * (e.g. "remind the circle about Anne's expiring offer in 24h",
 * "weekly digest of new neighbourhood-jobs") build the bridge once
 * + call `scheduleEnvelope({...})` for each scheduled item.
 *
 * Under the hood, the bridge is a thin wrapper around
 * `notifier.scheduleOnce` whose builder publishes via
 * `notifyEnvelope.publish`. The job's `channel` is a synthetic
 * `'notify-envelope'` slot the bridge owns. Apps **don't** need
 * to wire a special chat channel for it — the bridge registers
 * the slot itself when constructed.
 *
 * Standardisation Phase 52.9.
 */

/**
 * @typedef {object} EnvelopeJobArgs
 * @property {number}   triggerAt              — ms epoch
 * @property {string}   type                   — item-types name (becomes envelope `kind`)
 * @property {string}   ref                    — resource URI
 * @property {string[]} recipients
 * @property {*}        [payload]              — full-payload mode body
 * @property {string}   [etag]
 * @property {string}   [fromActor]
 * @property {string}   [circleId]
 * @property {string}   [cancelKey]
 *
 * @typedef {object} EnvelopeBridge
 * @property {(args: EnvelopeJobArgs) => Promise<string>}  scheduleEnvelope
 * @property {(cancelKey: string) => Promise<void>}        cancel
 * @property {string}                                       channelName
 */

const DEFAULT_CHANNEL_NAME = 'notify-envelope';

/**
 * Build a noop channel that the notifier's dispatch loop will pick
 * up. Our builder publishes via notify-envelope BEFORE returning —
 * the channel `send` is a no-op (the actual work happened in the
 * builder). We still need the channel slot so the scheduler's
 * type-checks pass.
 */
function _makeNoopChannel() {
  return {
    /** Called by the notifier after the builder runs; we already published. */
    async send() { return { ok: true, kind: 'noop' }; },
  };
}

/**
 * @param {object} args
 * @param {object} args.notifier              — required (must expose scheduleOnce + cancel)
 * @param {object} args.notifyEnvelope        — required (must expose publish)
 * @param {object} [args.channels]            — the notifier's channels object;
 *                                                bridge registers `notify-envelope` into it
 *                                                if supplied + the slot is empty.
 * @param {string} [args.channelName]
 * @returns {EnvelopeBridge}
 */
export function createEnvelopeBridge({
  notifier,
  notifyEnvelope,
  channels,
  channelName = DEFAULT_CHANNEL_NAME,
} = {}) {
  if (!notifier || typeof notifier.scheduleOnce !== 'function') {
    throw Object.assign(
      new Error('createEnvelopeBridge: notifier.scheduleOnce is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (!notifyEnvelope || typeof notifyEnvelope.publish !== 'function') {
    throw Object.assign(
      new Error('createEnvelopeBridge: notifyEnvelope.publish is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (channels && typeof channels === 'object' && !channels[channelName]) {
    channels[channelName] = _makeNoopChannel();
  }

  async function scheduleEnvelope({
    triggerAt,
    type,
    ref,
    recipients,
    payload,
    etag,
    fromActor,
    circleId,
    cancelKey,
  } = {}) {
    if (typeof triggerAt !== 'number') {
      throw Object.assign(
        new Error('scheduleEnvelope: triggerAt is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (typeof type !== 'string' || type.length === 0) {
      throw Object.assign(
        new Error('scheduleEnvelope: type is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (typeof ref !== 'string' || ref.length === 0) {
      throw Object.assign(
        new Error('scheduleEnvelope: ref is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw Object.assign(
        new Error('scheduleEnvelope: recipients must be a non-empty array'),
        { code: 'INVALID_ARGUMENT' },
      );
    }

    const builder = async () => {
      try {
        await notifyEnvelope.publish({
          type,
          ref,
          ...(payload   !== undefined ? { payload }   : {}),
          ...(etag      != null       ? { etag }      : {}),
          ...(fromActor != null       ? { fromActor } : {}),
          recipients,
          ...(circleId    != null       ? { circleId }    : {}),
        });
      } catch (_err) {
        // Best-effort fan-out: notify-envelope owns its own queueing
        // (full-payload + pending-pod-upload). Swallow to keep the
        // scheduler healthy; telemetry already records the failure.
      }
      // The noop channel's `send` does nothing; we still return the
      // shape it expects.
      return { text: '', meta: { type, ref, recipients } };
    };

    return notifier.scheduleOnce({
      triggerAt,
      recipient: recipients[0] ?? 'envelope',
      channel:   channelName,
      builder,
      ...(cancelKey ? { cancelKey } : {}),
    });
  }

  async function cancel(cancelKey) {
    if (typeof notifier.cancel !== 'function') return;
    return notifier.cancel(cancelKey);
  }

  return {
    scheduleEnvelope,
    cancel,
    get channelName() { return channelName; },
  };
}

export { DEFAULT_CHANNEL_NAME };
