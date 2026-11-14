# Contacts and personas

The person's 1:1 contacts, what each contact sees of them, and who may write to them first. Started 2026-11-12 with
message requests; the rest of the area (the book, trust, personas, disclosure, Mij) is still listed in the
catalogue's baseline and moves here as it is written up.

## What a person can do

- See first messages from people they did not choose, as requests: one per sender, with the sender's card held (its
  name shown as unverified) and the turns they sent. Known senders are let on as before: own devices, members of a
  circle the person is in, contacts in the book, and anyone the person wrote to first.
- Accept a request: the held card becomes a contact (as a scanned card does) and the held messages move into the
  thread, in order. (The Contacten section that offers it is still being built.)
- Choose, per persona, who may write first: `request` (the default for a person) or `open` (anyone, within the
  stranger budgets; the default for a bot, and the feedback persona's).
- Choose, per persona, whether people in its circles may write to it first (default on). On: a member of one of THAT
  persona's circles, as this device's own roster shows them, gets a thread but no contact row; answering them makes
  them a contact. Off: their first private message is a request. Circles of another persona do not count.
  Switched off after a member already wrote: answered, they are a contact and let on; never answered, their next
  message is a request without a card, shown by their name in the circle, and accepting it moves the messages into the
  thread without a book row (the row comes when the person answers).
  Both choices are on each persona's card in Mij (web and phone), each saying what it does.
- Ignore a request: it stays, marked, later messages still land on it, and it can still be accepted. The sender sees
  nothing different.
- Never lose a message at the door: a message the request cannot hold as it came (no card, a card naming someone else,
  a file, too large) is held anyway without what it could not keep, and the refusal is in the device's log with its
  reason (`apps/basis/src/v2/refusalLog.js`, the door's codes held against their sources by
  `refusalCodesCoverTheDoor.test.js`).
- Block someone, on this device: `/block`. Direct contact only: their direct messages, requests, files and answers are
  refused before anything is kept, and a direct message to them is refused with the reason. Circles are untouched (their
  posts still arrive, yours still reach them); the block covers every address the identity link knows for them.

## Where it lives

- The contact book: `contact` rows on the person's own-devices store, one per (self, contact):
  `apps/pinboard/src/lib/ContactBook.js`.
- Requests: `message-request` rows on the same store, beside the book and never in it, one per (self, sender):
  `apps/pinboard/src/lib/MessageRequests.js`. The type (`packages/item-types/src/types/messageRequest.js`) is an
  own-devices type; its held turns are a set that grows by union between the person's devices (keyed by message id,
  timed by the sender), pruned by a floor that merges by its maximum. Bounded by internal params: requests per self,
  turns per request, text per request, how long an ignored request is kept after its last turn. Files are never held.
- The door: `apps/basis/src/v2/messageRequestDoor.js` (over the stranger budgets of `inboundAdmission.js`), composed by
  the contact channel on every shell (seam `contact-channel-requests`); the agent's `messageRequests` answers the
  persona's policy for the address a turn arrived on. Accept: `apps/basis/src/v2/messageRequestAccept.js`. The policy:
  the profile property `firstMessages` (`packages/agent-registry/src/firstMessages.js`).
- The two choices on a persona's card: `apps/basis/src/v2/firstContact.js` (the controls, read through the registry's
  readers, so the defaults live once), carried on each card by `buildMijViewModel`, painted by web `circleMij.js` and
  mobile `CircleMijScreen.js`; written through `agents.setProfileProperty` on that persona (the op the agent's own
  setters use).
- Shared contact links: `shared-card` rows on the same store, one per link handed out, for the persona shared as:
  `apps/pinboard/src/lib/SharedCards.js` (type `packages/item-types/src/types/sharedCard.js`, own-devices). Each
  "Share my contact" mints a new 128-bit token; its first opener is let on, anyone after is a request. The use is a
  first-wins claim (the store's claim channel), so the person's devices agree on one opener. Bounded by internal params:
  how long a link lives, how many unused links a persona keeps. The link carries the token in its fragment after the
  card (`apps/basis/src/v2/contactCardLink.js`); the opener's contact row keeps it (`linkToken`) and the first turn to
  them carries it inside the person seal, then drops it. The door (`messageRequestDoor.js`, `useLink` / `letOnByLink`
  on the agent's `messageRequests`) gives the first opener the circle member's treatment: a thread, no book row until
  the person answers; Contacten names them from the card their turn carried (`nameLinkOpeners`). Reachable by a link
  lasts as long as the link: an opener the person never answered is a requester again once the link's row expires
  (30 days; an expired row goes on the next share), so answering is what keeps them.
- The block set: the secure agent's (`packages/secure-agent/src/mute.js`, enforced in `createSecureAgent.js` at the
  hello gate, on receive and on send), reached through basis's `mute` / `unmute` / `muted` ops.

<!-- catalogue-ops
pinboard: holdMessageRequest listMessageRequests acceptMessageRequest ignoreMessageRequest removeMessageRequest
pinboard: mintSharedCard listSharedCards withdrawSharedCard useSharedCard clearContactLinkToken
-->

## Proof

- `apps/basis/test/v2/firstContactControls.test.js` — the two controls, their words in both languages, the registry's
  defaults per persona card, and both shells writing them for that persona through the waist.
- `apps/basis/test/messageRequestDoor.relay.test.js` — a stranger's first turn is a request with no row, no pair circle
  and no thread turn; accept; a chosen contact lands as before; someone the person wrote to first is not a request.
- `apps/basis/test/messageRequestPersona.relay.test.js` — each persona's own policy decides, and a request is filed
  under the persona the message was written to.
- `apps/basis/test/alphaFeedbackPath.relay.test.js` — a tester's feedback reaches the open feedback persona's box.

- `apps/pinboard/test/messageRequests.test.js` — a first turn is held and writes no book row; turns land once each, in
  order; a card that does not decode or names someone else is refused; files refused; each bound drops the oldest;
  ignore keeps the request and later turns still land; an ignored request expires; requests are per self.

## Decided not to build (yet)

- A request is not a book row with a flag: every reader of the book would have to filter it, and the one that forgets
  makes a stranger a contact.
- A block does not stop a sender who makes a fresh key; the stranger budgets are the defence there.
- Requests are bounded per self; a flood of fresh keys past that bound evicts the oldest OPEN requests once the ignored
  ones are gone, so a real first message can be lost under a flood. The stranger budgets (turns per key per day, all
  strangers per hour) are the defence; nothing beyond them.
- On accept, the held turns go onto the thread ordered by the SENDER's time (their clock, not this device's arrival).
- A persona whose policy is `open` also takes files and threaded answers from someone it does not know: intended for the
  feedback persona (a tester sends a screenshot).
- An address the door cannot place on one of the device's personas is decided as `request`, never by the primary
  persona's policy.
- Whether the person wrote to a sender first is read from the threads on each stranger's turn; within the stranger
  budgets that is cheap, and a memo comes only if it shows.

## Open rows

- Message requests, steps 2–7: the door, accept, the circle co-member setting, receipts to accepted contacts only, the
  Contacten section, the two-phone walk.

## Decisions that bind this area

- [decisions.md](../decisions.md): 2026-11-12, a first message from someone you did not choose is a request; the persona
  decides who may write first.
