import { describe, it, expect } from 'vitest';
import { EventLog } from '../../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../../src/v2/botThreads.js';
import { createPlusThread, plusThreadId } from '../../src/v2/plusThread.js';

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
});
