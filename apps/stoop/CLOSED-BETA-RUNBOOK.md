# Stoop closed-beta runbook

For the facilitator running a real buurt pilot.  Companion to
[`README.md`](./README.md); skip the conceptual layering and treat
this as the operational checklist.

## What you're shipping

- **Closed-group skill app.**  Members post `vragen` / `aanbod` /
  `te leen`; replies happen in private chat threads.
- **Decentralised** — every member runs their own agent process.
  No central server holds buurt content.  A relay carries
  ciphertext only.
- **Recovery is the user's job.**  No password reset.  Members
  who lose their device + recovery phrase + encrypted backup are
  out — by design.

## Pre-flight (one-time)

```bash
cd apps/stoop
npm install
npm test                            # expect 252 tests passing
```

If any test fails, **stop**.  Do not deploy a red build to a
buurt.  Open an issue with the failing test name.

## Bring-up modes

### A. Single-machine multi-user testbed (dry-run)

The testbed launches one in-process agent per member with the
admin's invite issuer + spawn-on-redemption wired in.  Use this
to rehearse the onboarding flow with the buurt facilitators
*before* sending the real invites:

```bash
npm run testbed -- \
  --admin   https://id.example/admin \
  --members https://id.example/anne,https://id.example/bob
```

Each member gets their own UI on a local port; the launcher
prints the URLs.  No external network required.

### B. Two-device cross-device run (real transport)

Stoop V1 ships `persistPath`-based local persistence; the relay
transport story is documented in
`Project Files/coding-plans/H5-V2-resume.md`.
For a multi-device pilot: launch each member's UI on their own
machine with a stable `--persist-dir`, point all members at the
same relay URL, and verify that a post made on device A appears
on device B within ~5 seconds.

```bash
node bin/stoop-ui.js \
  --actor       https://id.example/anne \
  --group       block-42 \
  --persist-dir ./state-anne \
  --relay       wss://relay.example/p2p
```

## Onboarding a member

1. Admin generates an invite URL via `/onboard.html` (issue mode)
   or via the QR helper (`getInviteQrPayload` →
   `onderling-invite://...`).
2. New member opens the URL on their device.  The page asks them
   to:
   - Pick a per-group **handle** (`@oosterpoort-bird-23`).
   - Tap **Akkoord** on the privacy notice + group rules.  The
     gated skill (`redeemInviteWithGate`) refuses without both.
3. After redemption, send the new member to **Profiel → Toon
   herstelzin**.  They see the 12-word recovery phrase **once** —
   the skill (`getMnemonicOnce`) atomically marks it shown and
   never returns it again.  Tell the user: *write it on paper,
   don't screenshot*.
4. Have them download an **encrypted back-up** with a passphrase
   they will not forget.  This is their second-line recovery.

## Day-to-day operation

- Posts go up via `postRequest` (kind: `ask | offer | lend`).
- Replies open a chat thread via `respondToItem`; the in-app
  banner notifies the post author.
- Lend posts auto-schedule a return reminder via the notifier.
- `markReturned` closes the lend; the requester taps **Klaar**
  (`finished` button) on ask/offer.
- Reports go to admins via `reportPost`; admins read the queue
  via `listReports`.

### Mute vs report

- **Mute** is local-only.  Affects only the muting member's view.
- **Report** is admin-visible.  The post author is **not**
  notified.

### Reveals

Reveals are bilateral and per-peer-per-group.  Either side taps
"Connectie accepteren" → both sides flip locally and a
`reveal-request` envelope hints the other side to reciprocate.
A reveal cannot be coerced; both sides must independently flip.

## Operational metrics

Each agent counts user actions in-process via `UsageMetrics`.
Read the snapshot via the `getMetrics` skill (or click into a
member's UI dev console — `await callSkill('getMetrics', {})`).
Counters reset on agent restart; durable metrics are V1.5.

Useful counters for facilitator review:

| Counter | Meaning |
|---|---|
| `post-ask` / `post-offer` / `post-lend` | Activity per post type. |
| `accept-responder` | Successful matches. |
| `cancel-request` | Posts the author retracted. |
| `mark-returned` | Lends successfully closed. |
| `report-post` | Reports filed.  Cross-check with `listReports`. |
| `mute-peer` | Local mutes.  Spike → social-friction signal. |
| `chat-sent` / `chat-received` | Peer-chat traffic. |
| `reveal-request-sent` / `reveal-accept-sent` | Reveal handshakes. |
| `backup-created` | Members who downloaded an encrypted backup. |

## When something breaks

- **A member's UI shows nothing.**  Check their persist dir;
  rotate via [Phase 9](./README.md) RotationScheduler if their
  identity has expired.
- **A member can't claim a post.**  Confirm they're on the same
  `--group`; the closed-group filter rejects out-of-group claims.
- **A reveal "doesn't work".**  Reveal is bilateral; both sides
  must flip independently.  Confirm both members tapped
  "Connectie accepteren" on their own device.
- **A relay outage.**  Posts queued via `CachingDataSource` will
  flush when the relay returns.  No data loss; just delayed
  visibility.

## Boundaries (don't promise these to users)

- No password reset.  No central recovery.
- No moderation by the platform — only by group admins.
- No anonymity — this is V1; cryptographic anonymity (Q-H5) is
  V2.
- No mobile push notifications without a wired channel
  (`@onderling/notifier`'s scheduling is in-process by default).

## Where to file feedback

- Code-level issue: GitHub issue on the repo, tag `stoop-v1`.
- UX feedback from real members: facilitator collects + files
  weekly summary.  Per
  `Project Files/Stoop/advice-2026-05-05.md`
  the V1.5 priority list is driven from this loop.
