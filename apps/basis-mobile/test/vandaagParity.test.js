/**
 * Vandaag, the home — web ≡ mobile, from ONE source (it took over Mij's "Mijn overzicht": my chores and what is
 * coming, now the seeded blocks of the person's first page). Both shells seed the book through the shared
 * `ensureVandaagBook`, fill the active page through the one `materializeScreen`, and paint it with their screen block
 * painter, which names a block by its `titleKey`. Neither Me screen carries the overview any more. RN cannot render
 * under Vitest, so this reads the sources, as the other parity tests here do.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(__dirname, p), 'utf8');
// comments describe; code decides
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Vandaag — parity', () => {
  const webHost = code(read('../../basis/web/v2/circleApp.js'));
  const mobileHost = code(read('../src/screens/v2/CircleLauncherScreen.js'));
  const webPainter = code(read('../../basis/web/v2/circleScreen.js'));
  const mobilePainter = code(read('../src/screens/v2/CircleScreenView.js'));

  it('both shells seed the book and fill the page from the shared helpers', () => {
    for (const src of [webHost, mobileHost]) {
      expect(src).toMatch(/ensureVandaagBook\(\{/);
      expect(src).toMatch(/materializeScreen\(\{/);
      // "mine" per circle: the self this device speaks as there, never one id for every circle
      expect(src).toMatch(/selfIn: /);
      expect(src).toMatch(/circleSelf\?\.\(/);
    }
  });

  it('both block painters name a block by its titleKey — the title and the empty / error line', () => {
    for (const src of [webPainter, mobilePainter]) {
      expect(src.match(/block\.titleKey \?\?/g)?.length ?? 0).toBeGreaterThanOrEqual(3);   // tasks · agenda · items titles
      expect(src).toMatch(/block_empty', \{ type: blockName\(block/);
      expect(src).toMatch(/block_error', \{ type: blockName\(block/);
    }
  });

  it('neither Me screen carries the overview any more', () => {
    for (const src of [code(read('../../basis/web/v2/circleProfile.js')), code(read('../src/screens/v2/CircleProfileScreen.js'))]) {
      expect(src).not.toMatch(/mijOverview|MIJ_OVERVIEW|plannedForMe/);
    }
  });
});
