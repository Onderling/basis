/**
 * @onderling/sdk — the batteries-included, LAYERED developer facade.
 *
 * ONE import for the whole SDK, in two layers:
 *
 * ── LOW layer (explicit / concrete) ─────────────────────────────────────
 * Named re-exports so a dev has a single import but passes adapters
 * EXPLICITLY (maximal clarity + compatibility). The whole kernel is
 * re-exported (`export * from '@onderling/core'`), plus the default concrete
 * adapters that were de-fatted OUT of the kernel:
 *   - the Vault family from @onderling/vault (VaultMemory is the default),
 *   - the network transports from @onderling/transports,
 *   - the pod pieces from @onderling/pod-client.
 * A dev who wants control uses these directly, e.g.:
 *
 *     import { Agent, AgentIdentity, VaultMemory, RelayTransport } from '@onderling/sdk';
 *     const id = await AgentIdentity.generate(new VaultMemory());
 *     const agent = new Agent({ identity: id, transport: new RelayTransport({ identity: id, relayUrl }) });
 *     await agent.start();
 *
 * ── HIGH layer (opinionated / "import one thing, done") ──────────────────
 * Thin helpers built ON the low layer that inject the defaults:
 *   - createAgent(opts)                 — Tier-3 run-as-agent, batteries in.
 *   - connectSkill(agent, name, appFn)  — Tier-1 plain-fn → skill adapter.
 *
 *     import { createAgent, connectSkill } from '@onderling/sdk';
 *     const agent = await createAgent();                       // VaultMemory + in-process transport, started
 *     connectSkill(agent, 'greet', (args) => `Hi ${args.name}`);
 *
 * Defaults live HERE (in the facade), never back in @onderling/core — the
 * kernel stays de-fatted; this package restores the DX on top of it.
 *
 * ──: the barrel is now the SUM of the sub-path slices ───────────────
 * The batteries-included surface below is carved into importable sub-paths
 * so a consumer can take ONLY the pieces they need (core base vs each
 * extension) rather than the whole barrel:
 *   - `@onderling/sdk/core`       → the kernel base            (./core.js)
 *   - `@onderling/sdk/transports` → default network transports (./transports.js)
 *   - `@onderling/sdk/vault`      → default Vault family        (./vault.js)
 *   - `@onderling/sdk/pod`        → default pod-client surface  (./pod.js)
 *   - `@onderling/sdk/high`       → createAgent/connectSkill/…  (./high.js)
 *   - `@onderling/sdk/requires`   → capability vocab + validator(./requires.js)
 * This barrel simply re-exports every slice, so the aggregate named surface
 * is UNCHANGED — every existing `import { X } from '@onderling/sdk'` still
 * resolves to the same symbol.
 */

// ── LOW layer: the kernel base ───────────────────────────────────────────
export * from './core.js';

// ── LOW layer: default adapter extensions (de-fatted out of core) ────────
// Vault family (VaultMemory is createAgent's default) + OAuth helper.
export * from './vault.js';

// Concrete network transports (the base Transport + InternalTransport /
// OfflineTransport stay in @onderling/core, re-exported by ./core.js).
export * from './transports.js';

// Pod pieces — the whole @onderling/pod-client public surface (PodClient, Auth,
// SolidPodSource, ConflictResolver, sealing/sharing/tombstones, …).
export * from './pod.js';

// ── HIGH layer: opinionated helpers ──────────────────────────────────────
export * from './high.js';

// ──: requires vocabulary + validator (the seam) ───────────────
export { CAPABILITIES, REQUIRES_CODES, validateRequires } from './requires.js';

// ── manifest → skills: the shared wiring every app uses ────────────────────────────────────────────
// `buildSkillsFromManifest` documents itself as `import … from '@onderling/sdk'` and was never actually
// exported here, so both callers reached into `packages/sdk/src/…` directly — an invariant-5 violation
// the dependency guard reported and nobody could act on while it was red. Exported now, so the
// documented import is the working one.
export { buildSkillsFromManifest } from './buildSkillsFromManifest.js';
