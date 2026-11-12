// A first message from someone the person did not choose is HELD as a request, beside the contact book and never in
// it. The store is the own-devices store the book uses.
import { describe, it, expect, beforeEach } from 'vitest';
import { createMessageRequests, MESSAGE_REQUESTS_MAX, MESSAGE_REQUEST_TURNS_MAX, MESSAGE_REQUEST_TEXT_MAX_BYTES, MESSAGE_REQUEST_IGNORED_KEEP_MS } from '../src/lib/MessageRequests.js';
import { createContactBook } from '../src/lib/ContactBook.js';
import { encodeContactCard } from '../src/lib/contactCard.js';
import { createCircleStores, memoryDataSource } from '@onderling/item-store';

const cardOf = (webid, extra = {}) => `onderling-contact://${encodeContactCard({ webid, pubKey: webid, displayName: `name of ${webid}`, ...extra })}`;
const turn = (from, n, extra = {}) => ({ from, card: cardOf(from), messageId: `${from}-m${n}`, text: `hello ${n}`, ts: 1_000 + n, ...extra });

describe('message requests: held beside the book, bounded', () => {
  let store; let clock; let requests; let book;
  beforeEach(() => {
    store = createCircleStores({ dataSource: memoryDataSource(), rootPrefix: 'mem://own/' }).getStore('own-devices');
    clock = 10_000;
    const selfFor = () => ({ id: 'default', writer: 'me' });
    requests = createMessageRequests({ store: () => store, selfFor, now: () => clock });
    book = createContactBook({ store: () => store, selfFor });
  });

  it('a first turn is a request, not a contact: no book row is written', async () => {
    const r = await requests.hold(turn('stranger', 1));
    expect(r.held).toBe(true);
    expect(r.request).toMatchObject({ from: 'stranger', state: 'open', turns: [{ messageId: 'stranger-m1', text: 'hello 1', ts: 1001 }] });
    expect(r.request.name).toBe('name of stranger');
    expect(await book.listContacts()).toEqual([]);
    expect((await requests.list()).map((q) => q.from)).toEqual(['stranger']);
  });

  it('later turns land on the same request, once each, in order', async () => {
    await requests.hold(turn('s', 2));
    await requests.hold(turn('s', 1));
    await requests.hold(turn('s', 2));   // the same message again (a sibling device, a resend)
    const [q] = await requests.list();
    expect(q.turns.map((t) => t.messageId)).toEqual(['s-m1', 's-m2']);
    expect(q.firstAt).toBe(1001); expect(q.lastAt).toBe(1002);
  });

  it('a card that does not decode, or names someone other than the sender, is refused', async () => {
    expect(await requests.hold({ ...turn('s', 1), card: 'onderling-contact://nonsense' })).toEqual({ held: false, reason: 'malformed-card' });
    expect(await requests.hold({ ...turn('s', 1), card: cardOf('someone-else') })).toEqual({ held: false, reason: 'card-not-sender' });
    expect(await requests.list()).toEqual([]);
  });

  it('a file on a request is refused with its own reason', async () => {
    expect(await requests.hold(turn('s', 1, { file: { name: 'x.jpg' } }))).toEqual({ held: false, reason: 'file-on-request' });
    expect(await requests.list()).toEqual([]);
  });

  it(`keeps at most ${MESSAGE_REQUEST_TURNS_MAX} turns per request: the oldest goes`, async () => {
    for (let n = 1; n <= MESSAGE_REQUEST_TURNS_MAX + 3; n += 1) await requests.hold(turn('s', n));
    const [q] = await requests.list();
    expect(q.turns).toHaveLength(MESSAGE_REQUEST_TURNS_MAX);
    expect(q.turns[0].messageId).toBe('s-m4');
    expect(q.turnsBefore).toBe(1004);
  });

  it(`keeps at most ${MESSAGE_REQUEST_TEXT_MAX_BYTES} bytes of text per request: the oldest turns go`, async () => {
    const big = 'x'.repeat(Math.floor(MESSAGE_REQUEST_TEXT_MAX_BYTES / 2) - 10);
    for (let n = 1; n <= 3; n += 1) await requests.hold(turn('s', n, { text: big }));
    const [q] = await requests.list();
    expect(q.turns.map((t) => t.messageId)).toEqual(['s-m2', 's-m3']);
    // one turn larger than the whole bound is refused, not truncated
    expect(await requests.hold(turn('t', 1, { text: 'y'.repeat(MESSAGE_REQUEST_TEXT_MAX_BYTES + 1) }))).toEqual({ held: false, reason: 'turn-too-large' });
  });

  it(`keeps at most ${MESSAGE_REQUESTS_MAX} requests per self: an ignored one goes first, then the oldest open`, async () => {
    for (let n = 1; n <= MESSAGE_REQUESTS_MAX; n += 1) { clock += 1; await requests.hold(turn(`s${n}`, 1, { ts: clock })); }
    await requests.ignore('s7');
    clock += 1; await requests.hold(turn('newcomer', 1, { ts: clock }));
    let froms = (await requests.list()).map((q) => q.from);
    expect(froms).toHaveLength(MESSAGE_REQUESTS_MAX);
    expect(froms).not.toContain('s7');
    clock += 1; await requests.hold(turn('another', 1, { ts: clock }));
    froms = (await requests.list()).map((q) => q.from);
    expect(froms).toHaveLength(MESSAGE_REQUESTS_MAX);
    expect(froms).not.toContain('s1');
    expect(froms).toContain('another');
  });

  it('ignore keeps the request, marked; later turns still land and it can still be read', async () => {
    await requests.hold(turn('s', 1));
    expect((await requests.ignore('s')).state).toBe('ignored');
    await requests.hold(turn('s', 2));
    const [q] = await requests.list();
    expect(q.state).toBe('ignored');
    expect(q.turns).toHaveLength(2);
    expect(await requests.ignore('nobody')).toBeNull();
  });

  it(`an ignored request goes ${MESSAGE_REQUEST_IGNORED_KEEP_MS / 86_400_000} days after its last turn; an open one stays`, async () => {
    await requests.hold(turn('ig', 1, { ts: clock }));
    await requests.hold(turn('op', 1, { ts: clock }));
    await requests.ignore('ig');
    clock += MESSAGE_REQUEST_IGNORED_KEEP_MS + 1;
    expect((await requests.list()).map((q) => q.from)).toEqual(['op']);
  });

  it('remove takes a request out (what accept does once the card is a contact)', async () => {
    await requests.hold(turn('s', 1));
    expect(await requests.remove('s')).toBe(true);
    expect(await requests.remove('s')).toBe(false);
    expect(await requests.list()).toEqual([]);
  });

  it('requests are per self: each self holds its own, written as that self', async () => {
    const selves = { work: { id: 'work', writer: 'me-work' }, null: { id: 'default', writer: 'me' } };
    const perSelf = createMessageRequests({ store: () => store, selfFor: (p) => selves[p ?? 'null'] ?? null, now: () => clock });
    await perSelf.hold({ ...turn('s', 1), persona: 'work' });
    await perSelf.hold(turn('s', 2));
    expect((await perSelf.list()).map((q) => [q.self, q.from, q.turns.length])).toEqual([['default', 's', 1]]);
    expect((await perSelf.list({ persona: 'work' })).map((q) => [q.self, q.from, q.turns.length])).toEqual([['work', 's', 1]]);
    expect((await store.listByType('message-request')).map((r) => r.createdBy).sort()).toEqual(['me', 'me-work']);
    expect(await perSelf.hold({ ...turn('s', 3), persona: 'unknown' })).toEqual({ held: false, reason: 'no-self' });
  });
});
