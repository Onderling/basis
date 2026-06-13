/**
 * canopy-chat — localisation tests.  v0.1 sub-slice 1.11.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  initLocalisation, t, setLang, currentLang, detectDeviceLang,
  isInitialised, __test__,
} from '../src/localisation.js';
import en from '../locales/en.json' with { type: 'json' };
import nl from '../locales/nl.json' with { type: 'json' };
import { renderReply, __resetMessageIdSeq } from '../src/renderer.js';

beforeEach(() => __resetMessageIdSeq());

describe('initLocalisation + t', () => {
  it('initialises with en by default + translates known keys', async () => {
    await initLocalisation();
    expect(isInitialised()).toBe(true);
    expect(currentLang()).toBe('en');
    expect(t('common.ok')).toBe('✓');
    expect(t('common.failed')).toBe('Failed');
    expect(t('common.error')).toBe('Error');
  });

  // Guards the locale consolidation: the `circle.*` block now lives in the SHARED source
  // (src/locales/), merged by the loader. Every key the shared src/v2 modules reference must
  // resolve to a real string (not the raw key) — this is the exact drift that hid `circle.bot.*`
  // from web before (→ `/me` showed "circle.bot.failed"). Fails loudly if a key goes missing.
  it('resolves the shared circle.* keys the shared modules reference (en + nl)', async () => {
    const keys = [
      'circle.bot.failed', 'circle.bot.unknown', 'circle.bot.added', 'circle.bot.completed',
      'circle.bot.ok', 'circle.bot.done', 'circle.bot.listed', 'circle.bot.listEmpty', 'circle.bot.needsInfo',
      'circle.clarify.notFound', 'circle.clarify.which', 'circle.clarify.whichMissing', 'circle.clarify.noneToPick',
      'circle.kring.chat_disabled', 'circle.kring.composer_placeholder',
    ];
    await setLang('en');
    for (const k of keys) expect(t(k), `${k} (en) did not resolve — raw key returned`).not.toBe(k);
    await setLang('nl');
    for (const k of keys) expect(t(k), `${k} (nl) did not resolve — raw key returned`).not.toBe(k);
  });

  it("switches language to 'nl' via setLang", async () => {
    await setLang('nl');
    expect(currentLang()).toBe('nl');
    expect(t('common.failed')).toBe('Mislukt');
    expect(t('common.error')).toBe('Fout');
    expect(t('common.ok')).toBe('✓');
    // back to en
    await setLang('en');
    expect(t('common.failed')).toBe('Failed');
  });

  it('interpolates parameters with {{name}}', async () => {
    await setLang('en');
    expect(t('reply.unknown_command', { input: 'hello' }))
      .toMatch(/Didn't understand “hello”/);
    await setLang('nl');
    expect(t('reply.unknown_command', { input: 'hallo' }))
      .toMatch(/Begreep „hallo” niet/);
  });

  it('returns the key itself for unknown translations (visible failure)', async () => {
    await setLang('en');
    expect(t('does.not.exist')).toBe('does.not.exist');
  });

  it('initLocalisation is idempotent — second call is a no-op', async () => {
    await initLocalisation({ lng: 'en' });
    await initLocalisation({ lng: 'en' });  // no-op
    expect(isInitialised()).toBe(true);
  });

  it('initLocalisation second call with new lng switches language', async () => {
    await initLocalisation({ lng: 'en' });
    await initLocalisation({ lng: 'nl' });
    expect(currentLang()).toBe('nl');
    await setLang('en');
  });
});

describe('detectDeviceLang', () => {
  it("returns 'en' as fallback when navigator unavailable", () => {
    // In Node/vitest there's no navigator → 'en'.
    expect(detectDeviceLang()).toBe('en');
  });
});

describe('locale-file key parity (en ↔ nl)', () => {
  it('every key in en exists in nl (no translation drift)', () => {
    const enKeys = flatKeys(en).sort();
    const nlKeys = flatKeys(nl).sort();
    expect(nlKeys).toEqual(enKeys);
  });

  it("every leaf is {text, doc} shaped", () => {
    const enLeaves = leafShapes(en);
    const nlLeaves = leafShapes(nl);
    for (const shape of [...enLeaves, ...nlLeaves]) {
      expect(shape).toEqual(['text', 'doc']);
    }
  });

  it('unwrapLeaves transforms {text, doc} → string', () => {
    const { unwrapLeaves } = __test__;
    expect(unwrapLeaves({ a: { text: 'X', doc: 'note' } })).toEqual({ a: 'X' });
    expect(unwrapLeaves({ a: { text: 'X' } })).toEqual({ a: 'X' });
    expect(unwrapLeaves({ a: { nested: { text: 'Y', doc: 'd' } } }))
      .toEqual({ a: { nested: 'Y' } });
  });
});

describe('renderer + localisation integration', () => {
  it('renderer uses t() when supplied — Dutch produces Dutch labels', async () => {
    await setLang('nl');
    const r1 = renderReply({ payload: { ok: true },  shape: 'text' }, { t });
    expect(r1.text).toBe('✓');

    const r2 = renderReply({ payload: { ok: false }, shape: 'text' }, { t });
    expect(r2.text).toBe('Mislukt');

    const r3 = renderReply({
      payload: null, shape: 'text', error: { code: '', message: '' },
    }, { t });
    expect(r3.text).toBe('Fout');
    await setLang('en');
  });

  it("renderer falls back to English literals when no t supplied", () => {
    // Without opts.t, the renderer uses DEFAULT_T (English fallbacks).
    const r1 = renderReply({ payload: { ok: true }, shape: 'text' });
    expect(r1.text).toBe('✓');
    const r2 = renderReply({ payload: { ok: false }, shape: 'text' });
    expect(r2.text).toBe('Failed');
    const r3 = renderReply({
      payload: null, shape: 'text', error: { code: '', message: '' },
    });
    expect(r3.text).toBe('Error');
  });
});

/* ───── helpers ───── */

function flatKeys(node, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && typeof v.text === 'string'
        && (v.doc === undefined || typeof v.doc === 'string')
        && Object.keys(v).every((kk) => kk === 'text' || kk === 'doc')) {
      out.push(path);
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flatKeys(v, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

function leafShapes(node, out = []) {
  if (node && typeof node === 'object' && typeof node.text === 'string'
      && (node.doc === undefined || typeof node.doc === 'string')
      && Object.keys(node).every((k) => k === 'text' || k === 'doc')) {
    out.push(Object.keys(node).sort().reverse());   // ['text','doc'] or ['text']
    return out;
  }
  if (node && typeof node === 'object') {
    for (const v of Object.values(node)) leafShapes(v, out);
  }
  return out;
}
