/**
 * What the model is told must agree with what the bot does — for EVERY op, read from the map the gate reads.
 *
 * A household's log (2026-09-28 → 10-08) had the model deny what the person could do, five times: a member asking for a
 * new list was told "only the admin can" (making a list is on the member column); "remind me in 10 minutes" was refused
 * (remindMe is on the member column); it asked how the person wanted to be reminded, then said it could not change
 * that (assistant-reminders is on the member column). Each was a hand-written line lagging the map. So the lines that
 * say who may do what are GENERATED from `BOT_OP_MAP`: every op on the member column is described to the model as the
 * member's, every admin-only op as the admin's, and no hand-written line claims either.
 *
 * Also kept from before: never a promise to change how the bot works ("I'll do it like that from now on") — how the bot
 * answers is its code, not the model's choice.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { HOUSEHOLD_TEMPLATE } from '../src/v2/householdTemplate.js';
import { BOT_OP_MAP, roleHintsFor, opMapPromptLines } from '../src/v2/botOpMap.js';
import { botPromptLines } from '../src/v2/botPrompt.js';
import { initLocalisation, t } from '../src/localisation.js';

const bare = (q) => q.slice(q.indexOf('.') + 1);
const MEMBER = BOT_OP_MAP.member.map(bare);
const ADMIN_ONLY = BOT_OP_MAP.admin.filter((q) => !BOT_OP_MAP.member.includes(q)).map(bare);

let lines;
let prompt;
beforeAll(async () => {
  await initLocalisation({ lng: 'nl' });
  lines = botPromptLines(t);
  prompt = [...lines, ...roleHintsFor('member', t)].join('\n');
});

/** The line that names an op as available to every member (the generated one), or undefined. */
const availableLine = () => lines.find((l) => /every member may use/i.test(l));
/** The line that names the admin's ops (the generated one), or undefined. */
const adminLine = () => lines.find((l) => /are the admin's/i.test(l));
/** Does `line` name this op as a word of its own (`createList`, not `createListX`)? */
const names = (line, op) => new RegExp(`(^|[^\\w-])${op.replace(/[-]/g, '\\-')}([^\\w-]|$)`).test(String(line ?? ''));

describe('the household prompt tells the model the truth, for every op on the map', () => {
  it('every op on the member column is described to the model as the member\'s', () => {
    const line = availableLine();
    expect(line, 'a generated line naming the member column').toBeTruthy();
    const missing = MEMBER.filter((op) => !names(line, op));
    expect(missing).toEqual([]);
  });

  it('the observed denials: making a list, a reminder, how one is reminded — all named as available', () => {
    for (const op of ['createList', 'remindMe', 'assistant-reminders']) {
      expect(MEMBER).toContain(op);
      expect(names(availableLine(), op)).toBe(true);
    }
  });

  it('every admin-only op is described as the admin\'s, and a member is told so', () => {
    const line = adminLine();
    expect(line, 'a generated line naming the admin column').toBeTruthy();
    expect(ADMIN_ONLY.filter((op) => !names(line, op))).toEqual([]);
    const [hint] = roleHintsFor('member', t);
    expect(ADMIN_ONLY.filter((op) => !names(hint, op))).toEqual([]);
  });

  it('no line calls a member op the admin\'s — not the generated ones, not the hints, not the template\'s', () => {
    const adminWords = /alleen de beheerder|only the (household's )?admin|the admin's|van de beheerder/i;
    // (the member line itself says "never say that only the admin can": the one line that may name both)
    for (const l of prompt.split('\n').filter((x) => adminWords.test(x) && x !== availableLine())) {
      expect(MEMBER.filter((op) => names(l, op)), l).toEqual([]);
    }
  });

  it('the lines are generated from the map, never a hand list: another map, other lines', () => {
    const [mine, admins] = opMapPromptLines({ member: ['lists.fooList', 'assistant.bar-baz'], admin: ['tasks.quxTask'] });
    expect(names(mine, 'fooList') && names(mine, 'bar-baz')).toBe(true);
    expect(names(admins, 'quxTask')).toBe(true);
    // and the template's own lines claim nobody's rights: who may do what is the map's to say
    const hand = HOUSEHOLD_TEMPLATE.promptLines.join('\n');
    expect(hand).not.toMatch(/Iedereen mag|alleen de beheerder (maakt|mag|kan)|only the admin/i);
  });

  it('a setting a tool changes is not "how the bot works": the model is never told it cannot change it', () => {
    // the template's line about the bot's own behaviour excepts what a tool sets — the reminders above all
    const own = lines.find((l) => /Beloof NOOIT/.test(l));
    expect(own).toBeTruthy();
    expect(own).toMatch(/herinneringen/i);
  });

  it('never a promise to change how the bot works', () => {
    expect(prompt).toMatch(/Beloof NOOIT/);
    expect(prompt).toMatch(/beheerder/);
  });
});
