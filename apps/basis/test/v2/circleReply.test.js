import { describe, it, expect } from 'vitest';
import { circleReplyText } from '../../src/v2/circleReply.js';
import { runDispatch } from '../../src/dispatch.js';

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

describe('circleReplyText — the household families read as on the bot', () => {
  // the reply as the waist hands it to the web and mobile circle composer (`runDispatch`), with the op that ran
  const ran = (opId, payload) => runDispatch({ kind: 'ready', opId, appOrigin: 'lists', args: {} }, async () => payload);

  it('an add to a list names the list and the thing — not "Klaar."', async () => {
    const reply = await ran('addToList', { ok: true, itemId: 'i1', kind: 'list-item', entry: 'melk', list: 'Boodschappen', message: 'x' });
    expect(circleReplyText(reply, { verb: 'add', t })).toBe('circle.lists.added:{"text":"melk","name":"Boodschappen"}');
  });

  it('a claimed chore says it is taken, with its day — not "✓ label"', async () => {
    const reply = await ran('claimTask', { ok: true, message: 'x', itemId: 'c1', task: { id: 'c1', text: 'lamp vervangen', assignees: ['me'] } });
    expect(circleReplyText(reply, { verb: 'claim', t })).toBe('circle.reply.chore_claimed:{"title":"lamp vervangen","when":""}');
  });

  it('an op the bot does not reach keeps the bubble it had', async () => {
    const reply = await ran('someOtherOp', { title: 'X' });
    expect(circleReplyText(reply, { verb: 'claim', t })).toBe('circle.bot.ok:{"label":"X"}');
  });
});
