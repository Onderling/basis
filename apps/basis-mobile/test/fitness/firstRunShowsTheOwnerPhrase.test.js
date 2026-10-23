/**
 * The recovery-phrase screen must show the OWNER ROOT phrase, not the chat identity's mnemonic — and it opens only
 * from Vandaag's key card ("Toon"), never by itself at start (2026-10-23: App.js reads no phrase at all).
 *
 * ── Why this is a text guard, stated plainly ─────────────────────────────────────────────────────────────
 * `App.js` has no runtime coverage, so nothing here executes the screen. This asserts the WIRING and
 * nothing else, and it is the most that can honestly be claimed until the first-run flow is driven by
 * Detox on a real device.
 *
 * The neighbouring behaviour tests (`identityRecoveryJourney.test.js`) prove the underlying FACT — that the
 * chat identity's mnemonic re-encodes a child seed and can never equal the recovery phrase. What they
 * cannot prove is which of the two App.js reads. That is this file's one job.
 *
 * ── The defect it prevents ───────────────────────────────────────────────────────────────────────────────
 * Until 2026-08-02 the first-run word grid was filled from
 * `b.agent.sa.agent.identity.getMnemonic()` — the CHAT identity, whose seed is
 * `root.deriveAgentSeed('default')`, one derivation BELOW the owner root. It produced a perfectly valid,
 * perfectly useless 24-word phrase: not the phrase `revealOwnerPhrase` hands out, and feeding it back to
 * `restoreOwnerPhrase` installed it as a NEW root — a different person, at addresses nobody had seen.
 *
 * The same mistake had already been made and fixed once, in `CircleMyDataScreen`, whose comment records it
 * ("was pinboard getMnemonicOnce (wrong seed)"). One host got the fix; the other did not. That is the repo's
 * most-repeated defect, and this guard exists because noticing it is the hard part.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
/** App.js with comments stripped — it must not open the phrase at start. */
const APP_CODE = strip(readFileSync(fileURLToPath(new URL('../../App.js', import.meta.url)), 'utf8'));
/** The key card's host — where the phrase is read, on the card's explicit "Toon". */
const CODE = strip(readFileSync(fileURLToPath(new URL('../../src/screens/v2/CircleLauncherScreen.js', import.meta.url)), 'utf8'));

describe('the recovery phrase comes from the owner root, and only on the key card\'s "Toon"', () => {
  it('App.js reads no phrase and shows no phrase screen at start', () => {
    expect(APP_CODE).not.toMatch(/revealOwnerPhrase|MnemonicCreateScreen|getMnemonic/);
  });

  it('the key card\'s host reads it through the `revealOwnerPhrase` skill, on the `key-show` act', () => {
    const at = CODE.indexOf("'key-show'");
    expect(at).toBeGreaterThan(-1);
    expect(CODE.slice(at, at + 400)).toMatch(/revealOwnerPhrase/);
  });

  it('does NOT read the chat identity\'s mnemonic', () => {
    // the exact expression that was wrong, and any near relative of it
    expect(CODE).not.toMatch(/identity\s*\??\.\s*getMnemonic/);
    expect(CODE).not.toMatch(/sa\s*\??\.\s*agent\s*\??\.\s*identity/);
  });

  it('tolerates the skill being unavailable: an error reads as no words (the screen then says so), never a throw', () => {
    const at = CODE.indexOf("'key-show'");
    const near = CODE.slice(at, at + 500);
    expect(near).toMatch(/res\.error/);
    expect(near).toMatch(/catch\(/);
  });
});

describe('the two screens that show a recovery phrase agree', () => {
  const MYDATA = readFileSync(
    fileURLToPath(new URL('../../src/screens/v2/CircleMyDataScreen.js', import.meta.url)), 'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('both go through the same skill — one host getting a fix is how this broke', () => {
    for (const [name, src] of [['CircleLauncherScreen.js', CODE], ['CircleMyDataScreen.js', MYDATA]]) {
      expect(src, `${name} does not read the owner phrase through revealOwnerPhrase`)
        .toMatch(/revealOwnerPhrase/);
    }
  });
});
