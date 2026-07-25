/**
 * basis — profile-update propagation Wave B: the diff-gate + pull-me on the persona-props path.
 *
 * Proves the two hard rules end to end at the orchestrator + admin-handler level:
 *   • open-and-save-unchanged is a TRUE no-op — no send, no roster write, no entry;
 *   • a real change writes the roster then announces exactly one pull-me (member ref + changed
 *     keys, no values);
 *   • reveal-gating holds — a prop the persona does NOT disclose to the circle never travels.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  shareDisclosureToCircle,
  createDisclosureShareMemo,
  makeHandlePersonaPropsUpdate,
} from '../src/core/handlers/personaPropsUpdate.js';

/** A callSkill stub whose release + roster shape the test controls. */
function makeMemberCallSkill({ released, admin = null, recordResult = { ok: true } }) {
  const calls = [];
  const callSkill = vi.fn(async (app, op, args) => {
    calls.push([op, args]);
    if (op === 'getPersonaRelease') return { released };
    if (op === 'listGroupRoster') return { members: admin ? [{ addr: admin, role: 'admin' }] : [] };
    if (op === 'recordMemberPersonaProperties') return recordResult;
    return { ok: true };
  });
  return { callSkill, calls };
}

describe('member-side diff-gate (shareDisclosureToCircle)', () => {
  it('open-and-save-UNCHANGED is a true no-op: no send, no roster write, no entry', async () => {
    const released = { place: 'Groningen' };
    const memo = createDisclosureShareMemo();
    await memo.set('c1', 'default', released);            // I already shared exactly this

    const sendPersonaUpdate = vi.fn(async () => ({ ok: true }));
    const announceRosterUpdate = vi.fn();
    const { callSkill, calls } = makeMemberCallSkill({ released, admin: 'admin.addr' });

    const r = await shareDisclosureToCircle({
      callSkill, sendPersonaUpdate, circleId: 'c1', personaId: 'default',
      lastShared: memo, announceRosterUpdate,
    });

    expect(r).toEqual({ ok: true, via: 'none', unchanged: true, changedKeys: [] });
    expect(sendPersonaUpdate).not.toHaveBeenCalled();
    expect(announceRosterUpdate).not.toHaveBeenCalled();
    // never even reached the roster / admin lookup — pure short-circuit after the release read.
    expect(calls.map(([op]) => op)).toEqual(['getPersonaRelease']);
  });

  it('a REAL change on the LOCAL (I-am-admin) path writes the roster then announces the pull-me', async () => {
    const memo = createDisclosureShareMemo();
    await memo.set('c1', 'default', { place: 'Assen' });   // previously shared something else
    const announceRosterUpdate = vi.fn(async () => {});
    const { callSkill } = makeMemberCallSkill({
      released: { place: 'Groningen' }, admin: null,        // no remote admin ⇒ I AM the admin
      recordResult: { ok: true, changedKeys: ['place'], memberWebid: 'me.webid' },
    });

    const r = await shareDisclosureToCircle({
      callSkill, circleId: 'c1', personaId: 'default', lastShared: memo, announceRosterUpdate,
    });

    expect(r).toMatchObject({ ok: true, via: 'local', changedKeys: ['place'] });
    expect(announceRosterUpdate).toHaveBeenCalledWith({
      circleId: 'c1', memberRef: 'me.webid', keys: ['place'],
    });
  });

  it('reveal-gating: only the persona RELEASE for the circle ever travels', async () => {
    // The persona holds realName privately; the release for THIS circle exposes only place.
    const { callSkill } = makeMemberCallSkill({ released: { place: 'Groningen' }, admin: 'admin.addr' });
    const sendPersonaUpdate = vi.fn(async () => ({ ok: true }));
    await shareDisclosureToCircle({
      callSkill, sendPersonaUpdate, circleId: 'c1', personaId: 'default',
      lastShared: createDisclosureShareMemo(),
    });
    const sent = sendPersonaUpdate.mock.calls[0][0];
    expect(sent.personaProperties).toEqual({ place: 'Groningen' });
    expect(JSON.stringify(sent)).not.toContain('realName');
  });
});

describe('member-side media re-seal (shareDisclosureToCircle + resealMediaForCircle)', () => {
  // A stand-in resealer: turns a source ref into a circle-sealed copy ref, recording
  // which circle it was asked to seal for. (The real one opens+re-seals+re-uploads the
  // blob; here we only assert the WIRING — source stays on the gate/memo, the resealed
  // copy is what leaves.)
  function makeReseal() {
    const seenCircles = [];
    const resealMediaForCircle = vi.fn(async (props, circleId) => {
      seenCircles.push(circleId);
      const out = { ...props };
      for (const k of Object.keys(out)) {
        if (out[k] && typeof out[k] === 'object' && out[k].__mediaSource) {
          out[k] = { ref: `sealed://${circleId}/${out[k].ref}`, sealedFor: circleId };
        }
      }
      return out;
    });
    return { resealMediaForCircle, seenCircles };
  }
  const SOURCE_PIC = { __mediaSource: true, ref: 'self-pic-1' };

  it('the OUTBOUND value carries the circle-sealed copy, not the self-sealed source', async () => {
    const { callSkill } = makeMemberCallSkill({
      released: { handle: 'jan', profilePicture: SOURCE_PIC }, admin: 'admin.addr',
    });
    const sendPersonaUpdate = vi.fn(async () => ({ ok: true }));
    const { resealMediaForCircle, seenCircles } = makeReseal();

    await shareDisclosureToCircle({
      callSkill, sendPersonaUpdate, circleId: 'c1', personaId: 'default',
      lastShared: createDisclosureShareMemo(), resealMediaForCircle,
    });

    expect(seenCircles).toEqual(['c1']);
    const sent = sendPersonaUpdate.mock.calls[0][0];
    // circle-sealed copy travels; the self-sealed source ref never leaves.
    expect(sent.personaProperties.profilePicture).toEqual({ ref: 'sealed://c1/self-pic-1', sealedFor: 'c1' });
    expect(JSON.stringify(sent)).not.toContain('__mediaSource');
    expect(sent.personaProperties.handle).toBe('jan');       // non-media props pass through
  });

  it('the memo + diff-gate track the SOURCE — an unchanged picture is a no-op (no re-seal)', async () => {
    const memo = createDisclosureShareMemo();
    await memo.set('c1', 'default', { handle: 'jan', profilePicture: SOURCE_PIC }); // already shared this source
    const sendPersonaUpdate = vi.fn(async () => ({ ok: true }));
    const { resealMediaForCircle, seenCircles } = makeReseal();
    const { callSkill } = makeMemberCallSkill({
      released: { handle: 'jan', profilePicture: SOURCE_PIC }, admin: 'admin.addr',
    });

    const r = await shareDisclosureToCircle({
      callSkill, sendPersonaUpdate, circleId: 'c1', personaId: 'default',
      lastShared: memo, resealMediaForCircle,
    });

    expect(r).toEqual({ ok: true, via: 'none', unchanged: true, changedKeys: [] });
    expect(sendPersonaUpdate).not.toHaveBeenCalled();
    expect(seenCircles).toEqual([]);                          // short-circuited BEFORE any re-seal
  });

  it('a re-seal that DROPS the media prop (failed copy) never leaks the source ref', async () => {
    const { callSkill } = makeMemberCallSkill({
      released: { handle: 'jan', profilePicture: SOURCE_PIC }, admin: 'admin.addr',
    });
    const sendPersonaUpdate = vi.fn(async () => ({ ok: true }));
    // resealer drops the media prop (mirrors resealPicForCircle returning null → delete).
    const resealMediaForCircle = vi.fn(async (props) => {
      const out = { ...props }; delete out.profilePicture; return out;
    });

    await shareDisclosureToCircle({
      callSkill, sendPersonaUpdate, circleId: 'c1', personaId: 'default',
      lastShared: createDisclosureShareMemo(), resealMediaForCircle,
    });

    const sent = sendPersonaUpdate.mock.calls[0][0];
    expect(sent.personaProperties).toEqual({ handle: 'jan' }); // pic dropped, not leaked as source
    expect(JSON.stringify(sent)).not.toContain('self-pic-1');
  });
});

describe('admin-side handler: diff-gate + pull-me', () => {
  function makeAdmin({ recordResult }) {
    const callSkill = vi.fn(async (_app, op) => (op === 'recordMemberPersonaProperties' ? recordResult : { ok: true }));
    const sent = [];
    const sendPeer = vi.fn(async (addr, payload) => { sent.push([addr, payload]); });
    const announceRosterUpdate = vi.fn(async () => {});
    const handle = makeHandlePersonaPropsUpdate({ callSkill, sendPeer, announceRosterUpdate });
    return { handle, sendPeer, sent, announceRosterUpdate };
  }

  it('a REAL roster change → announce ONE pull-me with the changed keys + ack ok', async () => {
    const { handle, sent, announceRosterUpdate } = makeAdmin({
      recordResult: { ok: true, changedKeys: ['place'] },
    });
    await handle('app.member.test', {
      requestId: 'pp-1', groupId: 'c1', personaProperties: { place: 'Groningen' },
    });
    expect(announceRosterUpdate).toHaveBeenCalledTimes(1);
    expect(announceRosterUpdate).toHaveBeenCalledWith({
      circleId: 'c1', memberRef: 'app.member.test', keys: ['place'],
    });
    expect(sent[0][1]).toMatchObject({ subtype: 'persona-props-ack', requestId: 'pp-1', ok: true });
  });

  it('an UNCHANGED roster (unchanged:true) announces NOTHING but still acks ok', async () => {
    const { handle, sent, announceRosterUpdate } = makeAdmin({
      recordResult: { ok: true, unchanged: true, changedKeys: [] },
    });
    await handle('app.member.test', {
      requestId: 'pp-2', groupId: 'c1', personaProperties: { place: 'Groningen' },
    });
    expect(announceRosterUpdate).not.toHaveBeenCalled();
    expect(sent[0][1]).toMatchObject({ subtype: 'persona-props-ack', requestId: 'pp-2', ok: true, unchanged: true });
  });

  it('a record FAILURE announces nothing and acks the error', async () => {
    const { handle, sent, announceRosterUpdate } = makeAdmin({
      recordResult: { ok: false, reason: 'not-a-member' },
    });
    await handle('x', { requestId: 'pp-3', groupId: 'c1', personaProperties: {} });
    expect(announceRosterUpdate).not.toHaveBeenCalled();
    expect(sent[0][1]).toMatchObject({ subtype: 'persona-props-ack', error: 'not-a-member' });
  });
});
