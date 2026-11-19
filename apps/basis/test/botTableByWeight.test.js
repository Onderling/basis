/**
 * THE HOUSEHOLD BOT'S TABLE AGREES WITH THE WEIGHT (ledger L977, D.3c; Fable's rulings 2026-11-19). Per role, every op
 * on its column weighs what the role may do: observer 1+2 (2 = a person's own conversation things at the box), member
 * 1+2+3, admin 1+2+3+5. An op that must differ is an EXCEPTION named in its manifest row with its reason, and the
 * exceptions are a closed list pinned here. An exception runs only from the person's own private chat, on their own
 * typed command or button, never as a model's pick (it has no chat surface). The bot's model never picks 4 to 6.
 */
import { describe, it, expect } from 'vitest';
import { opWeight, isGenericOpId } from '@onderling/app-manifest';
import { BOT_OP_MAP } from '../src/v2/botOpMap.js';
import { catalogueManifests } from '../src/v2/manifestSources.js';
import { assistantManifest } from '../src/v2/assistantManifest.js';
import { synthesizeGenericOps } from '../src/genericOpSynth.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { createBotUsers } from '../src/v2/botUsers.js';

const MANIFESTS = [...catalogueManifests(), assistantManifest];
const rowOf = (q) => {
  const id = q.includes('.') && !isGenericOpId(q) ? q.slice(q.indexOf('.') + 1) : q;
  for (const m of MANIFESTS) { const o = [...(m.operations ?? []), ...synthesizeGenericOps(m)].find((x) => x.id === id); if (o) return { m, o }; }
  return null;
};
const ROLE_WEIGHTS = { observer: [1, 2], member: [1, 2, 3], admin: [1, 2, 3, 5] };
const EXCEPTIONS = ['assistant-screen', 'assistant-screens', 'assistant-screen-confirm', 'assistant-screen-paste',
  'assistant-link', 'assistant-link-confirm', 'assistant-unlink', 'assistant-inapp'];

describe("the bot's table and the weight", () => {
  it('the exceptions are a closed list, each with its reason, none a model may pick', () => {
    const declared = assistantManifest.operations.filter((o) => o.botException).map((o) => o.id).sort();
    expect(declared).toEqual([...EXCEPTIONS].sort());
    for (const o of assistantManifest.operations.filter((x) => x.botException)) {
      expect(typeof o.botException === 'string' && o.botException.length > 20, o.id).toBe(true);
      expect(o.surfaces?.chat, `${o.id}: no chat surface, so never a model's pick`).toBeUndefined();
    }
  });

  it('every op on a role\'s column weighs what that role may do, or is a named exception', () => {
    const off = [];
    for (const [role, ops] of Object.entries(BOT_OP_MAP)) {
      for (const q of ops) {
        const r = rowOf(q);
        const w = r ? opWeight(r.m, r.o) : null;
        if (ROLE_WEIGHTS[role].includes(w)) continue;
        if (r?.o?.botException) continue;
        off.push(`${role}: ${q} = ${w}`);
      }
    }
    expect(off).toEqual([]);
  });

  it("the bot's model is never handed an op of weight 4 to 6", () => {
    const heavy = [];
    for (const ops of Object.values(BOT_OP_MAP)) {
      for (const q of ops) {
        const r = rowOf(q);
        if (r?.o?.surfaces?.chat && (opWeight(r.m, r.o) ?? 6) > 3) heavy.push(q);
      }
    }
    expect([...new Set(heavy)]).toEqual([]);
  });
});

describe('an exception runs only from the person\'s own private chat', () => {
  const t = (k) => k;
  async function door() {
    const m = new Map();
    const store = { get: async (id) => m.get(id) ?? null, put: async (row) => { m.set(row.id, { ...row }); return row; }, list: async () => [...m.values()], hide: async () => {} };
    const users = createBotUsers({ store });
    await users.admit({ channel: 'telegram', uid: '42', displayName: 'Ann' });
    return withAssistantOps({ callSkill: async () => ({ params: [] }), t, refusal: async () => null, threads: { langOf: () => null }, admin: { users: async () => users.list() } });
  }
  it('from a group chat each one is refused before it runs', async () => {
    const call = await door();
    for (const op of EXCEPTIONS) {
      const r = await call('assistant', op, {}, { caller: 'telegram:42', threadId: 'telegram:42', chatId: '-100777' });
      expect(r?.error?.code, op).toBe('not-private');
    }
  });
  it('from the private chat none is refused for that', async () => {
    const call = await door();
    for (const op of EXCEPTIONS) {
      const r = await Promise.resolve(call('assistant', op, {}, { caller: 'telegram:42', threadId: 'telegram:42', chatId: '42' })).catch(() => null);
      expect(r?.error?.code ?? null, op).not.toBe('not-private');
    }
  });
});
