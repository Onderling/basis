/**
 * An argument-taking op is reachable as a FORM on both shells — never only "in chat".
 *
 * The shared projection (`advancedOpRows`) says `via: 'form'` for such an op and carries its params. Each
 * shell must PAINT that: web through the docked page panel (`openPagePanel`), mobile through the op-page
 * sheet (`OpPageModal`). Before 2026-08-29 both shells printed "In chat: /slash" instead — and a phone
 * with no circle has no chat, so on mobile such an op could not be run at all (the walk's W24).
 * Shell files have no runtime coverage, so this reads the source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(HERE, rel), 'utf8');
const WEB    = read('../../web/v2/circleApp.js');
const MOBILE = read('../../../basis-mobile/src/screens/v2/CircleAdvancedScreen.js');

describe('an argument-taking op has a form of its own on every shell', () => {
  it('the web advanced tab opens the page panel for it', () => {
    const advanced = WEB.slice(WEB.indexOf("t('circle.advanced.ops_title')"));
    expect(advanced).toMatch(/t\('circle\.advanced\.open'\)/);
    expect(advanced.slice(0, 6000)).toMatch(/openPagePanel\(/);
  });
  it('the mobile advanced screen opens the op-page sheet for it', () => {
    expect(MOBILE).toMatch(/import OpPageModal from '\.\/OpPageModal\.js'/);
    expect(MOBILE).toMatch(/t\('circle\.advanced\.open'\)/);
    expect(MOBILE).toMatch(/<OpPageModal/);
  });
  it('the mobile sheet builds its form from the SHARED form spec — no second field builder', () => {
    const modal = read('../../../basis-mobile/src/screens/v2/OpPageModal.js');
    expect(modal).toMatch(/buildFormSpec, validateAndCoerce \} from '.*basis\/src\/forms\/buildFormSpec\.js'/);
  });
});
