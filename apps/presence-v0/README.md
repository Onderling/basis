# H8 — presence-v0

> **Layer: app.** Composes substrates from `packages/{item-store, agent-ui, ...}`. Direct kernel use is allowed only when justified in this README's `## Direct kernel use` section (per [`app-readme-scheme.md`](../../docs/conventions/app-readme-scheme.md)). See [`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md).

Privacy-preserving proof of presence: a phone agent proves to a home
agent that the user is physically present at the household, by
proving (a) WiFi-associated + (b) reachable via direct LAN (mDNS /
BLE), not via relay.

V0 = the simplest viable variant per the author's 2026-04-26 contribution
to the H8 design.  No beacons, no QR codes, no witness networks
(those are V1+).  GDPR boundary: WiFi data stays on the user's own
devices.

## What's in here

- **`src/HomeAgent.js`** — issues short-lived attestation tokens
  when both signals (WiFi + LAN) pass; logs every attestation in
  an L1b ItemStore for audit.
- **`src/ProverAgent.js`** — phone-side flow: `checkWifi` →
  `probeHomeAgent` → `requestAttestation`.  Returns a token or an
  error result.
- **`src/types.js`** — `LocalPresenceProbe` interface +
  `AttestationToken` shape (JSDoc).

## Substrates

This app composes the following substrate packages
(see [`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md)):

| Package | Used for | Why a substrate, not direct kernel |
|---|---|---|
| `@onderling/item-store` (L1b) | Audit trail of issued attestation tokens (`addItem` per attestation, append-only). | The pod write paths + per-field merge contracts are amortised across H4 (tasks) / H5 (neighbourhood) / H8 (this app) — no need to re-implement. |

## Direct kernel use

| Kernel/adapter package | Primitive | Used for | Justification |
|---|---|---|---|
| `@onderling/core` | `MemorySource` | DataSource concrete passed into `ItemStore` for tests + the V0 in-memory deployment. | `ItemStore` is `core.DataSource`-shaped post-Phase 5.2; production replaces this with a `pod-client.PodClient`-wrapped adapter at the app layer. |
| `@onderling/core` | (Future, V1+) `transportFor(peerId)` on a `core.Agent` | Transport-classification probe distinguishing LAN-direct (mDNS / BLE) vs relay — the entire point of H8. | The transport-routing distinction is foundational kernel behaviour; no substrate wraps "what transport is this peer reachable on" because every consumer's needs differ. V0 stub skips construction; V1 pulls in `core.Agent` directly. |

The V0 home-/prover-agent classes today don't construct a real `core.Agent` — they just hold the policy logic + audit. V1 wires `core.Agent` for the actual LAN-vs-relay probe (the H8 design intent); that addition will appear in this table when it lands.

## Bring it up

```bash
cd apps/presence-v0
npm install
npm test          # 11 integration tests
```

Real-device validation (Android phone + a Mac mini home agent on LAN) is the next milestone for H8 — see "Real-device validation (deferred)" below.

## Usage

```js
import { HomeAgent, ProverAgent } from '@onderling-app/presence-v0';

// Home agent (runs on the household's always-on machine)
const home = new HomeAgent({
  homeWebid:  'https://id.example/home-de-roos',
  locationId: 'household-de-roos',
  ttlMs:      5 * 60 * 1000,        // 5-minute attestations
});

// Phone agent (runs on the user's RN app)
const prover = new ProverAgent({
  subjectWebid: 'https://id.example/anne',
  homeWebid:    'https://id.example/home-de-roos',
  probe: {
    // RN-side WiFi info: `expo-network` provides isWifi() / SSID;
    // V0 only needs the boolean — full SSID is optional + on-device.
    checkWifi: async () => {
      const { isConnected, type } = await Network.getNetworkStateAsync();
      return { associated: isConnected && type === 'WIFI' };
    },
    // SDK transport probe: try to reach `homeWebid` and ask
    // `transportFor(peerId)` what path was used.
    probeHomeAgent: async (homeWebid) => {
      const t = await agent.transportFor(homeWebid);
      // t.kind tells us 'lan' (mDNS / BLE direct) vs 'relay'
      return { reachable: !!t, transport: t?.kind ?? 'unreachable' };
    },
  },
  // Production: invoke the home agent's requestAttestation via SDK skill-call.
  invokeHomeAgent: (args) => agent.invokeSkill(home.webid, 'requestAttestation', args),
});

const result = await prover.attest();
if (result.error) {
  // 'wifi-not-associated' | 'not-lan-reachable' | 'denied' | 'transport'
} else {
  // result is an AttestationToken — short-lived, hand to consumers
}

// Verify on the home side
const v = home.verify(token);
if (v.valid) { /* token is good */ }
```

## V0 vs V1+

V0 (this package):
- Phone-side WiFi-association + LAN-direct probe
- Home-agent attestation issuance + verification
- L1b-backed audit log
- Short-lived tokens (5-minute TTL default)
- Unsigned tokens (V1 adds Ed25519 signing)

V1+:
- Witness networks via L1e (skill-match) — multiple co-signers via
  the existing closed-group skill-broadcast machinery
- Signed beacons (ESP32 + Ed25519 + TOTP rotation)
- QR / NFC / BLE capture from beacon
- Multi-signal composition (WiFi fingerprint + signed GPS + C2PA photo)
- ZKP composition (privacy-preserving "all signals from inside region X")

## Real-device validation (deferred)

Per `Project Files/projects/06-proof-of-location/wifi-and-agent.md`,
~1 week of focused work for V0 against a real Android phone + a real
home-agent server on LAN.  Steps:

1. Wire `expo-network` to the prover's `checkWifi`.
2. Wire `agent.transportFor` to the prover's `probeHomeAgent`.
3. Run home agent on a Mac mini (or similar) with mDNS advertising.
4. Test: phone on WiFi can attest; phone on cellular cannot.
5. Threat model walkthrough (per `wifi-and-agent.md`).

This V0 ships the substrate composition + agent shape; real-device
work is the next milestone for H8.

## Test coverage

11 integration tests cover:
- Happy path (WiFi + LAN → attestation token)
- Audit log entry
- Denial when WiFi not associated
- Denial when reachable only via relay
- Denial when home agent unreachable
- Denial when prover claims false signals
- Token verification (valid, wrong issuer, expired, wrong location)
- Custom TTL behaviour

## See also

- `Project Files/Substrates/apps/H8-presence.md` — sketch.
- `Project Files/projects/06-proof-of-location/README.md` — full design (verbatim user framing + research notes).
- `Project Files/projects/06-proof-of-location/wifi-and-agent.md` — V0 specifics + threat model + GDPR analysis.
