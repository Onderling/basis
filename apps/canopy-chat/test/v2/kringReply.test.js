import { describe, it, expect } from 'vitest';
import { kringReplyText } from '../../src/v2/kringReply.js';

const t = (k, p) => (p ? `${k}:${JSON.stringify(p)}` : k);

describe('kringReplyText', () => {
  it('distinguishes add vs complete by verb (the bug: both were "✓ X")', () => {
    const reply = { payload: { task: { text: 'buy milk' } } };
    expect(kringReplyText(reply, { verb: 'add', t })).toBe('circle.bot.added:{"label":"buy milk"}');
    expect(kringReplyText(reply, { verb: 'complete', t })).toBe('circle.bot.completed:{"label":"buy milk"}');
  });
  it('other verbs fall back to the generic ✓ label', () => {
    expect(kringReplyText({ payload: { title: 'X' } }, { verb: 'claim', t })).toBe('circle.bot.ok:{"label":"X"}');
  });
  it('reads the label across payload shapes', () => {
    expect(kringReplyText({ payload: { name: 'N' } }, { verb: 'add', t })).toBe('circle.bot.added:{"label":"N"}');
    expect(kringReplyText({ payload: 'just text' }, { verb: 'x', t })).toBe('circle.bot.ok:{"label":"just text"}');
  });
  it('surfaces an error via circle.bot.failed with the message', () => {
    expect(kringReplyText({ error: { message: 'boom' } }, { t })).toBe('circle.bot.failed:{"msg":"boom"}');
  });
  it('a list payload with labels → enumerated bullets; empty → listEmpty; no labels → listed(n)', () => {
    expect(kringReplyText({ payload: { items: [{ label: 'bread' }, { text: 'milk' }] } }, { t })).toBe('• bread\n• milk');
    expect(kringReplyText({ payload: { items: [] } }, { t })).toBe('circle.bot.listEmpty');
    expect(kringReplyText({ payload: { items: [1, 2, 3] } }, { t })).toBe('circle.bot.listed:{"n":3}');  // no labels → count
    expect(kringReplyText({ payload: {} }, { t })).toBe('circle.bot.done');
    expect(kringReplyText(null, { t })).toBe('circle.bot.done');
  });
});
