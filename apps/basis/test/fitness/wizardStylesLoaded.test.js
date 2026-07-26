/**
 * Fitness — every `cc-wizard-*` class the wizards EMIT must have a rule in a stylesheet the app actually
 * LOADS.
 *
 * This guards a failure that shipped silently and was only caught at a live demo (2026-07-22, "bare HTML
 * buttons in settings + wizards don't match the look/feel"): the whole wizard stylesheet lived in
 * `web/style.css`, which no HTML file references any more, so every wizard rendered as unstyled browser
 * chrome while the CSS sat there looking authoritative. Nothing failed — there was no check that the classes
 * we emit are the classes we style.
 *
 * The rule: styling lives in the sheets `index.html` links. Adding a new `cc-wizard-*` class without a rule
 * (or moving rules into an unloaded file) fails here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const WEB = new URL('../../web/', import.meta.url).pathname;

/** The stylesheets `index.html` actually links — the only ones that reach a user. */
function loadedStylesheets() {
  const html = readFileSync(join(WEB, 'index.html'), 'utf8');
  const hrefs = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/g)].map((m) => m[1]);
  expect(hrefs.length).toBeGreaterThan(0);
  return hrefs.map((h) => readFileSync(join(WEB, h.replace(/^\.\//, '')), 'utf8')).join('\n');
}

/** Every `cc-wizard-*` class name the wizard/shell sources emit. */
function emittedWizardClasses() {
  const dirs = [join(WEB, '../src/web/wizards'), join(WEB, 'v2')];
  const out = new Set();
  for (const dir of dirs) {
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      for (const m of src.matchAll(/cc-wizard-[a-z-]+/g)) {
        const cls = m[0].replace(/-$/, '');          // strip a trailing `-` from template-built names
        if (cls !== 'cc-wizard') out.add(cls);
      }
    }
  }
  return [...out].sort();
}

describe('wizard styles reach the app', () => {
  it('every emitted cc-wizard-* class has a rule in a LOADED stylesheet', () => {
    const css = loadedStylesheets();
    const emitted = emittedWizardClasses();
    expect(emitted.length).toBeGreaterThan(20);       // sanity: we really did scan the wizards

    const unstyled = emitted.filter((cls) => !new RegExp(`\\.${cls}[\\s,:{]`).test(css));
    expect(unstyled).toEqual([]);
  });

  it('wizard buttons reuse the ONE .cc-btn family rather than a second look', () => {
    const css = loadedStylesheets();
    // The button classes must appear in the SAME rule as their .cc-btn counterpart — one source of truth for
    // the visuals, so a wizard button can never drift from the rest of the app again.
    expect(css).toMatch(/\.cc-btn,\s*\n\.cc-wizard-btn\s*\{/);
    expect(css).toMatch(/\.cc-btn--primary,\s*\n\.cc-wizard-btn-primary\s*\{/);
  });

  it('the wizard chrome carries no hardcoded colours (themeable light/dark)', () => {
    const css = loadedStylesheets();
    // Only the declarations INSIDE rules whose selector mentions a wizard class — token definitions in
    // theme.css are exactly where literal colours belong, so they must not be swept up here.
    const offenders = [];
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const [, selector, body] = m;
      if (!selector.includes('.cc-wizard-')) continue;
      for (const decl of body.split(';')) {
        if (/:\s*(#[0-9a-fA-F]{3,6}|white|black)\b/.test(decl)) offenders.push(`${selector.trim()} {${decl.trim()}}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
