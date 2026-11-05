/**
 * The Feedback contact is OFFERED, never seeded: a person adds it by their own tap, after one line that says who
 * receives what. No tap, nothing added; a removed contact stays removed — nothing adds it back on its own.
 */
import { describe, it, expect } from 'vitest';
import { encodeContactCard } from '@onderling-app/pinboard/lib/contactCard';
import { createLocalBuiltins } from '../../src/core/localBuiltins.js';

const CARD = `onderling-contact://${encodeContactCard({ webid: 'fbWebidAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', pubKey: 'fbWebidAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', handle: 'Feedback' })}`;
const WEBID = 'fbWebidAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function host({ inBook = false, answer = true } = {}) {
  const book = inBook ? [{ webid: WEBID }] : [];
  const calls = []; const opened = []; const asked = [];
  const callSkill = async (app, op, args) => {
    calls.push(op);
    if (op === 'listContacts') return { contacts: book.slice() };
    if (op === 'addContactFromQr') { book.push({ webid: WEBID }); return { ok: true, webid: WEBID }; }
    return {};
  };
  const builtins = createLocalBuiltins({
    t: (k) => k, callSkill, feedbackCard: CARD, appVersion: 'v9',
    openFeedback: (o) => opened.push(o),
    confirmFeedbackOffer: async (o) => { asked.push(o); return answer; },
  });
  return { builtins, calls, opened, asked, book };
}

describe('the Feedback contact is offered, not seeded', () => {
  it('not in the book: asked first, with who receives what; yes adds it and opens the thread', async () => {
    const h = host({ answer: true });
    const r = await h.builtins.feedback({});
    expect(r.ok).toBe(true);
    expect(h.asked).toHaveLength(1);
    expect(h.asked[0]).toMatchObject({ title: 'feedback.offer_title', line: 'feedback.offer_line' });
    expect(h.calls).toContain('addContactFromQr');
    expect(h.opened).toHaveLength(1);
    expect(h.opened[0].webid).toBe(WEBID);
  });

  it('no tap, nothing added and nothing opened', async () => {
    const h = host({ answer: false });
    const r = await h.builtins.feedback({});
    expect(r.ok).toBe(false);
    expect(h.calls).not.toContain('addContactFromQr');
    expect(h.opened).toHaveLength(0);
  });

  it('already in the book: the thread opens at once, nothing asked', async () => {
    const h = host({ inBook: true });
    await h.builtins.feedback({});
    expect(h.asked).toHaveLength(0);
    expect(h.calls).not.toContain('addContactFromQr');
    expect(h.opened).toHaveLength(1);
  });
});
