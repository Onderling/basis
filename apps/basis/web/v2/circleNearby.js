/**
 * basis v2 — Nearby / HIER screen (web DOM renderer).
 *
 * Renders the model `buildNearbyModel` produces: header line, per-peer
 * rows (pseudonym + shared-skills + proximity), and an own-profile
 * footer showing what others see of *me*.  Pure render — host wires
 * the model + `t` + back handler.
 *
 * Web is mDNS-blind today (the substrate runs but `peers=[]`), so the
 * empty state will be the common path until -followup brings
 * a mDNS broadcast on web.  The screen still renders honestly: empty
 * list + the user's own published-skill footer so they understand
 * what others would see if they showed up.
 *
 * ── Step E additions ─────────────────────────────────────────────────────────
 * Two things the row list alone could not say:
 *
 *   • a **visibility banner** — what the device is ACTUALLY doing, taken from
 *     the transports rather than from what the screen asked for. The case that
 *     matters is the disagreement: asked to be hidden, still announcing.
 *   • **per-row actions**, which arrive already decided on the row (the
 *     controller attaches `nearbyActions`). The renderer only labels them, so
 *     web and mobile cannot drift on what proximity entitles a stranger to.
 */

import {
  NEARBY_ACTION_LABELS, NEARBY_ASK_LABELS, NEARBY_INVITE_LABELS, nearbyVisibilityKey,
} from '../../src/v2/nearbyScreen.js';
import { ASK_MAX_TEXT } from '../../src/v2/nearbyAsks.js';
import { CARD_MAX_LABEL, CARD_MAX_LINE, CHAT_MAX_TEXT } from '../../src/v2/nearbyRoom.js';

export function renderCircleNearby(container, {
  model = null,
  t,
  onBack,
  onAction = null,
  onAskAction = null,
  onCompose = null,
  composing = false,
  onSubmitAsk = null,
  notice = null,
  onToggleAllow = null,
  onSubmitCard = null,
  onSay = null,
  onInviteAction = null,
} = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.classList.add('circle-nearby');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-nearby__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  container.appendChild(back);

  const head = document.createElement('h2');
  head.className = 'circle-nearby__title';
  head.textContent = tr('circle.nearbyScreen.title');
  container.appendChild(head);

  const safeModel = model && typeof model === 'object' ? model : { rows: [], counts: { total: 0, sharingAny: 0 }, ownProfile: {}, headerLabel: '' };
  const {
    rows = [], ownProfile = {}, headerLabel = '', visibility = null, asks = [],
    allows = { card: false, chat: false }, chat = null, invites = [],
  } = safeModel;

  // ── Visibility banner ──────────────────────────────────────────────────────
  // Ordered by what a person most needs to know, not by what we asked for:
  // being visible when you asked to be hidden outranks everything else here.
  if (visibility) {
    const key = nearbyVisibilityKey(visibility);
    const banner = document.createElement('div');
    banner.className = `circle-nearby__visibility is-${key.replace(/_/g, '-')}`;
    banner.dataset.visibility = key;
    if (visibility.degraded) banner.setAttribute('role', 'alert');

    const bTitle = document.createElement('div');
    bTitle.className = 'circle-nearby__visibility-title';
    bTitle.textContent = tr(`circle.nearbyScreen.${key}_title`);
    banner.appendChild(bTitle);

    const bBody = document.createElement('div');
    bBody.className = 'circle-nearby__visibility-body';
    bBody.textContent = tr(`circle.nearbyScreen.${key}_body`);
    banner.appendChild(bBody);

    container.appendChild(banner);
  }

  const header = document.createElement('div');
  header.className = 'circle-nearby__header';
  header.textContent = headerLabel;
  container.appendChild(header);

  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'circle-nearby__empty';
    empty.textContent = tr('circle.nearbyScreen.header_empty');
    container.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'circle-nearby__list';
    for (const row of rows) {
      const el = document.createElement('div');
      el.className = 'circle-nearby__row';
      if (row.sharesAny) el.classList.add('is-sharing');
      el.dataset.peerId = row.id || '';

      const name = document.createElement('div');
      name.className = 'circle-nearby__name';
      name.textContent = row.pseudonym;
      el.appendChild(name);

      if (row.sharedSkills.length) {
        const skills = document.createElement('div');
        skills.className = 'circle-nearby__skills';
        skills.textContent = row.sharedSkills.join(', ');
        el.appendChild(skills);
      }

      if (row.card) {
        // Attached to the person, not listed separately — a face and a card are one thing on screen.
        const card = document.createElement('div');
        card.className = 'circle-nearby__card';
        const cardLine = document.createElement('div');
        cardLine.className = 'circle-nearby__card-line';
        cardLine.textContent = row.card.line || '';
        if (row.card.line) card.appendChild(cardLine);
        if (row.card.tags?.length) {
          const tags = document.createElement('div');
          tags.className = 'circle-nearby__card-tags';
          tags.textContent = row.card.tags.join(', ');
          card.appendChild(tags);
        }
        if (card.childElementCount) el.appendChild(card);
      }

      if (row.proximity) {
        const prox = document.createElement('div');
        prox.className = 'circle-nearby__proximity';
        prox.textContent = row.proximity;
        el.appendChild(prox);
      }

      // Rule (b): a stranger you can see is still a stranger. Say so, rather than
      // letting the absence of an "open" button be the only hint.

      const actions = Array.isArray(row.actions) ? row.actions : [];
      if (actions.length) {
        const bar = document.createElement('div');
        bar.className = 'circle-nearby__actions';
        for (const action of actions) {
          const labelKey = NEARBY_ACTION_LABELS[action];
          if (!labelKey) continue;   // an action the renderer does not know is not shown raw
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = `circle-nearby__action circle-nearby__action--${action}`;
          btn.dataset.action = action;
          btn.dataset.peerId = row.id || '';
          btn.textContent = tr(labelKey);
          btn.addEventListener('click', () => {
            if (typeof onAction === 'function') onAction(action, row);
          });
          bar.appendChild(btn);
        }
        if (bar.childElementCount) el.appendChild(bar);
      }

      list.appendChild(el);
    }
    container.appendChild(list);
  }

  // ── Asks (step F) ──────────────────────────────────────────────────────────
  // Every live ask is shown, matching or not. Filtering the room to what resonates with me would make it a
  // recommender — and would leak my own drivers into what I am able to see.
  // Rule (b), said ONCE for the room rather than under every stranger: a person you can see is still a
  // stranger.
  if (rows.some((row) => row?.note === 'nearby-not-member')) {
    const note = document.createElement('div');
    note.className = 'circle-nearby__note';
    note.textContent = tr('circle.nearbyScreen.not_member_note');
    container.appendChild(note);
  }
  const asksBlock = document.createElement('div');
  asksBlock.className = 'circle-nearby__asks';

  const asksTitle = document.createElement('div');
  asksTitle.className = 'circle-nearby__asks-title';
  asksTitle.textContent = tr('circle.nearbyScreen.asks_title');
  asksBlock.appendChild(asksTitle);

  if (composing) {
    // Inline, not a modal: the room stays visible while you type, which is the honest framing — you are
    // about to say something out loud in a place where you can see who is standing there.
    const form = document.createElement('form');
    form.className = 'circle-nearby__ask-form';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'circle-nearby__ask-input';
    input.maxLength = ASK_MAX_TEXT;
    input.placeholder = tr('circle.nearbyScreen.ask_placeholder');
    form.appendChild(input);

    const send = document.createElement('button');
    send.type = 'submit';
    send.className = 'circle-nearby__ask-send';
    send.textContent = tr('circle.nearbyScreen.ask_send');
    form.appendChild(send);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      if (typeof onSubmitAsk === 'function') onSubmitAsk(text);
    });
    asksBlock.appendChild(form);
    // Focus after append, so opening the composer puts the caret where the user is already looking.
    try { input.focus(); } catch { /* not focusable in a detached container */ }
  } else {
    const askBtn = document.createElement('button');
    askBtn.type = 'button';
    askBtn.className = 'circle-nearby__ask-compose';
    askBtn.textContent = tr('circle.nearbyScreen.ask_compose');
    askBtn.addEventListener('click', () => { if (typeof onCompose === 'function') onCompose(); });
    asksBlock.appendChild(askBtn);
  }

  // Result of the last action — the real reach of a broadcast, or that an answer just made me visible.
  if (notice) {
    const el = document.createElement('div');
    el.className = 'circle-nearby__notice';
    el.dataset.notice = notice.key;
    el.setAttribute('role', 'status');
    el.textContent = tr(`circle.nearbyScreen.${notice.key}`, notice.vars ?? {});
    asksBlock.appendChild(el);
  }

  if (!asks.length) {
    const none = document.createElement('div');
    none.className = 'circle-nearby__asks-empty';
    none.textContent = tr('circle.nearbyScreen.asks_empty');
    asksBlock.appendChild(none);
  } else {
    for (const entry of asks) {
      const el = document.createElement('div');
      el.className = 'circle-nearby__ask';
      if (entry.resonant) el.classList.add('is-resonant');
      el.dataset.askId = entry.ask?.id || '';

      const text = document.createElement('div');
      text.className = 'circle-nearby__ask-text';
      text.textContent = entry.ask?.text ?? '';
      el.appendChild(text);

      if (entry.resonant && entry.reason) {
        const why = document.createElement('div');
        why.className = 'circle-nearby__ask-reason';
        // Names the SHARED tags only. My own unmatched drivers never appear here.
        why.textContent = tr('circle.nearbyScreen.ask_resonant', { reason: entry.reason });
        el.appendChild(why);
      }

      // Shown to me, sent nowhere: the reminder that replying is what reveals me.
      const disclosure = document.createElement('div');
      disclosure.className = 'circle-nearby__ask-disclosure';
      disclosure.textContent = tr('circle.nearbyScreen.ask_disclosure');
      el.appendChild(disclosure);
      if (typeof entry.ask?.expiresAt === 'number') {
        const clock = document.createElement('div');
        clock.className = 'circle-nearby__ask-clock';
        clock.textContent = tr('circle.nearbyScreen.ask_expires_in', { min: Math.max(1, Math.ceil((entry.ask.expiresAt - Date.now()) / 60_000)) });
        el.appendChild(clock);
      }

      const bar = document.createElement('div');
      bar.className = 'circle-nearby__ask-actions';
      for (const action of Array.isArray(entry.actions) ? entry.actions : []) {
        const labelKey = NEARBY_ASK_LABELS[action];
        if (!labelKey) continue;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `circle-nearby__ask-action circle-nearby__ask-action--${action}`;
        btn.dataset.action = action;
        btn.dataset.askId = entry.ask?.id || '';
        btn.textContent = tr(labelKey);
        btn.addEventListener('click', () => {
          if (typeof onAskAction === 'function') onAskAction(action, entry.ask);
        });
        bar.appendChild(btn);
      }
      if (bar.childElementCount) el.appendChild(bar);

      asksBlock.appendChild(el);
    }
  }
  container.appendChild(asksBlock);

  // ── Circles being advertised here (step H) ─────────────────────────────────
  // Rendered as its own block rather than on peer rows: what matters is which CIRCLE is open, not who is
  // holding the door — and two people advertising the same circle is one thing you can join.
  const invitesBlock = document.createElement('div');
  invitesBlock.className = 'circle-nearby__invites';

  const invitesTitle = document.createElement('div');
  invitesTitle.className = 'circle-nearby__invites-title';
  invitesTitle.textContent = tr('circle.nearbyScreen.invites_title');
  invitesBlock.appendChild(invitesTitle);

  if (!invites.length) {
    const none = document.createElement('div');
    none.className = 'circle-nearby__invites-empty';
    none.textContent = tr('circle.nearbyScreen.invites_empty');
    invitesBlock.appendChild(none);
  } else {
    for (const entry of invites) {
      const el = document.createElement('div');
      el.className = 'circle-nearby__invite';
      el.dataset.circleId = entry.invite?.circleId || '';

      const name = document.createElement('div');
      name.className = 'circle-nearby__invite-name';
      name.textContent = entry.invite?.circleName || entry.invite?.circleId || '';
      el.appendChild(name);

      // On every invite: the carrier changed, the gate did not.
      const note = document.createElement('div');
      note.className = 'circle-nearby__invite-note';
      note.textContent = tr('circle.nearbyScreen.join_is_a_join');
      el.appendChild(note);

      const bar = document.createElement('div');
      bar.className = 'circle-nearby__invite-actions';
      for (const action of Array.isArray(entry.actions) ? entry.actions : []) {
        const labelKey = NEARBY_INVITE_LABELS[action];
        if (!labelKey) continue;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `circle-nearby__invite-action circle-nearby__invite-action--${action}`;
        btn.dataset.action = action;
        btn.textContent = tr(labelKey);
        btn.addEventListener('click', () => {
          if (typeof onInviteAction === 'function') onInviteAction(action, entry.invite);
        });
        bar.appendChild(btn);
      }
      if (bar.childElementCount) el.appendChild(bar);

      invitesBlock.appendChild(el);
    }
  }
  container.appendChild(invitesBlock);

  // ── Card + chat, each behind its own allow (step G) ────────────────────────
  const allowsBlock = document.createElement('div');
  allowsBlock.className = 'circle-nearby__allows';

  for (const [key, live] of [['card', allows.card], ['chat', allows.chat]]) {
    const label = document.createElement('label');
    label.className = `circle-nearby__allow circle-nearby__allow--${key}`;
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!live;
    box.dataset.allow = key;
    box.addEventListener('change', () => {
      if (typeof onToggleAllow === 'function') onToggleAllow(key, box.checked);
    });
    label.appendChild(box);
    const text = document.createElement('span');
    text.textContent = tr(`circle.nearbyScreen.allow_${key}`);
    label.appendChild(text);
    allowsBlock.appendChild(label);

    // Says what OTHERS see, not what the setting is — a setting name does not tell you its consequence.
    if (!live) {
      const off = document.createElement('div');
      off.className = `circle-nearby__allow-off circle-nearby__allow-off--${key}`;
      off.textContent = tr(`circle.nearbyScreen.allow_${key}_off`);
      allowsBlock.appendChild(off);
    }
  }
  container.appendChild(allowsBlock);

  if (allows.card) {
    const form = document.createElement('form');
    form.className = 'circle-nearby__card-form';

    const title = document.createElement('div');
    title.className = 'circle-nearby__card-title';
    title.textContent = tr('circle.nearbyScreen.card_title');
    form.appendChild(title);

    const label = document.createElement('input');
    label.type = 'text';
    label.className = 'circle-nearby__card-label';
    label.maxLength = CARD_MAX_LABEL;
    label.placeholder = tr('circle.nearbyScreen.card_label');
    form.appendChild(label);

    const line = document.createElement('input');
    line.type = 'text';
    line.className = 'circle-nearby__card-line-input';
    line.maxLength = CARD_MAX_LINE;
    line.placeholder = tr('circle.nearbyScreen.card_line');
    form.appendChild(line);

    // The consequence, next to the fields. "Everyone in this room" is not obvious from a text box.
    const who = document.createElement('div');
    who.className = 'circle-nearby__card-visible';
    who.textContent = tr('circle.nearbyScreen.card_visible_to');
    form.appendChild(who);

    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'circle-nearby__card-save';
    save.textContent = tr('circle.nearbyScreen.card_save');
    form.appendChild(save);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = label.value.trim();
      if (!name) return;
      if (typeof onSubmitCard === 'function') onSubmitCard({ label: name, line: line.value.trim() });
    });
    container.appendChild(form);
  }

  // `chat === null` means "I have not joined" — deliberately distinct from an empty conversation.
  if (Array.isArray(chat)) {
    const block = document.createElement('div');
    block.className = 'circle-nearby__chat';

    const title = document.createElement('div');
    title.className = 'circle-nearby__chat-title';
    title.textContent = tr('circle.nearbyScreen.chat_title');
    block.appendChild(title);

    // Said out loud, because a chat window normally implies history and this one has none.
    const eph = document.createElement('div');
    eph.className = 'circle-nearby__chat-ephemeral';
    eph.textContent = tr('circle.nearbyScreen.chat_ephemeral');
    block.appendChild(eph);

    if (!chat.length) {
      const empty = document.createElement('div');
      empty.className = 'circle-nearby__chat-empty';
      empty.textContent = tr('circle.nearbyScreen.chat_empty');
      block.appendChild(empty);
    } else {
      for (const m of chat) {
        const line = document.createElement('div');
        line.className = 'circle-nearby__chat-line';
        line.dataset.messageId = m.id || '';
        line.textContent = m.text;
        block.appendChild(line);
      }
    }

    const form = document.createElement('form');
    form.className = 'circle-nearby__chat-form';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'circle-nearby__chat-input';
    input.maxLength = CHAT_MAX_TEXT;
    input.placeholder = tr('circle.nearbyScreen.chat_placeholder');
    form.appendChild(input);
    const send = document.createElement('button');
    send.type = 'submit';
    send.className = 'circle-nearby__chat-send';
    send.textContent = tr('circle.nearbyScreen.chat_send');
    form.appendChild(send);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      if (typeof onSay === 'function') onSay(text);
      input.value = '';
    });
    block.appendChild(form);

    container.appendChild(block);
  }

  const footer = document.createElement('div');
  footer.className = 'circle-nearby__own';
  const ownTitle = document.createElement('div');
  ownTitle.className = 'circle-nearby__own-title';
  ownTitle.textContent = tr('circle.nearbyScreen.own_profile');
  footer.appendChild(ownTitle);
  const ownSkills = document.createElement('div');
  ownSkills.className = 'circle-nearby__own-skills';
  const skills = Array.isArray(ownProfile.publishedSkills) ? ownProfile.publishedSkills : [];
  ownSkills.textContent = skills.length
    ? skills.join(', ')
    : tr('circle.nearbyScreen.own_profile_empty');
  footer.appendChild(ownSkills);
  container.appendChild(footer);

  return container;
}
