/**
 * A NEW DEVICE ASKS EVERY SIBLING FOR THE ROSTER SEED, the device the offer was shown on first.
 *
 * With one address per persona per circle, a new device shares the circle address with its siblings and asks one of
 * them, at its device address, for the circle's roster. It used to ask only the first device on its list, and every
 * resend went to that same device: when that one was silent (busy, not yet registered after its own boot), the enrol
 * failed with `seed-not-received` while the device that had shown the offer sat ready. Now the request goes to every
 * live sibling of that persona, the offering device first; the first answer wins.
 */
import { describe, it, expect } from 'vitest';
import { encodeEnrollOffer, stashEnrollOffer, consumeEnrollOffer } from '../src/v2/enrollOffer.js';

const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; };
const ADDR = 'shared-circle-address';
const P = 'p-1234567890abcdef';

async function enrol({ answers, answerAfterMs = 0 }) {
  const storage = memStorage();
  const uri = encodeEnrollOffer({ circles: [{ id: 'cx', address: ADDR, persona: P }], introduce: [{ pubKey: 'phone-dev', profileId: P }] });
  expect((await stashEnrollOffer(storage, uri, { keepIntroduce: true })).ok).toBe(true);
  let seeded = false;
  const asked = [];
  const agent = {
    identity: { chat: { pubKey: 'me' } },
    circleSelf: () => ({ sendAs: 'me' }),
    circleAddressFor: () => ADDR,
    profileIdOf: () => P,
    learnOfferedDevices: async () => {},
    ownDeviceAddress: () => 'new-dev',
    // the list as the registry gives it: the laptop first
    ownDeviceAddressesOf: async () => ['laptop-dev', 'phone-dev'],
    rosterSeed: { buildRequest: async (circleId, replyTo) => ({ subtype: 'roster-seed-request', circleId, replyTo }) },
  };
  const callSkill = async (app, op) => {
    if (op === 'listGroupMembers') return { members: seeded ? [{ webid: 'me', circleAddresses: [ADDR] }] : [] };
    return { ok: true };
  };
  const sendPeerMessage = async (to, payload) => {
    if (payload?.subtype !== 'roster-seed-request') return {};
    asked.push(to);
    if (answers.includes(to)) { if (answerAfterMs) setTimeout(() => { seeded = true; }, answerAfterMs); else seeded = true; }
    return {};
  };
  const r = await consumeEnrollOffer({ agent, callSkill, sendPeerMessage, storage });
  return { row: r.circles?.find((c) => c.circleId === 'cx'), asked };
}

describe('the roster seed is asked of every sibling', () => {
  it('the laptop (first on the list) is silent; the phone that showed the offer answers — the enrol completes', async () => {
    const { row, asked } = await enrol({ answers: ['phone-dev'] });
    expect(row?.ok, JSON.stringify(row)).toBe(true);
    expect(asked[0], 'the device the offer was shown on is asked first').toBe('phone-dev');
    expect(new Set(asked)).toEqual(new Set(['phone-dev', 'laptop-dev']));
  }, 20_000);
  it('an answer that takes 12 s (a first contact on a busy device) still completes the enrol — it is late, not lost', async () => {
    const { row } = await enrol({ answers: ['phone-dev'], answerAfterMs: 12_000 });
    expect(row?.ok, JSON.stringify(row)).toBe(true);
  }, 40_000);
  it('the phone is silent, the laptop answers: the enrol completes too', async () => {
    const { row } = await enrol({ answers: ['laptop-dev'] });
    expect(row?.ok, JSON.stringify(row)).toBe(true);
  }, 20_000);
});
