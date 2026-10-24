/**
 * The feedback op: opens the feedback contact's thread with "[<screen> · <version>] " prefilled — the person writes
 * and sends it themselves (no auto-send). No card in the build → the door still answers, honestly, so a tester
 * reports the gap. It is declared once (basis manifest: /feedback, the "+" sheet, the foot of Instellingen).
 */
import { describe, it, expect, vi } from 'vitest';
import { createLocalBuiltins } from '../../src/core/localBuiltins.js';
import { basisManifest } from '../../manifest.js';
import { encodeContactCard } from '../../../pinboard/src/lib/contactCard.js';

const t = (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k);
const CARD = `onderling-contact://${encodeContactCard({ webid: 'https://id.example/onderling', displayName: 'Onderling' })}`;

describe('the feedback op', () => {
  it('is declared once: /feedback, an own-scope "+" act with no fields, authenticated', () => {
    const op = basisManifest.operations.find((o) => o.id === 'feedback');
    expect(op).toMatchObject({ visibility: 'authenticated' });
    expect(op.surfaces.slash.command).toBe('/feedback');
    expect(op.surfaces.attach).toMatchObject({ scopes: ['own'] });
    expect((op.params ?? []).filter((p) => p.required)).toEqual([]);
  });

  it('opens the contact\'s thread with the prefill; sends nothing', async () => {
    const openFeedback = vi.fn();
    const ops = createLocalBuiltins({ t, openFeedback, feedbackCard: CARD, appVersion: 'v0.1.74-alpha',
      currentScreen: () => ({ screen: 'settingsGroup', settingsGroup: 'display' }) });
    const r = await ops.feedback({});
    expect(r.ok).toBe(true);
    expect(openFeedback).toHaveBeenCalledWith({ webid: 'https://id.example/onderling', draft: '[instellingen/display · v0.1.74-alpha] ' });
  });

  it('inside a circle the prefill says "circle", never the circle\'s name — not even when an arg carries it', async () => {
    const openFeedback = vi.fn();
    const ops = createLocalBuiltins({ t, openFeedback, feedbackCard: CARD, appVersion: 'v0.1.74-alpha',
      currentScreen: () => ({ inCircle: true, screen: 'Huize Zwartkruid-7731' }) });
    await ops.feedback({ screen: 'Huize Zwartkruid-7731' });
    const { draft } = openFeedback.mock.calls[0][0];
    expect(draft).toBe('[circle · v0.1.74-alpha] ');
    expect(draft).not.toContain('Zwartkruid');
  });

  it('no card in the build → says so (the door stays), opens nothing', async () => {
    const openFeedback = vi.fn();
    const ops = createLocalBuiltins({ t, openFeedback, feedbackCard: null, appVersion: 'v0.1.74-alpha' });
    expect(await ops.feedback({})).toMatchObject({ ok: false, error: 'feedback.no_contact' });
    expect(openFeedback).not.toHaveBeenCalled();
  });
});
