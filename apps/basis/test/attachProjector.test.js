/**
 * (J4) — the ATTACHMENT projector wired into the basis WEB composer.
 *
 * Covers the three seams the wiring rests on:
 *   1. renderAttachments(basisManifest) projects the attach menu from each op's
 *      `surfaces.attach` (Bestand/Kaart/Afspraak), in manifest order.
 *   2. the prikbord + circle composers render that menu behind a "+" affordance
 *      (replacing the hand-coded 📎).
 *   3. selecting the FILE entry routes through the media pipeline (onAttach); every
 *      OTHER entry dispatches its {opId} via onAttachCommand (the host → callSkill).
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderAttachments } from '@onderling/app-manifest';
import { basisManifest } from '../manifest.js';
import { renderCircleNoticeboard } from '../web/v2/circleNoticeboard.js';
import { renderCircleView } from '../web/v2/circleView.js';

const LABELS = {
  'circle.attach.file': 'Bestand',
  'circle.attach.card': 'Kaart',
  'circle.attach.appointment': 'Afspraak',
};
const t = (k) => LABELS[k] ?? k;

describe('renderAttachments(basisManifest) — the ATTACHMENT projector', () => {
  const { attachMenu } = renderAttachments(basisManifest);

  it('lists exactly the ops that declare surfaces.attach, in manifest order', () => {
    expect(attachMenu.map((e) => e.opId)).toEqual(['embed', 'embed-file', 'embed-time']);
  });

  it('projects the file entry (embed-file → "Bestand") with its itemType', () => {
    const file = attachMenu.find((e) => e.opId === 'embed-file');
    expect(file.label).toBe('circle.attach.file');   // locale KEY (invariant #8)
    expect(t(file.label)).toBe('Bestand');
    expect(file.itemType).toBe('file');
  });

  it('carries params for an op that needs them (embed-time → title · when)', () => {
    const appt = attachMenu.find((e) => e.opId === 'embed-time');
    expect(t(appt.label)).toBe('Afspraak');
    expect(appt.params.map((p) => p.name)).toContain('when');
  });

  it('slash-parity: every attach entry is also a real slash command', () => {
    const slash = new Set(
      basisManifest.operations.filter((o) => o.surfaces?.slash?.command).map((o) => o.id),
    );
    for (const e of attachMenu) expect(slash.has(e.opId)).toBe(true);
  });
});

describe('prikbord composer — the projected "+" attach menu', () => {
  const attachMenu = renderAttachments(basisManifest).attachMenu;

  it('renders a "+" trigger + a menu item per entry (not the hardcoded 📎)', () => {
    const el = renderCircleNoticeboard(document.createElement('div'), {
      posts: [], t, attachMenu, onAttach: () => {}, onAttachCommand: () => {},
    });
    const trigger = el.querySelector('.cc-prikbord__attach');
    expect(trigger).not.toBeNull();
    expect(trigger.textContent).toBe('+');            // "+" affordance, no 📎
    const items = [...el.querySelectorAll('.cc-prikbord__attach-item')];
    expect(items.map((i) => i.dataset.opId)).toEqual(['embed', 'embed-file', 'embed-time']);
    expect(items.map((i) => i.textContent)).toEqual(['Kaart', 'Bestand', 'Afspraak']);
  });

  it('the "+" toggles the menu open', () => {
    const el = renderCircleNoticeboard(document.createElement('div'), {
      posts: [], t, attachMenu, onAttach: () => {}, onAttachCommand: () => {},
    });
    const menu = el.querySelector('.cc-prikbord__attach-menu');
    expect(menu.hidden).toBe(true);
    el.querySelector('.cc-prikbord__attach').click();
    expect(menu.hidden).toBe(false);
  });

  it('selecting the FILE entry routes through the media pipeline, NOT the dispatcher', () => {
    const onAttach = vi.fn();
    const onAttachCommand = vi.fn();
    const el = renderCircleNoticeboard(document.createElement('div'), {
      posts: [], t, attachMenu, onAttach, onAttachCommand,
    });
    const fileInput = el.querySelector('.cc-prikbord__file');
    fileInput.click = vi.fn();   // the file entry opens the picker (media pipeline)
    el.querySelector('.cc-prikbord__attach-item[data-op-id="embed-file"]').click();
    expect(fileInput.click).toHaveBeenCalledTimes(1);
    expect(onAttachCommand).not.toHaveBeenCalled();

    // …and a picked file still reaches onAttach (createMediaEmbed / sealed upload).
    const file = new File(['x'], 'pic.jpg', { type: 'image/jpeg' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fileInput.dispatchEvent(new Event('change'));
    expect(onAttach).toHaveBeenCalledWith(file);
  });

  it('selecting a NON-file entry dispatches its {opId} via onAttachCommand', () => {
    const onAttachCommand = vi.fn();
    const el = renderCircleNoticeboard(document.createElement('div'), {
      posts: [], t, attachMenu, onAttach: () => {}, onAttachCommand,
    });
    el.querySelector('.cc-prikbord__attach-item[data-op-id="embed-time"]').click();
    expect(onAttachCommand).toHaveBeenCalledWith(expect.objectContaining({ opId: 'embed-time' }));
  });
});

describe('circle composer — the same projected "+" menu', () => {
  const attachMenu = renderAttachments(basisManifest).attachMenu;
  const CIRCLE = { id: 'c1', name: 'Buren' };

  it('renders the menu + routes the file entry through onAttachMedia', () => {
    const onAttachMedia = vi.fn();
    const onAttachCommand = vi.fn();
    const el = renderCircleView(document.createElement('div'), {
      circle: CIRCLE, rows: [], t, onSend: () => {},
      attachMenu, onAttachMedia, onAttachCommand,
    });
    const items = [...el.querySelectorAll('.circle-circle__attach-item')];
    expect(items.map((i) => i.dataset.opId)).toEqual(['embed', 'embed-file', 'embed-time']);

    const fileInput = el.querySelector('.circle-circle__file');
    fileInput.click = vi.fn();
    el.querySelector('.circle-circle__attach-item[data-op-id="embed-file"]').click();
    expect(fileInput.click).toHaveBeenCalledTimes(1);

    el.querySelector('.circle-circle__attach-item[data-op-id="embed-time"]').click();
    expect(onAttachCommand).toHaveBeenCalledWith(expect.objectContaining({ opId: 'embed-time' }));
  });
});
