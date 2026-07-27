/**
 * Nearby screen seams, mobile side (Nearby step E).
 *
 * `vitest` excludes `src/screens/**` here (no JSX loader), so — following this suite's existing convention
 * (see `nearbyRow.test.js`) — what gets tested is the SEAM the screen consumes, not the JSX.
 *
 * The seam is deliberately shared with web: `NEARBY_ACTION_LABELS` and `nearbyVisibilityKey` have exactly
 * one definition, in the basis app. A copy per renderer is how web starts offering a stranger something
 * mobile does not (invariant 3), and how the "you are still visible" warning ends up firing on one platform
 * and not the other. These tests pin the shared rule AND that every key it names actually exists in both
 * locales (invariant 8) — a renamed locale key breaks here rather than on a device.
 */
import { describe, it, expect } from 'vitest';
import { NEARBY_ACTION_LABELS, nearbyVisibilityKey } from '@onderling-app/basis';
import { initLocalisation, setLang, t }              from '../src/core/localisation.js';

describe('nearbyVisibilityKey — the shared banner rule', () => {
  it('THE ONE THAT MATTERS: degraded outranks everything', () => {
    // Announcing after being asked to hide. If this ever ranks below "publishing", a user is told they are
    // hidden while a café full of strangers can see them.
    expect(nearbyVisibilityKey({ degraded: true, publishing: true, unavailable: false })).toBe('still_visible');
    expect(nearbyVisibilityKey({ degraded: true, publishing: false, unavailable: true })).toBe('still_visible');
  });

  it('unavailable outranks the ordinary states, but not degraded', () => {
    expect(nearbyVisibilityKey({ degraded: false, publishing: false, unavailable: true })).toBe('unavailable');
  });

  it('otherwise it is simply whether we are announcing', () => {
    expect(nearbyVisibilityKey({ degraded: false, publishing: true,  unavailable: false })).toBe('visible');
    expect(nearbyVisibilityKey({ degraded: false, publishing: false, unavailable: false })).toBe('hidden');
  });

  it('no visibility ⇒ no banner', () => {
    expect(nearbyVisibilityKey(null)).toBeNull();
    expect(nearbyVisibilityKey(undefined)).toBeNull();
  });
});

describe('NEARBY_ACTION_LABELS — one definition, resolvable in both languages', () => {
  it('covers exactly the actions nearbyActions can produce', () => {
    // If shared code grows a fourth action, this fails — which is the point: a renderer skips ids it does
    // not know, so an unlisted action would silently never render.
    expect(Object.keys(NEARBY_ACTION_LABELS).sort())
      .toEqual(['invite-to-circle', 'open-shared-circle', 'request-join']);
  });

  it('is frozen — a renderer cannot mutate the shared map', () => {
    expect(Object.isFrozen(NEARBY_ACTION_LABELS)).toBe(true);
  });

  for (const lang of ['en', 'nl']) {
    it(`every action + banner key resolves in ${lang}`, async () => {
      await initLocalisation({ lng: lang });
      await setLang(lang);

      const keys = [
        ...Object.values(NEARBY_ACTION_LABELS),
        ...['visible', 'hidden', 'still_visible', 'unavailable']
          .flatMap((k) => [`circle.nearbyScreen.${k}_title`, `circle.nearbyScreen.${k}_body`]),
        'circle.nearbyScreen.not_member_note',
      ];

      for (const key of keys) {
        const value = t(key);
        // i18next returns the key itself when a translation is missing.
        expect(value, `missing ${lang} translation for ${key}`).not.toBe(key);
        expect(String(value).trim().length).toBeGreaterThan(0);
      }
    });
  }
});
