/**
 * THE INBOUND WIRING — one composition of what a device does with a peer message, for every shell.
 *
 * Every shell answers the same inbound subtypes with the same shared handlers: the signed lanes and their catch-ups
 * (`buildCircleLanes`), the live governance statement, the contact channel, the join handshake, a member's proven
 * circle address, the delivery receipt, the calendar, a shared file, a reply to a noticeboard post, a sealed copy.
 * Until this module each shell wrote that map out by hand (the phone inside a SCREEN), so a handler added on one
 * shell was missing on the next until somebody noticed. Here the map is built once; a shell hands in only what it
 * alone can answer: where a landed turn is painted, what a calendar invite says on screen, how it asks the catch-up's
 * consent question, what it logs.
 *
 * An entry is present only when what it needs is: no contact channel → no contact subtypes; no shared-with-me store →
 * no `shared-copy`; no pending-redeems map → no `group-redeem-response`. Absent is honest: the router's default
 * handler (or none) takes the subtype, exactly as a shell that never registered it did.
 *
 * What stays with the shell: the router's DEFAULT handler (the phone's main-thread bubble), its own doors (the box's
 * screen and companion offers), and the catch-up kicks on connect.
 */
import { buildCircleLanes } from './circleLanes.js';
import { makeCircleGovernancePeerHandler } from './circleLogReceiver.js';
import { makeCircleRecipePeerHandler } from './circleRecipeReceiver.js';
import { makeCircleRulesPeerHandler } from './circleRulesReceiver.js';
import { makeCircleAddressAnnouncePeerHandler, propagateCircleAddressesAfterJoin } from './circleAddressAnnounce.js';
import { makeHandleGroupRedeemRequest, makeHandleGroupRedeemResponse } from '../core/handlers/groupRedeem.js';
import { makeHandleCalendarInvite } from '../core/handlers/calendarInvite.js';
import { makeHandleCalendarRsvp } from '../core/handlers/calendarRsvp.js';
import { makeHandleCalendarCancel } from '../core/handlers/calendarCancel.js';
import { makeHandleFileShare } from '../core/handlers/fileShare.js';
import { makeHandleThreadedChat } from '../core/handlers/threadedChat.js';
import { makeHandleSharedCopy } from '../core/handlers/sharedCopyReceive.js';
import { makeHandleCirclePost } from '../core/handlers/circlePost.js';
import { landedNoticeboardHandler } from './noticeboardCarry.js';

/**
 * @param {object} o
 * @param {object} o.agent                 the real agent (sendPeerMessage, identityOfAddress, circleAddressFor, …)
 * @param {Function} o.callSkill           the shell's callSkill
 * @param {Function} [o.publishEvent]      the shell's event sink (the log, or the box's walk log)
 * @param {object} o.lanes                 `buildCircleLanes`'s options WITHOUT `agent` / `sendToPeer` (added here)
 * @param {object} [o.eventLog]            the device log the governance broadcast lands on
 * @param {object|null} [o.govRail]        the governance rail; null → no live governance broadcast entry
 * @param {Function} [o.onGovChange]       the shell's reaction to a landed governance statement
 * @param {object|null} [o.contactChannel] the contact channel; null → no contact subtypes
 * @param {Function} [o.onContactReply]    a turn that lands in a contact thread (the `in` subtype)
 * @param {Function} [o.onContactMessage]  a person's message (the `out` subtype); defaults to `onContactReply`
 * @param {Map|null} [o.pendingRedeems]    the joiner's pending join requests; null → no response entry
 * @param {Function} [o.onAdmitted]        an admission landed (the pair roster's co-admin rule, the launcher's re-read)
 * @param {Function} [o.grantSealedAudience] a proven device address joins a sealed circle's readers
 * @param {Function} [o.applyIncomingReceipt] the delivery-receipt reducer; null → no `delivery-receipt` entry
 * @param {object|null} [o.nearbyRoom]     the Nearby room binding (its handlers, its receipt hook)
 * @param {{pendingStore: object, dedup?: Set}|null} [o.recipe]  the circle recipe stash; null → no entry
 * @param {{pendingStore: object, dedup?: Set}|null} [o.rules]   the circle rules stash; null → no entry
 * @param {{addMainBubble: Function}|null} [o.calendar]  the calendar's on-screen heads-up; null → no calendar entries
 * @param {Function|null} [o.deliverToContactThread] where a peer's file or post reply lands; null → neither entry
 * @param {Function} [o.notePeer]          a first file or reply makes the sender a contact row
 * @param {object|null} [o.sharedWithMeStore] the shared-with-me store; null → no `shared-copy`
 * @param {boolean} [o.noticeboardLanded]  a noticeboard post another member made, landed through the items lane, resonates
 *   here (the circle-post handler, for the self this device is in that circle)
 * @param {object} [o.logger]
 * @returns {{handlers: object, lanes: object}}  the router's handler map, and the lane table (its catch-ups, carriers)
 */
export function buildInboundWiring({
  agent, callSkill, publishEvent = () => {},
  lanes: laneOpts = {}, eventLog = null, govRail = null, onGovChange = () => {},
  contactChannel = null, onContactReply = null, onContactMessage = null,
  pendingRedeems = null, onAdmitted = null, grantSealedAudience = null,
  applyIncomingReceipt = null, nearbyRoom = null,
  recipe = null, rules = null, calendar = null,
  deliverToContactThread = null, notePeer = () => {},
  sharedWithMeStore = null, noticeboardLanded = false,
  logger = console,
} = {}) {
  if (noticeboardLanded) {
    agent?.setNoticeboardLandedHook?.(landedNoticeboardHandler({
      // …resonating with the drivers of the self this device is in that circle (a persona's circle is the persona's)
      handleCirclePost: makeHandleCirclePost({ callSkill, publishEvent, profileIdOf: (cid) => agent.profileIdOf?.(cid) ?? 'default' }),
      self: agent.identity?.pubKey ?? null,
    }));
  }
  const sendPeer = (addr, payload, opts) => agent.sendPeerMessage(addr, payload, opts);
  // the PERSON behind an address (a code bound to one person, a thread keyed on the person, not the route it came by)
  const personOf = (addr) => agent?.identityOfAddress?.(addr) ?? addr;
  const lanes = buildCircleLanes({ ...laneOpts, agent, sendToPeer: sendPeer });
  const handlers = {
    // the signed lanes and the personal ones, from the one lane table
    ...lanes.handlers,
    // the Nearby room's inbound side — asks, answers, cards, room chat, broadcast invites
    ...(nearbyRoom?.handlers ?? {}),
    // a live governance statement, verified at this device's rail (the catch-up alone would leave a device behind until
    // its next reconnect); a landed decision reaches my other devices through the lane table's carrier
    ...(govRail ? {
      'circle-governance-broadcast': makeCircleGovernancePeerHandler({
        eventLog, rail: govRail, onChange: onGovChange, onLanded: lanes.landedCarrier?.governance,
      }),
    } : {}),
    // a contact's turn and a person's message, through the shared channel
    ...(contactChannel && typeof onContactReply === 'function' ? {
      [contactChannel.subtypes.in]:  contactChannel.replyHandler(onContactReply),
      [contactChannel.subtypes.out]: contactChannel.messageHandler(onContactMessage ?? onContactReply),
    } : {}),
    // the join handshake: the admin verifies a redeem, admits, returns its own proven per-circle address and hands the
    // circle the newcomer's (nobody else can: a fresh joiner cannot address the other members yet)
    'group-redeem-request': makeHandleGroupRedeemRequest({
      callSkill, sendPeer, publishEvent, identityOf: personOf,
      ...(typeof onAdmitted === 'function' ? { onAdmitted } : {}),
      circleAddressFor: (gid) => agent?.circleAddressFor?.(gid) ?? null,
      signCircleAddress: (gid, addr) => agent?.signCircleLink?.(gid, gid, addr) ?? null,
      propagateCircleAddresses: ({ circleId, newMemberWebid }) => propagateCircleAddressesAfterJoin({ agent, circleId, newMemberWebid }),
      // the one answer to a proven request may leave on the person key (the send gate's invite exchange)
      inviteExchange: agent?.inviteExchange ?? null,
      logger,
    }),
    ...(pendingRedeems ? { 'group-redeem-response': makeHandleGroupRedeemResponse({ pendingMap: pendingRedeems }) } : {}),
    // a member's proven per-circle address (every announcement carries its own proof, so the sender is not trusted)
    'circle-address-announce': makeCircleAddressAnnouncePeerHandler({
      agent, logger, ...(typeof grantSealedAudience === 'function' ? { grantSealedAudience } : {}),
    }),
    // delivery honesty — the peer's app stored our message (the room confirms with the same receipt)
    ...(typeof applyIncomingReceipt === 'function' ? {
      'delivery-receipt': (from, payload) => { nearbyRoom?.onReceipt?.(from, payload); applyIncomingReceipt(payload, from); },
    } : {}),
    ...(recipe?.pendingStore ? {
      'circle-recipe-broadcast': makeCircleRecipePeerHandler({ pendingStore: recipe.pendingStore, dedup: recipe.dedup ?? new Set(), logger }),
    } : {}),
    ...(rules?.pendingStore ? {
      'circle-rules-broadcast': makeCircleRulesPeerHandler({ pendingStore: rules.pendingStore, dedup: rules.dedup ?? new Set(), logger }),
    } : {}),
    ...(calendar ? {
      'calendar-invite': makeHandleCalendarInvite({ callSkill, publishEvent, addMainBubble: calendar.addMainBubble ?? (() => {}) }),
      'calendar-rsvp':   makeHandleCalendarRsvp({ callSkill, publishEvent }),
      'calendar-cancel': makeHandleCalendarCancel({ callSkill, publishEvent }),
    } : {}),
    // a peer's file, and a reply to one of OUR noticeboard posts, land in THAT SENDER's contact thread
    ...(typeof deliverToContactThread === 'function' ? {
      'file-share': makeHandleFileShare({
        deliverToThread: ({ contactId, fromAddr, file, messageId, ts, sealed }) =>
          deliverToContactThread({ contactId, fromAddr, text: '', file, messageId, ts, ...(sealed ? { sealed } : {}) }),
        identityOf: personOf,
        // a file sealed to the person opens with my key for the version it names (the text turn's seal)
        openFor: (sealed, fromAddr) => agent?.contactSeal?.openFor?.(sealed, fromAddr) ?? null,
        // a file from someone the person did not choose is refused (the channel's door decides who is known)
        isKnownSender: (contactId, fromAddr, to) => (contactChannel?.knownSender ? contactChannel.knownSender(contactId, fromAddr, to) : true),
        notePeer,
        publishEvent,
      }),
      'chat-message': makeHandleThreadedChat({
        deliverToThread: ({ contactId, fromAddr, text, messageId, ts, replyTo }) =>
          deliverToContactThread({ contactId, fromAddr, text, messageId, ts, replyTo }),
        notePeer,
        identityOf: personOf,
        noteAnswer: (addr, requestId) => agent?.noteAnswer?.(addr, requestId),
        isKnownSender: (contactId, fromAddr, to) => (contactChannel?.knownSender ? contactChannel.knownSender(contactId, fromAddr, to) : true),
      }),
    } : {}),
    // a sealed copy pushed straight to us lands in the per-person "shared with me" store
    ...(sharedWithMeStore ? { 'shared-copy': makeHandleSharedCopy({ store: sharedWithMeStore, publishEvent }) } : {}),
  };
  return { handlers, lanes };
}
