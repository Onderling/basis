/**
 * A PHOTO IN A DIRECT MESSAGE IS RESIZED LIKE A PHOTO IN A CIRCLE — only the encoder's output rides (L78).
 *
 * Two web apps over a local relay, contacts. A sends B a camera-sized photo (3200×2400, a few MB)
 * through `/send-file` and the real file chooser (a JPEG shaped like a phone photo). What lands in B's thread is the encoder's output: under the
 * attachment cap (600 KB), re-encoded — not the picked file. Before, the direct-message door let anything up to
 * 8 MB ride as picked, while the same photo posted in a circle was resized.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-dm-photo.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootPeer, teardown, log } from './peerHarness.js';
import { nameMe, becomeContacts } from './contactsWalk.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

const CAP = 600_000;   // attachment.maxNoticeboardBytesPerAtt

test('a camera-sized photo sent to a contact arrives resized, under the attachment cap', async ({ browser }) => {
  test.setTimeout(420_000);
  let A = null; let B = null;
  try {
    A = await bootPeer(browser, 'A'); B = await bootPeer(browser, 'B');
    await nameMe(A.page, 'Anna'); await nameMe(B.page, 'Bea');
    const { aId, bId } = await becomeContacts(A, B);

    // a photo the size a phone takes, shaped like one: smooth gradients with sensor-like grain, saved as a
    // high-quality JPEG (a phone never hands over a PNG of pure noise — that one is refused honestly, as in a circle)
    const png = Buffer.from(await A.page.evaluate(() => {
      const w = 3200; const h = 2400;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, w, h); grad.addColorStop(0, '#2c5364'); grad.addColorStop(0.5, '#c79a5b'); grad.addColorStop(1, '#203a43');
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
      const img = g.getImageData(0, 0, w, h);
      for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 24; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
      g.putImageData(img, 0, 0);
      return c.toDataURL('image/jpeg', 0.98).split(',')[1];
    }), 'base64');
    expect(png.length, 'the picked photo is well over the cap').toBeGreaterThan(CAP * 3);

    const chooser = A.page.waitForEvent('filechooser', { timeout: 20_000 });
    const sending = A.page.evaluate((to) => window.onderlingCall('basis', 'send-file', { peer: to }), bId);
    await (await chooser).setFiles({ name: 'IMG_2041.jpg', mimeType: 'image/jpeg', buffer: png });
    const r = await sending;
    expect(r?.error ?? null, JSON.stringify(r)).toBeNull();
    log('STEP1 A sent the photo', 'PASS', `picked ${Math.round(png.length / 1024)} KB · ${r?.message ?? ''}`);

    const landed = async () => B.page.evaluate(async (id) => {
      try {
        const rows = await window.onderlingContactChannel?.rehydrate?.(id);
        const f = (rows ?? []).map((x) => x?.file).find(Boolean);
        return f ? { name: f.name, mime: f.mime, size: f.size, b64: typeof f.dataB64 === 'string' ? f.dataB64.length : null } : null;
      } catch { return null; }
    }, aId);
    await expect.poll(landed, { timeout: 60_000, message: 'the photo landed in B\'s thread' }).toBeTruthy();
    const f = await landed();
    expect(f.size, 'what rode is under the attachment cap').toBeLessThanOrEqual(CAP);
    expect(f.size, 'and it is not the picked file').toBeLessThan(png.length);
    log('STEP2 B received the encoder\'s output', 'PASS', JSON.stringify(f));
  } finally {
    await teardown([A, B].filter(Boolean));
  }
});
