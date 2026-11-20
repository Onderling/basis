/**
 * MIJ LEAVES THE TAB BAR — web ≡ mobile from ONE model: both shells open the persona panel from the persona button over
 * the tab that is showing (`personaPanelModel`: a tab per persona, the "Laat zien als" door), put the settings button
 * beside it (the settings home's back from `settingsBackFor`), and give Vandaag its top from the declared `todayBlocks`
 * (the availability words, "Wacht op jou"). Neither shell has a Mij tab or a "← Mij" any more. `src/screens/**` cannot
 * render under vitest, so the wiring is pinned as source text.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(__dirname, p), 'utf8');

describe('the persona panel and the settings button — parity', () => {
  const webHost = read('../../basis/web/v2/circleApp.js');
  const launcher = read('../src/screens/v2/CircleLauncherScreen.js');
  const sheet = read('../src/screens/v2/PersonaPanelSheet.js');
  const view = read('../src/screens/v2/CircleScreenView.js');
  const personaButtonRN = read('../src/screens/v2/PersonaButton.js');
  const settingsHome = read('../src/screens/v2/SettingsHomeScreen.js');

  it('both hosts open the panel from the shared model, the tab of the one persona shown first', () => {
    for (const src of [webHost, launcher]) {
      expect(src).toMatch(/personaPanelModel\(\{ held:[\s\S]{0,120}selected: [^,]*writeAs\(/);
    }
    expect(sheet).toMatch(/model\.tabs\.map/);
    expect(sheet).toMatch(/model\.showAs/);
  });

  it('both hosts read Vandaag\'s top from the manifest and hand its sources', () => {
    for (const src of [webHost, launcher]) {
      expect(src).toMatch(/todayTop: todayTopBlocks\(\)/);
      expect(src).toMatch(/pendingDeviceOffer:/);
    }
    // availability left Vandaag (Frits 2026-11-20): a ring on the persona button and one row in the persona panel,
    // from the shared helpers; no block, no line under the title
    expect(view).not.toMatch(/case 'availability'|availabilityLine|VandaagAvailability/);
    expect(launcher).not.toMatch(/VandaagAvailability/);
    expect(webHost).not.toMatch(/renderVandaagAvailability/);
    expect(personaButtonRN).toMatch(/availabilityRing\(/);
    expect(personaButtonRN).toMatch(/personaButtonLabel\(/);
    expect(sheet).toMatch(/availabilityRow\(/);
    expect(launcher).toMatch(/onAvailability=\{\(\) => \{ setPanelOpen\(false\); setView\('availability'\); \}\}/);
    expect(webHost).toMatch(/onAvailability: \(\) => \{ shut\(\); showAvailability\(/);
  });

  it('the "Wacht op jou" block is titled by the kinds in it, from the shared helper on both shells', () => {
    expect(read('../../basis/web/v2/circleScreen.js')).toMatch(/awaitingTitle\(block\.content\?\.items, \{ t: tr \}\)/);
    expect(view).toMatch(/awaitingTitle\(items, \{ t \}\)/);
    expect(view).not.toMatch(/circle\.recipe\.block\.awaiting'/);
  });

  it('the vote chip opens the circle\'s open votes (the decisions view) on both shells, not its settings', () => {
    expect(webHost).toMatch(/action\?\.kind === 'open-votes' && action\.circleId\) showGovernance\(action\.circleId\)/);
    expect(launcher).toMatch(/a\?\.kind === 'open-votes'\) \{ const c = circles\.find\(\(x\) => x\.id === a\.circleId\); if \(c\) openVotes\(c\); \}/);
    expect(launcher).toMatch(/const openVotes = useCallback\(\(c\) => \{ setSelected\(c\); setView\('governance'\); \}/);
  });

  it('the settings home names the tab it returns to, and holds Advanced at its foot', () => {
    for (const src of [webHost, launcher]) expect(src).toMatch(/settingsBackFor\(/);
    expect(settingsHome).toMatch(/onAdvanced/);
    expect(settingsHome).not.toMatch(/circle\.mydata\.back/);
  });

  it('no Mij tab and no way back to it', () => {
    expect(launcher).not.toMatch(/id === 'mij'/);
    expect(launcher).not.toMatch(/setView\('profile'\)/);
    expect(launcher).not.toMatch(/circle\.back_me|circle\.profile\.avatar_label/);
  });
});
