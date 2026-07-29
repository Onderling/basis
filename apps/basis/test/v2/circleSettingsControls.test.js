// L1 — Phase 4 §9 settings-surface controls: the `enabledWhen` fold (route × capability matrix)
// + the manifest is the source of the controls. Asserts each route/policy combo greys the RIGHT
// controls — pod-only disables the private-DM toggle; a relay route re-enables it; a relay-less
// route greys the relay/both transport options — and that missing transport data SEAMS to enabled
// (never a faked disable).
import { describe, it, expect, vi } from 'vitest';
import {
  resolveCircleRoute, resolveControlEnablement, transportOptionEnabled,
  settingsControlsFromManifest,
} from '../../src/v2/circleSettingsControls.js';
import { basisManifest } from '../../src/index.js';

const CONTROLS = settingsControlsFromManifest(basisManifest);

describe('§9 settings controls — declared on the manifest (invariant #4)', () => {
  it('the settings op carries its controls, declared in the manifest', () => {
    const ids = CONTROLS.map((c) => c.id);
    expect(ids).toEqual(['transport-mode', 'relay-endpoint', 'conversation-kinds', 'private-dm']);
  });

  it('the conversation-kinds control resolves its options from the registry, not from the manifest', () => {
    // Decision 3 (2026-07-29). Declared with `optionsFrom` rather than a frozen `of` list: the entry-kind
    // registry is the source, so adding a kind there cannot leave this control showing a stale set.
    const ck = CONTROLS.find((c) => c.id === 'conversation-kinds');
    expect(ck).toMatchObject({
      kind: 'multi', scope: 'circle', policyField: 'conversationKinds',
      optionsFrom: 'conversationKinds', adminOnly: true,
    });
    expect(ck.of, 'a frozen option list would drift from the registry').toBeUndefined();
  });
  it('the private-DM control is a circle-policy toggle gated by the relayRoute predicate', () => {
    const dm = CONTROLS.find((c) => c.id === 'private-dm');
    expect(dm).toMatchObject({ kind: 'toggle', scope: 'circle', policyField: 'privateDm', enabledWhen: 'relayRoute' });
  });
});

describe('§7 route × capability — the enabledWhen fold', () => {
  it('pod-only (shared pod, no relay) DISABLES member↔member private chat', () => {
    const out = resolveControlEnablement(CONTROLS, {
      policy: { pod: 'shared', privateDm: false },
      transport: { mode: 'nkn', relayUrl: '', relayConnected: false },
    });
    expect(out['private-dm'].enabled).toBe(false);
    expect(out['private-dm'].reason).toBe('pod-only-no-relay');
  });

  it('a configured relay endpoint ENABLES private chat (route re-enables it)', () => {
    const out = resolveControlEnablement(CONTROLS, {
      policy: { pod: 'shared' },
      transport: { mode: 'nkn', relayUrl: 'wss://relay.example', relayConnected: true },
    });
    expect(out['private-dm'].enabled).toBe(true);
    expect(out['private-dm'].reason).toBe('relay-route');
  });

  it('transport-mode = relay/both counts as a relay route (private enabled)', () => {
    for (const mode of ['relay', 'both']) {
      const out = resolveControlEnablement(CONTROLS, { policy: { pod: 'none' }, transport: { mode } });
      expect(out['private-dm'].enabled, mode).toBe(true);
    }
  });

  it('a no-pod circle with NKN-only still has no relay route → private disabled', () => {
    const out = resolveControlEnablement(CONTROLS, {
      policy: { pod: 'none' }, transport: { mode: 'nkn', relayUrl: '' },
    });
    expect(out['private-dm'].enabled).toBe(false);
  });

  it('transport-mode OPTIONS: nkn always available; relay/both grey out without a relay endpoint', () => {
    const out = resolveControlEnablement(CONTROLS, {
      policy: { pod: 'shared' }, transport: { mode: 'nkn', relayUrl: '' },
    });
    const opts = out['transport-mode'].options;
    expect(opts.nkn.enabled).toBe(true);
    expect(opts.relay.enabled).toBe(false);
    expect(opts.both.enabled).toBe(false);
  });

  it('with a relay endpoint configured, all transport-mode options are available', () => {
    const out = resolveControlEnablement(CONTROLS, {
      policy: { pod: 'shared' }, transport: { relayUrl: 'wss://relay.example' },
    });
    const opts = out['transport-mode'].options;
    expect(opts.nkn.enabled && opts.relay.enabled && opts.both.enabled).toBe(true);
  });

  it('transport-mode itself is always interactive (enabledWhen: always)', () => {
    const out = resolveControlEnablement(CONTROLS, { policy: { pod: 'shared' }, transport: { relayUrl: '' } });
    expect(out['transport-mode'].enabled).toBe(true);
    expect(out['relay-endpoint'].enabled).toBe(true);
  });
});

describe('seam — missing route/transport data defaults ENABLED + logs (never a faked disable)', () => {
  it('no transport state → private-DM defaults ENABLED with a seam reason + log', () => {
    const log = vi.fn();
    const out = resolveControlEnablement(CONTROLS, { policy: { pod: 'shared' }, transport: null, log });
    expect(out['private-dm'].enabled).toBe(true);
    expect(out['private-dm'].reason).toBe('route-unknown-default-enabled');
    expect(log).toHaveBeenCalled();
  });
  it('no transport state → relay/both options default ENABLED (seam), not disabled', () => {
    const out = resolveControlEnablement(CONTROLS, { policy: { pod: 'shared' }, transport: null });
    expect(out['transport-mode'].options.relay.enabled).toBe(true);
    expect(out['transport-mode'].options.both.enabled).toBe(true);
  });
});

describe('resolveCircleRoute + transportOptionEnabled — pure helpers', () => {
  it('reuses C9 data-policy (hasPod) without recomputing', () => {
    expect(resolveCircleRoute({ policy: { pod: 'shared' } }).hasPod).toBe(true);
    expect(resolveCircleRoute({ policy: { pod: 'none' } }).hasPod).toBe(false);
  });
  it('marks the route unknown when no transport is supplied', () => {
    expect(resolveCircleRoute({ policy: { pod: 'shared' } }).transportKnown).toBe(false);
    expect(resolveCircleRoute({ policy: { pod: 'shared' }, transport: {} }).transportKnown).toBe(true);
  });
  it('nkn option needs no relay; relay option needs a configured endpoint', () => {
    const noRelay = resolveCircleRoute({ policy: { pod: 'shared' }, transport: { relayUrl: '' } });
    expect(transportOptionEnabled('nkn', noRelay).enabled).toBe(true);
    expect(transportOptionEnabled('relay', noRelay).enabled).toBe(false);
  });
});
