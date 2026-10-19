# Web ≡ mobile — what may differ, what may not

The invariant (CLAUDE.md #2) says web and mobile are equals: one shared source, neither platform
primitive. This convention makes the invariant *practical* by naming the differences that are
legitimate. Anything different that is not covered here — or not listed in the exceptions table
below — is drift, i.e. a bug.

## May differ (platform idiom — no listing needed)

| axis | web idiom | mobile idiom |
|---|---|---|
| **Input & overlays** | dialogs, side panels, hover states | bottom sheets, FAB, long-press |
| **Platform services** | file picker, clipboard | camera/QR, share sheet, push notifications |
| **Navigation chrome** | tab bar / URL routing | stack navigation, back gesture |
| **Density & layout** | multi-column where wide | single-column, larger touch targets |
| **Fonts** | CSS token stacks | system families (undefined fontFamily = system default) |

The test for "idiom": the same op, the same name, the same consent flow — reached through a
different gesture.

## May NOT differ

- **Op coverage.** Every op a user can reach on one platform is reachable on the other, unless
  listed below with a reason and a date.
- **Vocabulary.** One concept, one name, both platforms — sourced from the shared locales
  (`apps/basis/src/locales/`), never platform-local strings for shared concepts.
- **Consent flows.** The same disclosure/consent steps in the same order. A platform may render
  a step differently; it may not skip, merge, or reorder steps.
- **Design tokens.** Colors, radii, spacing come from the shared `THEME` (src/v2/theme.js) on
  both platforms. Platform-local colour values are the drift this repo has been burned by.

## Current listed exceptions

| what | platform | why | since | exit path |
|---|---|---|---|---|
| QR **scanning** | mobile only | no camera API parity on desktop web; web shows the QR + paste-a-code path | 2026-05 | WebRTC camera capture, when worth it |
| Push **wake** (the wake-nudges toggle) | mobile only | the attention gate is BUILT (silent kinds never wake — the shared entry-kind table; recipient off-by-default via the `wake-nudges` device toggle), but only mobile has a killed-app state an OS push can wake — an open web tab already receives live. The control is declared once in the manifest; web states `canWakePush:false` and the toggle greys with its honest why | 2026-08 | a web-push service worker, if a closed-tab web wake is ever worth its metadata |
| Where an accepted **device offer** lands you | web opens the add-a-device flow; mobile says where to finish it | Both shells recognise an offer for another of your own devices in both its carriers (the scanned code and the clickable link) and both STORE it — the offer is public data and carries no authority, so storing it is the whole of what accepting can do. The difference is the last step: web reads the link out of its own address bar on the screen that also hosts the flow, so it opens it; on mobile the link arrives at the chat shell while the ceremony lives on the Mij screen, so it names where to go rather than reaching across screens | 2026-09 | a cross-screen open signal (the shape `contactReplyInbox` already uses), if the extra tap proves to be one too many |
| The **In de buurt** tab (`nearby`, `MESH_TABS`; its words `circle.nearbyScreen.*`, `circle.nearby.*`) | mobile only | the tab is the local mesh, and a browser has none: no mDNS, and Web Bluetooth can neither scan nor advertise. Both shells decide through the one `isAlphaTab` (a shell says whether it has a mesh) | 2026-10-18 (Frits: "only on mobile for now") | a local node the browser can reach |
| A circle's ⋯ **Share** screen (`share`, `platforms: ['mobile']`) | mobile only — and hidden on both by the alpha today | there is no web share screen yet; the gap was declared in the manifest when the ⋯ menu was projected (2026-07-08) rather than hand-coded per shell. The admin's outbound shares and Stop sharing are on both shells' admin panels (L351) | 2026-07 | a web share screen, when the alpha widens |
| How a bot's **identity link** reaches the app | web reads it from its own address bar; mobile pastes it in My data | the same idiom split as the device offer: on web the link opens the app with it in the address, so the sheet reads it there; on mobile the link lands outside the screen that links a bot, so My data takes it pasted. What the link does (the identity-link sheet, the same checks) does not differ | 2026-10 | a cross-screen open signal, if the paste proves one step too many |
| The **first-run welcome** (`circle.firstRun.*`) | mobile only | shown once on a clean phone install, before any identity exists (Start · I have a recovery phrase). Web starts at the app and offers the phrase where it is used (the restore and add-device ceremonies), so it has no welcome screen of its own | 2026-07 | a web first-run screen, if web ever gets an install moment of its own |
| Legacy ChatScreen (invisible peer-wiring host) | mobile only | v1 residue; keeps inbound routing alive until the port lands | 2026-05 | retire with the chat-surface completion |
| Light/dark **toggle** — live recolour of onboarding screens | mobile only (v1 residue) | the systeem/licht/donker toggle + reactive theme context ship on both (shared `themePref` contract, one storage key); **every v2 screen now recolours live** — each reads the theme via `useTheme()` at render and builds styles with `makeStyles(theme)`, so a systeem/licht/donker flip repaints immediately. The only module-load holdouts are the three pre-v2 onboarding screens (`FirstRunWelcomeScreen`, `MnemonicCreateScreen`, `MnemonicEntryScreen`), which run before the in-app toggle is reachable, so live-recolour there is moot | 2026-07 | convert the onboarding screens to `useTheme()` / `makeStyles(theme)` if/when they gain an in-flow toggle |

Add a row when you consciously ship a one-platform feature; remove it when parity lands. A row may name the locale keys or key prefixes (`circle.x.*`) of its surface in backticks: `lint-locale-key-parity` reads them as declared, so a one-sided key that is a decision is not mistaken for a gap. The
surface-coverage snapshot (`npm run coverage` in `apps/basis`) is the mechanical side of this
check — an op present in one platform's projector output and absent from the other's must have a
row here.
