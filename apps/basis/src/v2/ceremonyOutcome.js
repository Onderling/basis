/**
 * The line a device ceremony ends on (revoke, replace, claim a companion), as both shells paint it: done, a phrase
 * that is not the owner's, an outcome the ceremony words itself (`circle.<prefix>.outcome_<outcome>` — a clock that
 * is off, a code that ran out), the op's own error, or the ceremony's "failed".
 * @param {{keyPrefix: string, outcome?: string|null, out?: object|null, t: (key: string, o?: object) => string}} a
 * @returns {string}
 */
export function ceremonyOutcomeText({ keyPrefix, outcome = null, out = null, t }) {
  if (outcome === 'ok') return t(`circle.${keyPrefix}.done`);
  if (outcome === 'wrong-phrase' || outcome === 'invalid-phrase') return t('circle.enroll.invalid_phrase');
  if (outcome) {
    const key = `circle.${keyPrefix}.outcome_${String(outcome).replace(/-/g, '_')}`;
    const said = t(key);
    if (said && said !== key) return said;
  }
  return out?.error ?? t(`circle.${keyPrefix}.failed`);
}
