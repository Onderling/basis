import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EventLog } from '../../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../../src/v2/botThreads.js';
import { createPlusThread, plusThreadId, plusAnswerLine } from '../../src/v2/plusThread.js';
import { PLUS_ACTS } from '../../src/v2/vandaagPlus.js';
import { forYouRows } from '../../src/v2/userScreenBlocks.js';
import { entryKind } from '@onderling/item-store';

// The "+" is the person's assistant thread: what they type and what it answered are KEPT (the bot's own turn entries
// on the device log, the chat retention class), so the sheet opens on the conversation so far.
const boot = (log = new EventLog({ initial: [], muted: [] })) => {
  const threads = createBotThreads({ eventLog: log, store: memoryThreadStore() });
  return { log, threads, plus: createPlusThread({ threads, threadId: plusThreadId('me') }) };
};

describe('the "+" thread: one kept conversation', () => {
  it('keeps what the person typed and what it answered, oldest first', () => {
    const { plus } = boot();
    plus.heard('zet melk op de boodschappen');
    plus.answered('✓ melk staat op Boodschappen');
    plus.heard('herinner me morgen aan de vuilnis');
    expect(plus.turns().map((x) => [x.who, x.text])).toEqual([
      ['you', 'zet melk op de boodschappen'],
      ['assistant', '✓ melk staat op Boodschappen'],
      ['you', 'herinner me morgen aan de vuilnis'],
    ]);
  });

  it('survives a restart: a new composition over the same log opens on the same conversation', () => {
    const { log, plus } = boot();
    plus.heard('hoi');
    plus.answered('Hoi! Wat kan ik doen?');
    // a reload hands the stored entries back as kept (newest first)
    const again = boot(new EventLog({ initial: log.query({}), muted: [] })).plus;
    expect(again.turns().map((x) => x.text)).toEqual(['hoi', 'Hoi! Wat kan ik doen?']);
  });

  it('shows at most the last N turns', () => {
    const { plus } = boot();
    for (let i = 0; i < 30; i += 1) plus.heard(`regel ${i}`);
    const shown = plus.turns(5);
    expect(shown.map((x) => x.text)).toEqual(['regel 25', 'regel 26', 'regel 27', 'regel 28', 'regel 29']);
  });

  it('forget empties this thread only, never a circle line or another thread', () => {
    const { log, threads, plus } = boot();
    plus.heard('weg ermee');
    threads.memory.remember('telegram:42', 'you', 'van iemand anders');
    log.append({ id: 'c1', type: 'chat-message', app: 'basis', ts: Date.now(), actor: 'x', payload: { circleId: 'kring', text: 'kringregel' } });
    expect(plus.forget()).toBe(1);
    expect(plus.turns()).toEqual([]);
    expect(threads.memory.recent('telegram:42')).toEqual(['you: van iemand anders']);
    expect(log.query({}).some((e) => e.id === 'c1')).toBe(true);
  });

  it('keeps nothing with memory off (the person chose a thread that forgets)', () => {
    const { threads, plus } = boot();
    threads.setMode(plusThreadId('me'), 'off');
    plus.heard('niet bewaren');
    expect(plus.turns()).toEqual([]);
  });

  it('a person without a self has no thread (nothing is kept under an empty id)', () => {
    expect(plusThreadId(null)).toBeNull();
    expect(plusThreadId('')).toBeNull();
  });

  it('a "+" turn is the person\'s own: it never shows as news ("Nieuw voor jou") beside the circles', () => {
    const { log, plus } = boot();
    plus.heard('zet melk op de boodschappen');
    plus.answered('✓ melk staat op Boodschappen');
    log.append({ id: 'c1', type: 'chat-message', app: 'basis', ts: Date.now(), actor: 'bram', payload: { circleId: 'kring', text: 'hoi allemaal' } });
    const rows = forYouRows({ eventLog: log, circles: [{ id: 'kring', name: 'Kring', kind: 'circle' }], myRefs: ['me'], t: (k) => k });
    const ids = rows.map((r) => r.id);
    expect(ids, 'the circle line is news').toContain('c1');
    expect(ids.filter((id) => String(id).startsWith('bot-turn:')), 'a "+" turn shown as news').toEqual([]);
  });

});

describe('what the "+" answers in its thread', () => {
  const t = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);
  it('what went wrong first, then what a circle act did, then the which-circle question, then the act it read', () => {
    expect(plusAnswerLine({ error: 'mislukt', done: 'gedaan', t })).toBe('mislukt');
    expect(plusAnswerLine({ done: '✓ melk staat op Boodschappen', t })).toBe('✓ melk staat op Boodschappen');
    expect(plusAnswerLine({ circleCard: { line: 'nieuwe taak verven' }, t })).toBe('circle.vandaag.plus_circle_ask:{"line":"nieuwe taak verven"}');
    expect(plusAnswerLine({ ownActId: PLUS_ACTS[0].id, t })).toBeTruthy();
    expect(plusAnswerLine({ t })).toBeNull();
  });
});

describe('one exchange in the "+" thread (the duty both shells run)', () => {
  const t = (k) => k;
  it('a typed line: heard, the read run, its answer kept; the read result handed back', async () => {
    const { plus } = boot();
    const r = await plus.exchange('blauwe olifanten dansen', async () => ({ error: 'circle.vandaag.plus_line_unread' }), { t });
    expect(r).toEqual({ error: 'circle.vandaag.plus_line_unread' });
    expect(plus.turns().map((x) => [x.who, x.text])).toEqual([['you', 'blauwe olifanten dansen'], ['assistant', 'circle.vandaag.plus_line_unread']]);
  });

  it('a pick on the card (no new line): only the answer is kept; the phone shape {card} words the question', async () => {
    const { plus } = boot();
    await plus.exchange(null, async () => ({ done: '✓ verf kopen staat bij Taken' }), { t });
    await plus.exchange('nieuwe taak verven', async () => ({ card: { line: 'nieuwe taak verven', to: [] } }), { t });
    expect(plus.turns().map((x) => x.text)).toEqual(['✓ verf kopen staat bij Taken', 'nieuwe taak verven', 'circle.vandaag.plus_circle_ask']);
  });

  it('a run with nothing to say keeps only the line', async () => {
    const { plus } = boot();
    await plus.exchange('iets', async () => null, { t });
    expect(plus.turns().map((x) => x.who)).toEqual(['you']);
  });

  it('reads ONE result shape, {error, done, card, actId} (what the shared readers and the phone sheet speak); no other spelling', async () => {
    const { plus } = boot();
    await plus.exchange('a', async () => ({ actId: PLUS_ACTS[0].id }), { t });
    await plus.exchange('b', async () => ({ circleCard: { line: 'b', to: [] } }), { t });
    await plus.exchange('c', async () => ({ ownActId: PLUS_ACTS[0].id }), { t });
    expect(plus.turns().map((x) => x.who)).toEqual(['you', 'assistant', 'you', 'you']);
  });

  it('both shells hand it that shape: web\'s read returns card and actId, never circleCard or ownActId', () => {
    const web = readFileSync(fileURLToPath(new URL('../../web/v2/circleApp.js', import.meta.url)), 'utf8');
    const at = web.indexOf('await plusThreadNow().exchange(text,');
    expect(at).toBeGreaterThan(-1);
    const body = web.slice(at, web.indexOf('}, { t });', at));
    expect(body).toMatch(/return \{ error, card: circleCard, actId: /);
    expect(body).not.toMatch(/ownActId/);
  });
});

describe('where a "+" turn goes', () => {
  it('it is never carried: no member, no own other device (the dictionary\'s sync policy for the kind)', () => {
    expect(entryKind('assistant-turn').syncPolicy).toBe('none');
  });
});
