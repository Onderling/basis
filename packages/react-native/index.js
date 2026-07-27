/**
 * @onderling/react-native — RN platform layer (polyfills, Metro preset,
 * BLE/mDNS/Keychain adapters, MobilePushBridge, push adapters, mesh agent
 * factory).
 *
 * **Layer: SDK foundation.** Substrates and apps compose primitives from this
 * package; substrates MUST NOT reinvent them, apps MUST justify direct use in
 * their README. See `Project Files/conventions/architectural-layering.md`.
 */

export { KeychainVault }          from './src/identity/KeychainVault.js';
export { VaultAsyncStorage }      from './src/identity/VaultAsyncStorage.js';
export { attachIdentityToAgent }  from './src/identity/IdentityWiring.js';
export { AsyncStorageAdapter }    from './src/storage/AsyncStorageAdapter.js';
export { FileSystemAdapter }      from './src/storage/FileSystemAdapter.js';
export { MdnsTransport }          from './src/transport/MdnsTransport.js';
export { BleTransport, SERVICE_UUID, CHARACTERISTIC_UUID }
                                  from './src/transport/BleTransport.js';
export { NknTransport, HI_RACE_PATTERNS }
                                  from './src/transport/NknTransport.js';
export { requestMeshPermissions } from './src/permissions.js';
export { buildMeshTransports }    from './src/buildMeshTransports.js';
export { createMeshAgent }        from './src/createMeshAgent.js';
export { subscribeToNetworkChange, combineSources }
                                  from './src/networkChangeSource.js';
export { MobilePushBridge }       from './src/transport/MobilePushBridge.js';
export { PushAdapter }            from './src/transport/pushAdapters/PushAdapter.js';
// ExpoNotificationsAdapter is intentionally NOT re-exported from the barrel —
// it imports `expo-notifications` at module-load time (peer dep), and apps
// that don't use push shouldn't be forced to install it.  Use the subpath:
//   import { ExpoNotificationsAdapter }
//     from '@onderling/react-native/src/transport/pushAdapters/ExpoNotificationsAdapter.js';

// pseudo-pod-adapter (Phases 51.1 – 51.4). NOT re-exported here on
// purpose — its factories take namespace imports of `expo-file-system`
// and `@react-native-async-storage/async-storage`, which the substrate
// shouldn't force on every consumer of this barrel. Use the subpath:
//   import { createBackend } from '@onderling/react-native/pseudo-pod-adapter';
//
// hub-discovery + hub-binding (Phases 51.6 – 51.9). Also NOT re-exported —
// they take a native-module injection that production wires via
// `NativeModules.HubDiscovery` / `NativeModules.HubBinding`. Use the subpaths:
//   import { createHubDiscovery } from '@onderling/react-native/hub-discovery';
//   import { bind }               from '@onderling/react-native/hub-binding';
