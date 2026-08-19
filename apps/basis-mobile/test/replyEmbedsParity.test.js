/**
 * S6.A (mobile parity) — the inline-button substrate the circle screen relies on:
 * mobile's buildManifestsByOrigin() feeds the SHARED embedButtonsForReply, so a
 * bot reply's items get the same appliesTo-gated manifest buttons as web. The RN
 * render of payload.buttons + the onBubbleButton→dispatch wiring are exercised on
 * device; here (portable vitest, no RN render) we guard the data contract.
 */
import { describe, it, expect } from 'vitest';
import { buildManifestsByOrigin } from '../src/core/composeManifests.js';
import { embedButtonsForReply } from '../../basis/src/v2/replyEmbeds.js';
import { isAppSurfaceEnabled } from '../../basis/src/v2/appFeature.js';
import { isFeatureEnabled } from '../../basis/src/v2/circlePolicy.js';

describe('mobile inline-button substrate (shared with web)', () => {
  const manifestsByOrigin = buildManifestsByOrigin();

  it('buildManifestsByOrigin exposes the task manifest keyed by appOrigin', () => {
    expect(manifestsByOrigin['tasks']).toBeTruthy();
    expect(Array.isArray(manifestsByOrigin['tasks'].operations)).toBe(true);
  });

  it('an open task reply yields a Claim button via the shared mapper', () => {
    const btns = embedButtonsForReply({
      reply: { task: { id: 't1', state: 'open', label: 'boodschappen' } },
      appOrigin: 'tasks', manifestsByOrigin,
    });
    expect(btns.map((b) => b.opId)).toContain('claimTask');
    expect(btns.find((b) => b.opId === 'claimTask')).toMatchObject({ itemId: 't1' });
  });

  it('a claimed task yields Mark complete (not Claim) — appliesTo gating holds on mobile too', () => {
    const ops = embedButtonsForReply({
      reply: { task: { id: 't2', state: 'claimed' } }, appOrigin: 'tasks', manifestsByOrigin,
    }).map((b) => b.opId);
    expect(ops).toContain('completeTask');
    expect(ops).not.toContain('claimTask');
  });

  it('S6.B — the tasks overview op declares a screen surface in the shared manifest', () => {
    const listMine = manifestsByOrigin['tasks'].operations.find((o) => o.id === 'listMine');
    expect(listMine?.surfaces?.ui?.screen).toBe('tasks');
  });

  it('S6.C — the tasks screen surface is gated by the circle policy.features (mobile parity)', () => {
    expect(isAppSurfaceEnabled('tasks', { features: { tasks: false } }, isFeatureEnabled)).toBe(false);
    expect(isAppSurfaceEnabled('tasks', { features: { tasks: true } }, isFeatureEnabled)).toBe(true);
  });
});
