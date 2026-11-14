/**
 * A change to a circle's group key that was NOT made says so in the device's refusal log, with its reason and never
 * an id: another device kept changing the key (the bounded compare-and-swap ran out), or the roster could not say
 * whether the member is still a member. Before, the router's warning was the only trace, and a log report never saw it.
 */
import { describe, it, expect, vi } from 'vitest';
import { createCircleControlAgentRouter } from '../src/v2/circlePodProducer.js';
import { KeyWriteContendedError, MemberUnknownError } from '@onderling/pod-client';

function routerThrowing(err) {
  const refusals = { note: vi.fn() };
  const controlAgent = { addMember: async () => { throw err; }, grantRecipient: async () => { throw err; } };
  const router = createCircleControlAgentRouter(() => ({ controlAgent }), { refusals });
  return { router, refusals };
}

describe('a key change that was not made is logged', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  it('a join that kept losing the race', async () => {
    const { router, refusals } = routerThrowing(new KeyWriteContendedError(4));
    await router.addMember({ webId: 'ref:bea', publicKey: 'pk', groupId: 'c1' });
    expect(refusals.note).toHaveBeenCalledWith({ tag: 'key', lane: 'key', check: 'granting', reason: 'key-write-contended' });
  });
  it('a join the roster could not answer for', async () => {
    const { router, refusals } = routerThrowing(new MemberUnknownError());
    await router.addMember({ webId: 'ref:bea', publicKey: 'pk', groupId: 'c1' });
    expect(refusals.note).toHaveBeenCalledWith(expect.objectContaining({ reason: 'member-unknown' }));
  });
  it('a key change refused because the pod gave no ETag', async () => {
    const { router, refusals } = routerThrowing(Object.assign(new Error('no etag'), { code: 'KEY_WRITE_UNCONDITIONED' }));
    await router.addMember({ webId: 'ref:bea', publicKey: 'pk', groupId: 'c1' });
    expect(refusals.note).toHaveBeenCalledWith(expect.objectContaining({ reason: 'key-write-unconditioned' }));
  });
  it('a device enrolment that kept losing the race', async () => {
    const { router, refusals } = routerThrowing(new KeyWriteContendedError(4));
    await router.grantRecipient({ publicKey: 'pk', groupId: 'c1' });
    expect(refusals.note).toHaveBeenCalledWith(expect.objectContaining({ check: 'enrolling', reason: 'key-write-contended' }));
  });
  it('any other failure stays a warning only, and no id reaches the refusal log', async () => {
    const { router, refusals } = routerThrowing(new Error('pod down'));
    await router.addMember({ webId: 'ref:bea', publicKey: 'pk', groupId: 'c1' });
    expect(refusals.note).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });
});
