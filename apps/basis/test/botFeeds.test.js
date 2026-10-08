/**
 * The bot keeps each person's agenda link filled: a new link always (the old file dropped), a push after an appointment
 * changes (a burst is one push), the file dropped when the person is revoked or the admin switches it off.
 */
import { describe, it, expect } from 'vitest';
import { openForLink } from '@onderling/blob-gateway';
import { createBotFeeds } from '../src/v2/botFeeds.js';

const NODE = 'N'.repeat(43);

function rig({ putOk = true, companion = { node: NODE, base: 'https://relay.example.org' } } = {}) {
  const rows = new Map();
  const threads = {
    feedLinkOf: (id) => rows.get(id) ?? null,
    setFeedLink: async (id, link) => { if (link) rows.set(id, link); else rows.delete(id); },
    feedPeople: () => [...rows.keys()],
  };
  const bucket = new Map();
  const dropped = [];
  const asked = [];
  let timer = null;
  let events = [{ id: 'e1', type: 'calendar-event', title: 'Tandarts', startsAt: new Date(Date.now() + 86_400_000).toISOString(), createdBy: 'p1' }];
  const people = [{ id: 'p1' }, { id: 'p2' }];
  const feeds = createBotFeeds({
    threads, events: async () => events, people: async () => people, calendarName: async () => 'Huishouden',
    // where the links are served: the companion the bot holds as a contact (its address, and where it serves)
    companion: async () => companion,
    put: async (node, id, env) => { asked.push(node); if (!putOk) return { ok: false }; bucket.set(id, env); return { ok: true }; },
    drop: async (node, id) => { asked.push(node); dropped.push(id); bucket.delete(id); return { ok: true }; },
    setTimer: (fn) => { timer = fn; return 1; }, clearTimer: () => { timer = null; },
  });
  return { feeds, rows, bucket, dropped, asked, fire: async () => { const f = timer; timer = null; await f?.(); await new Promise((r) => { setTimeout(r, 0); }); }, setEvents: (e) => { events = e; }, people };
}

describe('the bot\'s agenda links', () => {
  it('a new link every time: the file is there under its id, the old one dropped', async () => {
    const r = rig();
    const a = await r.feeds.mint('p1');
    expect(a.ok).toBe(true);
    // the link names the companion the file is on, at the address its contact says it serves
    expect(a.urls.https).toMatch(new RegExp(`^https://relay\\.example\\.org/feed/${NODE}/[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{22}\\.ics$`));
    expect(new Set(r.asked)).toEqual(new Set([NODE]));
    expect(a.urls.webcal).toMatch(/^webcal:\/\//);
    const first = r.rows.get('p1');
    expect(openForLink(r.bucket.get(first.id), first.k)).toContain('SUMMARY:Tandarts');
    const b = await r.feeds.mint('p1');
    expect(b.urls.https).not.toBe(a.urls.https);
    expect(r.dropped).toEqual([first.id]);
    expect(r.bucket.has(first.id)).toBe(false);
  });

  it('no companion among the bot\'s contacts: no link, and nothing asked', async () => {
    const r = rig({ companion: null });
    expect(await r.feeds.mint('p1')).toEqual({ ok: false, reason: 'no-companion' });
    expect(r.asked).toEqual([]);
    expect(r.rows.has('p1')).toBe(false);
  });

  it('a companion that refuses: no link is kept, and the old one stands', async () => {
    const r = rig({ putOk: false });
    expect(await r.feeds.mint('p1')).toEqual({ ok: false, reason: 'companion' });
    expect(r.rows.has('p1')).toBe(false);
  });

  it('an appointment changes: one push for a burst, every link re-rendered; other items push nothing', async () => {
    const r = rig();
    await r.feeds.mint('p1');
    const link = r.rows.get('p1');
    r.feeds.touched({ after: { type: 'task' } });
    await r.fire();
    expect(openForLink(r.bucket.get(link.id), link.k)).not.toContain('Kapper');
    r.setEvents([{ id: 'e2', type: 'calendar-event', title: 'Kapper', startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), createdBy: 'p1' }]);
    r.feeds.touched({ after: { type: 'calendar-event' } });
    r.feeds.touched({ before: { type: 'calendar-event' }, after: null });
    await r.fire();
    expect(openForLink(r.bucket.get(link.id), link.k)).toContain('SUMMARY:Kapper');
  });

  it('revoked or switched off: the file dropped and the link forgotten', async () => {
    const r = rig();
    await r.feeds.mint('p1'); await r.feeds.mint('p2');
    const p1 = r.rows.get('p1');
    await r.feeds.end('p1');
    expect(r.bucket.has(p1.id)).toBe(false);
    expect(r.rows.has('p1')).toBe(false);
    await r.feeds.endAll();
    expect(r.rows.size).toBe(0);
    expect(r.bucket.size).toBe(0);
  });

  it('a person no longer in the household is not pushed', async () => {
    const r = rig();
    await r.feeds.mint('p2');
    const p2 = r.rows.get('p2');
    r.people.splice(1, 1);
    r.bucket.delete(p2.id);
    await r.feeds.pushAll();
    expect(r.bucket.has(p2.id)).toBe(false);
  });
});

describe('/agenda-link with no companion among the bot\'s contacts', () => {
  it('says this household has no agenda link — not "try again later"', async () => {
    const { withAssistantOps } = await import('../src/v2/assistantOps.js');
    const { createBotThreads, memoryThreadStore } = await import('../src/v2/botThreads.js');
    const { EventLog } = await import('../src/eventLog.js');
    const t = (k) => k;
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    const feeds = createBotFeeds({ threads, events: async () => [], people: async () => [{ id: 'telegram:1' }], companion: async () => null, put: async () => ({ ok: true }), drop: async () => ({ ok: true }) });
    const sent = [];
    const callSkill = async (app, op) => (app === 'params' && op === 'list-user-params' ? { params: [{ key: 'assistant.calendarFeed', value: 'on' }] } : null);
    const door = withAssistantOps({ callSkill, threads, t, admin: { feeds, sendPrivately: async (...a) => { sent.push(a); return { ok: true }; } } });
    const r = await door('assistant', 'assistant-agenda-link', {}, { caller: 'telegram:1', threadId: 'telegram:1' });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('no-companion');
    expect(r.error.message).toBe('circle.bot.agenda_link_none_here');
    expect(sent).toEqual([]);
  });
});
