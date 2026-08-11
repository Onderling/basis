import { describe, it, expect } from 'vitest';
import { migrateKringChatHistory } from '../../src/v2/kringChatRehydrate.js';

// The blessed no-backcompat exception: chat history gets a REAL one-time migration (store copy →
// persisted device log). The latch's promises: it runs the pass once; a FAILED pass leaves the latch
// unset (retry next boot — history must not be silently lost); a latched device never reads the store's
// chat rows again.

// The strict rehydrator contract: `text` on the ITEM, msgId/circleId/ts on `source`.
const item = (msgId) => ({ id: msgId, type: 'kring-chat-message', text: `msg ${msgId}`, source: { circleId: 'c1', msgId, ts: 1, fromActor: 'ada' } });

function fakeInbox() {
  const inserted = [];
  return {
    inserted,
    ingestChatMessage: async (env) => { inserted.push(env.msgId); return { result: 'inserted' }; },
  };
}
function memMarker() {
  let v = null;
  return { get: async () => v, set: async (x) => { v = x; }, peek: () => v };
}

describe('the one-time chat-history migration', () => {
  it('migrates the store history ONCE and latches; a second boot skips without touching the store', async () => {
    const inbox = fakeInbox();
    const marker = memMarker();
    let storeReads = 0;
    const callSkill = async (app, op) => { storeReads += 1; return { items: [item('m1'), item('m2')] }; };

    const first = await migrateKringChatHistory({ callSkill, inbox, marker });
    expect(first.migrated).toBe(true);
    expect(first.rehydrated).toBe(2);
    expect(marker.peek()).toBeTruthy();                 // latched on success

    const second = await migrateKringChatHistory({ callSkill, inbox, marker });
    expect(second).toEqual({ migrated: false, alreadyDone: true });
    expect(storeReads).toBe(1);                         // the store was never read again
  });

  it('a FAILED pass does NOT latch — history is retried, never silently lost', async () => {
    const inbox = fakeInbox();
    const marker = memMarker();
    let attempt = 0;
    const callSkill = async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('store unreachable');
      return { items: [item('m1')] };
    };

    const failed = await migrateKringChatHistory({ callSkill, inbox, marker, logger: { warn() {}, info() {} } });
    expect(failed.migrated).toBe(false);
    expect(marker.peek()).toBeNull();                   // NOT latched

    const retried = await migrateKringChatHistory({ callSkill, inbox, marker, logger: { warn() {}, info() {} } });
    expect(retried.migrated).toBe(true);                // the next boot completed it
    expect(inbox.inserted).toEqual(['m1']);
  });

  it('a missing marker io is refused loudly rather than migrating unlatched forever', async () => {
    const res = await migrateKringChatHistory({ callSkill: async () => ({ items: [] }), inbox: fakeInbox() });
    expect(res.migrated).toBe(false);
    expect(res.error).toMatch(/marker/);
  });
});
