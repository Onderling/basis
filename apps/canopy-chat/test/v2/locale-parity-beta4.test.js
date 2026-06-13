/**
 * Locale-parity smoke test for β.4 — verifies the new
 * `circle.create.template.applied_hint` key exists in BOTH en + nl
 * with the same flat-key set across the canopy-chat locale files.
 * (Avoids importing renderer.js which has a worktree-only @canopy/*
 * resolution issue that breaks localisation.test.js — pre-existing.)
 */
import { describe, it, expect } from 'vitest';
import enRaw from '../../locales/en.json' with { type: 'json' };
import nlRaw from '../../locales/nl.json' with { type: 'json' };
import { sharedCircleLocale } from '../../src/locales/index.js';
// `circle.*` now lives in the shared source; merge it back to check the effective bundle.
const en = { ...enRaw, circle: sharedCircleLocale.en };
const nl = { ...nlRaw, circle: sharedCircleLocale.nl };

function flatKeys(node, prefix = '', out = []) {
  for (const [k, v] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (
      v && typeof v === 'object' && typeof v.text === 'string'
      && (v.doc === undefined || typeof v.doc === 'string')
      && Object.keys(v).every((kk) => kk === 'text' || kk === 'doc')
    ) {
      out.push(path);
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      flatKeys(v, path, out);
    } else {
      out.push(path);
    }
  }
  return out;
}

describe('β.4 — circle.create.template locale parity', () => {
  it('en + nl have the applied_hint key', () => {
    expect(en.circle.create.template.applied_hint.text).toBe('Defaults filled in for {{kind}}');
    expect(nl.circle.create.template.applied_hint.text).toBe('Standaardwaarden ingevuld voor {{kind}}');
  });

  it('en + nl key sets match (no drift introduced)', () => {
    expect(flatKeys(en).sort()).toEqual(flatKeys(nl).sort());
  });
});
