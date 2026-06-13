/**
 * canopy-chat-mobile — quickReplies pass-through (α.5a, audit #3).
 *
 * Vitest can't render RN components (vitest.config.js excludes
 * src/screens/**), so this test pins the portable surface MessageBubble
 * consumes: the `normalizeQuickReplies` helper hands the bubble an
 * array of `{label, slash}` records that the RN Pressable row maps
 * one-to-one.  Same pattern as chatRender.test.js (#253 step 2) which
 * pins the list-buttons data contract from mobile's perspective.
 *
 * The RN-side dispatch wiring (Pressable → submitInput(slash)) is
 * exercised by Detox / on-device walks; this test guards the data
 * contract that wiring depends on.
 *
 * Import is via the in-repo relative path (canopy-chat src) — the
 * portable helper has no @canopy/* transitive deps so it survives
 * the worktree's un-installed workspace state.
 */
import { describe, it, expect, vi } from 'vitest';
import { normalizeQuickReplies } from '../../canopy-chat/src/core/quickReplies.js';
import enRaw from '../locales/en.json' with { type: 'json' };
import nlRaw from '../locales/nl.json' with { type: 'json' };
import { sharedCircleLocale } from '@canopy-app/canopy-chat';
// `circle.*` now lives in the shared canopy-chat source; merge it back to check the effective bundle.
const en = { ...enRaw, circle: sharedCircleLocale.en };
const nl = { ...nlRaw, circle: sharedCircleLocale.nl };

describe('mobile bubble — quickReplies pass-through (α.5a)', () => {
  it('normaliser produces two pills with labels Ja / Nee + slashes /yes /no', () => {
    const pills = normalizeQuickReplies([
      { label: 'Ja',  slash: '/yes' },
      { label: 'Nee', slash: '/no'  },
    ]);
    expect(Array.isArray(pills)).toBe(true);
    expect(pills).toEqual([
      { label: 'Ja',  slash: '/yes' },
      { label: 'Nee', slash: '/no'  },
    ]);
  });

  it('simulating a Pressable tap on pill 0 dispatches /yes exactly once', () => {
    // Stand in for ChatScreen's
    //   onQuickReplyTap={(slash) => submitInput(slash)}
    // — same path the TextInput Enter handler uses.
    const submitInput = vi.fn();
    const pills = normalizeQuickReplies([
      { label: 'Ja',  slash: '/yes' },
      { label: 'Nee', slash: '/no'  },
    ]);
    const onQuickReplyTap = (slash) => submitInput(slash);
    // RN MessageBubble does:
    //   <Pressable onPress={() => onQuickReplyTap?.(qr.slash)} />
    onQuickReplyTap(pills[0].slash);
    expect(submitInput).toHaveBeenCalledTimes(1);
    expect(submitInput).toHaveBeenCalledWith('/yes');
  });

  it('returns undefined when no quickReplies provided (bubble omits pill row)', () => {
    expect(normalizeQuickReplies(undefined)).toBeUndefined();
    expect(normalizeQuickReplies([])).toBeUndefined();
  });

  it("drops entries whose slash doesn't start with /", () => {
    // Mirrors the renderer behaviour — pills exist to dispatch a
    // slash, not free text, so a bad envelope must not surface a
    // tappable pill that dispatches nothing.
    expect(normalizeQuickReplies([
      { label: 'bad', slash: 'plain text' },
      { label: 'ok',  slash: '/yes' },
    ])).toEqual([
      { label: 'ok', slash: '/yes' },
    ]);
  });
});

describe('mobile locale entries — circle.chat.quick_reply.fallback_label', () => {
  it("en.json carries 'Reply' under circle.chat.quick_reply.fallback_label", () => {
    expect(en.circle?.chat?.quick_reply?.fallback_label?.text).toBe('Reply');
    expect(typeof en.circle?.chat?.quick_reply?.fallback_label?.doc).toBe('string');
  });
  it("nl.json carries 'Antwoord' under the matching path", () => {
    expect(nl.circle?.chat?.quick_reply?.fallback_label?.text).toBe('Antwoord');
    expect(typeof nl.circle?.chat?.quick_reply?.fallback_label?.doc).toBe('string');
  });
});
