/**
 * A FILE TO A CONTACT, FROM THE THREAD (Frits, sitting row 76: must work for alpha). A walk found no attach in a contact
 * thread: only the `/send-file` slash. The thread now has the circle composer's "+", fed by the same projector for a
 * contact scope; the picked entry runs as an op addressed to this contact.
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { attachEntriesFor } from '../../src/v2/attachEntries.js';
import { basisManifest } from '../../src/index.js';
import { renderContactThread } from '../../web/v2/contactThread.js';

const t = (k) => k;

describe('attach in a contact thread', () => {
  it('the projector offers a file to a contact, and never puts it in a circle\'s "+"', () => {
    const contact = attachEntriesFor({ manifestsByOrigin: { basis: basisManifest }, scope: 'contact' });
    expect(contact.map((e) => e.opId)).toContain('send-file');
    const circle = attachEntriesFor({ manifestsByOrigin: { basis: basisManifest } });
    expect(circle.map((e) => e.opId)).not.toContain('send-file');
  });

  it('web: the thread\'s "+" runs the picked entry for this contact', () => {
    const onAttachCommand = vi.fn();
    const attachMenu = attachEntriesFor({ manifestsByOrigin: { basis: basisManifest }, scope: 'contact' });
    const el = renderContactThread(document.createElement('div'), { t, name: 'Tester B', messages: [], attachMenu, onAttachCommand });
    const items = [...el.querySelectorAll('button, [role="menuitem"]')].filter((b) => b.textContent === 'circle.attach.file');
    expect(items.length, 'no file entry in the contact composer').toBeGreaterThan(0);
    items[0].click();
    expect(onAttachCommand).toHaveBeenCalledWith(expect.objectContaining({ opId: 'send-file' }));
  });

  it('mobile: the contact composer reads the same contact-scoped entries and runs them for this contact', () => {
    const src = readFileSync(path.join(process.cwd(), '../basis-mobile/src/screens/v2/ContactThreadScreen.js'), 'utf8');
    expect(/attachEntriesFor\([\s\S]{0,120}scope:\s*'contact'/.test(src)).toBe(true);
    expect(/\{\s*peer:\s*peerAddr\s*\}/.test(src)).toBe(true);
  });
});
