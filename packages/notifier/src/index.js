export { Notifier } from './Notifier.js';
export { InMemoryScheduleStore } from './stores/InMemoryScheduleStore.js';
export { PodScheduleStore }      from './stores/PodScheduleStore.js';
export { NoopChannel, PushChannel } from './channels/index.js';
export { nextDailyFireInTz } from './timezone.js';
export { UsageMetrics } from './UsageMetrics.js';
export { PushPolicy }   from './PushPolicy.js';

// Phase 52.9 — bridge to @onderling/notify-envelope for scheduled
// envelope-shape deliveries (e.g. "remind circle about expiring offer in 24h").
export { recogniseEnvelopeShape }      from './recogniseEnvelopeShape.js';
export { createEnvelopeBridge, DEFAULT_CHANNEL_NAME as ENVELOPE_CHANNEL_NAME }
                                       from './envelopeBridge.js';
