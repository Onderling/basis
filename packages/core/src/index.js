/**
 * @onderling/core — public API
 *
 * Exports every stable surface that downstream packages and applications
 * should import. Internal helpers (b64, canonicalize, etc.) are intentionally
 * not exported here; import them directly if needed.
 */

// ── Emitter (base class) ──────────────────────────────────────────────────────
// Exported FIRST, deliberately: downstream packages (@onderling/item-store ItemStore,
// @onderling/identity-resolver MemberMap, …) do `class X extends Emitter` importing it
// from this barrel. On Hermes' circular-import init order, a late re-export leaves
// Emitter `undefined` at class-definition time → "Super expression must be null or a
// function" → the whole agent boot fails. Emitter.js has no deps, so exporting it
// before everything else makes the binding live before any cycle can reach it.
export { Emitter } from './Emitter.js';

// ── Envelope ────────────────────────────────────────────────────────────────
export { P, REPLY_CODES, mkEnvelope, canonicalize, isEnvelope, genId } from './Envelope.js';

// ── Parts ───────────────────────────────────────────────────────────────────
export {
  TextPart,
  DataPart,
  FilePart,
  ImagePart,
  Parts,
} from './Parts.js';

// ── Identity ────────────────────────────────────────────────────────────────
// NOTE: the Vault family (Vault, VaultMemory, VaultLocalStorage, VaultIndexedDB,
// VaultNodeFs, OAuthVault, makeAuthorizedFetch) lives in `@onderling/vault` — import
// it directly. `core` no longer re-exports it (kills the core→vault re-export
// inversion; guarded by test/layering.enforcement.test.js).
export { AgentIdentity }      from './identity/AgentIdentity.js';
export { KeyRotation }        from './identity/KeyRotation.js';
export { Bootstrap }          from './identity/Bootstrap.js';
// identity step 3 — per-circle addresses (unlinkability layer)
export { deriveCircleSeed, deriveCircleAddress, circleIdentity } from './identity/circleAddress.js';
export { circleLinkMessage, signCircleLink, signCircleLinkFromSeed, verifyCircleLink } from './identity/circleLink.js';
export {
  CIRCLE_ADDRESS_ANNOUNCE_KIND, circleAddressAnnouncement, ownCircleAddressAnnouncement,
  ownCircleAddressAnnouncementFromSeed, verifyCircleAddressAnnouncement,
  verifyCircleAddressAnnouncements,
} from './identity/circleAddressAnnouncement.js';
// Proof of possession of an address, for whatever routes to it (DESIGN-boundary-authentication §7).
// NOT circleLink: the verifier supplies a fresh nonce — see the header of addressPossession.js.
export {
  ADDRESS_NONCE_BYTES, ADDRESS_CHALLENGE_TTL_MS, newAddressChallenge,
  addressPossessionMessage, signAddressPossession, signAddressPossessionFromSeed,
  circleAddressSigner, verifyAddressPossession,
} from './identity/addressPossession.js';
export { hashHex } from './hashHex.js';
// NOTE: IdentityPodStore, IdentitySync and migrateVaultToPod were extracted OUT
// of core into `@onderling/pod-client` — they store/migrate/sync identity ON a pod
// (SDK pod layer), not kernel identity. Import them from '@onderling/pod-client'.
// `core` no longer re-exports them (guarded by test/layering.enforcement.test.js).
// AgentIdentity / KeyRotation / Bootstrap (kernel identity) stay here.
export { CloudBackup }                 from './identity/CloudBackup.js';
export { CloudAdapter, MemoryAdapter } from './identity/CloudAdapter.js';
export {
  generateMnemonic,
  mnemonicToSeed,
  seedToMnemonic,
  validateMnemonic,
} from './identity/Mnemonic.js';

// ── Security ─────────────────────────────────────────────────────────────────
export { SecurityLayer, SecurityError, SEC } from './security/SecurityLayer.js';
// Decision 1 — the two seams the inverted receive path is built on. `senderKey` decides what an
// envelope CARRIES (full key vs key id); `senderAuthorization` declares the roster-authorize
// port the kernel calls and never implements (kernel vs substrate).
export { SENDER_KEY_FIELD, senderCredential, resolveSenderKey, carriedSenderCredential, isEd25519PubKey }
  from './security/senderKey.js';
export { SENDER_AUTHORIZATION, allowSender, refuseSender, askSenderAuthorizer }
  from './security/senderAuthorization.js';
export {
  signReachabilityClaim,
  verifyReachabilityClaim,
  createMemorySeqStore,
  CLAIM_VERSION,
  DEFAULT_VERIFY_LIMITS,
}                                            from './security/reachabilityClaim.js';
export {
  signOrigin,
  verifyOrigin,
  ORIGIN_SIG_VERSION,
  DEFAULT_ORIGIN_WINDOW_MS,
}                                            from './security/originSignature.js';
export {
  packSealed,
  openSealed,
  SEALED_VERSION,
}                                            from './security/sealedForward.js';
export {
  tokenGate,
  groupGate,
  anyOf,
}                                            from './security/helloGates.js';

// ── Transport ────────────────────────────────────────────────────────────────
// NOTE: the concrete network transports (RelayTransport, MqttTransport,
// NknTransport, RendezvousTransport) were extracted OUT of core into
// `@onderling/transports` — import them from there. `core` no longer re-exports
// them (kills the kernel→concrete-adapter coupling; guarded by
// test/layering.enforcement.test.js). Transport (base), InternalBus/
// InternalTransport, LocalTransport, OfflineTransport and HubDelegateTransport
// stay here.
// `Transport` is a PORT — the compatibility contract a third-party network
// adapter implements (extend it, override `_put`). See docs/conventions/ports.md
// and test/conformance/transportConformance.js.
export { Transport }                      from './transport/Transport.js';
export { MAX_ENVELOPE_BYTES, EnvelopeTooLargeError, envelopeExceedsLimit, envelopeByteLength }
  from './transport/envelopeSize.js';
export {
  DISCOVERABILITY, DISCOVERABILITY_ORDER, isDiscoverability,
  normalizeDiscoverability, publishes, browses, maxExposure,
  createDiscoverabilityControl,
} from './transport/discoverability.js';
// Sender binding — the one shared rule ("may this envelope claim this sender?") plus the
// `authenticatedSender` port every boundary implements. Pure kernel logic; the transport-specific
// halves live with their adapters (nkn in `@onderling/transports`, the socket set in `@onderling/relay`).
export { senderVerdict, createSenderBinding } from './transport/senderBinding.js';
export { createNearbyPeerSource }         from './transport/nearbyPeers.js';
export { InternalBus, InternalTransport } from './transport/InternalTransport.js';
export { HubDelegateTransport }           from './transport/HubDelegateTransport.js';
export { LocalTransport }                 from './transport/LocalTransport.js';
export { OfflineTransport }               from './transport/OfflineTransport.js';

// ── Skills ────────────────────────────────────────────────────────────────────
export { defineSkill }         from './skills/defineSkill.js';
export { makeFetchResourceSkill } from './skills/fetchResource.js';

// Phase 50.9 — `ActorResolver` is a PORT: a STRUCTURAL (duck-typed) contract,
// not a class — there is no runtime symbol to export, only the `@typedef` in
// permissions/ActorResolver.js (the substrate `@onderling/agent-registry`
// implements it). The in-memory helper below is the reference adapter, for
// tests + minimal apps. See docs/conventions/ports.md and
// test/conformance/actorResolverConformance.js.
export { createInMemoryActorResolver } from './permissions/ActorResolver.js';
export { SkillRegistry }       from './skills/SkillRegistry.js';
export { registerRelayForward }        from './skills/relayForward.js';
export { registerRelayReceiveSealed }  from './skills/relayReceiveSealed.js';
export { registerReachablePeersSkill } from './skills/reachablePeers.js';
export { registerCapabilitiesSkill }   from './skills/capabilities.js';
export { registerTunnelOpen }          from './skills/tunnelOpen.js';
export { registerTunnelOw }            from './skills/tunnelOw.js';
export { registerTunnelReceiveSealed } from './skills/tunnelReceiveSealed.js';
export { TunnelSessions }              from './skills/tunnelSessions.js';
export { generateTunnelKey,
         sealTunnelOW,
         openTunnelOW }                from './security/tunnelSeal.js';
export { encode as b64encode,
         decode as b64decode }         from './crypto/b64.js';

// ── Protocol ──────────────────────────────────────────────────────────────────
export { Task }                                           from './protocol/Task.js';
export { ping }                                           from './protocol/ping.js';
export { sendMessage, handleMessage }                     from './protocol/messaging.js';
export { sendHello, handleHello }                         from './protocol/hello.js';
export { requestSkills, handleSkillDiscovery }            from './protocol/skillDiscovery.js';
export { invokeAgentSkill, handleTaskRequest, handleTaskOneWay } from './protocol/taskExchange.js';
export { subscribe, unsubscribe, publish, handlePubSub }  from './protocol/pubSub.js';
export {
  SkillsPubSub,
  buildTopic               as buildSkillTopic,
  audienceFromHumanInTheLoop,
} from './protocol/SkillsPubSub.js';
export { streamOut, handleStreamChunk, streamBidi }       from './protocol/streaming.js';
export {
  handleSessionOpen, handleSessionMessage, handleSessionClose,
  registerSessionSkills,
}                                                         from './protocol/session.js';
export {
  sendFile, bulkTransferSend, handleBulkChunk,
}                                                         from './protocol/fileSharing.js';
export { LiveSyncSkill }                                  from './protocol/LiveSyncSkill.js';

// ── State ─────────────────────────────────────────────────────────────────────
export { StateManager } from './state/StateManager.js';

// ── Permissions ───────────────────────────────────────────────────────────────
export { TrustRegistry, TIER_LEVEL } from './permissions/TrustRegistry.js';
export { PolicyEngine }     from './permissions/PolicyEngine.js';
export { CapabilityToken, offeringMatches, skillAttenuates } from './permissions/CapabilityToken.js';
export { PodCapabilityToken } from './permissions/PodCapabilityToken.js';
export { pathScopeCovers } from './permissions/pathScope.js';
export { TokenRegistry }    from './permissions/TokenRegistry.js';
export { GroupManager }     from './permissions/GroupManager.js';
export { verifyGroupProof } from './permissions/groupProofVerify.js';
export { DataSourcePolicy, DataSourceAccessDeniedError } from './permissions/DataSourcePolicy.js';
export {
  ROLES,
  STANDARD_RANKS,
  isStandardRole,
  roleRank,
  isKnownRole,
  registerCustomRole,
  unregisterCustomRole,
  canPromote,
  listKnownRoles,
} from './permissions/Roles.js';
export {
  defineRoleBundle,
  registerRoleBundle,
  getRoleBundle,
  hasRoleBundle,
  listRoleBundles,
  unregisterRoleBundle,
  resetRoleBundles,
  ADMIN_ROLE_BUNDLE,
} from './permissions/RoleBundle.js';
export { RoleGrantManager, materializeBundle } from './permissions/RoleGrant.js';
export { TaskGrantManager } from './permissions/TaskGrant.js';

// ── Routing (Group G) ────────────────────────────────────────────────────────
export { FallbackTable }                       from './routing/FallbackTable.js';
export { RoutingStrategy, TRANSPORT_PRIORITY } from './routing/RoutingStrategy.js';
export { invokeWithHop }                       from './routing/invokeWithHop.js';
export {
  default as ReachabilityTier,
  TIERS as REACHABILITY_TIERS,
  tierForTransport,
  tierForRouteVia,
  compareTiers,
}                                              from './routing/ReachabilityTier.js';
export {
  ReachabilityOracle,
  ORACLE_TOPIC as REACHABILITY_ORACLE_TOPIC,
}                                              from './routing/ReachabilityOracle.js';

// ── Discovery (Group G) ──────────────────────────────────────────────────────
export { PeerGraph }      from './discovery/PeerGraph.js';
export { PeerDiscovery }  from './discovery/PeerDiscovery.js';
export { GossipProtocol } from './discovery/GossipProtocol.js';
export { PingScheduler }  from './discovery/PingScheduler.js';
export { pullPeerList }   from './discovery/pullPeerList.js';
export { peerFacade }     from './discovery/peerFacade.js';

// ── A2A layer (Group H) ───────────────────────────────────────────────────────
export { A2ATLSLayer }      from './a2a/A2ATLSLayer.js';
export { A2AAuth }          from './a2a/A2AAuth.js';
export { A2ATransport }     from './a2a/A2ATransport.js';
export { AgentCardBuilder } from './a2a/AgentCardBuilder.js';
export { discoverA2A }      from './a2a/a2aDiscover.js';
export { sendA2ATask }      from './a2a/a2aTaskSend.js';
export { sendA2AStreamTask } from './a2a/a2aTaskSubscribe.js';

// ── Storage (Group I) ────────────────────────────────────────────────────────
// `DataSource` is a PORT — the compatibility contract a third-party storage
// adapter implements (extend it, implement read/write/delete/list). See
// docs/conventions/ports.md and test/conformance/dataSourceConformance.js.
export { DataSource }        from './storage/DataSource.js';
export { MemorySource }      from './storage/MemorySource.js';
export { IndexedDBSource }   from './storage/IndexedDBSource.js';
export { FileSystemSource }  from './storage/FileSystemSource.js';
// `StorageBackend` is a second, narrower PORT: a BLIND ciphertext store
// (put/get/list, ciphertext only). The seal — not the store's access control —
// gates who can read, so the store is a free choice and sealed content is
// portable across backends. `MemoryStorageBackend` is the reference adapter; the
// pod adapter (`podStorageBackend`) lives in @onderling/pod-client. See
// docs/conventions/ports.md and conformance/storageBackendConformance.js.
export { StorageBackend }       from './storage/StorageBackend.js';
export { MemoryStorageBackend } from './storage/MemoryStorageBackend.js';
// NOTE: `SolidPodSource` lives in `@onderling/pod-client` — import it directly.
// The concrete Solid pod DataSource + its portable archive pair (`PodExporter`
// / `PodImporter`) were extracted OUT of `core`; it no longer re-exports them
// (guarded by test/layering.enforcement.test.js).
// NOTE: `SolidVault` lives in `@onderling/oidc-session` — import it directly.
// `core` no longer re-exports it, and no longer depends on `@onderling/oidc-session`
// at all (kills that inversion; guarded by test/layering.enforcement.test.js).
export { StorageManager }    from './storage/StorageManager.js';
export {
  setUnionWithDedupe,
  appendOnlyEventLog,
  lastWriteWins,
  MergeContracts,
}                            from './storage/MergeContracts/index.js';
export { FederatedReader }   from './storage/FederatedReader.js';

// ── Config ────────────────────────────────────────────────────────────────────
export { AgentConfig } from './config/AgentConfig.js';

// ── Agent ─────────────────────────────────────────────────────────────────────
export { Agent } from './Agent.js';
