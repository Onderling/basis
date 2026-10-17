# @onderling/agent-provisioning

> **Layer: facade.** One-call agent bring-up. Composes
> [`@onderling/core`](../core/) + the standardisation substrates
> (`@onderling/vault`, `@onderling/oidc-session`,
> `@onderling/webid-discovery`, plus the forthcoming
> `@onderling/pseudo-pod` and `@onderling/agent-registry`) into a
> single `provisionAgent({...})` factory.
>
> Apps that want the canonical Hub-free bring-up use this; anything
> bespoke composes substrates manually (every substrate stands
> alone).
>
> Authored 2026-05-11 as part of standardisation Phase 50.5.b — see
> `Project Files/SDK/core-v2-coding-plan-2026-05-11.md`.

## Why a facade?

The strict layering invariant (`apps → substrates → core`) means
core never imports substrates. That keeps core clean — but it
shifts the "wire everything together" work to a higher layer.
This package is that higher layer: it imports core + every
relevant substrate and exposes one function that returns a
working Agent.

## Public API

```js
import { provisionAgent } from '@onderling/agent-provisioning';

const { agent, identity, vault, mnemonic, oidc, webid } =
  await provisionAgent({
    // required
    transport,                         // any @onderling/core Transport

    // identity
    mnemonic,                          // omit to generate fresh
    vault,                             // optional; defaults to VaultMemory

    // pod-having mode (optional)
    oidc: {
      webid:        'https://anne.example/profile#me',
      oidcIssuer:   'https://login.inrupt.com',
      clientId:     'app-client-id',
      clientSecret: 'app-client-secret',
      refreshToken: '...',             // skip full login if supplied
    },

    // substrate slots (all optional)
    pseudoPod,                         // pre-constructed; goes to agent.pseudoPod
    agentRegistry,                     // pre-constructed; goes to agent.agentRegistry

    // wiring
    skills:           [echo, foo],     // pre-register on the Agent
    agentOpts:        { ... },         // pass-through to Agent ctor
    autoStart:        true,            // call agent.start() before returning
    webidHeartbeatMs: 60_000,
  });
```

### What it does, in order

1. Pick / generate a 24-word mnemonic.
2. Pick a Vault (caller-supplied, or `VaultMemory` by default).
3. Reconstitute / generate the `AgentIdentity` (deterministic
   from the mnemonic via core's `AgentIdentity.fromMnemonic`).
4. **If `oidc` is supplied** — construct a `SolidVault` OIDC
   session + log in.
5. **If `oidc` is supplied** — construct a `WebIdCache` and
   refresh it (best-effort; failures don't block bring-up).
6. Build the `Agent`, populating its opaque slots:
   - `agent.webid`         ← `WebIdCache` (or null)
   - `agent.pseudoPod`     ← caller-supplied (or null)
   - `agent.agentRegistry` ← caller-supplied (or null)
7. `agent.start()` (when `autoStart: true`, default).
8. Return `{agent, identity, vault, mnemonic, oidc, webid}`.

### Result shape

| Field | Description |
|---|---|
| `agent` | The `Agent` instance, started (by default) |
| `identity` | The `AgentIdentity` backing the agent |
| `vault` | The Vault used for identity storage |
| `mnemonic` | The BIP-39 phrase if `mnemonic` was provided; `null` on fresh-generate (the AgentIdentity owns the seed) |
| `oidc` | The `SolidVault` session, or `null` |
| `webid` | The `WebIdCache`, or `null` |

## Where this sits in the layering

```
                  Apps (Tasks, Pinboard, Folio)
                          │
                          ▼
        @onderling/agent-provisioning  ← this package (facade)
                          │
        ┌───────┬─────────┼─────────┬───────────────────┐
        ▼       ▼         ▼         ▼                   ▼
  @onderling/  @onderling/  @onderling/  @onderling/   @onderling/
    core      vault      oidc-       webid-       (forthcoming
              (substrate) session     discovery   pseudo-pod,
                         (substrate) (substrate)  agent-
                                                  registry, ...)
```

Core sits at the bottom. Every substrate stands alone (imports
nothing from this facade, nothing from each other beyond explicit
contracts). The facade imports everything and composes.

## Bring it up

```bash
cd packages/agent-provisioning
npm install
npm test
```

11 tests covering:
- local-only bring-up (no OIDC)
- mnemonic restore (deterministic identity)
- caller-supplied vault passthrough
- pre-constructed pseudoPod / agentRegistry passthrough
- autoStart toggle
- pod-having bring-up with mocked OIDC (Inrupt session injected
  via `_setSessionFactory` from `@onderling/oidc-session`)
- WebIdCache wiring with the pseudo-pod's read

## Limitations / future work

- The not-yet-built substrates (`@onderling/pseudo-pod`,
  `@onderling/agent-registry`, `@onderling/pod-onboarding`) are
  accepted as **opaque pre-constructed objects**. When they
  ship as proper substrates, the facade gains the ability to
  construct them too (a follow-up phase, post-substrate work).
- First-run pod provisioning (creating the
  `<anchor-pod>/private/sub-containers` + the WebID profile
  pointer predicates) waits for the `@onderling/pod-onboarding`
  substrate — see Phase 50.5.b.3 in the coding plan.
- Apps haven't migrated yet (Phase 50.5.b.5). Tasks V1
  desktop, Folio's `bin/folio init`, and Pinboard V1.5 desktop
  continue to use their existing bring-up flows; they'll move
  to `provisionAgent` when convenient.

## See also

- [`@onderling/core`](../core/) — Agent + transport + skill
  registry + identity primitives.
- [`@onderling/vault`](../vault/) — Vault family.
- [`@onderling/oidc-session`](../oidc-session/) — Solid OIDC for
  Node.
- [`@onderling/oidc-session-rn`](../oidc-session-rn/) — Solid
  OIDC for React Native (the RN provisioning analogue lives
  in `@onderling/sync-engine-rn`'s `createMobileBootstrap`).
- [`@onderling/webid-discovery`](../webid-discovery/) — WebID
  profile pointer-walk + cache.
- `Project Files/SDK/core-v2-functional-design-2026-05-11.md`
  — design context.
