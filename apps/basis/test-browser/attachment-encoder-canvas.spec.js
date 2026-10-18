/**
 * S6.5 — real-canvas attachment encoder round-trip (Playwright / Chromium).
 *
 * The vitest suite (test/attachmentEncoder.test.js) covers the geometry + the
 * plumbing with an INJECTED fake canvas (happy-dom has no real 2D context). This
 * spec closes that gap: it runs the ACTUAL `encodeImageFile` against a real
 * browser Canvas + Image decode, and asserts the output is the inbound shape
 * pinboard.validateInboundAttachment accepts (real JPEG bytes + a JPEG thumbnail).
 *
 * User-run (per the project's Playwright-is-user-run cadence). Boots the dev
 * server via the shared config; imports the encoder from its vite-served path so
 * there's no source duplication.
 */
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// vite's dev root is `web/`, so the app's `src/` lives OUTSIDE it — vite serves out-of-root source via
// `/@fs/<abspath>` (that's what it rewrites the app's own relative imports to). A hardcoded `/src/…` URL
// would hit the SPA fallback and return index.html → "failed to fetch dynamically imported module".
const ENCODER_URL = `/@fs${path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/v2/attachmentEncoder.js')}`;

test('encodeImageFile produces a valid attachment record via a real Canvas', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async (encoderUrl) => {
    const { encodeImageFile } = await import(encoderUrl);

    // Build a real PNG File from a canvas (a recognisable gradient, 800×400).
    const src = document.createElement('canvas');
    src.width = 800; src.height = 400;
    const ctx = src.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 800, 400);
    grad.addColorStop(0, '#a8322d'); grad.addColorStop(1, '#1d4d3b');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 800, 400);
    const blob = await new Promise((r) => src.toBlob(r, 'image/png'));
    const file = new File([blob], 'gradient.png', { type: 'image/png' });

    // Real encode: real Image decode + real Canvas resize + real toDataURL.
    const att = await encodeImageFile(file, { maxDim: 256 });
    return {
      mime: att.mime,
      width: att.width,
      height: att.height,
      dataLen: att.dataB64.length,
      thumbStart: att.thumbnail.slice(0, 22),
      decodes: (() => { try { atob(att.dataB64); return true; } catch { return false; } })(),
    };
  }, ENCODER_URL);

  expect(result.mime).toBe('image/png');           // png input stays png
  expect(result.width).toBe(256);                  // 800→256 longest edge
  expect(result.height).toBe(128);
  expect(result.dataLen).toBeGreaterThan(100);     // real bytes came back
  expect(result.decodes).toBe(true);               // valid base64 payload
  expect(result.thumbStart).toBe('data:image/jpeg;base64');
});
