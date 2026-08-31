/**
 * The translator a shared module falls back to when its host forgot to inject one.
 *
 * Shared renderers take `t` as a dependency and, sixty-two times over, wrote the same line:
 * `const tr = translatorOr(t, 'translatorOr.js');`. It keeps the module honest — it renders
 * SOMETHING rather than throwing — but the something is raw key names, and nothing anywhere fails.
 * That is invariant 8's failure mode with no signal: the strings are all present and correctly
 * authored, the host simply never handed them over, and the screen fills with `circle.foo.bar`.
 *
 * Same behaviour, one place, and it says so in dev — once per key, because these run inside render
 * loops and a warning per frame is a warning nobody reads.
 *
 * @param {*} t — whatever the host passed
 * @param {string} [where] — the module's name, so the warning names the culprit
 * @returns {(key: string, params?: object) => string}
 */
const warned = new Set();

export function translatorOr(t, where = 'a shared module') {
  if (typeof t === 'function') return t;
  return (key) => {
    if (!warned.has(where)) {
      warned.add(where);
      // eslint-disable-next-line no-console
      console.warn(`[locale] ${where} was rendered without a translator — showing key names (e.g. "${key}"). The host should pass t.`);
    }
    return key;
  };
}

/** Test seam: forget which modules have already warned. */
export function __resetTranslatorWarnings() { warned.clear(); }
