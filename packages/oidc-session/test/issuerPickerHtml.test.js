/**
 * getIssuerPickerHtml — server-rendered issuer picker.
 *
 * Pure string-shape tests; no DOM. Consumer-side adoption (Folio +
 * Pinboard sign-in pages) is the integration coverage.
 *
 * Phase 52.15.4 (2026-05-14).
 */

import { describe, it, expect } from 'vitest';
import { getIssuerPickerHtml, KNOWN_ISSUERS } from '../index.js';

describe('getIssuerPickerHtml — defaults', () => {
  it('renders a radio for every KNOWN_ISSUERS entry', () => {
    const html = getIssuerPickerHtml();
    for (const issuer of KNOWN_ISSUERS) {
      expect(html).toContain(`value="${issuer.url}"`);
      expect(html).toContain(issuer.label);
      expect(html).toContain(`data-issuer-id="${issuer.id}"`);
    }
  });

  it('checks the default issuer (Inrupt) by default', () => {
    const html = getIssuerPickerHtml();
    expect(html).toMatch(/value="https:\/\/login\.inrupt\.com" checked/);
  });

  it('renders the custom-URL row by default', () => {
    const html = getIssuerPickerHtml();
    expect(html).toContain('value="custom"');
    expect(html).toContain('type="url"');
    expect(html).toContain('issuer-custom');
  });

  it('uses semantic fieldset/legend markup', () => {
    const html = getIssuerPickerHtml();
    expect(html).toMatch(/^<fieldset class="issuer-picker">/);
    expect(html).toContain('<legend>');
    expect(html.trim().endsWith('</fieldset>')).toBe(true);
  });
});

describe('getIssuerPickerHtml — selectedId', () => {
  it('checks the named known issuer', () => {
    const html = getIssuerPickerHtml({ selectedId: 'solidcommunity' });
    expect(html).toMatch(/value="https:\/\/solidcommunity\.net" checked/);
    expect(html).not.toMatch(/value="https:\/\/login\.inrupt\.com" checked/);
  });

  it('checks the custom row when selectedId="custom"', () => {
    const html = getIssuerPickerHtml({ selectedId: 'custom' });
    expect(html).toMatch(/value="custom" checked/);
    // Default (Inrupt) is NOT checked.
    expect(html).not.toMatch(/value="https:\/\/login\.inrupt\.com" checked/);
  });

  it('falls back to default for unknown selectedId', () => {
    const html = getIssuerPickerHtml({ selectedId: 'nonsense' });
    expect(html).toMatch(/value="https:\/\/login\.inrupt\.com" checked/);
  });

  it('pre-fills customUrl when selectedId="custom"', () => {
    const html = getIssuerPickerHtml({ selectedId: 'custom', customUrl: 'https://my-css.example/' });
    expect(html).toContain('value="https://my-css.example/"');
  });
});

describe('getIssuerPickerHtml — customAllowed=false', () => {
  it('omits the custom row when disabled', () => {
    const html = getIssuerPickerHtml({ customAllowed: false });
    expect(html).not.toContain('value="custom"');
    expect(html).not.toContain('issuer-custom');
  });

  it('selectedId="custom" while disabled falls back to default', () => {
    const html = getIssuerPickerHtml({ selectedId: 'custom', customAllowed: false });
    expect(html).toMatch(/value="https:\/\/login\.inrupt\.com" checked/);
  });
});

describe('getIssuerPickerHtml — namePrefix', () => {
  it('scopes the form names with the prefix', () => {
    const html = getIssuerPickerHtml({ namePrefix: 'foo' });
    expect(html).toContain('name="foo-issuer-choice"');
    expect(html).toContain('name="foo-issuer-custom"');
    // Default names are NOT present when prefixed.
    expect(html).not.toContain('name="issuer-choice"');
  });

  it('uses unprefixed names when namePrefix is empty', () => {
    const html = getIssuerPickerHtml();
    expect(html).toContain('name="issuer-choice"');
    expect(html).toContain('name="issuer-custom"');
  });
});

describe('getIssuerPickerHtml — escaping', () => {
  it('escapes the legend', () => {
    const html = getIssuerPickerHtml({ legend: '<script>x</script>' });
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toContain('<script>x</script>');
  });

  it('escapes the customUrl pre-fill', () => {
    const html = getIssuerPickerHtml({
      selectedId: 'custom',
      customUrl: 'https://attacker"onclick="alert(1)',
    });
    expect(html).toContain('&quot;onclick=&quot;alert(1)');
    expect(html).not.toContain('"onclick="alert(1)');
  });
});
