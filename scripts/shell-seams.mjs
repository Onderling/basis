/**
 * shell-seams — the seams every shell composes, declared once; `lint-shell-seams.mjs` checks the three shells.
 *
 * The rule (CLAUDE.md invariant #2): web ≡ mobile ≡ box. The shells are thin adapters over one shared substrate,
 * and the substrate exposes SEAMS — the lane table, the contact channel, the pair roster, the own-devices
 * catch-ups — that a shell composes with its adapters. A seam a shell forgets is invisible: nothing fails,
 * the device just does not do the thing. Measured twice in one week on the box (2026-09-18/19): the device
 * runner never composed the pair roster, and keyed a contact thread by the wire address while both shells
 * key by identity. Both were found by walking, days after the seams landed on web and mobile.
 *
 * This is a text guard, on purpose: the three composition files have no runtime coverage in common (the
 * browser walks reach web, the mobile tests reach the bundle, the relay walks reach the runner — never
 * the same seam in all three). A distinctive name per seam, present in each shell's file SET, is the fact
 * this guard can check cheaply. Mobile is a set of files, not one — the pair roster's `onAdmitted` and the
 * primary-device kick live in `ChatScreen.js`, not in `agentBundle.js` — so a shell is `{ name, files }`.
 *
 * A gap a shell is KNOWN to have goes in `BASELINE` with the brief that closes it; the guard reports it and
 * stays green, and goes red when a NEW gap appears — or when a baselined gap is gone and its entry is stale.
 */

/** A seam: what it is, why every shell needs it, and the text that proves a shell composes it. `shells` narrows a
 *  seam to the shells it applies to (a view seam has no meaning on the box) — with the reason beside it. */
export const SEAMS = Object.freeze([
  // A freshly enrolled device forgets what its THROWAWAY self wrote. Every shell boots unenrolled first, writes
  // content under an identity of its own, and the ceremony then replaces that identity and its content key. The
  // box swept its own named paths from 2026-09-14; web and mobile did not, and nothing failed — which is exactly
  // why this is a seam and not a convention. All three read ONE list now (`src/v2/enrolForgets.js`); a shell
  // supplies only how its storage is reached.
  { id: 'enrol-forgets-the-throwaway-self', pattern: /runPendingForget\(/, why: 'a device that keeps a former self\'s content greets it in every circle and warns about rows it cannot open, for ever — read the ceremony\'s note as the FIRST awaited act of boot, before any store is touched' },
  // A FUNCTION profile's inbox is a door (the household bot on its own node): the shell that can run one reads the
  // profile's kind and composes the door; a shell that ran one without it would leave the bot deaf on its inbox.
  // Only the box runs a function profile today (web and mobile are a person's devices).
  // The agent speaks in the person's language only when the shell hands it its translator: without one, its own lines
  // (list and calendar defaults, task confirmations, a paused circle) come out as keys or English. The box passed it;
  // web and mobile did not (found 2026-09-29).
  { id: 'agent-translator', pattern: /createRealHouseholdAgent\(\{(?:(?!\n\s*\}\);)[\s\S])*?\n\s+t(?::\s*[\w.]+)?,/, why: 'the agent\'s own lines follow the person\'s language' },
  // A person's node folds a circle's appointments onto that circle's ONE store (`PERSON_NODE_STORE_OPTS`, beside the box's
  // `HOUSEHOLD_BOT_STORE_OPTS`): without it a person's app reads only its own calendar and never the appointments its
  // circles hold — the household bot's included (B3, 2026-10-05).
  { id: 'person-node-store', pattern: /\.\.\.PERSON_NODE_STORE_OPTS/, shells: ['web', 'mobile'], why: 'a person\'s app sees the appointments of the circles they are in' },
  // Read-then-act in a circle's chat: the engine looks at a read the model picked and acts on it. The box's runner
  // composes its own look; web and mobile compose the shared one over their gated call (found missing 2026-09-29).
  { id: 'circle-peek', pattern: /createPeek\(/, shells: ['web', 'mobile'], why: 'a circle bot acts on "haal de melk eraf" instead of showing the list' },
  // A hosted bot keeps its household's export file (the one format kept readable across versions) on its own disk,
  // one a night, so a snapshot carries it off and /import can read it back. A person's device keeps no such shelf.
  { id: 'household-export-shelf', pattern: /createExportShelf\(/, shells: ['box'], why: 'a hosted bot\'s household survives a wipe, a lost disk and a new version' },
  { id: 'bot-inbox-door', pattern: /createInboxDoor\(/, shells: ['box'], why: 'a function profile\'s contact inbox is answered by its assistant; a person\'s never is' },
  // A household bot WRITES FIRST (reminders of what people dated): only a shell that hosts a bot runs the tick. Web and
  // mobile are a person's devices and write first to nobody.
  // A hosted bot's first message is derived from what it does for that person (their role's tools, the settings).
  { id: 'bot-welcome', pattern: /welcomeLines\(/, shells: ['box'], why: 'a hosted bot tells a new person what it does for them; a person\'s device has no door to greet on' },
  // Without its model a hosted bot says what does work (the word rules, the commands) instead of "only commands".
  { id: 'bot-basic-help', pattern: /basicModeLines\(/, shells: ['box'], why: 'a person learns what to type when the model is off or down' },
  // A host has ONE clock: every timed thing it does is a job on it (lint-host-tick refuses an interval beside it). The box
  // has jobs today; web and mobile join when they have one (they tick on foreground, painting what is planned).
  { id: 'host-tick', pattern: /createHostTick\(/, shells: ['box'], why: 'the box\'s timed work (reminders, the nightly export, the model watch, the key sweep) runs on one clock in a fixed order' },
  // Planned work: a host's own typed items (the own-devices store) and the job that runs the due ones as their person.
  // The box first (the Sunday overview of the people it serves); web and mobile join when the calendar's no-circle
  // appointments move into the store and they tick on foreground.
  // The stores write behind a short debounce; a shell that goes away inside it loses the last change. Each shell flushes
  // the waiting saves when it leaves: a page on pagehide/hidden, the app on going to the background, the box on stop.
  { id: 'flush-on-exit', pattern: /flushPendingSaves\(/, why: 'a change made a moment before a reload, a closed tab, a backgrounded app or a restart is still there afterwards' },
  { id: 'own-devices-store', pattern: /createOwnDevicesStore\(|lazyOwnStore\(/, shells: ['web', 'mobile', 'box'], why: 'a host\'s own planned work (and that of the people it is the device for) is durable, sealed, and no circle\'s' },
  { id: 'intention-runner', pattern: /createIntentionRunner\(/, shells: ['box'], why: 'what is planned runs once, as its person, through the door' },
  // A change that concerns others (a new, moved or cancelled appointment; a chore given) is told to them by the door
  // that hosts the bot, at once; a person's device writes first to nobody.
  { id: 'announcer', pattern: /createAnnouncer\(/, shells: ['box'], why: 'the household hears of a shared appointment, a move or a cancel, and a chore given to them, when it happens' },
  // What is coming for me, wherever it lives (my circles' appointments, my own, my dated chores) — read on the
  // person's device, no bot (the household bot is optional). The box hosts no person, so it has no Mij.
  { id: 'planned-for-me', pattern: /plannedForMe\(/, shells: ['web', 'mobile'], why: 'a person sees what is coming for them on Mij, from every circle and their own calendar' },
  { id: 'bot-reminder-tick', pattern: /createReminderTick\(/, shells: ['box'], why: 'a hosted bot reminds its people of what they dated, on their own door; a person\'s device never writes first' },
  { id: 'lane-table',            pattern: /buildCircleLanes\(/,                 why: 'the one lane table (governance, membership, keys, tasks, chat, the own-devices handlers) — a shell wires its reactions, never a lane of its own' },
  // THE CIRCLE'S POLICY is circle state on the governance lane (2026-09-26): every shell builds the one lane, folds
  // it on the governance change (live fan + catch-up), and serves its head at catch-up — the box above all, the
  // always-on member a joiner catches up from after the lane's audit window has aged the statement out.
  { id: 'circle-policy-lane',        pattern: /makeCirclePolicyLane\(/,         why: 'the circle policy as a signed admin statement on the governance lane — one composition, a shell injects its stores' },
  { id: 'circle-policy-lane-folds',  pattern: /circlePolicyLane\??\.apply\(/,     why: 'the policy is applied where governance changes land — a shell that never folds it keeps the default posture' },
  { id: 'circle-policy-lane-serves', pattern: /circlePolicyLane\??\.preserved\(/, why: 'the winning statement is served at catch-up after the audit window — a later joiner converges from any peer' },
  { id: 'assistant-reply-line',  pattern: /assistantReplyText\(/,               why: 'the line a door speaks when the assistant did not act or was cut short ("en verder?") — one answer for every door' },
  // The assistant takes a thread's lines one turn at a time. A line the door answers itself (its pending ask, a
  // confirmation, a command) is claimed in that lane, so a line typed while the turn that asks is running answers it.
  { id: 'assistant-lane-claims-the-ask', pattern: /\bclaim:\s/,              why: 'an answer typed during the turn that asks is the answer — not a new request, not a chat line for the circle' },
  // The collect window is for a chat app (the box's Telegram door, where quick lines arrive as separate messages).
  // A circle composer passes 0: a person types one line on purpose there, and a wait on every reply reads as slow.
  { id: 'circle-composer-does-not-collect', pattern: /collectMs:\s*0\b/,   shells: ['web', 'mobile'], why: 'a circle composer does not wait for more lines before the bot answers' },
  { id: 'contact-channel',       pattern: /createContactThreadChannel\(/,        why: 'direct messages: durable threads, the person seal, the own-devices carry' },
  // A ROW is a view: only the shells that paint Contacten compose it. The box stores the thread and carries it; the
  // row appears on each painting device when the carried turn lands there. Scoped on purpose, and said here so
  // the scoping is reviewed, not assumed.
  { id: 'contact-channel-notes-the-sender', pattern: /notePeer:/,               shells: ['web', 'mobile'], why: 'whoever writes to me becomes a row in Contacten — direct or carried (2026-09-18: a carried turn with no row)' },
  { id: 'contact-channel-keys-by-identity', pattern: /identityOf:\s*\(addr\)/,  why: 'a thread is keyed by the person, whatever address the message came from (2026-09-19: the box keyed by the wire address)' },
  // Hiding a contact (L106) is on every device: the box must know who is hidden (it never carries a hidden row
  // back as shown) and must unhide when they write, or the laptop and the phone would disagree with it.
  { id: 'contact-channel-hidden',   pattern: /isHidden:/,                        why: 'a hidden contact who writes again comes back — the shell tells the channel who is hidden…' },
  { id: 'contact-channel-returned', pattern: /onReturned:/,                      why: '…and what to do when one of them lands a turn: unhide the row (and, where there is a screen, mark the thread)' },
  // The first message carries the sender's card (2026-09-21): a device that does not hand its card in leaves the
  // other side a nameless row; one that does not take a card in never names the people who write to it.
  { id: 'contact-channel-my-card',   pattern: /myCard:/,                          why: 'the first message to a contact carries my card — name, handle, where to write back, the person key' },
  { id: 'contact-channel-on-card',   pattern: /onCard:/,                          why: 'a card that arrives with a message (naming its sender) goes into the book; the book carry names them on every device' },
  { id: 'pair-roster',           pattern: /createPairRoster\(/,                 why: 'the hidden two-member circle every written-to contact gets; DMs ride it (L105)' },
  { id: 'pair-roster-lens',      pattern: /shareRelease:/,                      why: 'the founder says on a new pair circle what THIS contact\'s persona discloses — which persona a contact sees you as (the lens, persona step 3)' },
  // The create wizard founds a circle AS a persona (Frits 2026-09-24): the shell hands it the one composition that
  // says a release. A shell that forgets it creates circles where the picker is shown and nothing rides. The box
  // has no create wizard — it joins and holds circles, it does not found them from a form.
  { id: 'create-founds-as-persona', pattern: /shareFounderRelease[:=]/,         shells: ['web', 'mobile'], why: 'the persona picked in the create wizard says what it discloses in the new circle' },
  // What a contact sees of you (L125): the add sheet before a scanned card or link is added, the control on the
  // thread header after. A person picks both; the box has nobody to ask.
  { id: 'contact-lens-asks', pattern: /ContactLens|contactLens\./, shells: ['web', 'mobile'], why: 'a contact added by a person is asked first what they see of you, and it can be changed on their thread' },
  // Deleting a contact (L114) is one relationship act on every painting shell: hide + leave the pair circle, asked first.
  { id: 'contact-delete', pattern: /deleteContact\(/, shells: ['web', 'mobile'], why: 'deleting a contact hides the row AND leaves the pair circle — a shell that only hid would leave the route and its keys running' },
  // Opbergen (Frits 2026-09-24): a circle out of sight is one fact on every painting shell — the launcher folds it and its
  // menu sets it through the agent's one act. The box paints no launcher; the carry itself is in the shared agent.
  { id: 'circle-sight', pattern: /setCircleSight/, shells: ['web', 'mobile'], why: 'a circle put away on one device is out of sight on every device — a shell without the fold would show it anyway' },
  // The restore-finish flow opens after a RESTORE, never after an add-a-device from an offer (2026-09-24): both
  // painting shells ask the one rule, and paint the one outcome. The box has no screen to paint it on.
  { id: 'restore-finish-applies', pattern: /restoreFinishApplies\(/, shells: ['web', 'mobile'], why: 'an enrol from an offer is not a restore — "your circles are not here" would tell a person adding a device that their circles are gone' },
  { id: 'pair-roster-admits',    pattern: /onAdmitted/,                          why: 'the founder promotes the joiner and announces — the redeem handler\'s hook' },
  { id: 'primary-device-request', pattern: /primaryDevice\??\.requestFromSiblings/, why: 'which device is the primary contact address — asked of the siblings at boot, so a claim made elsewhere reaches here' },
  { id: 'known-peers-catchup',   pattern: /knownPeersSync/,                      why: 'who the person knows, on every device: bindings and the contact book' },
  { id: 'person-key-catchup',    pattern: /personKeySync/,                       why: 'the person key and its chain, on every device' },
  { id: 'grants-catchup',        pattern: /grantsCatchUp/,                       why: 'the grants lane: what my devices may do' },
  { id: 'circle-presence',       pattern: /registerCirclePresence/,              why: 'per-circle addresses on the relay and the announce — the three acts every device performs on connect' },
  // Siblings follow a circle (L109, 2026-09-21): a circle founded or joined on one device reaches the others. A shell
  // that hands no consume in hears the carry and joins nothing; one that never asks misses what happened while it was off.
  { id: 'circle-follow-consume', pattern: /circleFollowSync\??\.setConsume\(/,   why: 'a circle a sibling founded or joined: this device joins it by the enrol consume\'s per-circle step, composed with the shell\'s seams' },
  { id: 'circle-follow-request', pattern: /circleFollowSync\??\.requestFromSiblings/, why: 'the circles the siblings are in that this device is not — asked at connect' },
]);

/** A shell is a file SET: the files that together compose the substrate for that surface. */
export const SHELLS = Object.freeze([
  { name: 'web',    files: ['apps/basis/web/v2/circleApp.js'] },
  { name: 'mobile', files: ['apps/basis-mobile/src/core/agentBundle.js', 'apps/basis-mobile/src/screens/ChatScreen.js', 'apps/basis-mobile/src/screens/v2/CircleLauncherScreen.js', 'apps/basis-mobile/src/screens/v2/CircleMyDataScreen.js', 'apps/basis-mobile/src/screens/v2/CircleProfileScreen.js', 'apps/basis-mobile/src/screens/v2/EnrollDeviceModal.js', 'apps/basis-mobile/src/screens/v2/ContactThreadScreen.js', 'apps/basis-mobile/App.js'] },
  { name: 'box',    files: ['apps/basis/bin/device-runner.mjs', 'apps/basis/src/telegram/runner.js'] },   // the runner is the box's Telegram door
]);

/** Gaps a shell is known to have, each with what closes it. Remove the entry when the seam lands. */
export const BASELINE = Object.freeze([]);

/** Source with comments removed — a comment that EXPLAINS a seam is not the seam. */
export const code = (src) => String(src).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * Which seams each shell lacks, and which baselined gaps are stale (the seam is there after all).
 * @param {(rel: string) => string} readFile  returns a file's text, or throws
 * @returns {{ gaps: Array<{shell: string, seam: string, why: string, files: string[]}>, known: typeof BASELINE, stale: typeof BASELINE }}
 */
export function findGaps(readFile, { seams = SEAMS, shells = SHELLS, baseline = BASELINE } = {}) {
  const gaps = []; const known = []; const stale = [];
  for (const shell of shells) {
    const text = shell.files.map((f) => { try { return code(readFile(f)); } catch { return ''; } }).join('\n');
    for (const seam of seams) {
      if (Array.isArray(seam.shells) && !seam.shells.includes(shell.name)) continue;
      const present = seam.pattern.test(text);
      const listed = baseline.find((b) => b.shell === shell.name && b.seam === seam.id) ?? null;
      if (present && listed) stale.push(listed);
      if (!present && listed) known.push(listed);
      if (!present && !listed) gaps.push({ shell: shell.name, seam: seam.id, why: seam.why, files: shell.files });
    }
  }
  return { gaps, known, stale };
}
