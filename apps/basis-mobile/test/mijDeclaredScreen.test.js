/**
 * Mij = identity, ONE declared screen — web ≡ mobile. Both Me screens paint the declared actions (`meActions`) and
 * the declared blocks (`meBlocks`, filled by the shared `mijScreenBlocks`, painted by each shell's block painter),
 * plus one door to My data and, behind the developer switch, Advanced. Neither lists a section by hand: the identity
 * fields and the location moved to the person's own editor, the overview to Vandaag, the other doors into My data
 * (declared once in `myDataDoors.js`). RN cannot render under Vitest, so this reads the sources.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(__dirname, p), 'utf8');
// comments describe; code decides
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const webHost = code(read('../../basis/web/v2/circleApp.js'));
const fnOf = (src, name) => { const at = src.indexOf(`function ${name}(`); return at < 0 ? '' : src.slice(at, src.indexOf('\n}\n', at)); };
const webProfile = code(read('../../basis/web/v2/circleProfile.js'));
const mobileProfile = code(read('../src/screens/v2/CircleProfileScreen.js'));

describe('Mij — one declared screen on both shells', () => {
  it('neither Me screen lists a section by hand', () => {
    for (const src of [webProfile, mobileProfile]) {
      expect(src).not.toMatch(/circle\.profile\.(identity|location|availability|sharedWithMe|blocked|version|overview_title|week_switch)\b/);
      expect(src).not.toMatch(/MIJ_OVERVIEW|plannedLines|plannedForMe|setMyHandle|setMyLocation|geocode/);
      expect(src).not.toMatch(/cc-profile__section/);
    }
  });

  it('both fill the declared blocks through the one helper and paint them with their block painter', () => {
    expect(fnOf(webHost, 'showMij')).toMatch(/mijScreenBlocks\(/);
    expect(mobileProfile).toMatch(/mijScreenBlocks\(/);
    expect(webProfile).toMatch(/renderCircleScreen\(/);
    expect(mobileProfile).toMatch(/<CircleScreenView\b/);
  });

  it('both keep the declared actions, one My data door and Advanced behind the switch', () => {
    expect(webProfile).toMatch(/meActionsFor\(basisManifest\)/);
    expect(mobileProfile).toMatch(/meActionsMobile\(basisManifest\)/);
    for (const src of [webProfile, mobileProfile]) {
      expect(src).toMatch(/circle\.profile\.mydata/);
      expect(src).toMatch(/circle\.advanced\.title/);
    }
  });

  it('the doors Mij gave up are on both My data screens, from the one declaration', () => {
    expect(code(read('../../basis/web/v2/circleMyData.js'))).toMatch(/myDataDoorsFor\(/);
    expect(code(read('../src/screens/v2/CircleMyDataScreen.js'))).toMatch(/myDataDoorsFor\(/);
  });

  it('the identity fields and the location live in the person\'s own editor on both shells', () => {
    const webEditor = code(read('../../basis/web/v2/profileBasics.js'));
    expect(fnOf(webHost, 'openAboutMePanel')).toMatch(/renderProfileBasics\(/);
    const mobileEditor = code(read('../src/screens/v2/ProfileBasics.js'));
    expect(code(read('../src/screens/v2/CircleMijScreen.js'))).toMatch(/<ProfileBasics\b/);
    for (const src of [webEditor, mobileEditor]) expect(src).toMatch(/circle\.profile\.(handle|location)/);
    for (const src of [fnOf(webHost, 'openAboutMePanel'), mobileEditor]) expect(src).toMatch(/setMyHandle[\s\S]*setMyLocation|setMyLocation[\s\S]*setMyHandle/);
  });
});
