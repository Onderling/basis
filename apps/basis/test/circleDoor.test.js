/**
 * The household bot's door in a circle it joined: a line reaches it only when it names the bot BY NAME (`@huisbot`, or
 * its roster handle) — `@assistent` / `@bot` stay the sender's own local engine's; the caller is the circle member,
 * by their role in THAT circle; replies go back onto the circle (capped per circle per minute); nothing of the bot's own
 * lines, nor a non-member's, is fed.
 */
import { describe, it, expect } from 'vitest';
import { botNamesFor, namesTheBotMember, withoutBotName, doorRoleForRosterRole, createReplyCap, createCircleDoors } from '../src/v2/circleDoor.js';

describe('addressing by name', () => {
  const names = botNamesFor('huisbot-van-frits');
  it('the handle and its short name', () => {
    expect(names).toEqual(['huisbot-van-frits', 'huisbot']);
    expect(botNamesFor('huisbot')).toEqual(['huisbot']);
    expect(botNamesFor(null)).toEqual([]);
  });
  it('named: @huisbot, @huisbot-van-frits, "huisbot, …" at the start', () => {
    for (const l of ['@huisbot zet melk op de lijst', 'zet @huisbot melk erop', '@huisbot-van-frits wat staat er', 'huisbot, wat staat er', 'Huisbot: hoi', '@Huisbot hoi']) {
      expect(namesTheBotMember(l, names), l).toBe(true);
    }
  });
  it('not named: the generic forms are the local engine\'s; a longer word is not the name', () => {
    for (const l of ['@assistent zet melk erop', '@bot hoi', 'de huisbot is stuk', '@huisbotje hoi', 'zet melk erop', '']) {
      expect(namesTheBotMember(l, names), l).toBe(false);
    }
    expect(namesTheBotMember('@assistent @huisbot zet melk erop', names)).toBe(true);   // both named: the bot's
  });
  it('the name taken off the line', () => {
    expect(withoutBotName('@huisbot zet melk op de lijst', names)).toBe('zet melk op de lijst');
    expect(withoutBotName('huisbot, wat staat er', names)).toBe('wat staat er');
    expect(withoutBotName('@huisbot-van-frits /users', names)).toBe('/users');
    expect(withoutBotName('zet @huisbot melk erop', names)).toBe('zet melk erop');
  });
});

describe('the circle role is the door role', () => {
  it('core\'s four, and anything else a member', () => {
    expect(doorRoleForRosterRole('admin')).toBe('admin');
    expect(doorRoleForRosterRole('coordinator')).toBe('coordinator');
    expect(doorRoleForRosterRole('observer')).toBe('observer');
    expect(doorRoleForRosterRole('member')).toBe('member');
    expect(doorRoleForRosterRole('founder')).toBe('member');
    expect(doorRoleForRosterRole(undefined)).toBe('member');
  });
});

describe('the reply cap', () => {
  it('per circle, per minute', () => {
    let now = 0;
    const cap = createReplyCap({ perMinute: 2, now: () => now });
    expect([cap.allow('a'), cap.allow('a'), cap.allow('a')]).toEqual([true, true, false]);
    expect(cap.allow('b')).toBe(true);
    now = 61_000;
    expect(cap.allow('a')).toBe(true);
  });
});

describe('the circle doors', () => {
  function make({ roster = [{ webid: 'ann', role: 'member', handle: 'ann' }, { webid: 'zoe', role: 'admin', handle: 'zoe' }, { webid: 'BOT', role: 'member', handle: 'huisbot-van-frits' }] } = {}) {
    const fed = []; const posted = []; const tiers = [];
    const doors = createCircleDoors({
      roster: async () => roster,
      botRef: () => 'BOT',
      botHandle: () => 'huisbot-van-frits',
      setDoorCaller: async (id, role) => { tiers.push([id, role]); },
      post: async (circleId, text) => { posted.push({ circleId, text }); },
      makeRunner: ({ circleId, bridge, roleOf }) => {
        bridge.onMessage(async (msg) => { fed.push({ circleId, msg, role: roleOf(msg.sender.bridgeUid) }); await bridge.sendReply({ chatId: msg.chatId, text: `antwoord op ${msg.text}` }); });
        return { start: async () => {}, stop: async () => {}, idle: async () => {} };
      },
      perMinute: 2,
    });
    return { doors, fed, posted, tiers };
  }

  it('a member\'s line naming the bot: fed without the name, as that member with their circle role; the reply goes onto the circle', async () => {
    const d = make();
    expect(await d.doors.landed({ circleId: 'c1', msgId: 'm1', authorRef: 'ann', text: '@huisbot zet melk erop' })).toBe(true);
    await d.doors.idle();
    expect(d.fed).toEqual([{ circleId: 'c1', msg: expect.objectContaining({ chatId: 'c1', text: 'zet melk erop', sender: expect.objectContaining({ bridgeUid: 'ann' }) }), role: 'member' }]);
    expect(d.tiers).toEqual([['ann', 'member']]);
    expect(d.posted).toEqual([{ circleId: 'c1', text: 'antwoord op zet melk erop' }]);
  });

  it('the circle\'s admin is the admin there', async () => {
    const d = make();
    await d.doors.landed({ circleId: 'c1', msgId: 'm1', authorRef: 'zoe', text: '@huisbot verwijder de lijst' });
    await d.doors.idle();
    expect(d.tiers).toEqual([['zoe', 'admin']]);
    expect(d.fed[0].role).toBe('admin');
  });

  it('not fed: a line not naming the bot; the bot\'s own line; a non-member; the same message twice', async () => {
    const d = make();
    expect(await d.doors.landed({ circleId: 'c1', msgId: 'm1', authorRef: 'ann', text: '@assistent zet melk erop' })).toBe(false);
    expect(await d.doors.landed({ circleId: 'c1', msgId: 'm2', authorRef: 'BOT', text: '@huisbot ik zeg iets' })).toBe(false);
    expect(await d.doors.landed({ circleId: 'c1', msgId: 'm3', authorRef: 'stranger', text: '@huisbot hoi' })).toBe(false);
    expect(await d.doors.landed({ circleId: 'c1', msgId: 'm4', authorRef: 'ann', text: '@huisbot hoi' })).toBe(true);
    expect(await d.doors.landed({ circleId: 'c1', msgId: 'm4', authorRef: 'ann', text: '@huisbot hoi' })).toBe(false);
    await d.doors.idle();
    expect(d.fed).toHaveLength(1);
  });

  it('a group naming it thirty times: the replies are capped per circle', async () => {
    const d = make();
    for (let i = 0; i < 5; i++) await d.doors.landed({ circleId: 'c1', msgId: `m${i}`, authorRef: 'ann', text: `@huisbot ${i}` });
    await d.doors.idle();
    expect(d.fed).toHaveLength(5);
    expect(d.posted).toHaveLength(2);
  });

  it('a line older than the window when it lands (held while the box was down): not answered', async () => {
    const d = make();
    expect(await d.doors.landed({ circleId: 'c1', msgId: 'old', authorRef: 'ann', text: '@huisbot hoi', ts: Date.now() - 60 * 60_000 })).toBe(false);
    expect(await d.doors.landed({ circleId: 'c1', msgId: 'new', authorRef: 'ann', text: '@huisbot hoi', ts: Date.now() - 1000 })).toBe(true);
  });

  it('forget: the circle\'s door goes; a later line builds it again', async () => {
    const d = make();
    await d.doors.landed({ circleId: 'c1', msgId: 'm1', authorRef: 'ann', text: '@huisbot hoi' });
    await d.doors.forget('c1');
    expect(d.doors.open()).toEqual([]);
    await d.doors.landed({ circleId: 'c1', msgId: 'm2', authorRef: 'ann', text: '@huisbot hoi' });
    expect(d.doors.open()).toEqual(['c1']);
  });
});
