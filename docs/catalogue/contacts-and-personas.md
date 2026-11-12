# Contacts and personas

The person's 1:1 contacts, what each contact sees of them, and who may write to them first. Started 2026-11-12 with
message requests; the rest of the area (the book, trust, personas, disclosure, Mij) is still listed in the
catalogue's baseline and moves here as it is written up.

## What a person can do

- See first messages from people they did not choose, as requests: one per sender, with the sender's card held (its
  name shown as unverified) and the turns they sent. (Listing and ignoring are built; the Contacten section, accept, and
  the door that turns a stranger's first message into a request are being built.)
- Ignore a request: it stays, marked, later messages still land on it, and it can still be accepted. The sender sees
  nothing different.
- Block someone: `/block` (basis's block set). Their messages are dropped on this device and sends to them are refused;
  the block covers every address the identity link knows for them.

## Where it lives

- The contact book: `contact` rows on the person's own-devices store, one per (self, contact):
  `apps/pinboard/src/lib/ContactBook.js`.
- Requests: `message-request` rows on the same store, beside the book and never in it, one per (self, sender):
  `apps/pinboard/src/lib/MessageRequests.js`. The type (`packages/item-types/src/types/messageRequest.js`) is an
  own-devices type; its held turns are a set that grows by union between the person's devices (keyed by message id,
  timed by the sender), pruned by a floor that merges by its maximum. Bounded by internal params: requests per self,
  turns per request, text per request, how long an ignored request is kept after its last turn. Files are never held.
- The block set: the secure agent's (`packages/secure-agent/src/mute.js`, enforced in `createSecureAgent.js` at the
  hello gate, on receive and on send), reached through basis's `mute` / `unmute` / `muted` ops.

<!-- catalogue-ops
pinboard: holdMessageRequest listMessageRequests acceptMessageRequest ignoreMessageRequest
-->

## Proof

- `apps/pinboard/test/messageRequests.test.js` — a first turn is held and writes no book row; turns land once each, in
  order; a card that does not decode or names someone else is refused; files refused; each bound drops the oldest;
  ignore keeps the request and later turns still land; an ignored request expires; requests are per self.

## Decided not to build (yet)

- A request is not a book row with a flag: every reader of the book would have to filter it, and the one that forgets
  makes a stranger a contact.
- A block does not stop a sender who makes a fresh key; the stranger budgets are the defence there.

## Open rows

- Message requests, steps 2–7: the door, accept, the circle co-member setting, receipts to accepted contacts only, the
  Contacten section, the two-phone walk.

## Decisions that bind this area

- [decisions.md](../decisions.md): the entry on message requests (to be written with the door: a card on a first message
  is held on a request, no longer added as a contact).
