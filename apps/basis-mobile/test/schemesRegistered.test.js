/**
 * FITNESS — every URI scheme this product BUILDS must be one the OS will hand back to it.
 *
 * `QR_URI_PREFIXES` is the canonical registry of schemes basis produces and recognises. Recognition is
 * enough for a scanned or pasted URI: the payload is already inside the app by then. A link someone taps
 * in a chat is a different question — the operating system has to know the app claims that scheme, or
 * tapping it does nothing at all.
 *
 * The two drifted, and the drift was invisible for exactly that reason (found walking S4, 2026-07-30):
 * `basis://` was registered, `stoop-invite://` — the scheme every circle invite actually uses — was not.
 * Sharing an invite the most natural way, by sending someone the link, produced a dead string, while
 * scanning and pasting both worked fine.
 *
 * So the registry is the source of truth and the app config must agree with it. If a scheme is added to
 * one and not the other, this fails.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QR_URI_PREFIXES, OS_REGISTERED_SCHEMES } from '../../basis/src/core/qrSchemes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appJson = JSON.parse(readFileSync(path.join(here, '..', 'app.json'), 'utf-8'));

describe('FITNESS: the app claims every scheme it hands out', () => {
  const declared = [].concat(appJson.expo.scheme ?? []);

  it('app.json declares a scheme for every entry in the QR registry', () => {
    const missing = OS_REGISTERED_SCHEMES.filter((s) => !declared.includes(s));
    expect(
      missing,
      'these schemes are produced by the app but no OS will route them back to it — a link someone taps '
      + 'in a chat does nothing. Add them to `expo.scheme` in app.json.',
    ).toEqual([]);
  });

  it('the derived list matches the registry it comes from', () => {
    expect(OS_REGISTERED_SCHEMES.length).toBe(QR_URI_PREFIXES.length);
    for (const s of OS_REGISTERED_SCHEMES) expect(s).not.toContain(':');
  });

  it('`stoop-invite` in particular — the one that was missing', () => {
    // Named explicitly because it is the scheme of the first thing a new person ever receives.
    expect(declared).toContain('stoop-invite');
  });
});
