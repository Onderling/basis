/**
 * A persona's consent to a model judging its drivers: `model.consent` on the profile, inherited from the default
 * persona. With nothing said anywhere, it is ON only when the person configured a model on this device (that act is
 * the opt-in). A judge runs only under a yes.
 */
import { describe, it, expect, vi } from 'vitest';
import { own, inherit } from '../src/profileProperties.js';
import { MODEL_CONSENT_KEY, modelConsentFor, consentedJudge } from '../src/modelConsent.js';
import { isReservedPropertyKey, PERSON_SETTABLE_KEYS } from '../src/reservedProperties.js';

const profiles = (map) => (id) => map[id] ?? null;

describe('modelConsentFor', () => {
  it('nothing said: on only when a model is configured on this device', () => {
    const gp = profiles({ default: { properties: {} }, werk: { properties: {} } });
    expect(modelConsentFor(gp, 'default', { defaultProfileId: 'default', modelConfigured: true })).toBe(true);
    expect(modelConsentFor(gp, 'default', { defaultProfileId: 'default', modelConfigured: false })).toBe(false);
    expect(modelConsentFor(gp, 'werk', { defaultProfileId: 'default', modelConfigured: true })).toBe(true);
    expect(modelConsentFor(gp, 'werk', { defaultProfileId: 'default' })).toBe(false);
  });

  it('a persona inherits the default persona\'s word, and may turn it off', () => {
    const gp = profiles({
      default: { properties: { [MODEL_CONSENT_KEY]: own(false) } },
      werk:    { properties: { [MODEL_CONSENT_KEY]: inherit() } },
      buurt:   { properties: { [MODEL_CONSENT_KEY]: own(false) } },
      club:    { properties: {} },
    });
    const opts = { defaultProfileId: 'default', modelConfigured: true };
    expect(modelConsentFor(gp, 'default', opts)).toBe(false);   // said no, a configured model does not override it
    expect(modelConsentFor(gp, 'werk', opts)).toBe(false);
    expect(modelConsentFor(gp, 'club', opts)).toBe(false);
    const gp2 = profiles({ default: { properties: { [MODEL_CONSENT_KEY]: own(true) } }, buurt: { properties: { [MODEL_CONSENT_KEY]: own(false) } } });
    expect(modelConsentFor(gp2, 'buurt', opts)).toBe(false);
    expect(modelConsentFor(gp2, 'default', { defaultProfileId: 'default', modelConfigured: false })).toBe(true);
  });

  it('only a boolean counts as a word; anything else is "nothing said"', () => {
    const gp = profiles({ default: { properties: { [MODEL_CONSENT_KEY]: own('yes') } } });
    expect(modelConsentFor(gp, 'default', { defaultProfileId: 'default', modelConfigured: false })).toBe(false);
  });

  it('is the person\'s to set, not a machine key', () => {
    expect(isReservedPropertyKey(MODEL_CONSENT_KEY)).toBe(false);
    expect(PERSON_SETTABLE_KEYS).toContain(MODEL_CONSENT_KEY);
  });
});

describe('consentedJudge', () => {
  it('hands the judge on only under a yes', () => {
    const judge = vi.fn();
    expect(consentedJudge(judge, true)).toBe(judge);
    expect(consentedJudge(judge, false)).toBeUndefined();
    expect(consentedJudge(judge, undefined)).toBeUndefined();
    expect(consentedJudge(judge, 'true')).toBeUndefined();
  });
});

describe('the gate binds in the matcher itself', () => {
  it('matchDriversSemantic ignores a judge handed in without a yes', async () => {
    const { matchDriversSemantic } = await import('../src/driverMatch.js');
    const { createDriver } = await import('../src/drivers.js');
    const drivers = { zeilen: createDriver({ kind: 'goal', text: 'leren zeilen', tags: ['zeilen'] }) };
    const signature = { text: 'wie gaat er mee varen', tags: ['varen'] };
    const judge = vi.fn(async () => ({ match: true, reason: 'past' }));
    expect(await matchDriversSemantic({ drivers, signature, judge })).toEqual([]);
    expect(judge).not.toHaveBeenCalled();
    const yes = await matchDriversSemantic({ drivers, signature, judge, modelConsent: true });
    expect(judge).toHaveBeenCalled();
    expect(yes.map((m) => m.reason?.kind)).toEqual(['llm']);
  });
});
