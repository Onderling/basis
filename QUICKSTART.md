# Quickstart

Build a working agent in ~20 lines.  This page is for evaluating the
shape of the API; once you're past the smoke test, see
[`docs/architecture.md`](docs/architecture.md) for the bigger picture.

---

## 1. Two agents — no network setup

Smallest possible thing that's still a real round-trip.  Two agents
share an in-process bus and call each other's skills.  No relay, no
sockets — just `Agent` + `InternalTransport`.

```js
// quickstart-pair.js
import {
  Agent, AgentIdentity, VaultMemory,
  InternalBus, InternalTransport,
  TextPart, Parts,
} from '@onderling/sdk';

const bus = new InternalBus();

async function makeAgent(label) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const agent = new Agent({
    identity:  id,
    transport: new InternalTransport(bus, id.pubKey, { identity: id }),
    label,
  });
  await agent.start();
  return agent;
}

const alice = await makeAgent('alice');
const bob   = await makeAgent('bob');

// Bob exposes a skill.
bob.register('greet', async ({ parts, from }) => {
  const name = Parts.text(parts) ?? 'stranger';
  return [TextPart(`Hello, ${name}! (you are ${from.slice(0, 8)}…)`)];
}, { visibility: 'public' });

// Alice introduces herself, then calls Bob's skill.
await alice.hello(bob.address);
const reply = await alice.invoke(bob.address, 'greet', [TextPart('world')]);
console.log(Parts.text(reply));    // → "Hello, world! (you are …)"
```

Run with `node quickstart-pair.js` after `npm install
@onderling/sdk` (or via the file-link in this monorepo).

What just happened:
- Each agent generated an Ed25519 keypair (stored in memory).
- `hello()` did a signed handshake; afterwards both `SecurityLayer`s
  hold each other's pubkey.
- `invoke()` encrypted + signed the call, ran Bob's skill, returned
  the parts.

---

## 2. Standalone agent talking to a relay

For two agents in different processes (or browser ↔ Node), use a
relay.  The relay is a dumb broker — it forwards `nacl.box`-encrypted
envelopes; it can't read them.

```bash
# terminal 1
node packages/relay/src/server.js          # listens on :8787 by default
```

```js
// my-agent.js
import {
  Agent, AgentIdentity, VaultNodeFs,
  RelayTransport,
  TextPart, Parts,
} from '@onderling/sdk';

const vault    = new VaultNodeFs({ path: './my-agent.vault' });
let identity;
try   { identity = await AgentIdentity.restore(vault); }
catch { identity = await AgentIdentity.generate(vault); }

const transport = new RelayTransport({
  identity,
  relayUrl: 'ws://localhost:8787',
});

const agent = new Agent({ identity, transport, label: 'my-app' });

agent.register('greet', async ({ parts, from }) => {
  return [TextPart(`Hello, ${Parts.text(parts) ?? 'stranger'}!`)];
}, { visibility: 'public' });

await agent.start();
console.log('my pubkey:', identity.pubKey);

// To call another peer once you know its pubkey:
//   const reply = await agent.invoke(otherPubKey, 'greet', [TextPart('world')]);
//   console.log(Parts.text(reply));
```

Run two copies of this in separate terminals (each writes its own
vault file → distinct identities).  Print each pubkey, then
`agent.invoke(otherPubKey, 'greet', …)` to round-trip a call.

---

## 3. Phone app — `createMeshAgent`

The core `@onderling/*` packages are on npm, but
`@onderling/react-native` isn't published yet — a phone app works
against a clone of this repo.  Two ways to get the JS code wired up
so Metro can find it.

### 3a. File layout — easy path (inside this monorepo)

Easiest if you're prototyping or evaluating: copy `apps/mesh-demo`
and put your new app next to it.

```
canopy-mono/
  packages/
    core/                          ← SDK (consumed as-is)
    react-native/                  ← SDK (consumed as-is)
    relay/                         ← SDK (run the server from here)
  apps/
    mesh-demo/                     ← reference app (works out of the box)
    my-app/                        ← ← ← put your new app here
      package.json                 ← copy from mesh-demo, change "name"
      metro.config.js              ← copy from mesh-demo verbatim
      app.json                     ← change "slug"/"name"; otherwise copy
      babel.config.js              ← copy verbatim
      index.js                     ← copy verbatim
      App.js                       ← your code
      src/
        agent.js                   ← your createMeshAgent factory
```

Your `package.json` references the SDK via `file:` links:

```json
"dependencies": {
  "@onderling/core":         "file:../../packages/core",
  "@onderling/react-native": "file:../../packages/react-native",
  …
}
```

Then `npm install && npx expo run:android` from inside
`apps/my-app/`.  Metro's `watchFolders` (set in the copied
`metro.config.js`) picks up live edits to the SDK source, so you can
edit `packages/core/src/...` and the app reloads.

### 3b. File layout — standalone (your own clone of the SDK elsewhere)

If your app lives outside this repo (e.g. `~/projects/my-app`) and
you cloned the SDK at `~/sdk/canopy-mono/`, you need three things:

1. **package.json** — point the file: links at the cloned SDK:

   ```json
   "dependencies": {
     "@onderling/core":         "file:../../sdk/canopy-mono/packages/core",
     "@onderling/react-native": "file:../../sdk/canopy-mono/packages/react-native"
   }
   ```

   Use a path relative to `my-app/` so the link survives moves.

2. **metro.config.js** — Metro doesn't follow symlinks well, so
   tell it explicitly to watch the SDK folders.  The shape mirrors
   `apps/mesh-demo/metro.config.js`; the key bits are
   `watchFolders` and `extraNodeModules`:

   ```js
   const path     = require('path');
   const { getDefaultConfig } = require('expo/metro-config');

   const sdkRoot = path.resolve(__dirname, '../../sdk/canopy-mono');
   const config  = getDefaultConfig(__dirname);

   config.watchFolders = [
     path.resolve(sdkRoot, 'packages/core'),
     path.resolve(sdkRoot, 'packages/react-native'),
   ];
   config.resolver = {
     ...config.resolver,
     unstable_enablePackageExports: false,
     extraNodeModules: {
       ...(config.resolver?.extraNodeModules ?? {}),
       '@onderling/core':         path.resolve(sdkRoot, 'packages/core'),
       '@onderling/react-native': path.resolve(sdkRoot, 'packages/react-native'),
     },
   };

   module.exports = config;
   ```

   The full mesh-demo config does more (Node-builtin shims, blockList
   for the SDK's own `node_modules`, version-pinning of native modules
   to your app's copies).  Copy the whole file once you hit your first
   "duplicate native module" or "module not found" error from Metro.

3. **Run the relay** from the SDK clone:
   `node ~/sdk/canopy-mono/packages/relay/src/server.js`.  Point your
   app's `relayUrl` at your laptop's LAN IP, e.g.
   `ws://192.168.2.20:8787`.

### 3c. Your `src/agent.js`

```js
import {
  createMeshAgent,
  KeychainVault,
} from '@onderling/react-native';
import { TextPart, Parts } from '@onderling/core';

export async function makeAgent({ relayUrl }) {
  const agent = await createMeshAgent({
    label:    'my-phone',
    relayUrl,                                               // e.g. ws://192.168.2.20:8787
    vault:    new KeychainVault({ service: 'my-app' }),
  });

  agent.register('greet', async ({ parts, from }) => {
    return [TextPart(`Hi from phone — you said "${Parts.text(parts) ?? ''}"`)];
  }, { visibility: 'public' });

  // Optional opt-ins — match what apps/mesh-demo turns on.
  agent.enableAutoHello({ pullPeers: true });
  agent.startDiscovery({ gossipIntervalMs: 60_000 });

  // Start the agent only after registering everything you want
  // advertised in the first hello payload (capabilities snapshot).
  await agent.start();
  return agent;
}
```

`createMeshAgent` handles permission requests, identity restore-or-
generate, BLE central+peripheral, mDNS over TCP, relay reconnection,
peer-graph persistence, and the live routing strategy that learns
which transport works best per peer.

For a fully wired reference see
[`apps/mesh-demo/src/agent.js`](./apps/mesh-demo/src/agent.js) — it
opts into hop tunnels, sealed-forward, reachability oracle, and
rendezvous (WebRTC upgrade).

---

## 4. Expose your agent over HTTP — A2A

If you want non-`@onderling` clients (curl, browser fetch, IoT
devices, other agent frameworks) to call your agent's skills,
attach an `A2ATransport`.  The implementation lives at
`packages/core/src/a2a/`: plain HTTP routes (`POST /tasks/send`, SSE
on `/tasks/sendSubscribe`), JWT bearer auth, and an agent card at
`/.well-known/agent.json`.

> **Which A2A this is.** These routes follow an EARLIER, REST-shaped
> draft of A2A. The current A2A protocol is JSON-RPC (what
> `@a2a-js/sdk` 1.x speaks), and the two do not
> understand each other without a translation. The decided direction
> (2026-11-18): Basis turns to current A2A, first as a CLIENT that calls
> a circle's toolboxes from the always-on box; this transport is not
> renamed and keeps working for what it does today. Basis's own shells
> (web, phone, the box) do not serve an agent card: an outside program
> reaches a person's Basis through the native path (signed envelopes over
> the relay) or as a paired screen of their household bot.

```js
// my-agent.js  — extend the section-2 example
import {
  Agent, AgentIdentity, VaultMemory,
  RelayTransport,
  A2ATransport, A2ATLSLayer,
  TextPart, Parts,
} from '@onderling/sdk';

const identity  = await AgentIdentity.generate(new VaultMemory());
const agent     = new Agent({
  identity,
  transport: new RelayTransport({ identity, relayUrl: 'ws://localhost:8787' }),
  label:     'my-app',
});

agent.register('greet', async ({ parts }) => {
  return [TextPart(`Hello, ${Parts.text(parts) ?? 'stranger'}!`)];
}, { visibility: 'public' });

// Add an HTTP server that speaks A2A.  port: 0 picks a random port;
// pick a fixed one for production deployment.
const a2a = new A2ATransport({ agent, port: 8080 });
agent.addTransport('a2a', a2a);
agent.useSecurityLayer(new A2ATLSLayer());   // TLS-channel auth, not nacl.box
await agent.start();

console.log(`A2A endpoint: http://localhost:${a2a.serverPort}`);
console.log(`Agent card:   http://localhost:${a2a.serverPort}/.well-known/agent.json`);
```

Now anyone can reach your agent over plain HTTP:

```bash
# Discover what skills the agent exposes:
curl http://localhost:8080/.well-known/agent.json

# Invoke a skill (no auth — public visibility):
curl -X POST http://localhost:8080/tasks/send \
     -H 'Content-Type: application/json' \
     -d '{
       "skillId": "greet",
       "parts": [{ "kind": "text", "text": "world" }]
     }'

# Stream skill output (SSE):
curl -X POST http://localhost:8080/tasks/sendSubscribe \
     -H 'Content-Type: application/json' \
     -d '{ "skillId": "stream-demo", "parts": [...] }'
```

For authenticated skills, attach a JWT bearer token issued via
`agent.issueA2ACapabilityToken({ subject, skill, expiresIn })`:

```bash
curl -X POST http://localhost:8080/tasks/send \
     -H "Authorization: Bearer ${TOKEN}" \
     -H 'Content-Type: application/json' \
     -d '{ "skillId": "greet-private", "parts": [...] }'
```

A2A endpoints exposed:

| Method + path | Purpose |
|---|---|
| `GET /.well-known/agent.json` | Agent card (skills, capabilities, auth schemes) |
| `POST /tasks/send` | Invoke a skill, get JSON result |
| `POST /tasks/sendSubscribe` | Invoke a skill, get SSE stream of chunks |
| `GET /tasks/:id` | Task status |
| `POST /tasks/:id/cancel` | Cancel a running task |

For a deeper dive see the `A2ATransport` sections of
[`docs/api/core.md`](docs/api/core.md).

**TLS in production:** front the A2A endpoint with Caddy / nginx /
Cloudflare for HTTPS termination + rate limiting + CORS rules.
A2A is the "expose your agent textually" surface; the operational
hardening is standard reverse-proxy work.

**Custom routes** (e.g. `GET /weather/:city`) are deliberately not
SDK-supported — wire them up with whatever framework you prefer
(Express, Fastify, hono) and forward to `agent.invoke` internally.
A2A handles the standard agent-to-agent case; your custom HTTP API
is your call.

---

## 5. The three methods you'll use 90% of the time

| Method | Use when |
|---|---|
| `agent.register(id, handler, meta)` | Defining a skill peers can call. |
| `agent.invoke(peerId, skillId, parts, opts)` | Calling a peer directly (you have a path to them). Returns `Promise<Part[]>`. |
| `agent.invokeWithHop(peerId, skillId, parts, opts)` | Calling a peer that may only be reachable via a bridge (Group CC).  Auto-falls-back to a one-shot relay-forward if no tunnel-capable bridge is around. |

Skills are `async (ctx) => parts | iterable<parts>`.  The context
carries `{ parts, from, originFrom, originVerified, envelope }`.
Yield from a generator to stream chunks; throw `Task.InputRequired`
to ask the caller for more input.

---

## 6. Gotchas the tutorial glosses over

- **Two peers must hello each other first.**  `invoke` after a
  `hello` works; without one, `SecurityLayer` rejects with
  `UNKNOWN_RECIPIENT`.  In RN the factory's `enableAutoHello()` does
  this on every newly-discovered peer.
- **Sealed tunnels need both sides to opt in.**  See the mesh-demo
  app for how to wire `enableTunnelForward` + `registerTunnelReceiveSealed`
  + `enableSealedForwardFor('groupId')`.
- **The relay is currently for trusted networks only.**  No auth, no
  rate limit.  Hardening is on the roadmap.
- **Vault choice depends on host.**  `VaultMemory` for tests,
  `VaultNodeFs` for Node, `VaultLocalStorage` / `VaultIndexedDB` for
  browsers, `KeychainVault` for RN.
- **Identity rotation works** (`agent.rotateIdentity({
  gracePeriodSeconds })`) but mid-grace peers that were offline at
  broadcast time auto-migrate via inline proof on the first
  post-rotation envelope.  See [`docs/api/core.md`](docs/api/core.md)
  for the full story.

---

## 7. Where to go next

- **Try it on hardware** — `apps/mesh-demo` is the reference Expo app.
  Build it, run it on two phones, run the relay on your laptop, and
  watch them gossip.
- **Browser demo** — `examples/mesh-demo/` for a no-RN single-page version.
- **Architecture map** — [`docs/architecture.md`](docs/architecture.md) for
  the full model, [`docs/repository-layout.md`](docs/repository-layout.md)
  for where things live.
