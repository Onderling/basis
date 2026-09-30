/**
 * A list reply's buttons carry words, never locale keys. Frits' session: "circle.list.done: sjoerd moet de …" — the
 * manifest declares its button label as a KEY (`labelKey`) and a surface is to resolve it; the per-item keyboard dropped
 * the key and kept the literal fallback (the key itself), so no surface could.
 */
import { describe, it, expect } from 'vitest';
import { renderReply } from '../src/renderer.js';
import { listsManifest } from '../../lists/manifest.js';

const t = (k) => ({ 'circle.list.done': 'Klaar' }[k] ?? k);

describe('the buttons of a list reply', () => {
  it('say words from the locale, not a key', () => {
    const reply = { shape: 'list', payload: { ok: true, items: [{ id: 'e1', label: 'sjoerd moet de lamp', type: 'list-item' }, { id: 'e2', label: 'melk', type: 'list-item' }] } };
    const out = renderReply(reply, { t, appOrigin: 'lists', manifestsByOrigin: { lists: listsManifest } });
    const labels = (out.items ?? []).flatMap((it) => (it.buttons ?? []).map((b) => b.label));
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) expect(l).not.toMatch(/^circle\./);
    expect(labels).toContain('Klaar');
  });
});
