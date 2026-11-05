/**
 * THE FALLBACK TEXT SAYS WHAT THE SETTING DOES. The address-fallback setting is per person and OFF by default
 * (`deliverySettings.js`); off means a member is reached at their per-circle address or not at all, on means the main
 * address may be used. For a while both states carried one identical sentence ("…your main address when we don't")
 * and the note said it "always happens" — written when the stored setting did not yet reach the send path. It does
 * now, so the screen contradicted the app (walked on a phone, 2026-11-05: the Connection screen said the linking
 * always happens on a build where it never did).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (lang) => JSON.parse(readFileSync(path.join(here, `../../src/locales/circle.${lang}.json`), 'utf8'));
const text = (bundle, key) => bundle?.nearbyScreen?.[key]?.text ?? null;

describe.each(['en', 'nl'])('the address-fallback texts (%s)', (lang) => {
  const b = load(lang);
  it('on and off say different things', () => {
    expect(text(b, 'delivery_fallback_on')).toBeTruthy();
    expect(text(b, 'delivery_fallback_off')).toBeTruthy();
    expect(text(b, 'delivery_fallback_off')).not.toBe(text(b, 'delivery_fallback_on'));
  });
  it('off does not promise the main address; on names it', () => {
    const main = lang === 'nl' ? /hoofdadres/i : /main address/i;
    expect(text(b, 'delivery_fallback_on')).toMatch(main);
    expect(text(b, 'delivery_fallback_off')).not.toMatch(lang === 'nl' ? /anders je hoofdadres/i : /main address when/i);
  });
  it('the note does not say the linking always happens', () => {
    expect(text(b, 'delivery_fallback_note')).not.toMatch(lang === 'nl' ? /altijd/i : /always happens/i);
  });
});
