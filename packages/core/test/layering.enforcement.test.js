import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as core from '../src/index.js';

// Phase 0a fitness-function: guard the core→vault / core→oidc-session inversion.
// `@onderling/vault` and `@onderling/oidc-session` were extracted OUT of `core`; core must
// NOT re-export them (the deprecation-era shim is gone) and must not depend on oidc-session
// at all. If any of these fail, someone re-introduced the layering inversion.

const here = dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(join(here, '../src/index.js'), 'utf8');
const pkg = JSON.parse(readFileSync(join(here, '../package.json'), 'utf8'));

const VAULT_SYMS = ['Vault', 'VaultMemory', 'VaultLocalStorage', 'VaultIndexedDB', 'VaultNodeFs', 'OAuthVault', 'makeAuthorizedFetch'];
const OIDC_SYMS = ['SolidVault'];

describe('layering: core does not re-export or depend on vault / oidc-session', () => {
  it('the barrel no longer re-exports the Vault family (import from @onderling/vault)', () => {
    for (const s of VAULT_SYMS) expect(core[s], `core should not re-export ${s}`).toBeUndefined();
  });

  it('the barrel no longer re-exports SolidVault (import from @onderling/oidc-session)', () => {
    for (const s of OIDC_SYMS) expect(core[s], `core should not re-export ${s}`).toBeUndefined();
  });

  it('src/index.js has no re-export from @onderling/vault or @onderling/oidc-session', () => {
    expect(indexSrc).not.toMatch(/from\s+['"]@onderling\/vault['"]/);
    expect(indexSrc).not.toMatch(/from\s+['"]@onderling\/oidc-session['"]/);
  });

  it('core has no RUNTIME dependency on vault / oidc-session (devDependencies allowed for tests)', () => {
    const runtime = { ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) };
    expect(runtime['@onderling/oidc-session']).toBeUndefined();
    expect(runtime['@onderling/vault']).toBeUndefined();
  });

  it('the kernel (Agent.js) does not import @onderling/vault at runtime (JSDoc @param type refs are fine)', () => {
    const agentSrc = readFileSync(join(here, '../src/Agent.js'), 'utf8');
    expect(agentSrc).not.toMatch(/await import\(\s*['"]@onderling\/vault['"]/);
    expect(agentSrc).not.toMatch(/^\s*import\s.*from\s*['"]@onderling\/vault['"]/m);
  });

  it('the kernel (Agent.js) constructs/imports no concrete network transport (they are injected)', () => {
    const agentSrc = readFileSync(join(here, '../src/Agent.js'), 'utf8');
    expect(agentSrc).not.toMatch(/new\s+(Rendezvous|Nkn|Mqtt|Relay)Transport\s*\(/);
    expect(agentSrc).not.toMatch(/^\s*import\s.*(Rendezvous|Nkn|Mqtt|Relay)Transport.*from\s*['"]\.\/transport\//m);
    expect(agentSrc).not.toMatch(/await import\(\s*['"]\.\/transport\/(Rendezvous|Nkn|Mqtt|Relay)Transport/);
  });

  it('core still exports its own kernel surface (sanity — the barrel is intact)', () => {
    for (const s of ['Agent', 'AgentIdentity', 'Emitter', 'Parts']) expect(core[s], `core must still export ${s}`).toBeDefined();
  });

  it('the barrel no longer re-exports the pod-storage adapters (SolidPodSource / PodExporter / PodImporter live in @onderling/pod-client)', () => {
    // Extracted OUT to @onderling/pod-client — core must NOT re-export them, and
    // src/index.js must have no export-from their old ./storage/ paths.
    for (const s of ['SolidPodSource', 'PodExporter', 'PodImporter']) {
      expect(core[s], `core should not re-export ${s} (it lives in @onderling/pod-client)`).toBeUndefined();
    }
    expect(indexSrc).not.toMatch(/from\s+['"]\.\/storage\/SolidPodSource\.js['"]/);
    expect(indexSrc).not.toMatch(/from\s+['"]\.\/storage\/PodExporter\.js['"]/);
    expect(indexSrc).not.toMatch(/from\s+['"]\.\/storage\/PodImporter\.js['"]/);
  });

  it('the barrel keeps the Transport base + InternalTransport but no longer re-exports the concrete network transports (import from @onderling/transports)', () => {
    // Kept in core (base + kernel-adjacent transports).
    expect(core.Transport, 'core must still export the Transport base').toBeDefined();
    expect(core.InternalTransport, 'core must still export InternalTransport').toBeDefined();
    // Extracted OUT to @onderling/transports — core must NOT re-export them.
    for (const s of ['NknTransport', 'MqttTransport', 'RelayTransport', 'RendezvousTransport']) {
      expect(core[s], `core should not re-export ${s} (it lives in @onderling/transports)`).toBeUndefined();
    }
  });

  it('the barrel no longer re-exports the on-pod identity family (import from @onderling/pod-client)', () => {
    // IdentityPodStore / IdentitySync / migrateVaultToPod store/migrate/sync
    // identity ON a pod — they were extracted OUT to @onderling/pod-client (SDK pod
    // layer). Kernel identity (AgentIdentity / Bootstrap) stays here.
    for (const s of ['IdentityPodStore', 'IdentitySync', 'migrateVaultToPod']) {
      expect(core[s], `core should not re-export ${s} (it lives in @onderling/pod-client)`).toBeUndefined();
    }
    expect(indexSrc).not.toMatch(/from\s+['"]\.\/identity\/IdentityPodStore\.js['"]/);
    expect(indexSrc).not.toMatch(/from\s+['"]\.\/identity\/IdentitySync\.js['"]/);
    expect(indexSrc).not.toMatch(/from\s+['"]\.\/identity\/migrateVaultToPod\.js['"]/);
    // Kernel identity must remain.
    for (const s of ['AgentIdentity', 'Bootstrap']) {
      expect(core[s], `core must still export kernel identity ${s}`).toBeDefined();
    }
  });
});
