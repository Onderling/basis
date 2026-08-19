# Stoop demo script (Phases 11–22, 2026-05-06)

A 10–15 minute walk-through.  Pre-flight: `npm install && npm test`
in `apps/stoop` first; expect 378 tests passing across 34 files.

## Setup

```bash
cd apps/stoop
npm run testbed -- \
  --admin   https://id.example/admin \
  --members https://id.example/anne,https://id.example/bob
```

The launcher prints one URL per member.  Open Anne's UI in one
browser window and Bob's in another.  Two windows side-by-side is
the cleanest way to demo the peer-to-peer flow.

## Demo path

### 1. The prikbord (Phases 5, 11–13)

- Anne posts an `ask` ("kun je mijn fietsband plakken?").  Note the
  warm card layout, the "Vraag" chip, and the `Ik help` reply
  button on Bob's side.
- Bob taps "Ik help" → lands on a chat thread on the post id.
  Send "ja, morgen om 11u in de schuur".
- Anne's UI shows an in-app banner: *"Nieuw bericht: ja, morgen om
  11u in de schuur"* — tap **Open** to land on the same thread.

### 2. Identity & reveals (Phases 6, 11)

- On Anne's side, navigate to **Profiel** — show the per-group
  handle (`@oosterpoort-bird-23`) and the optional real name field.
- Show that `addedBy` on Bob's post on the prikbord renders as the
  handle, NOT the WebID.  Reveals are bilateral and per-group.
- In the chat thread, tap "Connectie accepteren" → Anne's local
  Reveal flips + a hint envelope is sent to Bob.  Bob must
  independently flip on his end for full reveal.

### 3. Recovery + backup (Phases 13.6, 17)

- On **Profiel → Herstel & back-up**, tap *Toon herstelzin*.  The
  12 words appear once, then the skill atomically locks itself.
  Demo the reload — second click shows the locked-out state.
- Enter a passphrase, click *Download back-up* — a blob downloads
  that round-trips via `decryptBackup` (see `phase19.test.js`).

### 4. Closed-beta operational dashboard (Phase 19)

- Navigate to **Metrics**.  Live UsageMetrics snapshot — `post-ask`,
  `chat-sent`, `mute-peer`, etc.  Refreshes every 5 seconds.

### 5. Pod sign-in (Phase 20)

- Navigate to **Pod**.  Type the OIDC issuer (`https://solidcommunity.net`
  or any test IdP) → **Aanmelden bij pod**.
- The page redirects to the IdP's authorize URL; complete the
  consent flow; the IdP redirects back to
  `/auth-callback.html?code=…&state=…`.
- The callback page calls `completePodSignIn`, which builds a
  `SolidPodSource` from the authenticated fetch and attaches it
  via `bundle.cache.attachInner(podSource)`.
- Verify `bundle.cache.hasInner === true`.  Subsequent posts flush
  through the queue to the pod.

If you don't have a test IdP handy, run the Phase 20 smoke test
instead (`npx vitest run test/phase20.test.js`) — it stubs Inrupt's
Session and shows the full `attachInner` wiring deterministically.

### 6. Web Push (Phase 21)

```bash
# Generate VAPID keys (one-time):
npx web-push generate-vapid-keys

# Bring up Stoop with the keys (extend bin/stoop-ui.js to forward
# --vapid-public-key + --vapid-private-key into createNeighbourhoodAgent):
npm run ui -- \
  --actor https://id.example/anne --group block-42 \
  --vapid-public-key "<pub>" --vapid-private-key "<priv>" \
  --vapid-subject "mailto:facilitator@stoop.local"
```

- Navigate to **Push**.  Tap *Push aanzetten* — browser prompts for
  Notification permission, registers `/sw.js`, calls
  `pushManager.subscribe`, posts the subscription to
  `subscribeWebPush`.
- Tap *Test-melding* — `triggerSelfPush` skill fires a payload
  through `WebPushSender` → the SW shows a real notification.

For a deterministic demo without VAPID setup, run
`npx vitest run test/phase21.test.js` — 11 tests covering registry,
sender, and skills with stubbed `web-push`.

### 7. Layer-2 personal-interest matching (Phase 22)

Open the browser devtools console on Anne's tab and run:

```js
// Score a fresh post — Layer 1 misses (category mismatch), Layer 2
// has nothing to compare against → not matched.
await callSkill('scorePostRelevance', {
  text: 'iemand die fiets band kan plakken?',
  categoryId: 'tuinieren',
});
//=> { matched: false, ... layer2: 0 }

// Have Anne respond to a few fiets-related posts (or seed the
// profile directly):
await callSkill('respondToItem', { itemId: '<post>', body: 'ik help' });

await callSkill('getInterestProfile', {});
//=> { totalDocs: N, topTerms: [{term:'fiets', weight:...}, ...] }

// Re-score the same off-category post:
await callSkill('scorePostRelevance', {
  text: 'iemand die fiets band kan plakken?',
  categoryId: 'tuinieren',
});
//=> { matched: true, via: 'interest', layer2: 0.4… }
```

The profile is per-bundle, in-memory, and resettable via
`resetInterestProfile`.

## Closing

Show the test suite pass:

```bash
npm test
```

378/378 across 34 files: the bones are in place.  V2 is mobile +
LLM-as-agent + Q-H5 anonymity per
`coding-plan-v1-2026-05-05.md`.
