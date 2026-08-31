// @vitest-environment happy-dom
/**
 * Your own message carries no name — on BOTH shells, by one decision.
 *
 * Filed on 2026-08-31 as a web/mobile difference ("the phone shows no sender, web shows @handle"). It is
 * not one: the walk compared the PHONE's own message against WEB's view of the other device's message,
 * which is an incoming message and rightly named. Both shells suppress the label on the viewer's own
 * bubble, and neither decides it for itself — `stampSenderLabels` marks the row `senderSelf` with a null
 * label, and every renderer only paints what it is handed (invariant 1).
 *
 * The projector half has been pinned since it was written; `chatSenderLabels.test.js` even states the
 * reason in a test name — "a label on my bubble is noise". What was NOT pinned is the RENDERER half:
 * all three paint through `row?.senderSelf ? null : …`, and that `null` is a branch someone could fill
 * in on one shell alone. This is the parity half, so the question is answered mechanically rather than
 * re-filed from a screen dump.
 *
 * (Whether an own bubble SHOULD say "you" is a design question, not a drift — it is on the ledger.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderCircleScreen } from '../../web/v2/circleScreen.js';

const t = (k) => k;
const mount = () => { const el = document.createElement('div'); document.body.appendChild(el); return el; };

const board = (items) => [{ blockId: 'b1', type: 'noticeboard', status: 'ok', content: { items } }];

describe('the sender line above a message', () => {
  it('paints the stamped label for someone ELSE', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: board([
      { id: 'r1', actor: 'webid:anne', senderSelf: false, senderLabel: 'Anne', senderLabelKey: null,
        event: { payload: { text: 'Heeft iemand een ladder?' } } },
    ]), t });
    const senders = [...el.querySelectorAll('.circle-screen__noticeboard-sender')].map((n) => n.textContent);
    expect(senders).toEqual(['Anne']);
  });

  it('paints NOTHING for the viewer’s own row — the bubble is already yours', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: board([
      { id: 'r1', actor: 'webid:me', senderSelf: true, senderLabel: null, senderLabelKey: null,
        event: { payload: { text: 'Hallo vanaf de Fairphone' } } },
    ]), t });
    expect(el.querySelectorAll('.circle-screen__noticeboard-sender').length).toBe(0);
    expect(el.textContent).toContain('Hallo vanaf de Fairphone');
  });

  it('a name the SENDER claimed on the wire never paints, own row or not', () => {
    // The stamp exists because the payload's own `senderDisplay` was forgeable; a self row must not
    // become the hole that lets it back in.
    const el = mount();
    renderCircleScreen(el, { blocks: board([
      { id: 'r1', actor: 'webid:me', senderSelf: true, senderLabel: null, senderLabelKey: null,
        event: { payload: { text: 'mijn regel', senderDisplay: 'Gejat Naampje' } } },
    ]), t });
    expect(el.textContent).not.toContain('Gejat Naampje');
  });
});

describe('web ≡ mobile: all three renderers suppress the label the same way', () => {
  // Static for the mobile one: `apps/basis-mobile/src/screens/**` has no RN runtime under vitest, and
  // the line that matters is right there in the text.
  const RENDERERS = [
    ['web · a circle screen',    '../../web/v2/circleScreen.js'],
    ['web · the chat bubble',    '../../web/v2/circleView.js'],
    ['mobile · a circle screen', '../../../basis-mobile/src/screens/v2/CircleScreenView.js'],
  ];

  for (const [what, rel] of RENDERERS) {
    it(`${what} reads senderSelf and paints nothing for it`, () => {
      const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
      // `senderSelf ? null : (senderLabel ?? key)` — one shape, three files.
      expect(src, `${what} should branch on senderSelf`).toMatch(/senderSelf\s*\n?\s*\?\s*null/);
      expect(src, `${what} should fall back to the STAMPED label, never a payload name`)
        .toMatch(/senderLabel\s*\?\?\s*\(/);
      expect(src, `${what} must not read a name off the payload`).not.toMatch(/payload\??\.\s*senderDisplay/);
    });
  }
});
