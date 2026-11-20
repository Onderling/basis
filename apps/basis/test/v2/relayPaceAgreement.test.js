/**
 * THE RELAY'S LIMIT AND THE TRANSPORT'S PACE AGREE, and every lane's catch-up is a background send (the start burst,
 * 2026-11-20).
 *
 * Two layers hold one fact: the relay refuses `send` frames past its per-connection rate, and the relay transport paces
 * itself under that rate so a start's burst is never refused. This pins the AGREEMENT, not either value: whoever raises
 * the transport's pace past the relay's, or lowers the relay's under it, is red here.
 *
 * And what may wait behind a person's own sends is read from the payload's subtype (`isBackgroundSend`): every lane's
 * catch-up subtypes and the address announce must be read as background — a new lane named otherwise would quietly
 * go to the front, and a catch-up burst would hold up what a person typed again.
 */
import { describe, it, expect } from 'vitest';
import { RELAY_MSG_RATE } from '@onderling/relay';
import { RELAY_SEND_RATE } from '@onderling/transports';
import { isBackgroundSend } from '@onderling/secure-agent';
import { CHAT_CATCHUP_SUBTYPES } from '../../src/v2/chatRail.js';
import { GOV_CATCHUP_REQUEST, GOV_CATCHUP_BATCH } from '../../src/v2/governanceCatchUp.js';
import { KEY_CATCHUP_SUBTYPES } from '../../src/v2/keyRail.js';
import { ITEMS_CATCHUP_SUBTYPES, OWN_ITEMS_CATCHUP_SUBTYPES } from '../../src/v2/itemsRail.js';
import { MEMBERSHIP_CATCHUP_SUBTYPES } from '../../src/v2/membershipRail.js';
import { GRANTS_CATCHUP_SUBTYPES } from '../../src/v2/grantsRail.js';
import { KNOWN_PEERS_CATCHUP_SUBTYPES } from '../../src/v2/knownPeersSync.js';
import { PERSON_KEY_CATCHUP_SUBTYPES } from '../../src/v2/personKeySync.js';
import { PROFILE_FACTS_CATCHUP_SUBTYPES } from '../../src/v2/profileFactsSync.js';
import { CIRCLE_ADDRESS_ANNOUNCE_KIND } from '../../src/v2/circleAddressAnnounce.js';

describe('the relay transport paces under the relay limit', () => {
  it('the transport\'s rate and burst are at or under the relay\'s', () => {
    expect(RELAY_SEND_RATE.perSec).toBeGreaterThan(0);
    expect(RELAY_SEND_RATE.perSec).toBeLessThanOrEqual(RELAY_MSG_RATE.perSec);
    expect(RELAY_SEND_RATE.burst).toBeLessThanOrEqual(RELAY_MSG_RATE.burst);
  });
});

describe('what may wait behind a person\'s own sends', () => {
  it('every lane\'s catch-up subtype and the address announce are background sends', () => {
    const lanes = [CHAT_CATCHUP_SUBTYPES, KEY_CATCHUP_SUBTYPES, ITEMS_CATCHUP_SUBTYPES, OWN_ITEMS_CATCHUP_SUBTYPES,
      MEMBERSHIP_CATCHUP_SUBTYPES, GRANTS_CATCHUP_SUBTYPES, KNOWN_PEERS_CATCHUP_SUBTYPES, PERSON_KEY_CATCHUP_SUBTYPES,
      PROFILE_FACTS_CATCHUP_SUBTYPES];
    const subtypes = [...lanes.flatMap((l) => Object.values(l)), GOV_CATCHUP_REQUEST, GOV_CATCHUP_BATCH, CIRCLE_ADDRESS_ANNOUNCE_KIND];
    const foreground = subtypes.filter((st) => !isBackgroundSend({ subtype: st }));
    expect(foreground, 'catch-up subtypes read as foreground').toEqual([]);
  });

  it('what a person does stays in front: a chat line, an item, a receipt, a membership statement, a pairing answer', () => {
    for (const st of ['circle-chat-statement', 'circle-items-broadcast', 'delivery-receipt', 'circle-membership-broadcast', 'group-redeem-response', undefined]) {
      expect(isBackgroundSend({ subtype: st }), String(st)).toBe(false);
    }
  });
});
