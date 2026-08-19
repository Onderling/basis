/**
 * Task #13 — the mobile onboarding + help-bot wiring. The RN screen (CircleLauncherScreen) can't render
 * under vitest, but its logic is all shared `src/` modules; this pins the exact seams the mobile shell
 * wires: help-circle provisioning idempotence over the mobile AsyncStorage IO, the onboarding driver as
 * bot bubbles + handoff, and the shared {label, action} → mobile {id, label} button-id round-trip.
 */
import { describe, it, expect } from 'vitest';
import {
  HELP_CIRCLE_ID, helpCircleSpec, helpCircleRoster, onderlingBotMember, provisionHelpCircle,
} from '../../basis/src/v2/helpCircle.js';
import { createOnboardingFlags, asyncStorageOnboardingIo } from '../../basis/src/v2/onboardingFlags.js';
import { buildOnboardingTemplate } from '../../basis/src/v2/onboardingTemplate.js';
import { startGuidedSetup } from '../../basis/src/v2/guidedSetup.js';
import {
  onboardingTurn, answerOnboarding, parseOnboardingAction,
} from '../../basis/src/v2/onboardingChat.js';
import { parseHelpAction, helpConsentAction, helpTopicChips, helpLlmLabelKeys } from '../../basis/src/v2/helpChat.js';
import { botIsAddressed } from '../../basis/src/v2/botAddress.js';

// A fresh in-memory AsyncStorage (NOT the shared module stub, so cases don't cross-pollute).
function memAsyncStorage() {
  const m = new Map();
  return { getItem: async (k) => (m.has(k) ? m.get(k) : null), setItem: async (k, v) => { m.set(k, v); } };
}

describe('mobile help-circle provisioning (AsyncStorage IO, idempotent)', () => {
  it('creates the help circle once, then skips on the persisted marker', async () => {
    const flags = createOnboardingFlags(asyncStorageOnboardingIo(memAsyncStorage()));
    const created = [];
    let circleIds = [];
    const deps = () => ({
      isProvisioned: () => flags.isHelpCircleProvisioned(),
      listCircleIds: () => circleIds,
      createHelpCircle: (s) => { created.push(s.id); circleIds = [...circleIds, s.id]; },
      addBotMember: () => {},
      markProvisioned: () => flags.markHelpCircleProvisioned(),
      spec: helpCircleSpec((k) => k),
      bot: onderlingBotMember('Onderling'),
    });

    const first = await provisionHelpCircle(deps());
    expect(first.provisioned).toBe(true);
    expect(created).toEqual([HELP_CIRCLE_ID]);
    expect(await flags.isHelpCircleProvisioned()).toBe(true);

    // Second boot: the marker short-circuits — no second create.
    const second = await provisionHelpCircle(deps());
    expect(second.provisioned).toBe(false);
    expect(second.reason).toBe('marker');
    expect(created).toEqual([HELP_CIRCLE_ID]);
  });

  it('when the circle already exists but the marker was lost, it marks without re-creating', async () => {
    const flags = createOnboardingFlags(asyncStorageOnboardingIo(memAsyncStorage()));
    const created = [];
    const r = await provisionHelpCircle({
      isProvisioned: () => flags.isHelpCircleProvisioned(),
      listCircleIds: () => [HELP_CIRCLE_ID],   // already there
      createHelpCircle: (s) => { created.push(s.id); },
      addBotMember: () => {},
      markProvisioned: () => flags.markHelpCircleProvisioned(),
      spec: helpCircleSpec((k) => k),
    });
    expect(r).toEqual({ provisioned: false, reason: 'exists' });
    expect(created).toEqual([]);
    expect(await flags.isHelpCircleProvisioned()).toBe(true);
  });
});

describe('mobile onboarding driver (bot bubbles + option buttons + handoff)', () => {
  const template = buildOnboardingTemplate('nl');

  it('the first turn posts say-bubbles and parks at the own_circle choice with option buttons', () => {
    const turn = onboardingTurn(template, startGuidedSetup(template));
    expect(turn.awaiting).toBe(true);
    expect(turn.done).toBe(false);
    // The parked bubble carries the choice options as buttons ({label, action}); earlier bubbles are plain.
    const choice = turn.bubbles[turn.bubbles.length - 1];
    expect(Array.isArray(choice.buttons)).toBe(true);
    expect(choice.buttons.length).toBeGreaterThanOrEqual(2);
    // The mobile bubble model maps {label, action} → {id, label}; the ids round-trip back to option values.
    const mobileButtons = choice.buttons.map((b) => ({ id: b.action, label: b.label }));
    expect(parseOnboardingAction(mobileButtons[0].id)).toBe('ja');
    expect(mobileButtons.every((b) => parseOnboardingAction(b.id) != null)).toBe(true);
  });

  it('answering "ja" hands off to the create flow (no more bubbles)', () => {
    const turn = onboardingTurn(template, startGuidedSetup(template));
    const r = answerOnboarding(template, turn.state, 'ja');
    expect(r.handoff).toBe(true);
    expect(r.echo).toBeTruthy();          // the picked option's label → the me-bubble
    expect(r.bubbles).toEqual([]);
  });

  it('answering "later" continues the flow to its end without a handoff', () => {
    const turn = onboardingTurn(template, startGuidedSetup(template));
    const r = answerOnboarding(template, turn.state, 'later');
    expect(r.handoff).toBe(false);
    expect(r.bubbles.length).toBeGreaterThan(0);
    expect(r.done).toBe(true);
  });
});

describe('mobile help-bot addressing + button-id round-trips', () => {
  it('the help circle is a 1:1 bot chat → every message is addressed (no @-tag needed)', () => {
    const members = helpCircleRoster({ selfWebid: 'urn:me', botName: 'Onderling' });
    const helpBot = members.find((m) => m.relation === 'agent' || m.isBot === true);
    expect(botIsAddressed({ text: 'wat is dit?', circleMembers: members, selfWebid: 'urn:me', botMember: helpBot })).toBe(true);
  });

  it('help topic chips + consent actions round-trip through the mobile {id} button model', () => {
    const chips = helpTopicChips({ lang: 'nl' }).map((c) => ({ id: c.action, label: c.label }));
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.every((c) => parseHelpAction(c.id)?.kind === 'topic')).toBe(true);
    expect(parseHelpAction(helpConsentAction('yes'))).toEqual({ kind: 'consent', value: 'yes' });
  });

  it('the consent/badge wording keys honour the route confidentiality (#37, shared decision)', () => {
    expect(helpLlmLabelKeys({ confidential: true }).consentKey).toBe('circle.help.consent_prompt');
    expect(helpLlmLabelKeys({ confidential: false }).consentKey).toBe('circle.help.consent_prompt_plain');
    expect(helpLlmLabelKeys({ confidential: false }).badgeKey).toBe('circle.help.provenance_llm_plain');
  });
});
