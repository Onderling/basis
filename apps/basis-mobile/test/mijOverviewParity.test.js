/**
 * "Mijn overzicht" on Mij — web ≡ mobile, from ONE source: ONE section, titled with the shared key, holding Gepland's
 * rows on top (the shared `plannedForMe`, with the week-overview switch that sat beside them) and below them the
 * shared `mijOverviewBlocks` ("Mijn dingen", declared once in apps/basis/src/v2/mijOverview.js), drawn by each
 * shell's own screen block painter, which names a block by its `titleKey`. Gepland has no section of its own any more.
 * Neither carries the screens manager (rename, delete, set-active, add-a-block). RN cannot render under Vitest, so
 * this reads the sources, as the other parity tests here do.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MIJ_OVERVIEW_BLOCKS } from '../../basis/src/v2/mijOverview.js';

const read = (p) => readFileSync(resolve(__dirname, p), 'utf8');
// comments describe; code decides
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Mijn overzicht — parity', () => {
  const webHost = read('../../basis/web/v2/circleApp.js');
  const webProfile = code(read('../../basis/web/v2/circleProfile.js'));
  const webPainter = code(read('../../basis/web/v2/circleScreen.js'));
  const mobileProfile = code(read('../src/screens/v2/CircleProfileScreen.js'));
  const mobilePainter = code(read('../src/screens/v2/CircleScreenView.js'));
  const at = webHost.indexOf('async function showMij(');
  const webShowMij = code(webHost.slice(at, webHost.indexOf('\n}\n', at)));

  it('both shells fill it from the shared helper, with the person\'s id', () => {
    expect(webShowMij).toMatch(/mijOverviewBlocks\(\{[^}]*\bme\b/);
    expect(mobileProfile).toMatch(/mijOverviewBlocks\(\{[^}]*\bme\b/);
  });

  it('both shells title the section with the shared key and paint it with their screen block painter', () => {
    for (const src of [webProfile, mobileProfile]) expect(src).toMatch(/MIJ_OVERVIEW_TITLE_KEY/);
    expect(webProfile).toMatch(/renderCircleScreen\(/);
    expect(mobileProfile).toMatch(/<CircleScreenView\b/);
  });

  it('both block painters name a block by its titleKey — the title and the empty / error line', () => {
    for (const src of [webPainter, mobilePainter]) {
      expect(src.match(/block\.titleKey \?\?/g)?.length ?? 0).toBeGreaterThanOrEqual(3);   // tasks · agenda · items titles
      expect(src).toMatch(/block_empty', \{ type: blockName\(block/);
      expect(src).toMatch(/block_error', \{ type: blockName\(block/);
    }
  });

  it('neither profile carries the screens manager', () => {
    for (const src of [webProfile, mobileProfile]) {
      expect(src).not.toMatch(/addUserScreen|renameUserScreen|removeUserScreen|renameScreen|removeScreen|setActiveScreen|addBlock|renderScreensPicker|CircleScreensPickerScreen/);
    }
  });

  it('the overview shows one cross-circle block — my chores; the appointments are Gepland\'s', () => {
    expect(MIJ_OVERVIEW_BLOCKS.map((b) => b.config.noun)).toEqual(['task']);
  });

  it('one section on both shells: title, then Gepland\'s rows and its week switch, then the block — no Gepland heading', () => {
    const order = (src, marks) => marks.map((m) => src.search(m));
    for (const [name, src, marks] of [
      ['web', webProfile, [/MIJ_OVERVIEW_TITLE_KEY/, /cc-profile__planned-item/, /cc-profile__week-toggle/, /renderCircleScreen\(/, /circle\.profile\.location'/]],
      ['mobile', mobileProfile, [/MIJ_OVERVIEW_TITLE_KEY/, /profile-planned-item/, /profile-week-toggle/, /<CircleScreenView\b/, /circle\.profile\.location'/]],
    ]) {
      const at = order(src, marks);
      expect(at.every((i) => i >= 0), `${name}: ${at}`).toBe(true);
      expect([...at].sort((a, b) => a - b), `${name} order`).toEqual(at);
      expect(src, name).not.toMatch(/circle\.profile\.planned_title/);
    }
  });
});
