/**
 * A `t` over the shared `circle.*` bundle, for tests that boot the agent the way a shell does: every shell hands
 * the agent its translator, so a composition without one is not a shell's. Resolves `{ text, doc }` and plain-string
 * leaves, `{{name}}` placeholders, and the `_one` / `_other` forms when a numeric `count` is passed; a key the bundle
 * does not hold comes back as the key, the way the shells' translators show a missing one.
 */
import en from '../../src/locales/circle.en.json' with { type: 'json' };
import nl from '../../src/locales/circle.nl.json' with { type: 'json' };

export function bundleTranslator(bundle) {
  const leaf = (key) => {
    const v = String(key).split('.').slice(1).reduce((o, x) => (o && typeof o === 'object' ? o[x] : undefined), bundle);
    return typeof v === 'string' ? v : (typeof v?.text === 'string' ? v.text : null);
  };
  return (key, params = {}) => {
    const p = params ?? {};
    const plural = typeof p.count === 'number' ? leaf(`${key}_${p.count === 1 ? 'one' : 'other'}`) : null;
    const s = plural ?? leaf(key) ?? key;
    return s.replace(/\{\{(\w+)\}\}/g, (_, n) => String(p[n] ?? ''));
  };
}

export const tEn = bundleTranslator(en);
export const tNl = bundleTranslator(nl);
