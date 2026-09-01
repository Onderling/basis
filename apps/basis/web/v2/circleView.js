/**
 * basis v2 — circle content view (web DOM renderer, v2 1 5).
 *
 * The screen you land on after tapping a circle tile.  Chat-style mixed
 * message stream + inline composer.  No separate chat shell exists; chat
 * IS the circle view.
 *
 * Renders per v2 §1 board "EXAMPLE 1 · CIRCLE":
 *
 *   [← back]  Circle name  [⋯ more]
 *             N MEMBERS · functies meta
 *   ─ dated divider ─
 *   ┌─ bubble (sender)
 *   │  text
 *   │  [Ik help] [Negeer]   (per-row action chips)
 *   └─
 *   ┌─ NOTICEBOARD card
 *   │  "3 nieuwe asks vandaag."
 *   └─
 *   ┌─ AANKONDIGING card
 *   │  "Circle drinks zaterdag 17u"
 *   └─
 *   …
 *   [+] [Schrijf naar de circle…       ] [↑]
 *
 * Pure render: the host wires:
 *   - `rows`          buildCircleStream output (already scoped to this circle)
 *   - `onSend(text)`  composer submit handler
 *   - `onAction(action, row)`  per-row action chip taps
 *   - `onBack`        back-to-launcher
 *   - `more`          overflow-menu callbacks (settings / mine / files / …)
 *   - `composerPlaceholder`  circle-specific placeholder text (optional)
 *
 * Per-circle bottom tabs (CONVERSATION / NOTICEBOARD / MEMBERS etc.) live in
 * ; this slice focuses on the CONVERSATION render.
 */

import { actionsForStreamRow } from '../../src/v2/streamActions.js';
import { deliveryPresentation } from '../../src/v2/deliverySettings.js';
import { revealedMemberLabel } from '../../src/v2/circleViewAs.js';
import { renderMandateLegibility } from './mandatePicker.js';
// media — the sealed media-card chip renders via the existing shared
// domAdapter branch (renderToDom → renderMediaCard), NOT a re-implementation.
import { renderToDom } from '../../src/web/domAdapter.js';
import { renderCircleScreen } from './circleScreen.js';
import { renderCircleNoticeboard } from './circleNoticeboard.js';
import { buildAttachControl } from './attachControl.js';
import { createComposerCommands } from '../../src/v2/composerCommands.js';
import { embedChipsOf, embedTypeLabelKey, shortRef, screenForEmbedType } from '../../src/v2/embedChips.js';
// Convergence — the invite-circle feedback review renders the SAME editable per-point cards as the
// contact-thread flow (not a flattened text bubble). Shared renderer, one look across both surfaces.
import { renderReviewCards } from './contactThread.js';
// Long bot bubbles (e.g. a big verify-summary) chunk to a preview + "Show more" — shared with mobile so the
// truncation is identical across surfaces.
import { chunkBubble } from '../../src/v2/chunkBubble.js';
// D / Surface 2 — the ⋯ overflow roster is PROJECTED from manifest.actions via
// the shared selector (platform + feature gated), NOT a hardcoded MORE_ITEMS list.
import { circleActions } from '../../src/v2/actionProjection.js';
import { basisManifest } from '../../src/index.js';
import { translatorOr } from '../../src/locales/translatorOr.js';

export function renderCircleView(container, {
  circle = {},
  rows = [],
  onBack,
  onSend,
  onAction,
  onEmbedButton = null,   // S6.A — tap an inline manifest button on a bot reply
  onEmbedOpen = null,     // tap a "See also" embed chip → open the item's screen
  onReview = null,        // convergence — tap a feedback review card button (send/edit/cancel)
  onReportMessage = null, // §8 — report a message to the circle's admins (per-bubble affordance)
  more = null,
  composerPlaceholder = null,
  composerPrefill = null,   // convergence — the ✏ edit opens the composer with the point's current text
  // The label shown in the CONVERSATION chat-card's assistant-header strip (green presence
  // dot + this name). GATE: the host computes it via the shared `oneToOneBotLabel` and
  // passes a non-empty string ONLY for a genuine 1:1-with-a-bot chat; on a group circle
  // (or a 1:1-with-a-human) it passes null → NO strip. The localized default
  // (`circle.view.bot_header`) rides in as the helper's fallback for a named-less bot,
  // never as an always-on default here. Null → the chat card renders without a head.
  botLabel = null,
  // P1.7 — the viewer's conversation filter. `chatFilter` is the SHARED chip model
  // (`chatFilterChips` + the active filter); `onChatFilter(nextFilter)` is the tap. Null → no chip row,
  // exactly as before. The shell holds no filter logic: each chip already carries its `nextFilter`.
  chatFilter = null,
  onChatFilter = null,
  // per-circle bottom tabs (board Example 1-3).
  // `tabs`     `[{id, label}]` produced by `buildCircleTabs(policy, t)`
  // `activeTab` current tab id (defaults to first / 'conversation')
  // `onTab(id)` host switches its content render when a tab is tapped
  tabs = null,
  activeTab = null,
  onTab,
  // Chat ↔ Screen header pill (v2 §4 board "De mode switch").
  // `viewMode`   one of 'chat' | 'screen' (default 'chat')
  // `onViewMode(mode)`  host flips between the chat-style stream and
  //   the admin-recept'd screen-weergave.
  viewMode = 'chat',
  onViewMode,
  // α.1c — materialized screen blocks (circleRecipeBlocks.materializeRecipe).
  // null = host hasn't loaded yet (show empty-state placeholder);
  // [] = book is empty; [...] = render each block via circleScreen.
  screenBlocks = null,
  // D1 (§5A) — quickActions pill tap → host routes the feature key to a
  // circle tab / action.  Forwarded to renderCircleScreen's onAction.
  onScreenAction = null,
  // δ.2 — optimistic-send delivery state hook.
  //   `deliveryStateFor(msgId)` returns 'pending' | 'sent' | 'failed' | null
  //   `localActor`              actor stamp for locally-sent messages — only
  //                             these get a delivery icon
  //   `onRetryDelivery(msgId)`  tap-to-retry callback for 'failed' icons
  // All three are optional; when missing the bubbles render exactly as before.
  deliveryStateFor = null,
  localActor = null,
  onRetryDelivery = null,
  // Mandate ("entrust" / toevertrouwen) — the viewer's identity signals decide
  // whether the OWNER-only entrust action shows on a task-like row (the handler
  // gate is the real security boundary; this is owner-only VISIBILITY). Absent →
  // no entrust action (backwards-compatible).
  viewerWebid = null,
  viewerIsAdmin = false,
  // Composer affordances (web↔mobile parity, ported from the classic shell). Both optional — without
  // them the composer renders exactly as before.
  //   `catalogue`  the merged dispatch catalogue → drives the slash-command auto-suggest dropdown.
  //   `history`  a `createInputHistory()` instance (host-owned so it survives re-renders) → ArrowUp/Down.
  catalogue = null,
  history = null,
  // Permission gate (classic shell's `allowCommands` analog): when the circle's `chat` feature is off,
  // the composer is read-only — `canPost=false` renders a disabled note instead of the input. The host
  // computes it from `isFeatureEnabled(policy, 'chat')`.
  canPost = true,
  // Multi-field inline form (web↔mobile parity with mobile's `MultiFieldFormBubble`). When a circle
  // dispatch trips `needsForm` with 2+ missing params, the host sets `pendingForm` to the
  // `PendingFormFollowUp` (shared `src/v2/followUp.js` `beginFormFollowUp`) and the composer renders an
  // inline labelled form above it. `onFormSubmit(values)` runs the completed dispatch. Single-missing-field
  // needsForm still elicits conversationally (one bubble + the next message); this is the 2+ case only.
  pendingForm = null,
  onFormSubmit = null,
  // S1 #1 — noticeboard (noticeboard tab). When the active tab is `noticeboard`, the body
  // renders the circle noticeboard (post composer + open posts) instead of the
  // tab-coming placeholder, and the chat composer is suppressed (the noticeboard has
  // its own). `null` = host hasn't loaded it → falls back to the placeholder.
  //   `{ posts, intent, busy, onPost, onAction, onIntent }`
  noticeboard = null,
  // Taken (tasks) tab — the circle's tasks projected to stream rows via the shared
  // `buildTaskRows` (host-loaded from the composed tasks agent's `listOpen`). When the
  // active tab is `taken`, the body lists these rows with their lifecycle chips (claim /
  // done / snooze via `actionsForStreamRow`) + the owner-only "Toevertrouwen" (entrust)
  // chip — the same seam the chat stream uses. `null` = host hasn't loaded yet → the tab
  // renders its empty state (a friendly line, not the tab-coming placeholder).
  //   `onAddTask()` — the tab's compose affordance (host adds a task, then refreshes).
  tasks = null,
  onAddTask = null,
  // G16 — the real MEMBERS (members) tab. When the active tab is `members`, the body
  // lists the circle's trail-roster (the canonical Member via `normalizeCircleMembers`),
  // one tappable row per member. `members` is the host-loaded roster
  // (`[{ id, handle, realName, reveals }]`); `null` = not loaded yet → loading state,
  // `[]` = empty. `selfWebid` marks the viewer's own row ("jij"). `onMemberTap(member)`
  // opens the §2 card — a member row → their persona card, your own row → self-view;
  // the host routes by comparing `member.id` to `selfWebid`.
  members = null,
  selfWebid = null,
  revealPolicy = 'pairwise',   // the circle's realName reveal rule; gates the member labels
  onMemberTap = null,
  // Stale-rules banner: when the viewer's OWN row accepted an older rules version than the
  // circle's current one, the members tab opens with a re-accept affordance. The host wires
  // this to the acceptGroupRules op; absent → the banner still informs, without a button.
  onAcceptRules = null,
  // media — the sealed media path (live wiring). Both optional; without them the
  // composer + bubbles render exactly as before.
  //   `onAttachMedia(file)`  host runs the picked image through createMediaEmbed (sealed
  //     upload). Only wired when the circle HAS a content seal strategy — a p0/p1 circle
  //     never shows the affordance (sealed-only; no unsealed upload fallback).
  //   `media`  `{opener, openFull?}` — the circle's content OPENER, passed to the media-card
  //     chip so the sealed inline thumbnail renders; absent → the chip's mime/dims placeholder.
  //     Optional `openFull` (the gateway's gated full-size read) adds the chip's "[View]"
  //     full-image affordance; absent → thumbnail only, no View button.
  onAttachMedia = null,
  media = null,
  // (J4) — the ATTACHMENT projector's menu for the chat composer's "+". Same
  // contract as the noticeboard composer: `attachMenu` is
  // `renderAttachments(basisManifest).attachMenu` (host-computed); the FILE entry
  // (`attachFileOpId`) routes through the media pipeline (`onAttachMedia`), every
  // other entry dispatches via `onAttachCommand(entry)` (host → callSkill).
  attachMenu = [],
  attachFileOpId = 'embed-file',
  onAttachCommand = null,
  // D / Surface 2 — the circle policy the ⋯ overflow menu's feature gate reads.
  // The roster + its `requires` gates are projected from manifest.actions; this
  // is the ONLY feature-gate input (the host no longer pre-filters `more`).
  policy = null,
  t,
} = {}) {
  const tr = translatorOr(t, 'circleView.js');
  container.innerHTML = '';
  container.classList.add('circle-view');

  // Header — back · title · more.
  const header = document.createElement('div');
  header.className = 'circle-view__header';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-view__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  header.appendChild(back);

  const title = document.createElement('h2');
  title.className = 'circle-view__title';
  title.textContent = circle.name || circle.id || '';
  header.appendChild(title);

  // Chat ↔ Screen pill (v2 §4 board "De mode switch").
  // Only renders when the host wires `onViewMode`; otherwise the
  // header stays clean (some hosts may want to suppress it).
  if (typeof onViewMode === 'function') {
    const toggle = document.createElement('div');
    toggle.className = 'circle-view__view-toggle';
    toggle.setAttribute('role', 'group');
    toggle.setAttribute('aria-label', tr('circle.view.view_toggle_label'));
    for (const mode of ['chat', 'screen']) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'circle-view__view-toggle-btn';
      btn.dataset.viewMode = mode;
      if (mode === viewMode) btn.classList.add('is-active');
      btn.setAttribute('aria-pressed', mode === viewMode ? 'true' : 'false');
      btn.textContent = tr(`circle.view.view_${mode}`);
      btn.addEventListener('click', () => {
        if (mode !== viewMode) onViewMode(mode);
      });
      toggle.appendChild(btn);
    }
    header.appendChild(toggle);
  }

  const moreActions = collectMoreActions(more, tr, policy);
  if (moreActions.length > 0) {
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'circle-view__more';
    moreBtn.setAttribute('aria-label', tr('circle.view.more'));
    moreBtn.textContent = '⋯';
    moreBtn.addEventListener('click', () => {
      const menu = container.querySelector('.circle-view__more-menu');
      if (menu) menu.classList.toggle('is-open');
    });
    header.appendChild(moreBtn);
  }
  container.appendChild(header);

  if (circle.memberCount != null) {
    const meta = document.createElement('div');
    meta.className = 'circle-view__meta';
    meta.textContent = tr('circle.members', { count: circle.memberCount });
    container.appendChild(meta);
  }

  if (moreActions.length > 0) {
    const menu = document.createElement('div');
    menu.className = 'circle-view__more-menu';
    for (const a of moreActions) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'circle-view__more-item';
      item.dataset.action = a.id;
      item.textContent = a.label;
      item.addEventListener('click', () => {
        menu.classList.remove('is-open');
        a.run();
      });
      menu.appendChild(item);
    }
    container.appendChild(menu);
  }

  // body switches by active tab. CONVERSATION = the chat-style
  // bubble stream + day-dividers; all other tabs are placeholders for
  // now (per-tab content lands in -followups). Composer stays
  // pinned at the bottom regardless — per v2 §1 all 3 example boards
  // show the composer present whatever the body is.
  // `??` would treat the `Array.isArray && tabs[0]?.id` short-circuit's
  // false as non-nullish; fall back through plain `||` instead so the
  // no-tabs case ends up on 'conversation' (the CONVERSATION render path).
  const firstTabId = Array.isArray(tabs) && tabs.length > 0 ? tabs[0].id : null;
  const effectiveTab = activeTab || firstTabId || 'conversation';
  // S1 #1 — in the noticeboard tab the body owns its own composer, so the chat
  // composer + inline form below are suppressed.
  const inPrikbord = effectiveTab === 'noticeboard' && !!noticeboard;
  // P1.7 — the filter strip, above the stream and only in the conversation view. Rendering it only
  // where it applies keeps it from reading as a global control over tabs it does not touch.
  if (chatFilter && typeof onChatFilter === 'function' && effectiveTab === 'conversation' && viewMode !== 'screen') {
    container.appendChild(buildChatFilterStrip(chatFilter, onChatFilter, tr));
  }

  const body = document.createElement('div');
  body.className = 'circle-view__list';
  body.dataset.activeTab = effectiveTab;
  body.dataset.viewMode  = viewMode;
  if (viewMode === 'screen') {
    // α.1c — render the materialized recipe blocks.  `screenBlocks`
    // is an array from circleRecipeBlocks.materializeRecipe; null
    // means "host hasn't loaded yet" — show the empty-state for
    // a clean first paint.  circleScreen handles per-block status
    // (ok / empty / error) internally.
    renderCircleScreen(body, { blocks: screenBlocks ?? [], t: tr, onAction: onScreenAction, onEmbedOpen });
  } else if (effectiveTab === 'noticeboard' && noticeboard) {
    // S1 #1 — the circle noticeboard (its own composer + post list).
    renderCircleNoticeboard(body, {
      posts:    noticeboard.posts ?? [],
      intent:   noticeboard.intent ?? 'ask',
      busy:     noticeboard.busy ?? false,
      t:        tr,
      onPost:   noticeboard.onPost,
      onAction: noticeboard.onAction,
      onIntent: noticeboard.onIntent,
      // inline image attachments.
      attachment:       noticeboard.attachment ?? null,
      onAttach:         noticeboard.onAttach,
      onClearAttach:    noticeboard.onClearAttach,
      onViewAttachment: noticeboard.onViewAttachment,
      onEmbedOpen,
    });
  } else if (effectiveTab === 'tasks') {
    // Taken (tasks) tab — list the circle's tasks with their lifecycle chips + the
    // owner-only entrust chip (via the shared actionsForStreamRow). This is what makes
    // the Mandate/entrust picker reachable in the GUI.
    renderTakenTab(body, {
      tasks: Array.isArray(tasks) ? tasks : [],
      tr, onAction, onAddTask, viewerWebid, viewerIsAdmin,
    });
  } else if (effectiveTab === 'members') {
    // G16 — the real member roster (trail-derived), one tappable row per member.
    renderLedenTab(body, { members, selfWebid, revealPolicy, tr, onMemberTap, onAcceptRules });
  } else if (effectiveTab !== 'conversation') {
    const placeholder = document.createElement('div');
    placeholder.className = 'circle-view__placeholder';
    placeholder.textContent = tr('circle.view.tab_coming', {
      tab: tr(`circle.tabs.${effectiveTab}`),
    });
    body.appendChild(placeholder);
  } else if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'circle-view__empty';
    empty.textContent = tr('circle.view.empty');
    body.appendChild(empty);
  } else {
    // Render chronologically (oldest at top), grouped by day.  rows from
    // buildCircleStream are newest-first; reverse a copy so the timeline
    // reads top → bottom like a chat.
    const chronological = [...rows].reverse();
    let lastDayKey = null;
    for (const row of chronological) {
      const dayKey = dayKeyOf(row.ts);
      if (dayKey !== lastDayKey) {
        body.appendChild(renderDayDivider(row.ts, tr));
        lastDayKey = dayKey;
      }
      body.appendChild(renderBubble(row, {
        tr, onAction,
        deliveryStateFor, localActor, onRetryDelivery,
        onEmbedButton, onEmbedOpen, onReview,
        media,
        viewerWebid, viewerIsAdmin,
        onReportMessage,
      }));
    }
  }

  // Bulletin restyle — the CONVERSATION chat stream renders as ONE bot card: a header
  // strip (a green presence dot + the circle assistant's name) sitting over the message
  // log, in a single 2px-ink-bordered card (mirrors onderling.org's `.chatbox`). The
  // noticeboard / screen tabs keep the plain body — they aren't the assistant conversation.
  const isChatStream = viewMode !== 'screen' && effectiveTab === 'conversation';
  if (isChatStream) {
    const card = document.createElement('div');
    card.className = 'circle-view__chat-card';
    // Gate — the assistant-header strip (green dot + bot name) shows ONLY in a
    // genuine 1:1-with-a-bot chat. The host computes `botLabel` via the shared
    // `oneToOneBotLabel` gate; a non-empty string means "this IS a 1:1 bot chat"
    // (the localized fallback now rides through the helper, not an always-on `||`
    // here). Null/empty → group or 1:1-human → NO strip. The chat CARD itself still
    // renders for the conversation stream — only the HEAD is gated.
    if (botLabel) {
      const head = document.createElement('div');
      head.className = 'circle-view__bot-head';
      const dot = document.createElement('span');
      dot.className = 'circle-view__bot-dot';
      dot.setAttribute('aria-hidden', 'true');
      head.appendChild(dot);
      const name = document.createElement('span');
      name.className = 'circle-view__bot-name';
      name.textContent = botLabel;
      head.appendChild(name);
      card.appendChild(head);
    }
    card.appendChild(body);
    container.appendChild(card);
  } else {
    container.appendChild(body);
  }

  // Multi-field inline form (mobile parity). Rendered between the stream and the composer when the host
  // has a `pendingForm` (a 2+-missing-field needsForm). Pure render: the host owns the pending state and
  // the submit handler. Suppressed in screen-mode (not a chat surface). See `renderPendingForm`.
  if (pendingForm && viewMode !== 'screen' && !inPrikbord && typeof onFormSubmit === 'function') {
    container.appendChild(renderPendingForm(pendingForm, { tr, onFormSubmit }));
  }

  // Composer — text input + send button.  Suppressed in screen-mode
  // because the recept'd page isn't a chat surface; user flips back
  // to Chat to write something.  Also suppressed in the noticeboard tab (it
  // renders its own post composer).
  if (inPrikbord) {
    // no chat composer — the noticeboard body owns posting
  } else if (typeof onSend === 'function' && viewMode !== 'screen' && !canPost) {
    // Permission gate — chat is disabled for this circle; show a read-only note in place of the composer.
    const note = document.createElement('div');
    note.className = 'circle-view__composer-disabled';
    note.setAttribute('role', 'note');
    note.textContent = tr('circle.view.chat_disabled');
    container.appendChild(note);
  } else if (typeof onSend === 'function' && viewMode !== 'screen') {
    const form = document.createElement('form');
    form.className = 'circle-view__composer';
    form.setAttribute('autocomplete', 'off');

    // Slash-command auto-suggest dropdown (rendered first, positioned ABOVE the input via CSS). Hidden
    // until the user types a "/command" word; populated from the injected catalogue. Mirrors the classic
    // shell (#cmd-suggest); behaviour ported into the shared `suggestCommands`.
    const suggestEl = document.createElement('ul');
    suggestEl.className = 'circle-view__suggest';
    suggestEl.setAttribute('role', 'listbox');
    suggestEl.hidden = true;
    form.appendChild(suggestEl);

    // (J4) — the projector-driven "+" attach affordance (replaces the hand-coded
    // 📎). The FILE entry still routes through the sealed media pipeline
    // (`onAttachMedia`) — a p0/p1 circle wires no `onAttachMedia`, so the file entry
    // drops and only dispatchable entries (if any) remain. The menu is projected
    // from the manifest via renderAttachments (shared with the noticeboard composer).
    const attachControl = buildAttachControl({
      attachMenu, attachFileOpId,
      onAttach: onAttachMedia, onAttachCommand,
      cls: (s) => `circle-view__${s}`,
      tr, menuLabelKey: 'circle.view.attach',
    });
    if (attachControl) form.appendChild(attachControl);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'circle-view__composer-input';
    input.placeholder = composerPlaceholder ?? tr('circle.view.composer_placeholder');
    input.setAttribute('aria-label', tr('circle.view.composer_placeholder'));
    if (composerPrefill) { input.value = composerPrefill; setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 0); }
    form.appendChild(input);

    const send = document.createElement('button');
    send.type = 'submit';
    send.className = 'circle-view__composer-send';
    send.setAttribute('aria-label', tr('circle.view.send'));
    send.textContent = '↑';
    form.appendChild(send);

    // ── suggest state (local to this render; `history` is host-owned + persists across re-renders) ──
    let entries = [];
    let activeIdx = -1;

    const paintSuggest = (matches) => {
      suggestEl.innerHTML = '';
      entries = matches;
      if (!matches.length) { suggestEl.hidden = true; activeIdx = -1; return; }
      if (activeIdx < 0 || activeIdx >= matches.length) activeIdx = 0;
      matches.forEach((m, i) => {
        const li = document.createElement('li');
        li.className = `circle-view__suggest-item${i === activeIdx ? ' is-active' : ''}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', i === activeIdx ? 'true' : 'false');
        const cmd = document.createElement('span');
        cmd.className = 'circle-view__suggest-cmd';
        cmd.textContent = m.command;
        li.appendChild(cmd);
        if (m.hint) {
          const hint = document.createElement('span');
          hint.className = 'circle-view__suggest-hint';
          hint.textContent = m.hint;
          li.appendChild(hint);
        }
        // mousedown (not click) so it fires before the input's blur closes the list.
        li.addEventListener('mousedown', (ev) => { ev.preventDefault(); acceptSuggest(i); });
        suggestEl.appendChild(li);
      });
      suggestEl.hidden = false;
    };
    // What can I do HERE: the circle's own commands, then this device's own — the shared seam both
    // shells and both kinds of thread ask, so a person sees the same list wherever they type. It used to
    // read the catalogue directly, which is scoped to the circle's apps, so `/whoami` and `/logs` were
    // typeable-in-principle and undiscoverable in practice.
    const composerCommands = createComposerCommands({ kind: 'circle', catalogue });
    const refreshSuggest = () => paintSuggest(composerCommands.suggest(input.value));
    const acceptSuggest = (i) => {
      const m = entries[i];
      if (!m) return;
      input.value = `${m.command} `;          // full command + trailing space → keep typing args
      paintSuggest([]);
      input.focus();
    };

    if (catalogue) {
      input.addEventListener('input', () => { if (history) history.reset(); refreshSuggest(); });
      input.addEventListener('focus', refreshSuggest);
      // Defer so a click/mousedown on a suggestion item fires before the list closes.
      input.addEventListener('blur', () => setTimeout(() => paintSuggest([]), 120));
    }

    input.addEventListener('keydown', (e) => {
      const open = catalogue && !suggestEl.hidden && entries.length > 0;
      if (open) {
        // Dropdown navigation takes the arrow/Tab/Enter/Escape keys (classic parity).
        if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = (activeIdx + 1) % entries.length; paintSuggest(entries); return; }
        if (e.key === 'ArrowUp')   { e.preventDefault(); activeIdx = (activeIdx - 1 + entries.length) % entries.length; paintSuggest(entries); return; }
        if (e.key === 'Tab' || (e.key === 'Enter' && activeIdx >= 0)) { e.preventDefault(); acceptSuggest(activeIdx); return; }
        if (e.key === 'Escape')    { e.preventDefault(); paintSuggest([]); return; }
      }
      // Bash-style history navigation — only when the dropdown is closed.
      if (history && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (e.key === 'ArrowUp') {
          const v = history.prev(input.value);
          if (v != null) { e.preventDefault(); input.value = v; setTimeout(() => input.setSelectionRange(input.value.length, input.value.length), 0); }
        } else {
          const v = history.next();
          if (v != null) { e.preventDefault(); input.value = v; }
        }
      }
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      if (history) history.push(text);
      onSend(text);
      input.value = '';
      paintSuggest([]);
      // Keep focus so a quick burst of messages feels native.
      input.focus();
    });
    container.appendChild(form);
  }

  // per-circle bottom tab bar. Only renders when a tabs
  // list with ≥ 2 entries is supplied (a single-tab circle has no
  // bar to switch on).  The launcher's global Circles/Stroom/Mij
  // bar sits in a different DOM root, so the two never collide.
  // also suppress in screen-mode (screen is one canonical
  // page, no sub-tabs).
  if (Array.isArray(tabs) && tabs.length >= 2 && viewMode !== 'screen') {
    const bar = document.createElement('nav');
    bar.className = 'circle-view__tabs';
    bar.setAttribute('aria-label', tr('circle.view.tabs_label'));
    for (const tab of tabs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'circle-view__tab';
      btn.dataset.tab = tab.id;
      if (tab.id === effectiveTab) btn.classList.add('is-active');
      btn.textContent = tab.label ?? tr(tab.labelKey);
      btn.addEventListener('click', () => {
        if (typeof onTab === 'function' && tab.id !== effectiveTab) onTab(tab.id);
      });
      bar.appendChild(btn);
    }
    container.appendChild(bar);
  }

  // The newest bubble must be the one you can SEE.
  //
  // Bubbles render oldest-first into `.circle-view__list`, which is its own `overflow-y: auto` box, and
  // this renderer rebuilds that box from scratch on every repaint — so it came back scrolled to the TOP
  // and the message just sent sat below the fold. It reads exactly like a message that was dropped, which
  // is the same complaint the mobile Conversation produced from the same cause (web ≡ mobile).
  //
  // Belt and braces: assigned now for a container already in the document, and again on the next frame
  // for the first paint, when heights are not final yet. Guarded — a layout-less DOM (jsdom, the tests
  // here) has no `scrollHeight` worth reading and must not throw.
  if (isChatStream) {
    const toBottom = () => { try { body.scrollTop = body.scrollHeight; } catch { /* layout-less DOM */ } };
    toBottom();
    globalThis.requestAnimationFrame?.(toBottom);
  }

  return container;
}

/* ──────────────────────────────────────────────────────────────────
 * Internals
 * ────────────────────────────────────────────────────────────────── */

/**
 * Taken (tasks) tab body — a compose affordance, then one card per task with its
 * text + true status + the `actionsForStreamRow` chips (claim / done / snooze + the
 * owner-only "Toevertrouwen" entrust chip). Empty state when there are no tasks.
 *
 * The chips come from the SAME selector the chat stream uses (invariant #1/#3); the
 * host wires their taps (`onAction`) to the tasks agent + the mandate picker.
 */
function renderTakenTab(body, { tasks = [], tr, onAction, onAddTask, viewerWebid = null, viewerIsAdmin = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'circle-view__taken';

  // Compose affordance — add a task straight from the tab. `/addtask` in the composer
  // lands here too (both flow through the tasks agent); this is the explicit button.
  if (typeof onAddTask === 'function') {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'circle-view__taken-add';
    add.textContent = tr('circle.view.tasks_add');
    add.addEventListener('click', () => onAddTask());
    wrap.appendChild(add);
  }

  if (!tasks.length) {
    const empty = document.createElement('div');
    empty.className = 'circle-view__taken-empty';
    empty.textContent = tr('circle.view.tasks_empty');
    wrap.appendChild(empty);
    body.appendChild(wrap);
    return;
  }

  for (const row of tasks) {
    const card = document.createElement('div');
    card.className = 'circle-view__task';
    card.dataset.taskId = row.taskId ?? '';

    const textEl = document.createElement('div');
    textEl.className = 'circle-view__task-text';
    textEl.textContent = row.text || tr('circle.view.tasks_untitled');
    card.appendChild(textEl);

    const status = row.status ?? 'open';
    const statusEl = document.createElement('span');
    statusEl.className = `circle-view__task-status circle-view__task-status--${status}`;
    statusEl.textContent = tr(`circle.taskStatus.${status}`, { defaultValue: status });
    card.appendChild(statusEl);

    // Lifecycle + owner-only mandate chips — the SAME selector the chat stream uses.
    const actions = actionsForStreamRow(row, { viewerWebid, isAdmin: viewerIsAdmin });
    if (actions.length) {
      const actRow = document.createElement('div');
      actRow.className = 'circle-view__task-actions';
      for (const a of actions) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'circle-view__bubble-action';
        if (a.action === 'mandate') btn.classList.add('circle-view__bubble-action--mandate');
        btn.dataset.action = a.action;
        btn.textContent = tr(a.label);
        btn.addEventListener('click', () => { if (typeof onAction === 'function') onAction(a, row); });
        actRow.appendChild(btn);
      }
      card.appendChild(actRow);
    }
    wrap.appendChild(card);
  }
  body.appendChild(wrap);
}

/**
 * G16 — MEMBERS (members) tab body: one tappable row per member of the circle's
 * trail-roster (`normalizeCircleMembers` → canonical Member). A row shows the
 * member's handle + real name (whatever the roster carries), the role badge for
 * anyone who is not a plain member and HOW they came by it (made the circle ·
 * appointed by an admin · took it over because the circle had none left); the
 * viewer's own row is badged "jij". Tapping a row calls `onMemberTap(member)` — the host opens the
 * §2 card (persona for a member, self-view for your own row). Pure render: the
 * roster + the visibility logic live in shared code, this only draws + wires taps.
 *
 * `members === null` → loading; `[]` → empty; otherwise the rows.
 */
function renderLedenTab(body, { members = null, selfWebid = null, revealPolicy = 'pairwise', tr, onMemberTap, onAcceptRules = null } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'circle-view__members';

  if (members == null) {
    const loading = document.createElement('div');
    loading.className = 'circle-view__members-loading';
    loading.textContent = tr('circle.members_tab.loading');
    wrap.appendChild(loading);
    body.appendChild(wrap);
    return;
  }
  if (!members.length) {
    const empty = document.createElement('div');
    empty.className = 'circle-view__members-empty';
    empty.textContent = tr('circle.members_tab.empty');
    wrap.appendChild(empty);
    body.appendChild(wrap);
    return;
  }

  // Stale-rules banner — YOUR acceptance is older than the circle's current rules version.
  // Informative + voluntary (stale is valid; the fold never locks anyone out): one line, one button.
  const selfRow = selfWebid != null ? members.find((m) => m.id === selfWebid) : null;
  if (selfRow?.rules?.stale) {
    const banner = document.createElement('div');
    banner.className = 'circle-view__rules-banner';
    const msg = document.createElement('span');
    msg.textContent = tr('circle.members_tab.rules_banner', {
      accepted: selfRow.rules.accepted, current: selfRow.rules.current,
    });
    banner.appendChild(msg);
    if (typeof onAcceptRules === 'function') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'circle-view__rules-banner-accept';
      btn.textContent = tr('circle.members_tab.rules_banner_accept');
      btn.addEventListener('click', () => onAcceptRules());
      banner.appendChild(btn);
    }
    wrap.appendChild(banner);
  }

  for (const m of members) {
    const self = selfWebid != null && m.id === selfWebid;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `circle-view__member${self ? ' circle-view__member--self' : ''}`;
    row.dataset.memberId = m.id ?? '';
    if (self) row.dataset.self = 'true';

    // Reveal-gated (shared with mobile): the roster row carries `realName` ungated, so the label must be
    // computed, never read straight off the row — an unrevealed member shows their handle, not their name.
    const label = revealedMemberLabel(m, { viewerId: selfWebid, policy: revealPolicy });
    const primary = document.createElement('span');
    primary.className = 'circle-view__member-primary';
    primary.textContent = label.primary;
    row.appendChild(primary);

    // The real name as a secondary line — only when this viewer may actually see it.
    if (label.secondary) {
      const secondary = document.createElement('span');
      secondary.className = 'circle-view__member-secondary';
      secondary.textContent = label.secondary;
      row.appendChild(secondary);
    }

    // WHO RUNS THE CIRCLE, and how they came to. The role badge is the same rule the admin panel
    // uses (anything but a plain member), and next to it the provenance clause: they made the
    // circle, an admin appointed them, or — the one nobody chose — the circle was left without an
    // admin and the projection handed it over. Both ride the normalised member (`m.role`,
    // `m.admin`); shared code computes, this only paints. An admin whose provenance the projection
    // cannot state shows the badge alone, never a borrowed reason. web ≡ mobile.
    if (m.role && m.role !== 'member') {
      const roleEl = document.createElement('span');
      roleEl.className = 'circle-view__member-role';
      roleEl.textContent = tr(`circle.admin.role.${m.role}`);
      row.appendChild(roleEl);
      if (m.admin) {
        const via = document.createElement('span');
        via.className = `circle-view__member-via circle-view__member-via--${m.admin.via}`;
        via.dataset.adminVia = m.admin.via;
        via.textContent = tr(m.admin.labelKey);
        row.appendChild(via);
      }
    }

    // Rules acceptance — which rules version this member's signed join/re-accept carries, against
    // the circle's current one. Computed in shared code (`memberRulesStatus` rides the normalised
    // member as `m.rules`); stale is visible-but-valid, never a lockout. Pure paint here.
    if (m.rules) {
      const rules = document.createElement('span');
      rules.className = `circle-view__member-rules${m.rules.stale ? ' circle-view__member-rules--stale' : ''}`;
      rules.textContent = m.rules.stale
        ? tr('circle.members_tab.rules_stale', { accepted: m.rules.accepted, current: m.rules.current })
        : tr('circle.members_tab.rules_ok', { version: m.rules.accepted });
      row.appendChild(rules);
    }

    if (self) {
      const badge = document.createElement('span');
      badge.className = 'circle-view__member-you';
      badge.textContent = tr('circle.members_tab.you');
      row.appendChild(badge);
    }

    row.addEventListener('click', () => { if (typeof onMemberTap === 'function') onMemberTap(m); });
    wrap.appendChild(row);
  }
  body.appendChild(wrap);
}

/**
 * The delivery chip for one message — ONE builder, used by the initial render and by the targeted
 * repaint below, so a state can never look different depending on which drew it.
 *
 * @returns {HTMLElement|null} null when the state renders nothing (`show: false`, or no state yet).
 */
function buildDeliveryChip(state, { tr, onRetryDelivery = null, rowId = null } = {}) {
  const p = deliveryPresentation(state);
  if (!p) return null;
  const label = tr(p.labelKey);
  const el = document.createElement(p.retryable ? 'button' : 'span');
  el.className = `circle-view__bubble-delivery circle-view__bubble-delivery--${p.state}`;
  el.dataset.deliveryState = p.state;
  el.setAttribute('aria-label', label);
  el.title = label;
  el.textContent = p.glyph;
  if (p.retryable) {
    el.type = 'button';
    el.addEventListener('click', () => { if (typeof onRetryDelivery === 'function') onRetryDelivery(rowId); });
  } else {
    el.setAttribute('role', 'status');
  }
  return el;
}

/**
 * Repaint ONE message's delivery chip in place.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────────────────
 * The delivery ladder computes honest states — `failed` when the relay or the local hold queue gives
 * up, `stored` when the recipient's app confirms — and web painted almost none of them. The map's
 * subscriber rebuilt the whole circle view, which rebuilds the COMPOSER, so an input mid-sentence
 * lost what was typed into it. That was survivable only by narrowing the subscription to one state,
 * and the cost was the important one: a message the system had given up on kept its optimistic chip
 * indefinitely. Someone watched four messages get dropped by the relay while their screen said
 * nothing was wrong.
 *
 * Replacing one chip touches neither the composer nor the scroll position, so the narrowing is no
 * longer needed and every state can paint the moment it changes.
 *
 * A row that is not on screen (another circle open, not yet rendered) is a silent no-op — the next
 * full render reads the same map and gets the same answer.
 *
 * @param {ParentNode} root       the circle view container
 * @param {string} rowId          the message id
 * @param {string|null} state     the new delivery state
 * @returns {boolean} whether a chip was found or placed
 */
export function paintDeliveryChip(root, rowId, state, { tr, onRetryDelivery = null } = {}) {
  if (!root || !rowId || typeof tr !== 'function') return false;
  const bubble = root.querySelector(`.circle-view__bubble[data-row-id="${CSS.escape(String(rowId))}"]`);
  if (!bubble) return false;
  const existing = bubble.querySelector('.circle-view__bubble-delivery');
  const next = buildDeliveryChip(state, { tr, onRetryDelivery, rowId });
  if (!next) { existing?.remove(); return true; }   // a state that shows nothing must CLEAR the old chip
  if (existing) existing.replaceWith(next);
  else {
    // No chip yet (the message was sent in a state that shows nothing). It belongs at the end of the
    // bottom meta line, which is where the initial render puts it.
    const meta = bubble.querySelector('.circle-view__bubble-meta') ?? bubble;
    meta.appendChild(next);
  }
  return true;
}

function renderBubble(row, {
  tr, onAction,
  // δ.2 — delivery-icon plumbing; all three are optional.
  deliveryStateFor = null, localActor = null, onRetryDelivery = null,
  // S6.A — manifest-driven inline buttons carried on the bot event (payload.buttons).
  onEmbedButton = null,
  // tap a "See also" embed chip → open the referenced item's screen.
  onEmbedOpen = null,
  // convergence — a Stage-1 feedback review ({intro,points,labels}) renders as editable per-point cards.
  onReview = null,
  // media — `{opener, openFull?}` for the sealed media-card chip (inline thumbnail +
  // the optional gated full-image "[View]" affordance).
  media = null,
  // Mandate — viewer identity signals for the owner-only "entrust" action.
  viewerWebid = null, viewerIsAdmin = false,
  // §8 — report this message to the circle's admins (shown on others' human messages).
  onReportMessage = null,
} = {}) {
  const el = document.createElement('div');
  el.className = 'circle-view__bubble';
  el.dataset.rowId = row.id ?? '';

  // Bulletin restyle — the LLM-forward consent/handoff card. A bot bubble carrying
  // `payload.consent` styles as the reference card (dashed rust border, peach fill);
  // its `payload.buttons` carry `variant: 'primary' | 'secondary'` for the "ja,
  // doorsturen" / "nee, ik kies zelf" pair (rendered + wired by the embedButtons path
  // below). SEAM: nothing emits a consent bubble in the circle yet — this restyle lights
  // up when the LLM-forward consent flow stamps one. No backend consent logic is invented.
  if (row.event?.payload?.consent) el.classList.add('circle-view__bubble--consent');

  // Bulletin restyle — my own chat messages align right (me-bg block, no sender
  // header).  Same condition the delivery icon uses: a locally-authored
  // chat-message.  Without `localActor` plumbing everything renders as "others'".
  const isMine = localActor != null
    && row?.actor === localActor
    && (row?.type === 'chat-message' || row?.event?.type === 'chat-message');
  if (isMine) el.classList.add('circle-view__bubble--mine');

  // Sender label (top, small mono) — others'/bot bubbles only; my own name is noise.
  // Stamped by `chatRows` through the reveal ladder (batch 4) — the renderer only paints. An
  // unstamped row (roster still loading) shows no label; a stamped-unknown row shows the neutral
  // key. Never a payload-claimed name — that was the leak the old `pickSender` chain carried.
  const senderText = row?.senderSelf
    ? null
    : (row?.senderLabel ?? (row?.senderLabelKey ? tr(row.senderLabelKey) : null));
  if (senderText && !isMine) {
    const sender = document.createElement('div');
    sender.className = 'circle-view__bubble-sender';
    sender.textContent = senderText;
    el.appendChild(sender);
  }

  // "only you" vs "whole circle" scope — one presentation of the message's `scope`
  // data property (messageScope.js). Only on real chat bubbles; absent → 'self'.
  // Bulletin restyle: demoted from a top chip to the bottom meta line (appended
  // there below, together with delivery state + timestamp).
  const _payload = row.event?.payload;
  let scopeEl = null;
  if (_payload && _payload.kind === 'chat-message') {
    const scope = _payload.scope === 'circle' ? 'circle' : 'self';
    scopeEl = document.createElement('span');
    scopeEl.className = `circle-view__scope circle-view__scope--${scope}`;
    scopeEl.textContent = tr(`circle.scope.${scope}`);
  }

  // Kind pill (small, inline before text — matches the v2 NOTICEBOARD card
  // shape).  For chat-only messages the kind is null and no pill renders.
  const kind = pickKindLabel(row);
  if (kind) {
    const tag = document.createElement('span');
    tag.className = 'circle-view__bubble-kind';
    tag.textContent = kind;
    el.appendChild(tag);
  }

  // A Stage-1 feedback review renders as editable per-point CARDS (shared renderReviewCards), NOT the
  // flattened text — the convergence with the contact-thread flow. The event still carries `text` (the
  // intro) as a fallback for renderers that don't know `review`.
  const reviewData = row.event?.payload?.review;
  const fullText = pickRowText(row) ?? tr(`circle.streamAction.${row.type ?? 'unknown'}`) ?? '';
  const text = document.createElement('div');
  text.className = 'circle-view__bubble-text';
  if (reviewData) {
    try { el.appendChild(renderReviewCards(reviewData, tr, (b) => { if (typeof onReview === 'function') onReview(b, row); })); }
    catch { text.textContent = fullText; el.appendChild(text); }   // any render failure → the intro text still stands
  } else {
    // Chunk long BOT bubbles (verify-summary et al.) to a preview + a "Show more" toggle; short bubbles and
    // non-bot lines render whole. Same chunkBubble the mobile shell uses → identical truncation.
    const isBot = row.event?.actor === 'bot';
    const { head, rest } = isBot ? chunkBubble(fullText) : { head: fullText, rest: '' };
    if (rest === '') { text.textContent = fullText; el.appendChild(text); }
    else {
      let open = false;
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'circle-view__bubble-more';
      const paint = () => {
        text.textContent = open ? fullText : `${head}…`;
        toggle.textContent = tr(open ? 'circle.feedback.show_less' : 'circle.feedback.show_more', { defaultValue: open ? 'Show less' : 'Show more' });
      };
      toggle.addEventListener('click', () => { open = !open; paint(); });
      paint();
      el.appendChild(text);
      el.appendChild(toggle);
    }
  }

  // A message carrying an embed CARD (`payload.card`) renders it through the shared domAdapter
  // branch, which already knows every variant: a photo (`media-card`), an appointment (`time-card`),
  // a shared item (`item-card`), a file (`file-card`). This used to test `kind === 'media-card'`
  // explicitly, so the other three rendered as nothing — the adapter could paint them all along.
  // `media.opener` opens a photo's sealed inline thumbnail; no opener (or a wrong key) → the chip's
  // placeholder. Best-effort: a chip failure never eats the bubble.
  const cardEmbed = row.event?.payload?.card;
  if (cardEmbed && typeof cardEmbed.kind === 'string' && cardEmbed.kind.endsWith('-card')) {
    try {
      el.appendChild(renderToDom(
        { kind: 'embed-card', embed: cardEmbed, messageId: row.id, lifecycleState: 'live' },
        { doc: document, media: media ?? {}, t: tr },
      ));
    } catch { /* placeholder-less failure — the text line stands */ }
  }

  // Per-answer transparency badge (the site's `.msg .src` pattern) — how a BOT answer
  // came about (which layer, whether the language model was used). Rendered ONLY when the
  // message carries `payload.provenance`, and only on bot rows: a string renders verbatim
  // (a pipeline-stamped, already-localized note), an object `{ llmUsed }` localizes here.
  // SEAM: nothing stamps provenance onto circle bot replies yet, so today the badge stays
  // dormant — it lights up once the answer pipeline carries its layer/LLM provenance. It is
  // never fabricated.
  const provenance = row.event?.payload?.provenance;
  if (provenance != null && row.event?.actor === 'bot') {
    const prov = document.createElement('div');
    prov.className = 'circle-view__bubble-provenance';
    if (typeof provenance === 'string') {
      prov.textContent = provenance;
    } else {
      prov.textContent = tr(provenance.llmUsed ? 'circle.view.provenance_llm' : 'circle.view.provenance_direct');
    }
    el.appendChild(prov);
  }

  // Per-row action chips (Ik help / Negeer / Ik doe ze …).  Substrate
  // already picks the right set per row kind.  The owner-only "entrust"
  // (mandate) action rides the same seam, gated by the viewer signals.
  const rowIsOwn = localActor != null && row?.actor === localActor;
  const actions = actionsForStreamRow(row, { viewerWebid, isAdmin: viewerIsAdmin, isOwn: rowIsOwn });
  if (actions.length) {
    const actRow = document.createElement('div');
    actRow.className = 'circle-view__bubble-actions';
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'circle-view__bubble-action';
      if (a.action === 'mandate') btn.classList.add('circle-view__bubble-action--mandate');
      btn.dataset.action = a.action;
      btn.textContent = tr(a.label);
      btn.addEventListener('click', () => {
        if (typeof onAction === 'function') onAction(a, row);
      });
      actRow.appendChild(btn);
    }
    el.appendChild(actRow);
  }

  // §8 — report affordance on ANOTHER member's human message (not own, not a bot). Files a
  // `message` report into the governance report host (→ the admin Reports section).
  if (typeof onReportMessage === 'function' && !rowIsOwn && row?.actor !== 'bot' && row?.id) {
    const rep = document.createElement('button');
    rep.type = 'button';
    rep.className = 'circle-view__bubble-report';
    rep.textContent = tr('circle.governance.report_message');
    rep.addEventListener('click', () => onReportMessage(row.id, row));
    el.appendChild(rep);
  }

  // Mandate legibility — when a task row carries issued mandates
  // (`source.taskGrants`, best-effort on the event payload), show who holds what,
  // noting they lift when the task closes. Compact; the authoritative source is
  // the task item's `source.taskGrants` (surfaced when the row payload carries it).
  const taskGrants = row.event?.payload?.taskGrants
    ?? row.event?.payload?.source?.taskGrants
    ?? null;
  if (Array.isArray(taskGrants) && taskGrants.length) {
    el.appendChild(renderMandateLegibility(taskGrants, { t: tr }));
  }

  // embeds[] — cross-object "See also" chips the message carries (a bot reply
  // referencing the task/event it acted on). Title rides the embed → no resolve.
  const msgEmbeds = embedChipsOf(row.event?.payload);
  if (msgEmbeds.length) {
    const wrap = document.createElement('div');
    wrap.className = 'circle-view__embeds';
    const heading = document.createElement('span');
    heading.className = 'circle-view__embeds-label';
    heading.textContent = tr('circle.embed.see_also');
    wrap.appendChild(heading);
    for (const e of msgEmbeds) {
      const screen = screenForEmbedType(e.type);
      const tappable = !!(screen && !e.locked && typeof onEmbedOpen === 'function');
      const chip = document.createElement(tappable ? 'button' : 'span');
      if (tappable) chip.type = 'button';
      chip.className = `circle-view__embed circle-view__embed--${e.type}${tappable ? ' circle-view__embed--tappable' : ''}`;
      chip.dataset.ref = e.ref;
      const typeKey = embedTypeLabelKey(e.type);
      const typeLabel = tr(typeKey);
      const typeText = (typeLabel && typeLabel !== typeKey) ? typeLabel : e.type;
      chip.textContent = `${e.icon} ${typeText}: ${e.label ?? shortRef(e.ref)}`;
      if (tappable) chip.addEventListener('click', () => onEmbedOpen({ type: e.type, ref: e.ref, screen }));
      wrap.appendChild(chip);
    }
    el.appendChild(wrap);
  }

  // S6.A — manifest-driven inline buttons (the resurrected "inline menu"): an op
  // per item the bot's reply carried (Claim / Mark complete / RSVP …), gated by
  // appliesTo upstream. Tap dispatches the op against the item.
  const embedButtons = Array.isArray(row.event?.payload?.buttons) ? row.event.payload.buttons : [];
  if (embedButtons.length && typeof onEmbedButton === 'function') {
    const bRow = document.createElement('div');
    bRow.className = 'circle-view__bubble-actions circle-view__embed-buttons';
    for (const b of embedButtons) {
      if (!b?.opId && !b?.screen && !b?.action) continue;   // `action` = a non-circle bot's callback (general in-chat menus)
      const btn = document.createElement('button');
      btn.type = 'button';
      // S6.B — a screen button opens a panel; an inline button dispatches an op.
      const isScreen = !!b.screen;
      // Bulletin restyle — a consent-card button carries `variant` so the "ja, doorsturen"
      // (primary, filled ink) / "nee, ik kies zelf" (secondary, ink-outline) pair reads right.
      const variantCls = b.variant === 'primary' ? ' circle-view__consent-btn--primary'
        : b.variant === 'secondary' ? ' circle-view__consent-btn--secondary' : '';
      btn.className = `circle-view__bubble-action circle-view__embed-button${isScreen ? ' circle-view__screen-button' : ''}${variantCls}`;
      if (b.opId) btn.dataset.opId = b.opId;
      if (b.itemId != null) btn.dataset.itemId = String(b.itemId);
      if (b.screen) btn.dataset.screen = b.screen;
      // A `labelKey` is resolved; a literal `label` is printed as given. An op that declares neither
      // shows its id, which is honest and ugly enough to get noticed — the state 31 stoop buttons were
      // in while `labelKey` was validated and read by nothing.
      btn.textContent = (b.labelKey ? tr(b.labelKey) : null) ?? b.label ?? b.opId ?? b.screen ?? b.action;
      btn.addEventListener('click', () => onEmbedButton(b));   // pass the whole button so a non-circle source survives
      bRow.appendChild(btn);
    }
    if (bRow.childNodes.length) el.appendChild(bRow);
  }

  // δ.2 — delivery-state icon for locally-sent chat messages.  Only
  // surfaces when (a) the host supplied a lookup and (b) the bubble is a
  // locally-authored chat-message (`isMine`; other row kinds — circle-post
  // mirrors etc. — never have delivery state).  The happy path
  // ('sent' / null) renders nothing so it doesn't clutter the timeline.
  // Bulletin restyle: the icon now sits in the bottom meta line (below),
  // keeping its existing classes/roles.
  // Delivery state, driven by the SHARED presentation table (`deliverySettings.js`) rather than an
  // if/else per state. The chain this replaced knew three states and would have rendered the far-end ones
  // — `reached-device`, `stored` — as silence, in the one place they are worth showing.
  let deliveryEl = null;
  if (typeof deliveryStateFor === 'function' && isMine) {
    // States marked `show: false` render nothing — the happy path stays clean.
    deliveryEl = buildDeliveryChip(deliveryStateFor(row.id), { tr, onRetryDelivery, rowId: row.id });
  }

  // Bottom meta line (the site's `.msg .src` pattern): ONE small mono line with
  // delivery state · audience scope · timestamp, in that order.
  const metaChildren = [];
  if (deliveryEl) metaChildren.push(deliveryEl);
  if (scopeEl) metaChildren.push(scopeEl);
  const timeText = formatTimeLabel(row.ts);
  if (timeText) {
    const time = document.createElement('span');
    time.className = 'circle-view__bubble-time';
    time.textContent = timeText;
    metaChildren.push(time);
  }
  if (metaChildren.length) {
    const meta = document.createElement('div');
    meta.className = 'circle-view__bubble-meta';
    for (const c of metaChildren) meta.appendChild(c);
    el.appendChild(meta);
  }

  return el;
}

function formatTimeLabel(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Inline multi-field form bubble (web analog of mobile's `MultiFieldFormBubble`). Renders a titled card
 * with one labelled input per missing field + a submit button that stays disabled until every field has a
 * value. On submit it calls `onFormSubmit(values)` — the host completes the dispatch via
 * `completeMultiFieldFollowUp`. Pure DOM; no module state.
 *
 * @param {import('@onderling/kring-host/followUp').PendingFormFollowUp} pending
 * @param {{ tr: function, onFormSubmit: (values: Object<string,string>) => void }} ctx
 */
function renderPendingForm(pending, { tr, onFormSubmit }) {
  const fields = Array.isArray(pending?.fields) ? pending.fields : [];
  const values = Object.create(null);

  const form = document.createElement('form');
  form.className = 'circle-view__form';
  form.setAttribute('autocomplete', 'off');

  if (pending?.title) {
    const title = document.createElement('div');
    title.className = 'circle-view__form-title';
    title.textContent = pending.title;
    form.appendChild(title);
  }

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'circle-view__form-submit';
  submit.textContent = tr('chat.form_submit');

  // All fields are required (they're the op's missing required params) → submit enabled only once every
  // field is non-empty. Mirrors mobile's MultiFieldFormBubble gating.
  const refreshSubmit = () => {
    const allFilled = fields.every((f) => String(values[f.name] ?? '').trim() !== '');
    submit.disabled = !allFilled;
  };

  for (const f of fields) {
    const wrap = document.createElement('label');
    wrap.className = 'circle-view__form-field';

    const label = document.createElement('span');
    label.className = 'circle-view__form-label';
    label.textContent = f.label || f.name;
    wrap.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'circle-view__form-input';
    input.name = f.name;
    input.dataset.field = f.name;
    if (f.placeholder) input.placeholder = f.placeholder;
    input.addEventListener('input', () => { values[f.name] = input.value; refreshSubmit(); });
    wrap.appendChild(input);

    form.appendChild(wrap);
  }

  form.appendChild(submit);
  refreshSubmit();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    onFormSubmit({ ...values });
  });

  return form;
}

function renderDayDivider(ts, tr) {
  const el = document.createElement('div');
  el.className = 'circle-view__day';
  el.textContent = formatDayLabel(ts, tr);
  return el;
}

function dayKeyOf(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return 'unknown';
  const d = new Date(ts);
  // YYYY-MM-DD — local-time day key (avoid UTC drift across timezones).
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function formatDayLabel(ts, tr) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  if (sameDay)     return tr('circle.view.day_today');
  if (isYesterday) return tr('circle.view.day_yesterday');
  return d.toLocaleDateString();
}

function pickRowText(row) {
  const p = row?.event?.payload && typeof row.event.payload === 'object' ? row.event.payload : {};
  for (const k of ['text', 'title', 'body', 'name', 'message']) {
    if (typeof p[k] === 'string' && p[k]) return p[k];
  }
  return null;
}

function pickKindLabel(row) {
  const p = row?.event?.payload && typeof row.event.payload === 'object' ? row.event.payload : {};
  const k = typeof p.kind === 'string' && p.kind ? p.kind : null;
  // Don't show a kind pill for plain chat messages — they're the default.
  if (!k || k === 'message' || k === 'chat-message') return null;
  return k.toUpperCase();
}

// D / Surface 2 — the ⋯ overflow roster is PROJECTED from `manifest.actions`
// via the shared `circleActions` selector, NOT a hardcoded list (the old
// `MORE_ITEMS` literal is gone — invariants #1/#3/#4).  The roster carries the
// order + locale keys + `requires`/`platforms` gates ONCE, in the manifest.
//
// An item shows iff (a) its `requires` gate passes for `policy` AND its
// `platforms` includes web (both handled by `circleActions({policy, platform:'web'})`)
// AND (b) the host wired a `more[id]` callback for it.  Keyed by the projected
// action id, so the host's `more` object keys match the manifest ids directly
// (the mobile shell projects the SAME roster → web ≡ mobile by construction).
function collectMoreActions(more, tr, policy) {
  if (!more || typeof more !== 'object') return [];
  const out = [];
  for (const action of circleActions(basisManifest, { policy, platform: 'web' })) {
    const fn = more[action.id];
    if (typeof fn === 'function') {
      out.push({ id: action.id, label: tr(action.labelKey), run: fn });
    }
  }
  return out;
}

/**
 * P1.7 — the conversation filter strip: one chip per kind the circle allows, then the people/agents
 * chips. Pure projection of the shared model — a chip's tap just hands back its precomputed
 * `nextFilter`, so web and mobile can never drift on what a tap means.
 *
 * The wording matters here: this narrows what YOU read. It is not a circle setting and changes nothing
 * for anyone else, so the strip says so rather than looking like an admin control.
 */
function buildChatFilterStrip(model, onChatFilter, tr) {
  const strip = document.createElement('div');
  strip.className = 'circle-view__filter';
  if (model.active) strip.classList.add('circle-view__filter--active');

  const chip = (label, { selected, disabled, nextFilter, title }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'circle-view__filter-chip';
    if (selected) b.classList.add('is-on');
    b.textContent = label;
    if (title) b.title = title;
    if (disabled) {
      b.disabled = true;
      // The last remaining kind: say why rather than leaving a chip that silently does nothing.
      b.title = tr('circle.chatFilter.last_kind');
    } else {
      b.addEventListener('click', () => onChatFilter(nextFilter));
    }
    return b;
  };

  for (const c of model.kindChips ?? []) {
    strip.appendChild(chip(tr(`circle.chatFilter.kind.${c.kind}`, { defaultValue: c.kind }), c));
  }
  const sep = document.createElement('span');
  sep.className = 'circle-view__filter-sep';
  sep.setAttribute('aria-hidden', 'true');
  strip.appendChild(sep);
  for (const c of model.authorChips ?? []) {
    strip.appendChild(chip(tr(`circle.chatFilter.authors.${c.authors}`), c));
  }

  const note = document.createElement('span');
  note.className = 'circle-view__filter-note';
  note.textContent = tr('circle.chatFilter.note');
  strip.appendChild(note);
  return strip;
}
