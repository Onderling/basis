# hub-binding

Promise-based wrapper around the Hub AIDL binder. Apps call high-
level methods (`fetchResource`, `publishEnvelope`, …); the wrapper
handles bind / version-negotiation / register / unbind.

> Standardisation Phase **51.7 – 51.9**. AIDL interface files live
> under `android/aidl/com/onderling/hub/`; build wiring is documented
> in `HUB-BINDING-BUILD.md`.

---

## Quick start

```js
import { NativeModules } from 'react-native';
import {
  bind,
  negotiateVersion,
} from '@onderling/react-native/hub-binding';
import { createHubDiscovery } from '@onderling/react-native/hub-discovery';

const hd = createHubDiscovery({ nativeModule: NativeModules.HubDiscovery });
const { hubInstalled } = await hd.check();
if (!hubInstalled) return runInProcess();

const binding = await bind({
  nativeModule:   NativeModules.HubBinding,
  manifest: {
    bundleId:       'tasks-bundle',
    displayName:    'Tasks',
    supportedTypes: ['task'],
  },
  clientVersions: [1, 2],     // we speak both; Hub picks the highest
});

const bytes = await binding.fetchResource('https://anne.pod/sharing/tasks/abc.ttl');
await binding.writeResource('https://anne.pod/sharing/tasks/abc.ttl', updated, oldEtag);

await binding.publishEnvelope(
  { kind: 'task', ref: 'pseudo-pod://anne/tasks/abc', etag: '"v1"' },
  ['agent://bob', 'agent://carol'],
);

const unsub = binding.onIncomingEnvelope((envelope) => {
  console.log('got', envelope.kind, envelope.ref);
});

// Later:
unsub();
await binding.close();
```

---

## Version negotiation

```text
negotiateVersion({ clientVersions, hubVersions }) → number
  // picks the highest version both sides support
  // throws NO_COMPATIBLE_VERSION when there's no overlap
```

`bind()` runs the negotiation internally:

1. Native bridge → `getSupportedVersions(bindingId)` returns the
   Hub's `[1, 2]`-shaped array.
2. `negotiateVersion` picks max(intersection(client, hub)).
3. `IHubBinding.version` carries the negotiated value; V2-only
   methods gate on it (throw `VERSION_UNSUPPORTED` on V1 bindings).

Mismatch behaviour:

| Bundle  | Hub      | Result |
|---------|----------|--------|
| [1, 2]  | [1, 2]   | V2 |
| [1, 2]  | [1]      | V1 (Hub fallback) |
| [1]     | [1, 2]   | V1 (bundle fallback) |
| [2]     | [1]      | throw `NO_COMPATIBLE_VERSION` |

---

## API

```text
bind({ nativeModule, manifest, intentAction?, clientVersions? })
  → Promise<IHubBinding>

binding.version       → 1 | 2
binding.bindingId
binding.sessionId
binding.isClosed

binding.fetchResource(uri)                          → Promise<bytes>
binding.writeResource(uri, bytes, etag?)            → Promise<newEtag>
binding.publishEnvelope(envelope, recipients)        → Promise<void>
binding.declareCapabilities(caps)                    → Promise<ack>
binding.onIncomingEnvelope(callback)                 → unsubscribe fn
binding.close()                                      → Promise<void>

// V2-only — throw VERSION_UNSUPPORTED when negotiated version < 2:
binding.registerInterface(rendererManifest)
binding.lookupInterface(typeName)
binding.orchestrateProtocol(protocolId, eventArgs)
```

Native bridge contract:

```text
nativeModule.bindService({ intentAction, hubVersion })  → Promise<bindingId>
nativeModule.getSupportedVersions(bindingId)            → Promise<number[]>
nativeModule.callMethod(bindingId, methodName, args)    → Promise<result>
nativeModule.registerIncomingCallback(bindingId, cb)    → unsubscribe fn
nativeModule.unbindService(bindingId)                   → Promise<void>
```

---

## Error codes

| code                    | meaning |
|---|---|
| `INVALID_ARGUMENT`      | malformed / missing argument |
| `BIND_FAILED`           | native `bindService` didn't return a bindingId |
| `VERSION_PROBE_FAILED`  | `getSupportedVersions` threw |
| `NO_HUB_VERSIONS`       | Hub reported an empty version list |
| `NO_COMPATIBLE_VERSION` | client + Hub version sets don't overlap |
| `REGISTER_FAILED`       | `registerBundle` rejected or returned no sessionId |
| `BINDING_CLOSED`        | call on a closed `IHubBinding` |
| `VERSION_UNSUPPORTED`   | V2-only method called on a V1 binding |

---

## What V0 deliberately does not do

- **Run the Kotlin native module.** Phases 51.7 / 51.8 ship the JS
  surface + AIDL files + tests with mocked bridges. The
  `HubDiscoveryModule.kt` + `HubBindingModule.kt` implementations
  land in a follow-up phase that runs alongside Hub-Android's own
  build pipeline.
- **Auto-reconnect on service disconnect.** When the native side
  fires `onServiceDisconnected`, the binding marks itself closed.
  Apps re-bind by calling `bind()` again — typically gated on a
  `hub-discovery.watch()` "added" event.
- **Streaming/chunked payloads.** AIDL `byte[]` round-trips fit in
  a single binder transaction (≤ 1 MB practical limit). Large
  resources are pre-chunked by the Hub's pseudo-pod cache layer,
  not by this wrapper.
- **Multi-bundle support per process.** One `IHubBinding` per
  process. Multi-bundle apps construct + manage multiple bindings
  themselves.
