# Hub-binding Android build notes

This package ships the AIDL interface files but no compiled native
module yet. Real-pod integration with the Hub-Android service
requires building these as part of the consuming app's Android project.

> Standardisation Phase **51.7**.

---

## Files

```
android/aidl/com/onderling/hub/
├── IHub_V1.aidl          — Phase 51.7 interface
├── IHub_V2.aidl          — Phase 51.11 (direction-only) additive surface
└── IIncomingCallback.aidl — bundle-side callback for inbound envelopes
```

---

## Build integration

### Option A — depend on this package's `android/` (preferred)

Add to the consuming Expo app's `app.json` plugin config (when the
RN ↔ Android-AIDL integration ships):

```json
{
  "plugins": [
    [
      "@onderling/react-native",
      { "hubBinding": true }
    ]
  ]
}
```

The plugin copies the `.aidl` files into the host project's
`android/app/src/main/aidl/com/onderling/hub/` directory at prebuild
time. Gradle's `aidl` tool generates the Java stubs as part of the
normal Android build cycle.

### Option B — commit pre-generated Java stubs

For projects that don't run `aidl` at build time (Expo managed
workflow snapshots, CI environments without the Android SDK), the
generated `IHub_V1.java` + `IIncomingCallback.java` files can be
committed alongside the source `.aidl`s. **Decision**: not yet
done — committing generated stubs is brittle across AIDL versions.
First implementation should run the build step. Re-visit if Expo's
prebuild tooling can't accommodate it.

---

## Permission

The Hub declares a custom Android signature-level permission:

```xml
<!-- in the Hub APK's AndroidManifest.xml -->
<permission
    android:name="org.onderling.hub.PERMISSION_BIND"
    android:label="Bind to the Decentralised Web Agent Hub"
    android:protectionLevel="signature" />
```

Bundles must declare a `<uses-permission>` for this permission. The
Hub additionally verifies the caller's signature against a trusted-
signer allowlist at bind time — `signature`-level permission grants
the bind capability only to apps signed by the same key, and the
allowlist tightens that further to apps the user has explicitly
trusted at install time.

```xml
<!-- in the bundle (Tasks / Stoop / Folio) AndroidManifest.xml -->
<uses-permission android:name="org.onderling.hub.PERMISSION_BIND" />
```

---

## Native modules

Two native Android modules paired with the JS-side wrappers:

```
android/src/main/java/com/onderling/react/
├── HubDiscoveryModule.kt   — Phase 51.6 PackageManager wrapper
└── HubBindingModule.kt     — Phase 51.8 binding + 51.9 callback bridge
```

These wrap the AIDL-generated stubs and surface a JS-friendly
Promise-based API via ReactContextBaseJavaModule. **V0 status**:
direction-only — the JS-side ships with mock-friendly injection
points; production wires `NativeModules.HubDiscovery` /
`NativeModules.HubBinding` when the modules land in a follow-up.

Method-level contract (the shape the native modules expose to JS):

```text
HubDiscovery
  queryHubService(intentAction: String)
    → Promise<{hubInstalled, hubVersion?, packageName?, serviceName?, supportedVersions?}>
  subscribePackageEvents(callback)
    → unsubscribe fn (delivers {op: 'added'|'removed', packageName})

HubBinding
  bindService({intentAction, hubVersion}) → Promise<bindingId: String>
  callMethod(bindingId, methodName, args) → Promise<result>
  registerIncomingCallback(bindingId, callback) → unsubscribe fn
  unbindService(bindingId) → Promise<void>
  getSupportedVersions(bindingId) → Promise<number[]>
```

---

## Test-time strategy

JS-side tests **never touch the native module**. They pass mock
objects implementing the surface above. See:

```
packages/react-native/test/hub-discovery/check.test.js
packages/react-native/test/hub-binding/IHubBinding.test.js
```

Production wiring (when the native modules ship):

```js
import { NativeModules } from 'react-native';
import { createHubDiscovery } from '@onderling/react-native/hub-discovery';
import { bind } from '@onderling/react-native/hub-binding';

const hd = createHubDiscovery({ nativeModule: NativeModules.HubDiscovery });
const { hubInstalled } = await hd.check();
if (hubInstalled) {
  const binding = await bind({
    nativeModule: NativeModules.HubBinding,
    intentAction: 'org.onderling.hub.BIND',
    hubVersion:   1,
  });
  // …
}
```
