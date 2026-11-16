/**
 * Two lists say which acts a person has at a door that is theirs: the ops declared for the OWN place (`scopes`, read by
 * the person's own "+") and the household bot's member column (`botOpMap.js`, a household's door, by ROLE). They are not
 * the same fact, so they may differ, but only on purpose: every op of the bot's apps that is in one and not the other is
 * named here with its reason. A new own act, or a new act on the bot's map, fails here until someone says which.
 */
import { describe, it, expect } from 'vitest';
import { BOT_APPS, BOT_OP_MAP } from '../../src/v2/botOpMap.js';
import { catalogueManifests, DOOR_MANIFESTS } from '../../src/v2/manifestSources.js';
import { opScopes, encodeGenericOpId } from '@onderling/app-manifest';

const NOTE = (atom) => `household.${encodeGenericOpId('household', atom, 'note')}`;

/** In the own "+", not on the bot's member column. */
const OWN_ONLY = {
  [NOTE('get')]: 'the "+" opens an own note to change it; a household bot changes no note',
  [NOTE('update')]: 'the "+" opens an own note to change it; a household bot changes no note',
  'calendar.updateEvent': "the person moves their own appointment; a household bot's members only cancel one",
  'calendar.shareEvent': "an own appointment is shared with a contact from the person's own \"+\"; a bot shares nothing",
  'calendar.shareTargets': 'whom an own appointment can be shared with: the person\'s contacts, not the household\'s',
  'calendar.getEventSnapshot': "one own appointment read in full (the person's own agenda); the bot lists the household's",
  'calendar.briefSummary': "the person's own agenda in a few words; the bot's week overview is the household's",
  'calendar.searchEvents': "searching the person's own agenda; the bot lists the household's",
};

/** On the bot's member column, not in the own "+". */
const BOT_ONLY = {
  'lists.entryReminders': "a household list's reminders: the household's, not the person's own things",
  'lists.makeChore': 'a chore is a household act',
  'lists.shopVisit': 'a shop visit reads the household lists',
  'tasks.listMine': 'tasks are the household task app; the person has no own tasks',
  'tasks.listOpen': 'tasks are the household task app; the person has no own tasks',
  'tasks.claimTask': 'tasks are the household task app; the person has no own tasks',
  'tasks.completeTask': 'tasks are the household task app; the person has no own tasks',
  'calendar.rsvpAccept': 'an answer to an invitation: an own appointment invites nobody',
  'calendar.rsvpDecline': 'an answer to an invitation: an own appointment invites nobody',
  'calendar.rsvpTentative': 'an answer to an invitation: an own appointment invites nobody',
  'assistant.assistant-reminders': "the household bot's reminders; the app has no reminder book of the person's yet",
  'assistant.remindMe': "the household bot's reminders; the app has no reminder book of the person's yet",
  'assistant.cancelReminder': "the household bot's reminders; the app has no reminder book of the person's yet",
  'assistant.sayReminder': "the household bot's reminders; the app has no reminder book of the person's yet",
  'assistant.assistant-overview': "the household's week, from the household's sources",
  'assistant.weekOverview': "the household's week, from the household's sources",
  'assistant.sendWeekOverview': "the household's week, sent to the household",
  'assistant.assistant-people': "who is in the household: the household's people",
  'assistant.assistant-feedback': "the box door's feedback line; the \"+\" has the app's own feedback act",
  'assistant.assistant-planned': 'what the household bot will send this person',
};

const ownOps = () => {
  const apps = new Set([...BOT_APPS, 'household']);
  const own = new Set();
  for (const m of [...catalogueManifests(), ...DOOR_MANIFESTS].filter((x) => apps.has(x.app))) {
    for (const op of m.operations ?? []) if (opScopes(op).includes('own')) own.add(`${m.app}.${op.id}`);
    for (const [noun, d] of Object.entries(m.nouns ?? {})) {
      if (opScopes(d).includes('own')) for (const atom of d.atoms ?? []) own.add(`${m.app}.${encodeGenericOpId(m.app, atom, noun)}`);
    }
  }
  return own;
};

describe('the own place and the household bot\'s member column differ only where named', () => {
  it('every own act of the bot\'s apps is on the member column, or named with its reason', () => {
    const member = new Set(BOT_OP_MAP.member);
    expect([...ownOps()].filter((id) => !member.has(id) && !OWN_ONLY[id])).toEqual([]);
  });
  it('every member act is offered in the own place, or named with its reason', () => {
    const own = ownOps();
    expect(BOT_OP_MAP.member.filter((id) => !own.has(id) && !BOT_ONLY[id])).toEqual([]);
  });
  it('the named differences are real (a stale name is removed, not kept)', () => {
    const own = ownOps();
    const member = new Set(BOT_OP_MAP.member);
    expect(Object.keys(OWN_ONLY).filter((id) => !own.has(id) || member.has(id))).toEqual([]);
    expect(Object.keys(BOT_ONLY).filter((id) => own.has(id) || !member.has(id))).toEqual([]);
  });
});
