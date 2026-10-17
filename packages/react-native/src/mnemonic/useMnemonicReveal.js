/**
 * useMnemonicReveal — hook that surfaces the recovery-phrase reveal
 * UX backed by the SDK's `getMnemonicOnce` skill.
 *
 * Skills `getMnemonicOnce` + `markMnemonicShown` are app-side (each
 * app owns its skill registry); this hook calls them through a
 * `useSkill` hook the consumer supplies. That keeps the substrate
 * agnostic about which app the consumer is in.
 *
 * Usage:
 *
 *   import { useSkill } from './lib/useSkill.js';
 *   import { useMnemonicReveal } from '@onderling/react-native/mnemonic';
 *
 *   const { reveal, words, loading, error, reset } =
 *     useMnemonicReveal({ useSkill });
 *
 * Plan (Phase 41.0 L5): Tasks-mobile + Pinboard-mobile both call this
 * with their own `useSkill`. Both apps register `getMnemonicOnce` and
 * `markMnemonicShown` skills with the same names.
 */

import { useCallback, useState } from 'react';

/**
 * @param {object} args
 * @param {(skillId: string) => { call: (args?: object) => Promise<unknown> }} args.useSkill
 * @param {string} [args.revealSkill='getMnemonicOnce']
 * @param {string} [args.markShownSkill='markMnemonicShown']
 * @returns {{
 *   reveal:  () => Promise<string[] | null>,
 *   markShown: () => Promise<void>,
 *   words:   string[] | null,
 *   loading: boolean,
 *   error:   Error | null,
 *   reset:   () => void,
 * }}
 */
export function useMnemonicReveal({
  useSkill,
  revealSkill   = 'getMnemonicOnce',
  markShownSkill = 'markMnemonicShown',
} = {}) {
  if (typeof useSkill !== 'function') {
    throw new TypeError('useMnemonicReveal: useSkill hook required');
  }
  const get  = useSkill(revealSkill);
  const mark = useSkill(markShownSkill);

  const [words,   setWords]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const reveal = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await get.call();
      const phrase = r?.mnemonic ?? r?.phrase ?? r?.words ?? null;
      const arr = Array.isArray(phrase)
        ? phrase
        : (typeof phrase === 'string' ? phrase.trim().toLowerCase().split(/\s+/) : null);
      setWords(arr);
      return arr;
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [get]);

  const markShown = useCallback(async () => {
    try { await mark.call(); }
    catch (err) { setError(err); }
  }, [mark]);

  const reset = useCallback(() => {
    setWords(null);
    setLoading(false);
    setError(null);
  }, []);

  return { reveal, markShown, words, loading, error, reset };
}
