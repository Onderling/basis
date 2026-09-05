// @vitest-environment node
// Property-layer Phase 3 (participant side) — the pure charter-consent logic that drives the
// feedback requested-attributes consent step and packages what rides the contribution.
import { describe, it, expect } from 'vitest';
import {
  charterFromConfig, consentItems, emptyConsent, setConsentValue, toggleConsent,
  consentRelease, consentWarning,
} from '../src/v2/charterConsent.js';

const cfgCharter = { version: 1, attributes: [
  { key: 'place', purpose: 'which circles are represented' },
  { key: 'ageBand', purpose: 'age spread' },
] };

describe('charter consent (participant side)', () => {
  it('builds the charter from project config (null when absent)', () => {
    const charter = charterFromConfig('circle-42', cfgCharter);
    expect(charter.projectId).toBe('circle-42');
    expect(charterFromConfig('p', undefined)).toBeNull();
    expect(charterFromConfig('p', { attributes: [] })).toBeNull();
  });

  it('lists consent rows (attribute + purpose + buckets)', () => {
    const items = consentItems(charterFromConfig('circle-42', cfgCharter));
    expect(items.map((i) => i.key)).toEqual(['ageBand', 'place']);   // charter is canonical-sorted
    expect(items.find((i) => i.key === 'ageBand').buckets).toContain('35-54');
  });

  it('default-withhold: a fresh consent releases nothing but the charterHash', () => {
    const charter = charterFromConfig('circle-42', cfgCharter);
    let p = emptyConsent('circle-42');
    p = setConsentValue(p, 'place', 'Groningen');   // value set, NOT enabled
    const rel = consentRelease(p, charter);
    expect(rel.attributes).toEqual({});
    expect(rel.charterHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('releases only enabled + valued charter attributes; withheld absent', () => {
    const charter = charterFromConfig('circle-42', cfgCharter);
    let p = emptyConsent('circle-42');
    p = toggleConsent(setConsentValue(p, 'place', 'Groningen'), 'place', true);
    p = setConsentValue(p, 'ageBand', '35-54');   // valued but not enabled → withheld
    expect(consentRelease(p, charter).attributes).toEqual({ place: 'Groningen' });
  });

  it('LIFT: a picked value is stored as a shared own profile property + a shared disclosure policy (reusable shape)', () => {
    let p = emptyConsent('proj');
    p = toggleConsent(setConsentValue(p, 'ageBand', '35-54'), 'ageBand', true);
    // the value lives in the agent-registry own/inherit property graph…
    expect(p.properties.ageBand).toEqual({ mode: 'own', value: '35-54' });
    // …and the share choice lives in the shared per-context disclosure policy (not a feedback-local flag).
    // The entry carries the full three-axis shape (disclosed / matchable / requestable);
    // consent toggles only the disclosed axis, so matchable/requestable default off.
    expect(p.policy.perContext.proj.ageBand).toEqual({ enabled: true, rung: null, matchable: false, requestable: false });
  });

  it('SWAP: consentRelease can read from an EXTERNAL profile (the cross-app reuse point)', () => {
    const charter = charterFromConfig('circle-42', cfgCharter);
    // the user enabled sharing place for this project, but the VALUE lives on their real profile registry
    let p = emptyConsent('circle-42');
    p = toggleConsent(p, 'place', true);   // enabled, but NO local value set
    // a stand-in "real profile" holding the curated value (own/inherit shape)
    const realProfile = { properties: { place: { mode: 'own', value: 'Groningen' } } };
    const profileCtx = { getProfile: (id) => (id === 'me' ? realProfile : null), profileId: 'me', defaultProfileId: 'me' };
    expect(consentRelease(p, charter, profileCtx).attributes).toEqual({ place: 'Groningen' });  // reused from the real profile
    // …and WITHOUT the external profile the local (empty) graph releases nothing — same policy, different source.
    expect(consentRelease(p, charter).attributes).toEqual({});
  });

  it('warns on-device when the enabled combo is likely rare in a small cohort', () => {
    const charter = charterFromConfig('circle-42', cfgCharter);
    let p = emptyConsent('circle-42');
    p = toggleConsent(setConsentValue(p, 'place', 'Groningen'), 'place', true);
    p = toggleConsent(setConsentValue(p, 'ageBand', '35-54'), 'ageBand', true);
    expect(consentWarning(p, charter, 8).warn).toBe(true);      // place+age in a group of ~8 → recognisable
    expect(consentWarning(p, charter, undefined).warn).toBe(false);  // no cohort size → inert
  });
});
