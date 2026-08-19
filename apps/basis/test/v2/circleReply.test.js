import { describe, it, expect } from 'vitest';
import { circleReplyText } from '../../src/v2/circleReply.js';

const t = (k, p) => (p ? `${k}:${JSON.stringify(p)}` : k);

describe('circleReplyText', () => {
  it('distinguishes add vs complete by verb (the bug: both were "✓ X")', () => {
    const reply = { payload: { task: { text: 'buy milk' } } };
    expect(circleReplyText(reply, { verb: 'add', t })).toBe('circle.bot.added:{"label":"buy milk"}');
    expect(circleReplyText(reply, { verb: 'complete', t })).toBe('circle.bot.completed:{"label":"buy milk"}');
  });
  it('other verbs fall back to the generic ✓ label', () => {
    expect(circleReplyText({ payload: { title: 'X' } }, { verb: 'claim', t })).toBe('circle.bot.ok:{"label":"X"}');
  });
  it('reads the label across payload shapes', () => {
    expect(circleReplyText({ payload: { name: 'N' } }, { verb: 'add', t })).toBe('circle.bot.added:{"label":"N"}');
    expect(circleReplyText({ payload: 'just text' }, { verb: 'x', t })).toBe('circle.bot.ok:{"label":"just text"}');
  });
  it('surfaces an error via circle.bot.failed with the message', () => {
    expect(circleReplyText({ error: { message: 'boom' } }, { t })).toBe('circle.bot.failed:{"msg":"boom"}');
  });
  it('a list payload with labels → enumerated bullets; empty → listEmpty; no labels → listed(n)', () => {
    expect(circleReplyText({ payload: { items: [{ label: 'bread' }, { text: 'milk' }] } }, { t })).toBe('• bread\n• milk');
    expect(circleReplyText({ payload: { items: [] } }, { t })).toBe('circle.bot.listEmpty');
    expect(circleReplyText({ payload: { items: [1, 2, 3] } }, { t })).toBe('circle.bot.listed:{"n":3}');  // no labels → count
    expect(circleReplyText({ payload: {} }, { t })).toBe('circle.bot.done');
    expect(circleReplyText(null, { t })).toBe('circle.bot.done');
  });

  it('§1b: unwraps a GENERIC capability reply {via:generic, result} — add shows the note body, list enumerates', () => {
    // add·note → dispatchCapability envelope around the stored item (content field is `body`)
    const add = { payload: { ok: true, via: 'generic', atom: 'add', result: { ok: true, item: { type: 'note', body: 'buy stamps' } } } };
    expect(circleReplyText(add, { verb: 'add', t })).toBe('circle.bot.added:{"label":"buy stamps"}');
    // list·note → the items live under result.items; bodies are enumerated
    const list = { payload: { ok: true, via: 'generic', atom: 'list', result: { items: [{ type: 'note', body: 'stamps' }, { type: 'note', body: 'milk' }] } } };
    expect(circleReplyText(list, { verb: 'list', t })).toBe('• stamps\n• milk');
  });
});
