/**
 * A ceremony step is consent: its picks offer their choices, but a ceremony step NEVER fills itself — not even with
 * one choice (that rule, `opFormOrRun`'s, is for an op a scan reached, never a ceremony). The submit tap stays the
 * person's. And both shells paint ceremonies through ONE generic painter each, named for what it is.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ceremonyChoices } from '../../src/forms/pickerChoices.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('ceremonyChoices', () => {
  it('a pick with ONE choice is offered, not taken', async () => {
    const form = { step: 'ceremony', params: [{ name: 'circle', pickerSource: { listOp: 'listMyCircles', appOrigin: 'pinboard' } }, { name: 'mnemonic' }] };
    const r = await ceremonyChoices(form, async () => [{ id: 'thuis', label: 'Thuis' }]);
    expect(r).toEqual({ circle: [{ id: 'thuis', label: 'Thuis' }] });
  });
  it('no form, or no picks: nothing', async () => {
    expect(await ceremonyChoices(null, async () => [])).toEqual({});
    expect(await ceremonyChoices({ params: [{ name: 'mnemonic' }] }, async () => { throw new Error('not asked'); })).toEqual({});
  });
});

describe('the one ceremony painter per shell', () => {
  const MOBILE = '../../../basis-mobile/src/screens/v2/CeremonyFlowModal.js';
  it('mobile: CeremonyFlowModal, which offers choices and never fills a step', () => {
    expect(existsSync(fileURLToPath(new URL(MOBILE, import.meta.url)))).toBe(true);
    const src = read(MOBILE);
    expect(src).toMatch(/ceremonyChoices\(/);
    expect(src).not.toMatch(/onlyChoice|opFormOrRun/);
  });
  it('web: showCeremonyFlow, the same', () => {
    const web = read('../../web/v2/circleApp.js');
    expect(web).toMatch(/function showCeremonyFlow\(/);
    expect(web).not.toMatch(/showDeviceCeremonyFlow/);
    const body = web.slice(web.indexOf('function showCeremonyFlow('), web.indexOf('function showRestoreFinishFlow('));
    expect(body).toMatch(/ceremonyChoices\(/);
    expect(body).not.toMatch(/onlyChoice|opFormOrRun/);
  });
});
