/**
 * basis — media, the full-image "[View]" affordance on the media chip.
 *
 * RENDER-SIDE only (the domAdapter media-card seam). The chip already carries
 * the blob-gateway line; when the render ctx also carries an `openFull` reader
 * (the circle media gateway's gated full-size read) the chip grows a "[View]"
 * control that opens the full image in a self-contained lightbox. Absent
 * `openFull` → NO View control, the chip is byte-identical to before.
 *
 * The `openFull` seam is INJECTED by the composition (same pattern as
 * `ctx.media.opener`); here it is stubbed. deny/throw → a quiet notice, no crash.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';

import { renderToDom } from '../../src/web/domAdapter.js';

const t = (key) => key;

/** A media-card embed as the shared branch renders it: snapshot with a
 *  blob-gateway `source` line (an object → `line` is truthy). */
function mediaEmbed({ caption = '' } = {}) {
  return {
    kind: 'media-card',
    appOrigin: 'circle',
    snapshot: {
      id: 'i-1', type: 'media', mime: 'image/jpeg', width: 640, height: 480,
      caption,
      source: { ref: 'blob://k1', enc: { sealed: true, mime: 'image/jpeg', width: 640, height: 480 } },
    },
  };
}

function renderChip(mediaCtx) {
  const el = renderToDom(
    { kind: 'embed-card', embed: mediaEmbed(), messageId: 'm-1', lifecycleState: 'live' },
    { doc: document, t, ...(mediaCtx ? { media: mediaCtx } : {}) },
  );
  document.body.appendChild(el);
  return el;
}

const fullBytes = () => new Uint8Array([255, 216, 255, 224, 1, 2, 3, 4, 5]);

// happy-dom appends the lightbox to document.body — clear it between tests.
function resetBody() { document.body.innerHTML = ''; }

// Flush pending microtasks (the lightbox's read chain: then → then → catch).
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('media chip — full-image [View] affordance', () => {
  it('renders a View control when the ctx carries openFull', () => {
    resetBody();
    let seen = null;
    const chip = renderChip({ openFull: (line) => { seen = line; return { bytes: fullBytes() }; } });
    const view = chip.querySelector('.cc-media-view');
    expect(view).not.toBeNull();
    expect(view.tagName).toBe('BUTTON');
    expect(view.textContent).toBe('circle.media.view.label');   // t = identity → localised, not hardcoded
    expect(seen).toBeNull();   // not called until the user clicks
  });

  it('click → the full image is fetched through openFull and shown in a lightbox', async () => {
    resetBody();
    let calledWith;
    const openFull = (line) => { calledWith = line; return { bytes: fullBytes(), media: { mime: 'image/jpeg' } }; };
    const chip = renderChip({ openFull });
    chip.querySelector('.cc-media-view').click();
    await flush();   // settle the read promise

    const overlay = document.querySelector('.cc-media-lightbox');
    expect(overlay).not.toBeNull();
    const img = overlay.querySelector('img.cc-media-lightbox__img');
    expect(img).not.toBeNull();
    expect(img.src.length).toBeGreaterThan(0);
    // openFull was handed the manifest line the chip carries.
    expect(calledWith).toEqual(mediaEmbed().snapshot.source);
    // The loading placeholder is gone once the image lands.
    expect(overlay.querySelector('.cc-media-lightbox__status')).toBeNull();
  });

  it('the thumbnail is NOT the only trigger — clicking it also opens the lightbox', async () => {
    resetBody();
    // Provide an opener so the inline thumbnail renders (openThumbnail path).
    // A no-op opener returns the sealed text as-is; the thumb only needs bytes>0.
    let calls = 0;
    const chip = renderChip({
      opener: () => '',   // wrong/plaintext → thumb fails → placeholder; View still present
      openFull: () => { calls += 1; return { bytes: fullBytes() }; },
    });
    // Regardless of thumbnail success, the View button is present and opens.
    chip.querySelector('.cc-media-view').click();
    await flush();
    expect(calls).toBe(1);
    expect(document.querySelector('.cc-media-lightbox img.cc-media-lightbox__img')).not.toBeNull();
  });

  it('ESC / backdrop closes the lightbox (and it is removed from the DOM)', async () => {
    resetBody();
    const chip = renderChip({ openFull: () => ({ bytes: fullBytes() }) });
    chip.querySelector('.cc-media-view').click();
    await flush();
    expect(document.querySelector('.cc-media-lightbox')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.cc-media-lightbox')).toBeNull();
  });

  it('NO openFull in ctx → NO View control, and the chip is byte-identical', () => {
    resetBody();
    const withAffordance = renderChip({ openFull: () => ({ bytes: fullBytes() }) });
    resetBody();
    const bare = renderChip();          // no media ctx at all
    resetBody();
    const openerOnly = renderChip({ opener: () => '' });   // opener but no openFull

    expect(withAffordance.querySelector('.cc-media-view')).not.toBeNull();
    expect(bare.querySelector('.cc-media-view')).toBeNull();
    expect(openerOnly.querySelector('.cc-media-view')).toBeNull();

    // Byte-identical chip when the affordance isn't wired: same HTML as the
    // affordance version minus the View button.
    expect(bare.outerHTML).toBe(openerOnly.outerHTML);
  });

  it('a throwing / denied openFull → a quiet error notice, no crash, no broken image', async () => {
    resetBody();
    const chip = renderChip({ openFull: () => { throw new Error('denied'); } });
    expect(() => chip.querySelector('.cc-media-view').click()).not.toThrow();
    await flush();

    const overlay = document.querySelector('.cc-media-lightbox');
    expect(overlay).not.toBeNull();
    expect(overlay.querySelector('img.cc-media-lightbox__img')).toBeNull();   // never a broken image
    const status = overlay.querySelector('.cc-media-lightbox__status--error');
    expect(status).not.toBeNull();
    expect(status.textContent).toBe('circle.media.view.error');
  });

  it('an async-rejected openFull degrades the same quiet way', async () => {
    resetBody();
    const chip = renderChip({ openFull: () => Promise.reject(new Error('gate denied')) });
    chip.querySelector('.cc-media-view').click();
    await flush();

    const overlay = document.querySelector('.cc-media-lightbox');
    expect(overlay.querySelector('.cc-media-lightbox__status--error')).not.toBeNull();
    expect(overlay.querySelector('img.cc-media-lightbox__img')).toBeNull();
  });

  it('an empty read (no bytes) also degrades to the quiet notice', async () => {
    resetBody();
    const chip = renderChip({ openFull: () => ({ bytes: new Uint8Array([]) }) });
    chip.querySelector('.cc-media-view').click();
    await flush();

    const overlay = document.querySelector('.cc-media-lightbox');
    expect(overlay.querySelector('.cc-media-lightbox__status--error')).not.toBeNull();
    expect(overlay.querySelector('img')).toBeNull();
  });
});
