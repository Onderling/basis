/**
 * THE PERSONA PROPERTIES TRAVEL ON THE MEMBERSHIP LANE (step two of `NOTE-member-props-on-the-membership-lane.md`,
 * 2026-09-22). "Share to this circle" under About me computes the persona's RELEASE for the circle (reveal-gated, media
 * re-sealed to the circle by reference) and says it as ONE `member-props` statement on that circle's lane — folded on
 * every member's device, the roster row's `personaProperties`. No admin in the loop any more: the admin-mediated
 * `persona-props-update` wire (its two handlers, the ack, the pending map, the pull-me the admin announced) is retired.
 *
 * The two hard rules of the old wire hold unchanged: open-and-save-UNCHANGED is a true no-op (the memo's diff gate,
 * on the self-sealed SOURCE), and reveal-gating — a property the persona does not disclose to the circle never travels.
 */
import { describe, it, expect, vi } from 'vitest';
import { shareDisclosureToCircle, createDisclosureShareMemo } from '../src/core/handlers/personaPropsUpdate.js';

const callSkillWith = (released) => vi.fn(async (app, op) => (op === 'getPersonaRelease' ? { released } : { ok: true }));
const emitter = (result = { ok: true, emitted: ['c1'], unchanged: [], failed: [] }) => vi.fn(async () => result);

describe('shareDisclosureToCircle — on the lane', () => {
  it('a REAL change says the release as member-props on THAT circle; the memo remembers the source', async () => {
    const memo = createDisclosureShareMemo();
    await memo.set('c1', 'default', { place: 'Assen' });
    const emitMemberProps = emitter();
    const r = await shareDisclosureToCircle({ callSkill: callSkillWith({ place: 'Groningen' }), emitMemberProps, circleId: 'c1', personaId: 'default', lastShared: memo });
    expect(r).toEqual({ ok: true, via: 'lane', changedKeys: ['place'] });
    expect(emitMemberProps).toHaveBeenCalledWith({ circleIds: ['c1'], props: { personaProperties: { place: 'Groningen' } } });
    expect(await memo.get('c1', 'default')).toEqual({ place: 'Groningen' });
  });
  it('open-and-save-UNCHANGED is a true no-op: nothing said, nothing re-sealed', async () => {
    const memo = createDisclosureShareMemo();
    await memo.set('c1', 'default', { place: 'Groningen' });
    const emitMemberProps = emitter(); const reseal = vi.fn(async (p) => p);
    const callSkill = callSkillWith({ place: 'Groningen' });
    const r = await shareDisclosureToCircle({ callSkill, emitMemberProps, circleId: 'c1', personaId: 'default', lastShared: memo, resealMediaForCircle: reseal });
    expect(r).toEqual({ ok: true, via: 'none', unchanged: true, changedKeys: [] });
    expect(emitMemberProps).not.toHaveBeenCalled();
    expect(reseal).not.toHaveBeenCalled();
    expect(callSkill.mock.calls.map(([, op]) => op)).toEqual(['getPersonaRelease']);
  });
  it('reveal-gating: only the persona\'s RELEASE for the circle ever travels', async () => {
    const emitMemberProps = emitter();
    await shareDisclosureToCircle({ callSkill: callSkillWith({ place: 'Groningen' }), emitMemberProps, circleId: 'c1', personaId: 'default', lastShared: createDisclosureShareMemo() });
    expect(JSON.stringify(emitMemberProps.mock.calls[0][0])).not.toContain('realName');
    expect(emitMemberProps.mock.calls[0][0].props.personaProperties).toEqual({ place: 'Groningen' });
  });
  it('an EMPTY release still travels — that is how a member clears what they disclosed', async () => {
    const memo = createDisclosureShareMemo();
    await memo.set('c1', 'default', { place: 'Groningen' });
    const emitMemberProps = emitter();
    const r = await shareDisclosureToCircle({ callSkill: callSkillWith({}), emitMemberProps, circleId: 'c1', personaId: 'default', lastShared: memo });
    expect(r).toEqual({ ok: true, via: 'lane', changedKeys: ['place'] });
    expect(emitMemberProps).toHaveBeenCalledWith({ circleIds: ['c1'], props: { personaProperties: {} } });
  });
  it('media leaves RE-SEALED to the circle (by reference); the memo and the gate keep the self-sealed SOURCE; a dropped copy never leaks it', async () => {
    const SOURCE_PIC = { __mediaSource: true, ref: 'self-pic-1' };
    const released = { handle: 'jan', profilePicture: SOURCE_PIC };
    const seen = [];
    const reseal = vi.fn(async (props, circleId) => { seen.push(circleId); return { ...props, profilePicture: { ref: `sealed://${circleId}/${props.profilePicture.ref}`, sealedFor: circleId } }; });
    const memo = createDisclosureShareMemo();
    const emitMemberProps = emitter();
    await shareDisclosureToCircle({ callSkill: callSkillWith(released), emitMemberProps, circleId: 'c1', personaId: 'default', lastShared: memo, resealMediaForCircle: reseal });
    expect(seen).toEqual(['c1']);
    const said = emitMemberProps.mock.calls[0][0].props.personaProperties;
    expect(said.profilePicture).toEqual({ ref: 'sealed://c1/self-pic-1', sealedFor: 'c1' });
    expect(JSON.stringify(said)).not.toContain('__mediaSource');
    expect(await memo.get('c1', 'default'), 'the memo keeps the SOURCE, so the next unchanged save no-ops').toEqual(released);
    // a re-seal that drops the media prop (a failed copy) never leaks the source ref
    const dropping = vi.fn(async (props) => { const out = { ...props }; delete out.profilePicture; return out; });
    const emit2 = emitter();
    await shareDisclosureToCircle({ callSkill: callSkillWith(released), emitMemberProps: emit2, circleId: 'c2', personaId: 'default', lastShared: createDisclosureShareMemo(), resealMediaForCircle: dropping });
    expect(emit2.mock.calls[0][0].props.personaProperties).toEqual({ handle: 'jan' });
    expect(JSON.stringify(emit2.mock.calls[0][0])).not.toContain('self-pic-1');
  });
  it('the lane\'s own answer is honest: unchanged by the lane\'s gate, or a failed append, is reported — and without an emitter nothing is claimed', async () => {
    const r1 = await shareDisclosureToCircle({ callSkill: callSkillWith({ place: 'X' }), emitMemberProps: emitter({ ok: true, emitted: [], unchanged: ['c1'], failed: [] }), circleId: 'c1', personaId: 'default' });
    expect(r1).toEqual({ ok: true, via: 'lane', unchanged: true, changedKeys: [] });
    const r2 = await shareDisclosureToCircle({ callSkill: callSkillWith({ place: 'X' }), emitMemberProps: emitter({ ok: true, emitted: [], unchanged: [], failed: ['c1'] }), circleId: 'c1', personaId: 'default' });
    expect(r2).toEqual({ ok: false, reason: 'append-failed' });
    expect(await shareDisclosureToCircle({ callSkill: callSkillWith({ place: 'X' }), circleId: 'c1', personaId: 'default' })).toEqual({ ok: false, reason: 'no-lane' });
  });
});
