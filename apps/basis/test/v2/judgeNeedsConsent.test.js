/**
 * The judge seam is gated by the persona's model consent: a judge handed in without a yes is never called, on every
 * entry the matching has (the noticeboard's annotation, one incoming item, a room ask). Today no shell hands in a
 * judge; the day one does, it is already gated.
 */
import { describe, it, expect, vi } from 'vitest';
import { annotateResonantPosts, evaluateItemForDrivers, notifyIfResonant } from '../../src/core/handlers/driverMatchNotify.js';
import { evaluateIncomingAsk } from '../../src/v2/nearbyAsks.js';
import { createDriver } from '@onderling/agent-registry';

const drivers = { zeilen: createDriver({ kind: 'goal', text: 'leren zeilen', tags: ['zeilen'] }) };
const getDrivers = async () => drivers;
const post = { id: 'p1', text: 'wie wil er mee de boot op', tags: ['varen'] };
const judgeYes = () => vi.fn(async () => ({ match: true, reason: 'past bij zeilen' }));

describe('the judge runs only under the persona\'s yes', () => {
  for (const [name, run] of [
    ['annotateResonantPosts', (a) => annotateResonantPosts({ posts: [post], getDrivers, ...a })],
    ['evaluateItemForDrivers', (a) => evaluateItemForDrivers({ item: post, getDrivers, ...a })],
    ['notifyIfResonant', (a) => notifyIfResonant({ item: post, getDrivers, notify: () => {}, ...a })],
    ['evaluateIncomingAsk', (a) => evaluateIncomingAsk({ ask: { ...post, expiresAt: Date.now() + 60_000 }, getDrivers, ...a })],
  ]) {
    it(`${name}: no consent → the judge is never called; a yes → it may be`, async () => {
      const without = judgeYes();
      await run({ judge: without });
      await run({ judge: without, modelConsent: false });
      expect(without).not.toHaveBeenCalled();

      const withYes = judgeYes();
      await run({ judge: withYes, modelConsent: true });
      expect(withYes).toHaveBeenCalled();
    });
  }
});
