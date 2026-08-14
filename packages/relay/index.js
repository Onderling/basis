/**
 * @onderling/relay — relay broker (WS), offline queue, multi-recipient fan-out,
 * group auth, push wake (E2c).
 *
 * **Layer: SDK foundation.** Substrates and apps compose primitives from this
 * package; substrates MUST NOT reinvent them, apps MUST justify direct use in
 * their README. See `Project Files/conventions/architectural-layering.md`.
 */

export { WsServerTransport }    from './src/WsServerTransport.js';
export { RelayAgent }           from './src/RelayAgent.js';
export { startRelay, getLanIp } from './src/server.js';
export { ForwardQueue }         from './src/ForwardQueue.js';
export { GroupAuthVerifier }    from './src/GroupAuthVerifier.js';
export { MultiRecipientQueue }  from './src/MultiRecipientQueue.js';
export { QueueStore }           from './src/queueStores/QueueStore.js';
export { MemoryQueueStore }     from './src/queueStores/MemoryQueueStore.js';
export { SqliteQueueStore }     from './src/queueStores/SqliteQueueStore.js';
export { PushSender }           from './src/push/PushSender.js';
export { ExpoPushSender, ReliableExpoPushSender } from './src/push/ExpoPushSender.js';
export { PushTokenRegistry }    from './src/push/PushTokenRegistry.js';
export { PushTokenStore, MemoryPushTokenStore, SqlitePushTokenStore } from './src/push/PushTokenStore.js';
export {
  CONTENTLESS_WAKE, RELIABLE_WAKE_ALERT, WAKE_MODES,
  buildExpoWakeBody, assertContentlessWake,
}                               from './src/push/wakePayload.js';
export { mountBlobGate }        from './src/blobGateMount.js';
export {
  BlobAclStore, MemoryBlobAclStore, SqliteBlobAclStore,
}                               from './src/blobAclStore.js';
