/**
 * Inside basis the pinboard agent is a sub-agent, and its own key stays in the process. Two host injections keep it
 * there: `selfCard` (whom the default card and this device's own requests name — the chat identity) and
 * `circleSignerFor` (who signs a circle's statements — the per-circle key). Without either, pinboard falls back to its
 * own key, which then goes out on cards and statements. So the composition refuses to build it without both, and says
 * which is missing, at construction rather than at first use.
 */
export function assertPinboardHostBindings(opts = {}) {
  const missing = ['selfCard', 'circleSignerFor'].filter((k) => typeof opts?.[k] !== 'function');
  if (missing.length) {
    throw new Error(`pinboard in basis needs ${missing.join(' and ')}: without it, the pinboard agent's own key would name this device`);
  }
  return opts;
}
