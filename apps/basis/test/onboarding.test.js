/**
 * In-app onboarding — help-circle provisioning, the onboarding template, the chat
 * driver, and the 1:1-bot roster gate. @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildOnboardingTemplate, DEFAULT_ONBOARDING_TEMPLATE, ONBOARDING_LANGS, loadOnboardingTemplate,
} from '../src/v2/onboardingTemplate.js';
import {
  startGuidedSetup, submitGuidedStep, stepOf, isValidTemplate,
} from '../src/v2/guidedSetup.js';
import {
  onboardingTurn, answerOnboarding, onboardingActionFor, parseOnboardingAction,
} from '../src/v2/onboardingChat.js';
import {
  HELP_CIRCLE_ID, ONDERLING_BOT_WEBID, helpCircleRoster, helpCircleSpec,
  onderlingBotMember, provisionHelpCircle,
} from '../src/v2/helpCircle.js';
import { createOnboardingFlags } from '../src/v2/onboardingFlags.js';
import { oneToOneBotLabel } from '../src/v2/botChat.js';

describe('onboarding template', () => {
  it('builds a valid engine template in every bundled language', () => {
    for (const lang of ONBOARDING_LANGS) {
      const T = buildOnboardingTemplate(lang);
      expect(isValidTemplate(T)).toBe(true);
      expect(T.start).toBe('welkom');
    }
    expect(isValidTemplate(DEFAULT_ONBOARDING_TEMPLATE)).toBe(true);
  });

  it('the copy differs per language (nuchtere NL vs EN)', () => {
    expect(buildOnboardingTemplate('nl').steps.welkom.say)
      .not.toBe(buildOnboardingTemplate('en').steps.welkom.say);
  });

  it('resolves to the ACTIVE language when built at call time (nl → Dutch, en → English)', () => {
    // The shells now build the template with the current language WHEN onboarding starts (not at
    // import), so a Dutch app gets Dutch bubbles. Lock the per-language leaf copy here.
    const nl = buildOnboardingTemplate('nl');
    expect(nl.steps.welkom.say).toContain('Hoi, ik ben Onderling');
    expect(nl.steps.own_circle.options.map((o) => o.label)).toContain('Ja, help me');
    const en = buildOnboardingTemplate('en');
    expect(en.steps.welkom.say).toContain("Hi, I'm Onderling");
    expect(en.steps.own_circle.options.map((o) => o.label)).toContain('Yes, help me');
  });

  it('walks welcome → choice → handoff when the user says yes', () => {
    const T = buildOnboardingTemplate('nl');
    let s = startGuidedSetup(T);
    expect(stepOf(T, s).say).toMatch(/Onderling/);          // welkom
    s = submitGuidedStep(T, s, undefined).state;            // → wat_is_dit
    s = submitGuidedStep(T, s, undefined).state;            // → own_circle (choice)
    expect(stepOf(T, s).kind).toBe('choice');
    const r = submitGuidedStep(T, s, 'ja');                 // pick "ja" → per-option handoff
    expect(r.handoff).toBe(true);
    expect(r.done).toBe(true);
  });

  it('"later" continues to the invite step and ends without handoff', () => {
    const T = buildOnboardingTemplate('nl');
    let s = startGuidedSetup(T);
    s = submitGuidedStep(T, s, undefined).state;            // wat_is_dit
    s = submitGuidedStep(T, s, undefined).state;            // own_circle
    let r = submitGuidedStep(T, s, 'later');                // → uitnodigen
    expect(r.handoff).toBe(false);
    s = r.state;
    expect(stepOf(T, s).say).toBeTruthy();                  // uitnodigen
    r = submitGuidedStep(T, s, undefined);                  // → klaar
    s = r.state;
    r = submitGuidedStep(T, s, undefined);                  // klaar → end
    expect(r.done).toBe(true);
  });

  it('loadOnboardingTemplate falls back to the bundled build; uses a valid remote', async () => {
    expect(await loadOnboardingTemplate({})).toEqual(DEFAULT_ONBOARDING_TEMPLATE);
    const remote = { id: 'remote', steps: { a: { say: 'hi' } }, start: 'a' };
    const fetchImpl = vi.fn(async () => ({ json: async () => remote }));
    expect(await loadOnboardingTemplate({ url: 'https://hq/o.json', fetchImpl })).toBe(remote);
    expect(await loadOnboardingTemplate({ url: 'https://hq/o.json', fetchImpl: async () => { throw new Error('down'); }, lang: 'en' }))
      .toEqual(buildOnboardingTemplate('en'));
  });
});

describe('onboarding chat driver', () => {
  it('auto-advances say steps and parks at the choice with option buttons', () => {
    const T = buildOnboardingTemplate('nl');
    const turn = onboardingTurn(T, startGuidedSetup(T));
    expect(turn.awaiting).toBe(true);
    expect(turn.done).toBe(false);
    // welkom + wat_is_dit (say bubbles) + own_circle (the choice prompt) = 3 bubbles.
    expect(turn.bubbles.length).toBe(3);
    const last = turn.bubbles[turn.bubbles.length - 1];
    expect(last.buttons.map((b) => b.action)).toEqual([onboardingActionFor('ja'), onboardingActionFor('later')]);
    expect(turn.bubbles[0].buttons).toBeNull();
  });

  it('answering "ja" hands off (opens the create wizard), no further bubbles', () => {
    const T = buildOnboardingTemplate('nl');
    const parked = onboardingTurn(T, startGuidedSetup(T)).state;
    const r = answerOnboarding(T, parked, 'ja');
    expect(r.handoff).toBe(true);
    expect(r.echo).toBeTruthy();          // the picked label echoes as a me-bubble
    expect(r.bubbles).toEqual([]);
  });

  it('answering "later" posts the closing bubbles and ends', () => {
    const T = buildOnboardingTemplate('nl');
    const parked = onboardingTurn(T, startGuidedSetup(T)).state;
    const r = answerOnboarding(T, parked, 'later');
    expect(r.handoff).toBe(false);
    expect(r.done).toBe(true);
    expect(r.bubbles.length).toBeGreaterThanOrEqual(1);   // uitnodigen + klaar
  });

  it('action round-trips', () => {
    expect(parseOnboardingAction(onboardingActionFor('ja'))).toBe('ja');
    expect(parseOnboardingAction('fp:consent:all')).toBeNull();
  });
});

describe('help circle roster + 1:1-bot gate', () => {
  it('the roster is exactly you + the Onderling-bot (relation:agent), so the header strip shows', () => {
    const selfWebid = 'urn:pubkey:me';
    const roster = helpCircleRoster({ selfWebid });
    const bots = roster.filter((m) => m.relation === 'agent');
    expect(bots).toHaveLength(1);
    expect(bots[0].webid).toBe(ONDERLING_BOT_WEBID);
    // oneToOneBotLabel returns the bot's label → the assistant-header strip renders.
    expect(oneToOneBotLabel({ members: roster, selfWebid })).toBe('Onderling');
  });

  it('the bot member carries the agent markers the enforcement gate reads', () => {
    const bot = onderlingBotMember('Onderling');
    expect(bot.relation).toBe('agent');
    expect(bot.isBot).toBe(true);
  });

  it('the spec pins the stable help-circle id + a localised DISPLAY name (its own, not the bot)', () => {
    expect(helpCircleSpec().id).toBe(HELP_CIRCLE_ID);
    // The circle's title comes from circle.help.circle_name — deliberately NOT the bot's name
    // ('Onderling', circle.onboarding.help_name), so the tile/header never falls back to the raw id.
    expect(helpCircleSpec((k) => (k === 'circle.help.circle_name' ? 'Uitleg' : k)).name).toBe('Uitleg');
    // Default (no translator wired) is a friendly name, never the raw id or the bot name.
    expect(helpCircleSpec().name).not.toBe(HELP_CIRCLE_ID);
    expect(helpCircleSpec().name).not.toBe('Onderling');
  });
});

describe('help circle provisioning (idempotent)', () => {
  function harness({ provisioned = false, existingIds = [] } = {}) {
    const state = { provisioned };
    const calls = { create: 0, addBot: 0, mark: 0 };
    const deps = {
      isProvisioned: () => state.provisioned,
      listCircleIds: () => existingIds,
      createHelpCircle: () => { calls.create += 1; },
      addBotMember: () => { calls.addBot += 1; },
      markProvisioned: () => { state.provisioned = true; calls.mark += 1; },
    };
    return { deps, calls, state };
  }

  it('provisions once, then never again (marker guards the second run)', async () => {
    const { deps, calls } = harness();
    const first = await provisionHelpCircle(deps);
    expect(first.provisioned).toBe(true);
    expect(calls).toEqual({ create: 1, addBot: 1, mark: 1 });

    const second = await provisionHelpCircle(deps);
    expect(second.provisioned).toBe(false);
    expect(second.reason).toBe('marker');
    // No second create/add — never double-provisions.
    expect(calls).toEqual({ create: 1, addBot: 1, mark: 1 });
  });

  it('creates the circle with its DISPLAY name (not the raw id) so the tile/header reads friendly', async () => {
    const spec = helpCircleSpec((k) => (k === 'circle.help.circle_name' ? 'Uitleg' : k));
    let createdSpec = null;
    await provisionHelpCircle({
      isProvisioned: () => false,
      listCircleIds: () => [],
      createHelpCircle: (s) => { createdSpec = s; },
      addBotMember: () => {},
      markProvisioned: () => {},
      spec,
    });
    expect(createdSpec.id).toBe(HELP_CIRCLE_ID);
    expect(createdSpec.name).toBe('Uitleg');
    expect(createdSpec.name).not.toBe(HELP_CIRCLE_ID);
  });

  it('does not re-create when the help circle already exists (marks the marker instead)', async () => {
    const { deps, calls } = harness({ existingIds: [HELP_CIRCLE_ID] });
    const r = await provisionHelpCircle(deps);
    expect(r.provisioned).toBe(false);
    expect(r.reason).toBe('exists');
    expect(calls.create).toBe(0);
    expect(calls.addBot).toBe(0);
    expect(calls.mark).toBe(1);
  });

  it('the flag store round-trips the two one-time markers over its io', async () => {
    const mem = new Map();
    const flags = createOnboardingFlags({ get: (k) => mem.get(k) ?? null, set: (k, v) => mem.set(k, v) });
    expect(await flags.isHelpCircleProvisioned()).toBe(false);
    expect(await flags.isOnboardingDone()).toBe(false);
    await flags.markHelpCircleProvisioned();
    await flags.markOnboardingDone();
    expect(await flags.isHelpCircleProvisioned()).toBe(true);
    expect(await flags.isOnboardingDone()).toBe(true);
  });
});
