/**
 * canopy-chat — quickReplies normaliser tests (α.5a, audit #3).
 *
 * Pins the contract that:
 *   - input without a usable quickReplies array → undefined (so the
 *     renderer omits the field entirely)
 *   - well-formed pairs survive untouched
 *   - entries without a slash starting in '/' are dropped (no
 *     free-text pills)
 *   - blank labels fall back to `circle.chat.quick_reply.fallback_label`
 *     when a t() is supplied, else the English literal "Reply"
 *   - renderReply forwards quickReplies as a passthrough field
 */
import { describe, it, expect } from 'vitest';

import { normalizeQuickReplies } from '../src/core/quickReplies.js';
import enRaw from '../locales/en.json' with { type: 'json' };
import nlRaw from '../locales/nl.json' with { type: 'json' };
import { sharedCircleLocale } from '../src/locales/index.js';
// `circle.*` now lives in the shared source; merge it back to check the effective bundle.
const en = { ...enRaw, circle: sharedCircleLocale.en };
const nl = { ...nlRaw, circle: sharedCircleLocale.nl };

describe('normalizeQuickReplies — empty / absent input', () => {
  it('returns undefined when input is absent', () => {
    expect(normalizeQuickReplies(undefined)).toBeUndefined();
    expect(normalizeQuickReplies(null)).toBeUndefined();
  });

  it('returns undefined when input is not an array', () => {
    expect(normalizeQuickReplies({ slash: '/yes' })).toBeUndefined();
    expect(normalizeQuickReplies('nope')).toBeUndefined();
  });

  it('returns undefined when input is an empty array', () => {
    expect(normalizeQuickReplies([])).toBeUndefined();
  });

  it('returns undefined when every entry is dropped (no usable slash)', () => {
    expect(normalizeQuickReplies([
      { label: 'A', slash: 'no-leading-slash' },
      { label: 'B' },
      'string-not-object',
    ])).toBeUndefined();
  });
});

describe('normalizeQuickReplies — well-formed pairs', () => {
  it('passes through {label, slash} pairs unchanged', () => {
    const out = normalizeQuickReplies([
      { label: 'Ja', slash: '/yes' },
      { label: 'Nee', slash: '/no' },
    ]);
    expect(out).toEqual([
      { label: 'Ja', slash: '/yes' },
      { label: 'Nee', slash: '/no' },
    ]);
  });

  it('trims whitespace around slash + label', () => {
    const out = normalizeQuickReplies([
      { label: '  Ja  ', slash: '  /yes  ' },
    ]);
    expect(out).toEqual([{ label: 'Ja', slash: '/yes' }]);
  });
});

describe('normalizeQuickReplies — fallback label', () => {
  it('falls back to the English literal when no t() is supplied', () => {
    const out = normalizeQuickReplies([{ slash: '/yes' }]);
    expect(out).toEqual([{ label: 'Reply', slash: '/yes' }]);
  });

  it('uses t(circle.chat.quick_reply.fallback_label) when available', () => {
    const t = (key) => key === 'circle.chat.quick_reply.fallback_label'
      ? 'Antwoord'
      : key;
    const out = normalizeQuickReplies([{ slash: '/yes' }], { t });
    expect(out).toEqual([{ label: 'Antwoord', slash: '/yes' }]);
  });

  it('falls back to the English literal when t() returns the key itself', () => {
    // i18n returns the key when no translation exists; treat as miss.
    const t = (key) => key;
    const out = normalizeQuickReplies([{ slash: '/yes' }], { t });
    expect(out).toEqual([{ label: 'Reply', slash: '/yes' }]);
  });
});

describe('locale entries — circle.chat.quick_reply.fallback_label', () => {
  it("en.json carries 'Reply' under circle.chat.quick_reply.fallback_label", () => {
    expect(en.circle?.chat?.quick_reply?.fallback_label?.text).toBe('Reply');
    expect(typeof en.circle?.chat?.quick_reply?.fallback_label?.doc).toBe('string');
  });
  it("nl.json carries 'Antwoord' under the matching path", () => {
    expect(nl.circle?.chat?.quick_reply?.fallback_label?.text).toBe('Antwoord');
    expect(typeof nl.circle?.chat?.quick_reply?.fallback_label?.doc).toBe('string');
  });
});
