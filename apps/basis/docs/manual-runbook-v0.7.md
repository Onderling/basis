# basis — manual test runbook (v0.7)

> **Audience**: Frits, running basis by hand before promoting a
> release or starting the mobile pivot.
>
> **Time**: ~30-45 minutes start-to-finish.
>
> **Goal**: catch the things automated tests can't — real file pickers,
> real OIDC consent screens, real biometric unlock, real NKN timing,
> real cross-device handoff, real LLM dispatch.

## How to use this doc

For every release that touches the chat shell or any backing app,
walk this list top-to-bottom.  Each entry is a self-contained test
with:

- **Title** — what you're verifying, in plain language
- **Steps** — exactly what to type / click
- **Pass** — what success looks like
- **Pre-reqs** — extra setup beyond a clean browser tab
- **Linked CC-*** — the journey ID from
  `Project Files/basis/cross-app-journey-coverage-2026-05-23.md`
  so the runbook stays in sync with the planning doc

Mark each as ✅ / ❌ / ⏭ (skipped, with reason) in a notebook /
runbook log as you go.  A failed item is a release-blocking bug
unless explicitly waived.

## Pre-flight

Before starting the runbook proper:

```bash
# Confirm the suites are green
pnpm --filter basis        test
pnpm --filter @onderling/secure-agent test
pnpm --filter @onderling/core        test

# Start the dev server (one tab) — keep it running
pnpm --filter basis dev
```

The web app should serve at the URL printed by Vite (typically
http://localhost:5173).  Open it in the primary browser tab.

For the two-tab / two-device sections, open a SECOND browser
window (private mode or another profile so it has its own
localStorage and therefore a distinct NKN identity).

---

## H-1 — File picker reliability (large file, Linux)

**Linked**: CC-FO.3, H-1 in the planning doc.

**Why it matters**: the file picker race fix in `99a8542` switches
to the modern `cancel` event with a longer focus fallback.  Worth
re-verifying after any change to `web/main.js`'s openFilePicker.

**Steps**

1. Tab A: `/signin` + sign in to your test pod (or skip signin —
   not required for file send)
2. Tab A: `/peer-connect` — wait until the green NKN-connected
   confirmation
3. Tab A: `/me` — copy your NKN address (`a` for short)
4. Open Tab B in a separate browser window; repeat steps 1-3,
   call its address `b`
5. Tab A: `/test-peer <b> hi` — wait a few seconds for the
   bilateral HI exchange to complete
6. Tab A: `/send-file <b>`
7. In the OS file dialog, pick a file **larger than 10MB**
   (a video clip, a large PDF, etc.)
8. Wait for the OS dialog to close

**Pass**:
- Tab A shows "📤 sent &lt;name&gt; (&lt;size&gt; bytes) → &lt;b&gt;"
- Tab B shows an embed card with the filename, MIME, size + two
  buttons [Download] and [Save to my pod]
- Click [Download] on Tab B → browser downloads the actual file
  bytes; Tab B shows "↓ Downloaded &lt;name&gt; ..."
- The downloaded file matches the original byte-for-byte
  (verify via `sha256sum` or by opening in an editor)

**Fail signals**:
- Tab A shows "File picker cancelled" even though you picked a file
- Tab A hangs (no reply within 30s)
- Tab B's card has no metadata (name/mime/size all missing)
- [Download] click produces no file at all — fixed in commit
  `<this slice>`; report regression if it recurs.  Look for
  `triggerBlobDownloadFromBase64` in `web/main.js` and the
  `downloadFile` short-circuit in `onButtonTap`.
- [Download] produces a file with wrong size or 0 bytes —
  base64 decoding bug or the file-share envelope was truncated
  in transit (check console for "[peer] file-share missing fields").

---

## H-2 — File picker on Cancel resolves quickly

**Linked**: CC-FO.3 negative case.

**Steps**

1. Tab A: `/send-file <b>` (use any peer address — doesn't have to
   be connected for this test)
2. In the OS file dialog, click **Cancel** (or press Esc)

**Pass**: Within 1-2 seconds of the dialog closing, Tab A shows
"File picker cancelled."

**Fail signals**:
- Reply takes > 5 seconds to appear (the focus-fallback timeout
  regressed)
- No reply at all (handler never resolves)

---

## H-3 — Two-tab cross-peer ping (first-send latency)

**Linked**: CC-XA.5 — exercises the bilateral HI wait fix
(`99a8542`).

**Steps**

1. Both Tab A and Tab B connected via `/peer-connect` + `/me`
2. Tab A: `/test-peer <b> hello`  (FIRST send to that address)
3. Note the time-to-reply
4. Tab A: `/test-peer <b> world`  (second send)
5. Note the time-to-reply

**Pass**:
- First send: reply within ~5 seconds.  (The factory waits up to
  5s for the bilateral HI to complete before encrypting.)
- Second send: reply within ~1 second.  Subsequent sends skip the
  HI wait (cached in `helloedPeers`).

**Fail signals**:
- First send returns "No pubKey registered for recipient ..."
  (the bilateral HI wait regressed)
- First send takes > 10s (NKN connectivity issue, not a code bug)

---

## H-4 — Cross-peer file send + receive end-to-end

**Linked**: CC-FO.3, CC-FO.5.

**Steps**

1. Both tabs at NKN-connected state (H-3's setup)
2. Tab A: `/send-file <b>` → pick a PDF or image **≤ 32KB raw**
   (the inline-NKN cap, tightened 2026-05-23 after a 117KB file
   silently failed delivery — see file-share-roundtrip.test.js).
   Larger files: out of scope until the pod-URL hand-off slice.
3. Tab B: observe the incoming embed card

**Pass**:
- Card appears in Tab B within a few seconds
- Card shows filename, size, MIME, with [Download] and [Save to my
  pod] buttons
- [Download] triggers a real browser download of the file
- Round-trip the file through `diff` / `sha256sum` — bytes match
  exactly

**Fail signals**:
- Card has empty or corrupted body
- File size mismatch
- Download produces a 0-byte file

---

## H-5 — Identity rotation visible to peer

**Linked**: CC-XA.5.

**Steps**

1. Both tabs connected; H-3 done so both can encrypt to each other
2. Tab A: `/me` — note your current pubKey (`old`)
3. Tab A: `/rotate-identity` — note the new pubKey (`new`)
4. Tab A: `/me` — confirm pubKey matches `new`, NOT `old`
5. Tab A: `/test-peer <b> hi-after-rotation`
6. Tab B: confirm the message arrives
7. Tab B: `/security-status` — Tab A's `new` pubKey should be in
   Tab B's helloed list (the new key was registered via the
   KeyRotation.broadcast envelope)

**Pass**: Rotation completes, message delivers, peer learns the new
key.  Old key has a 7-day grace period during which envelopes
encrypted to the old key still decrypt.

**Fail signals**:
- `/rotate-identity` returns an error
- Post-rotation `/test-peer` fails to deliver
- Tab B's `/security-status` shows only the OLD pubKey

---

## H-6 — Show mnemonic + auto-lock

**Linked**: CC-ST.6.

**Pre-req**: this slash command is currently STUBBED (it lives in
the design doc but isn't wired yet).  If `/show-mnemonic` isn't in
the catalogue, mark this as ⏭ and revisit when the command lands.

**Steps**

1. Tab A: `/show-mnemonic`
2. Confirm the danger prompt
3. 12 BIP-39 words appear once
4. Close / hide the reply
5. Tab A: `/show-mnemonic` (second call)

**Pass**:
- First call shows the words
- Second call shows "already revealed; locked" instead of the
  words

**Fail signals**: words appear on the second call (one-shot lock
broken).

---

## H-7 — Encrypted backup download

**Linked**: CC-ST.7.

**Pre-req**: `/backup` is stubbed; mark ⏭ until wired.

**Steps**

1. Tab A: `/backup --passphrase=hunter2-correct-horse-battery-staple`
2. Browser downloads a blob (onderling-backup-YYYY-MM-DD.json)
3. Open another tab; load `npx vitest run --reporter=verbose
   --testPathPattern=phase19` (round-trip via decryptBackup)

**Pass**: blob downloads; round-trip restores the agent identity
+ vault contents byte-for-byte.

---

## H-8 — Real Solid pod sign-in (OIDC)

**Linked**: CC-ST.8, CC-XA.4.  Belongs in `journeys-pod.test.js`
once the auto-flow is wired, but the human path is still worth
walking once per release.

**Pre-req**: a test Solid account (e.g. on solidcommunity.net).

**Steps**

1. Tab A: `/signin`
2. Pick an issuer when prompted (e.g. solidcommunity.net)
3. Browser redirects to the IdP's consent screen
4. Log in + grant consent
5. Browser redirects back to /auth-callback.html
6. Tab A: `/whoami`

**Pass**: `/whoami` returns the same WebID you signed in as.
`/me` shows the WebID bound to the agent.

**Fail signals**:
- Redirect lands on an error page
- Callback doesn't complete (session not restored)
- `/whoami` returns null after the redirect

---

## H-9 — WebAuthn / passkey unlock

**Linked**: secure-agent S3 (CC-XA — passkey opt).

**Pre-req**: a browser + OS that supports CTAP2 PRF (Chrome 113+
on macOS Touch ID / Windows Hello / Android fingerprint).

**Steps**

1. Tab A: configure factory with `webAuthnUnlock: { rpId, prfSalt }`
2. Tab A: register a new credential (`sa.passkey.register()`)
3. Reload the tab
4. Tab A: unlock via `sa.passkey.unlock()` — biometric prompt fires
5. Touch fingerprint / use Hello / present security key
6. Vault decrypts; identity restored as the same pubKey

**Pass**: biometric prompt fires; same pubKey restored without
typing a passphrase.

**Fail signals**:
- PRF_UNAVAILABLE error (authenticator doesn't support PRF —
  expected on some older keys)
- Different pubKey restored (vault encryption key mismatch)

---

## H-10 — NKN connect time

**Linked**: CC-XA — peer-connect.

**Steps**

1. Open a fresh Tab (no prior identity)
2. `/signin` (or skip — NKN doesn't need pod)
3. `/peer-connect`
4. Start a stopwatch when you hit Enter

**Pass**: NKN connects within 30 seconds.  90 seconds is the
documented worst case for first-time connections (the SDK has to
discover seed nodes).

**Fail signals**:
- Times out (>90s)
- Returns an error referencing seed nodes or relay

---

## H-11 — LLM natural-language dispatch (v0.8)

**Linked**: J3 (when v0.8 lands).

**Pre-req**: deferred to v0.8 per `/Project Files/basis/...`.
Mark ⏭ for v0.7.

**Steps (when wired)**

1. Local LLM running (Ollama with the qwen2.5 model per
   `feedback-llm-default-qwen25.md`)
2. Tab A: "add a chore for taking out the trash" (no slash)
3. The chat shell routes to household.addItem via the LLM

**Pass**: chore added; reply identical to `/add-chore taking-out-trash`.

---

## H-12 — Two-device handoff

**Linked**: stretch goal — not in v0.7 scope.

**Steps**

1. Sign in on your laptop browser
2. Sign in on your phone browser (same WebID)
3. Add a chore on the laptop
4. Phone receives the update within a few seconds

**Pass**: cross-device sync demoed.

**Fail signals**: laptop changes don't appear on phone.

---

## H-13 — Notification permission grant

**Linked**: CC-XA.8 — logs panel.

**Steps**

1. Tab A: `/peer-connect`; have at least one peer interaction
2. Browser prompts for notification permission (first run only)
3. Grant permission
4. Trigger a peer event (Tab B sends a `/test-peer` to A)
5. While Tab A is in the background, observe the system notification

**Pass**: native notification fires; clicking it focuses Tab A.

**Fail signals**: permission prompt never appears (already
granted/denied); event arrives but no notification surfaces.

---

## End-of-runbook check

Once every item above is ✅ or ⏭ (with a documented reason):

1. The 🟢 + 🟡 + 🔴 coverage matrix from the planning doc is
   fully covered for this release.
2. Promote a release tag (`v0.7.x`).
3. Snapshot this runbook's pass/fail/skip into the release notes.
4. If kicking off the mobile pivot — this runbook becomes the
   web baseline that mobile must match.

## Companion docs

- `Project Files/basis/cross-app-journey-coverage-2026-05-23.md`
  — planning doc (CC-* labels live here)
- `apps/basis/test/journeys-cross-app.test.js`
  — 🟢 automatable journeys (45 tests)
- `apps/basis/test/journeys-pod.test.js`
  — 🟡 pod-cred journeys (env-gated; 9 todo)
- `apps/basis/test/journeys-security.test.js`
  — substrate-composition safety journeys
- `apps/basis/test/journeys-user-safety.test.js`
  — user-perspective safety journeys
