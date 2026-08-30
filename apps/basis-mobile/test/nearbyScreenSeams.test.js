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
import {
  NEARBY_ACTION_LABELS, NEARBY_ASK_LABELS, NEARBY_INVITE_LABELS, nearbyVisibilityKey,
  POINT_SOURCE_LABELS, DELIVERY_LABELS, resolveConversationKinds,
} from '@onderling-app/basis';
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
        ...Object.values(NEARBY_ASK_LABELS),
        ...Object.values(NEARBY_INVITE_LABELS),
        ...Object.values(POINT_SOURCE_LABELS),
        ...Object.values(DELIVERY_LABELS),
        ...['delivery_section', 'delivery_receipts_on', 'delivery_receipts_off',
            'delivery_receipts_toggle_on', 'delivery_receipts_toggle_off',
            'delivery_fallback_on', 'delivery_fallback_off',
            'delivery_fallback_toggle_on', 'delivery_fallback_toggle_off',
            'delivery_fallback_hint', 'delivery_fallback_cost', 'delivery_fallback_enable']
          .map((k) => `circle.nearbyScreen.${k}`),
        ...['asks_title', 'asks_empty', 'ask_resonant', 'ask_disclosure', 'ask_compose',
            'ask_placeholder', 'ask_send', 'ask_sent', 'ask_expired', 'answer_sent',
            // step G — cards + room chat
            'allow_card', 'allow_card_off', 'allow_chat', 'allow_chat_off',
            'card_title', 'card_label', 'card_line', 'card_visible_to', 'card_save', 'card_shown',
            'chat_title', 'chat_empty', 'chat_ephemeral', 'chat_placeholder', 'chat_send',
            // step H — broadcast circle invites
            'invites_title', 'invites_empty', 'join_is_a_join', 'invite_expired',
            'publish_invite', 'publish_warning', 'publish_short', 'invite_published',
            // step I — connection points
            'points_title', 'points_intro', 'points_empty', 'point_adopt', 'point_carries',
            'point_carries_none', 'point_remove', 'remove_cuts_off', 'remove_still_ok',
            'remove_nothing', 'remove_confirm', 'remove_cancel',
            // NKN+pod circle
            'point_kind_pod', 'point_pod_host_sees', 'join_no_admin']
          .map((k) => `circle.nearbyScreen.${k}`),
        ...['visible', 'hidden', 'still_visible', 'unavailable', 'becoming_visible']
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

describe('NEARBY_ASK_LABELS — the ask actions, shared', () => {
  it('covers exactly what askActions can produce, and no more', () => {
    // Critically it does NOT contain a notify-the-asker action: that would disclose on the responder's
    // behalf, which is the one thing step F forbids. An unlisted id is skipped by both renderers, so this
    // list is also the last line of defence against one appearing.
    expect(Object.keys(NEARBY_ASK_LABELS).sort()).toEqual(['answer-ask', 'dismiss-ask']);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(NEARBY_ASK_LABELS)).toBe(true);
  });
});

describe('NEARBY_INVITE_LABELS — one action, and it is a join', () => {
  it('there is exactly one, and no save-for-later', () => {
    // A broadcast invite expires in minutes; keeping one would be keeping a dead code and a record of a
    // room you were in. Both renderers skip unlisted ids, so this map is where that is enforced.
    expect(Object.keys(NEARBY_INVITE_LABELS)).toEqual(['join-published-circle']);
    expect(Object.isFrozen(NEARBY_INVITE_LABELS)).toBe(true);
  });
});

describe('POINT_SOURCE_LABELS — provenance, described once', () => {
  it('covers every source the store can produce', () => {
    // "A circle brought this" and "I typed this in" read differently, and a suggestion is a third thing.
    // Both renderers read this map, so neither can describe the same point differently.
    expect(Object.keys(POINT_SOURCE_LABELS).sort()).toEqual(['join', 'manual', 'suggested']);
    expect(Object.isFrozen(POINT_SOURCE_LABELS)).toBe(true);
  });
});

describe('the delivery ladder is ONE vocabulary, shared', () => {
  it('every label lives in the namespace that already existed', () => {
    // The chat bubble has had `circle.chat.delivery.*` since δ.2. A second namespace would mean the two
    // shells could word the same fact differently — and nothing would catch it.
    for (const key of Object.values(DELIVERY_LABELS)) {
      expect(key).toMatch(/^circle\.chat\.delivery\./);
    }
  });
});

describe('conversation kinds reach mobile identically', () => {
  it('a circle shows the noticeboard, not open chat — the same answer as web', () => {
    const kinds = resolveConversationKinds({ templateKind: 'neighbourhood' });
    expect(kinds).not.toContain('chat-message');
    expect(kinds).toEqual(expect.arrayContaining(['ask', 'offer']));
  });

  it("and an admin's choice wins on mobile too", () => {
    expect(resolveConversationKinds({ circleSetting: ['chat-message'], templateKind: 'neighbourhood' }))
      .toEqual(['chat-message']);
  });
});

