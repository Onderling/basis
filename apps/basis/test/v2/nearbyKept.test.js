/**
 * A room conversation kept on this device: lines on the device log under a visit id, the peer named by THEIR room
 * key; shown in a contact's thread only after that person's card tied their room key to their address; gone after the
 * person's window (`nearby.keepDays`, default 7); never carried to another device.
 */
import { describe, it, expect } from 'vitest';
import { EventLog } from '../../src/eventLog.js';
import { ENTRY_KINDS, SYNC } from '@onderling/item-store';
import {
  keepRoomLine, keepCardLink, earlierInTheRoom, roomRetentionMs, KEEP_DAYS, LINE_KIND, CARD_KIND,
} from '../../src/v2/nearbyKept.js';

const DAY = 24 * 60 * 60 * 1000;

describe('a room conversation, kept', () => {
  it('a line is kept, but shows for a contact only once their card tied their room key to their address', () => {
    const log = new EventLog({ now: () => 1000 });
    keepRoomLine({ eventLog: log, visitId: 'v1', peer: 'room-ann', who: 'them', text: 'wie heeft een ladder?', at: 1 });
    keepRoomLine({ eventLog: log, visitId: 'v1', peer: null, who: 'me', text: 'ik', at: 2 });
    keepRoomLine({ eventLog: log, visitId: 'v1', peer: 'room-bas', who: 'them', text: 'iets anders', at: 3 });
    keepRoomLine({ eventLog: log, visitId: 'v2', peer: null, who: 'me', text: 'een ander bezoek', at: 4 });
    expect(earlierInTheRoom(log.query(), 'ANN'), 'no card yet: nothing').toEqual([]);
    keepCardLink({ eventLog: log, peer: 'room-ann', address: 'ANN' });
    expect(earlierInTheRoom(log.query(), 'ANN')).toEqual([{
      visitId: 'v1',
      lines: [{ who: 'them', text: 'wie heeft een ladder?', at: 1 }, { who: 'me', text: 'ik', at: 2 }],
    }]);
  });

  it('the window is the person\'s setting: past it the lines and the link drop', () => {
    let now = 0;
    const log = new EventLog({ now: () => now });
    log.setRetention({ room: roomRetentionMs(2) });
    keepRoomLine({ eventLog: log, visitId: 'v1', peer: 'room-ann', who: 'them', text: 'hoi', at: 0 });
    keepCardLink({ eventLog: log, peer: 'room-ann', address: 'ANN', at: 0 });
    now = 1 * DAY;
    log.prune();
    expect(earlierInTheRoom(log.query(), 'ANN')).toHaveLength(1);
    now = 3 * DAY;
    log.prune();
    expect(earlierInTheRoom(log.query(), 'ANN'), 'gone after two days').toEqual([]);
    expect(log.query().filter((e) => e.type === LINE_KIND || e.type === CARD_KIND)).toEqual([]);
  });

  it('the default window is seven days, and 0 keeps nothing at all', () => {
    expect(KEEP_DAYS).toBe(7);
    const log = new EventLog();
    expect(keepRoomLine({ eventLog: log, visitId: 'v1', peer: 'x', who: 'them', text: 'hoi', keepDays: 0 })).toBeNull();
    expect(log.query()).toEqual([]);
  });

  it('the kinds are local: signed by nobody else, accepted from nobody, never carried', () => {
    for (const k of [LINE_KIND, CARD_KIND]) {
      expect(ENTRY_KINDS[k], k).toBeTruthy();
      expect(ENTRY_KINDS[k].syncPolicy).toBe(SYNC.NONE);
      expect(ENTRY_KINDS[k].accepts).toBe('none');
      expect(ENTRY_KINDS[k].retain).toBe('room');
    }
  });
});
