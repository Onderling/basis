/**
 * "Persona's op dit apparaat" — web ≡ mobile: both list the selves this device holds through `listPersonasHere`, paint
 * the shared rows (`personasHereRows`) and fire the row's own act; neither decides pause/resume itself.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(__dirname, p), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('personas on this device — parity', () => {
  it('both list, paint the shared rows and fire the row\'s act', () => {
    for (const src of [code(read('../../basis/web/v2/circleApp.js')), code(read('../src/screens/v2/ReceivePersonasModal.js'))]) {
      expect(src).toContain("'listPersonasHere'");
      expect(src).toContain('personasHereRows(');
      expect(src).toMatch(/\.act\.op/);
      expect(src).not.toMatch(/'pausePersona'\s*:\s*'resumePersona'|paused \? 'resumePersona'/);   // the choice is the model's
    }
  });
});
