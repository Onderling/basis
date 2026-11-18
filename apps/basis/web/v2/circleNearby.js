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
 * Below the "you here" row the room is two tabs, Conversation and Questions; what each holds and in what order
 * is `nearbyTabs` (shared with the phone), and each part has its own painter below. Conversation paints the stream
 * `nearbyStream` orders (chat lines, question cards, offered-circle cards); each tab's count of what is new is
 * `nearbyTabNews`.
 *
 * Two things the row list alone could not say:
 *
 *   • a **visibility banner** — what the device is ACTUALLY doing, taken from
 *     the transports rather than from what the screen asked for. The case that
 *     matters is the disagreement: asked to be hidden, still announcing.
 *   • **per-row actions**, which arrive already decided on the row (the
 *     controller attaches `nearbyActions`). The renderer only labels them, so
 *     web and mobile cannot drift on what proximity entitles a stranger to.
 */

import { NEARBY_LEVELS, nearbyLevelLabelKey } from '../../src/v2/nearbyLevel.js';
import {
  NEARBY_ACTION_LABELS, NEARBY_ASK_LABELS, NEARBY_INVITE_LABELS, nearbyVisibilityKey,
} from '../../src/v2/nearbyScreen.js';
import { ASK_MAX_TEXT } from '../../src/v2/nearbyAsks.js';
import { CARD_MAX_LABEL, CARD_MAX_LINE, CHAT_MAX_TEXT } from '../../src/v2/nearbyRoom.js';
import { translatorOr } from '../../src/locales/translatorOr.js';
import { nearbyTabs } from '../../src/v2/nearbyTabs.js';
import { nearbyStream, nearbyTabNews } from '../../src/v2/nearbyStream.js';
import { nearbyMenu } from '../../src/v2/nearbyMenu.js';
import { nearbyWizardStep, nearbyCardTags } from '../../src/v2/nearbyWizard.js';

export function renderCircleNearby(container, {
  model = null,
  roomSelf = null,   // { view: nearbyRoomSelfView(...), onPick(selfId) } — who this device enters the room as
  t,
  onBack,
  onAction = null,
  onAskAction = null,
  onCompose = null,
  composing = false,
  onSubmitAsk = null,
  notice = null,
  level = null,          // the room self's Nearby level (null while it is being read)
  wizard = null,         // { step, notice?, onPress(press, input) } — the first-time wizard while it is open, or null
  onLevelChange = null,
  onToggleAllow = null,
  onSubmitCard = null,
  onPrefillCard = null,   // async () => ({label?}) — only what the room self's level releases
  onSay = null,
  onInviteAction = null,
  onShareCard = null,     // (answerFrom, event) — 'deel je kaart' on an answer to my ask; the press goes with it
  onSetQuiet = null,      // (bool) — "even stil" for this once; the controller's setQuiet (a host with a radio control)
  onSetRadio = null,      // ('on'|'off') — the persisted radio switch; the controller's setRadio
  onHereChoose = null,    // ('visible'|'quiet'|'off') — the gear menu's choice; the host runs `nearbyHereChoose`
  onIntroAgain = null,    // () — the gear menu's "read the introduction again"
} = {}) {
  const tr = translatorOr(t, 'circleNearby.js');
  container.innerHTML = '';
  container.classList.add('circle-nearby');

  // no "← circles": Nearby is a tab of its own, not a page under Circles

  const head = document.createElement('h2');
  head.className = 'circle-nearby__title';
  head.textContent = tr('circle.nearbyScreen.title');
  // the title row: the title, and the gear right after it (not at the right edge: the header's help and avatar are there)
  const topRow = document.createElement('div');
  topRow.className = 'circle-nearby__top';
  topRow.appendChild(head);
  container.appendChild(topRow);

  // THE GEAR: everything about how you are here sits behind it (`nearbyMenu`), not on the page;
  // its glyph is the stylesheet's (a button with a name, no untranslated text)
  const gear = document.createElement('button');
  gear.type = 'button';
  gear.className = 'circle-nearby__gear';
  gear.setAttribute('aria-label', tr('circle.nearbyScreen.menu_title'));
  gear.title = tr('circle.nearbyScreen.menu_title');
  gear.hidden = !!wizard;   // while the wizard is open it is the page; its last line says where the gear holds it all
  topRow.appendChild(gear);

  const safeModel = model && typeof model === 'object' ? model : { rows: [], counts: { total: 0, sharingAny: 0 }, ownProfile: {}, headerLabel: '' };
  const {
    rows = [], ownProfile = {}, headerLabel = '', visibility = null, asks = [],
    allows = { card: false, chat: false }, chat = null, invites = [],
  } = safeModel;

  // THE FIRST TIME: three steps (`nearbyWizardStep`), before anything else; what a press writes is the host's
  // (`nearbyWizardPress`), so this paints the step and hands the press with what its fields hold
  if (wizard && typeof wizard.onPress === 'function') {
    const spec = nearbyWizardStep(wizard.step, { selfView: roomSelf?.view ?? null, offers: ownProfile?.publishedSkills ?? [], chat: !!allows?.chat });
    const wz = document.createElement('div');
    wz.className = `circle-nearby__wizard circle-nearby__wizard--step${spec.step}`;
    wz.setAttribute('role', 'group');
    const text = (cls, key, vars) => {
      const el = document.createElement('div');
      el.className = `circle-nearby__wizard-${cls}`;
      el.textContent = tr(key, vars);
      wz.appendChild(el);
      return el;
    };
    text('head', spec.head.key, spec.head.vars);
    text('title', spec.titleKey);
    text('text', spec.textKey);
    const nameOf = (c) => (c.nameKey ? tr(c.nameKey) : c.name);
    const shown = (c) => (c.general ? tr(spec.generalKey, { name: nameOf(c) }) : nameOf(c));
    const fields = {};
    if (spec.step === 1) {
      text('label', spec.appearAsKey);
      for (const c of spec.selves) {
        const lbl = document.createElement('label');
        lbl.className = 'circle-nearby__wizard-self';
        const radio = document.createElement('input');
        radio.type = 'radio'; radio.name = 'nearby-wizard-self'; radio.value = c.id; radio.checked = spec.selected === c.id;
        radio.addEventListener('change', () => roomSelf?.onPick?.(c.id));
        lbl.appendChild(radio);
        lbl.appendChild(document.createTextNode(shown(c)));
        wz.appendChild(lbl);
      }
      text('under', spec.underKey);
    } else if (spec.step === 2) {
      const input = (cls, key, max, placeholderKey) => {
        const lbl = document.createElement('label');
        lbl.className = `circle-nearby__wizard-field circle-nearby__wizard-field--${cls}`;
        lbl.appendChild(document.createTextNode(tr(key)));
        const el = document.createElement('input');
        el.type = 'text'; el.maxLength = max;
        if (placeholderKey) el.placeholder = tr(placeholderKey);
        lbl.appendChild(el);
        wz.appendChild(lbl);
        return el;
      };
      fields.label = input('name', spec.nameKey, CARD_MAX_LABEL, null);
      fields.line = input('line', spec.lineKey, CARD_MAX_LINE, spec.lineExampleKey);
      // pre-filled from what this room may see of the self, as the card editor's "fill in" does; the person still reads it
      Promise.resolve(typeof onPrefillCard === 'function' ? onPrefillCard() : null).then((got) => {
        if (typeof got?.label === 'string' && got.label && !fields.label.value) fields.label.value = got.label.slice(0, CARD_MAX_LABEL);
      }).catch(() => {});
      fields.offers = offersPicker(wz, spec.offers);
      text('under', spec.underKey);
    } else {
      const box = text('box', spec.boxKey);
      box.setAttribute('role', 'note');
      const lbl = document.createElement('label');
      lbl.className = 'circle-nearby__wizard-chat';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = spec.chat.on;   // sets: local:basis.nearbyAllows — the chat allow, written on Klaar
      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(tr(spec.chat.key)));
      wz.appendChild(lbl);
      fields.chat = cb;
      text('under', spec.underKey);
    }
    if (wizard.notice) text('notice', `circle.nearbyScreen.${wizard.notice}`);
    const bar = document.createElement('div');
    bar.className = 'circle-nearby__wizard-buttons';
    const selfName = (() => { const c = spec.selves?.find((x) => x.id === spec.selected) ?? spec.selves?.[0]; return c ? nameOf(c) : ''; })();
    for (const b of spec.buttons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `cc-btn ${b.id === 'yes' || b.id === 'next' || b.id === 'done' ? 'cc-btn--primary' : 'cc-btn--quiet'} circle-nearby__wizard-${b.id}`;
      btn.dataset.press = b.id;
      btn.textContent = tr(b.key, { name: selfName });
      btn.addEventListener('click', () => wizard.onPress(b.id, {
        label: fields.label?.value ?? '', line: fields.line?.value ?? '', chat: fields.chat ? fields.chat.checked : false,
        ...(fields.offers ? fields.offers.read() : {}),
      }));
      bar.appendChild(btn);
    }
    wz.appendChild(bar);
    container.appendChild(wz);
    return;   // while the wizard is open it is the page
  }

  // ── Visibility banner ──────────────────────────────────────────────────────
  // Ordered by what a person most needs to know, not by what we asked for:
  // being visible when you asked to be hidden outranks everything else here.
  if (visibility) {
    const key = nearbyVisibilityKey(visibility);
    const banner = document.createElement('div');
    banner.className = `circle-nearby__visibility is-${key.replace(/_/g, '-')}`;
    banner.dataset.visibility = key;
    if (visibility.degraded) banner.setAttribute('role', 'alert');

    // The sentence behind the state, one tap away rather than three lines on every open. A degraded
    // state keeps its sentence in view: that one is a warning, not an explanation.
    const bBody = document.createElement('div');
    bBody.className = 'circle-nearby__visibility-body';
    bBody.textContent = tr(`circle.nearbyScreen.${key}_body`);

    if (visibility.degraded) {
      const bTitle = document.createElement('div');
      bTitle.className = 'circle-nearby__visibility-title';
      bTitle.textContent = tr(`circle.nearbyScreen.${key}_title`);
      banner.appendChild(bTitle);
      banner.appendChild(bBody);
    } else {
      // THE STATE LINE IS THE AFFORDANCE. It used to be a title above a `<summary>` holding "…",
      // which rendered as a bare "▶ …" under the state — a control that named nothing and looked
      // like a rendering fault (walked 2026-08-31). Mobile had it right: the state line itself is
      // what you press. Putting the title in the summary says what opening it will explain, and
      // makes the two shells the same gesture.
      // …and it opens the gear menu, where the state is changed (one menu, not a second sheet behind the line)
      const line = document.createElement('button');
      line.type = 'button';
      line.className = 'circle-nearby__visibility-title';
      line.textContent = tr(`circle.nearbyScreen.${key}_title`);
      line.addEventListener('click', () => openMenu('main'));
      banner.appendChild(line);
    }

    container.appendChild(banner);
  }

  const header = document.createElement('div');
  header.className = 'circle-nearby__header';
  header.textContent = headerLabel;
  container.appendChild(header);

  // ── Behind the gear: how you are here, who you appear as, the card and the offer, the chat switch ────────
  const menuEl = paintMenu();
  container.appendChild(menuEl);
  gear.addEventListener('click', () => openMenu(menuEl.hidden ? 'main' : ''));

  // ── The two tabs ───────────────────────────────────────────────────────────
  // What each tab holds, in what order, and which one opens first is `nearbyTabs` (shared with the phone); a part
  // with nothing in it is not in its list, so it is not painted. Which tab is selected is this painter's own state,
  // kept on the container so a redraw (a peer arriving, the composer opening) does not jump back.
  const PAINTERS = {
    'nearby-chat': paintChat,
    'nearby-chat-off': paintChatOff,
    'nearby-ask-field': paintAskField,
    'nearby-ask-off': paintAskOff,
    'nearby-my-asks': paintMyAsks,
    'nearby-asks': paintAsks,
    'nearby-peers': paintPeers,
    'nearby-invites': paintInvites,
  };
  const { tabs, defaultTab, chatOff, askOff } = nearbyTabs(safeModel);
  const kept = container.dataset.nearbyTab;
  let selected = tabs.some((x) => x.id === kept) ? kept : defaultTab;
  // What is new on each tab (`nearbyTabNews`). The seen-marks are paint state, on the container like the picked tab:
  // the open tab is seen up to its latest arrival, so only the other tab counts up.
  const seenKey = (id) => `nearbySeen${id[0].toUpperCase()}${id.slice(1)}`;
  const seen = () => Object.fromEntries(tabs.map((x) => [x.id, Number(container.dataset[seenKey(x.id)]) || 0]));
  const markSeen = (id) => {
    const { latest } = nearbyTabNews(safeModel, seen());
    container.dataset[seenKey(id)] = String(latest[id] ?? 0);
  };
  const tabLabel = (tab, counts) => (counts[tab.id] > 0
    ? tr('circle.nearbyScreen.tab_with_new', { label: tr(tab.labelKey), count: counts[tab.id] })
    : tr(tab.labelKey));

  const bar = document.createElement('div');
  bar.className = 'circle-nearby__tabs';
  bar.setAttribute('role', 'tablist');
  container.appendChild(bar);
  const buttons = [];
  const panels = [];
  const select = (id) => {
    selected = id;
    markSeen(id);
    const { counts } = nearbyTabNews(safeModel, seen());
    for (const b of buttons) {
      const tab = tabs.find((x) => x.id === b.dataset.tab);
      b.textContent = tabLabel(tab, counts);
      b.dataset.newCount = String(counts[tab.id] ?? 0);
      const on = b.dataset.tab === id;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.classList.toggle('is-selected', on);
    }
    for (const p of panels) p.hidden = p.dataset.tab !== id;
  };
  for (const tab of tabs) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `circle-nearby__tab circle-nearby__tab--${tab.id}`;
    b.dataset.tab = tab.id;
    b.setAttribute('role', 'tab');
    b.textContent = tr(tab.labelKey);
    b.addEventListener('click', () => { container.dataset.nearbyTab = tab.id; select(tab.id); });
    bar.appendChild(b);
    buttons.push(b);

    const panel = document.createElement('div');
    panel.className = `circle-nearby__panel circle-nearby__panel--${tab.id}`;
    panel.dataset.tab = tab.id;
    panel.setAttribute('role', 'tabpanel');
    for (const id of tab.sections) {
      const el = PAINTERS[id]?.();
      if (!el) continue;
      el.dataset.section = id;
      panel.appendChild(el);
    }
    container.appendChild(panel);
    panels.push(panel);
  }
  select(selected);
  // Focus after the panels are in place and shown, so opening the composer puts the caret where the user looks.
  if (composing) { try { container.querySelector('.circle-nearby__ask-input')?.focus(); } catch { /* not focusable in a detached container */ } }

  return container;

  // ── Section painters (each returns one element; `nearbyTabs` decides whether it is called) ─────────────

  function paintChatOff() {
    // No stream (`nearbyChatOff`): hidden from the room, or not in the chat. One line, and the existing act that ends
    // it — leaving "even stil", the radio back on, or the chat allow. No button when this host cannot carry the act.
    const el = document.createElement('div');
    el.className = 'circle-nearby__chat-off';
    el.dataset.reason = chatOff?.reason ?? '';
    const hidden = chatOff?.reason === 'hidden';
    const line = document.createElement('div');
    line.className = 'circle-nearby__chat-off-line';
    line.textContent = tr(hidden ? 'circle.nearbyScreen.chat_hidden_line' : 'circle.nearbyScreen.allow_chat_off');
    el.appendChild(line);
    const ACTS = {
      join: typeof onToggleAllow === 'function' ? () => onToggleAllow('chat', true) : null,
      unquiet: typeof onSetQuiet === 'function' ? () => onSetQuiet(false) : null,
      'radio-on': typeof onSetRadio === 'function' ? () => onSetRadio('on') : null,
    };
    const act = ACTS[chatOff?.act];
    if (act || !hidden) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `cc-btn cc-btn--quiet ${hidden ? 'circle-nearby__chat-visible' : 'circle-nearby__chat-join'}`;
      btn.dataset.act = chatOff?.act ?? '';
      btn.textContent = tr(hidden ? 'circle.nearbyScreen.chat_hidden_action' : 'circle.nearbyScreen.allow_chat');
      btn.addEventListener('click', () => act?.());
      el.appendChild(btn);
    }
    return el;
  }

  function paintAskOff() {
    // Hidden from the room (`nearbyAskOff`): no composer to type a whole question into and then be refused; the hidden
    // line and the same way to become visible as the Conversation tab. The last action's notice stays in view.
    const el = document.createElement('div');
    el.className = 'circle-nearby__ask-off';
    const line = document.createElement('div');
    line.className = 'circle-nearby__ask-off-line';
    line.textContent = tr('circle.nearbyScreen.ask_hidden_line');
    el.appendChild(line);
    const act = { unquiet: typeof onSetQuiet === 'function' ? () => onSetQuiet(false) : null,
      'radio-on': typeof onSetRadio === 'function' ? () => onSetRadio('on') : null }[askOff?.act];
    if (act) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cc-btn cc-btn--quiet circle-nearby__ask-visible';
      btn.dataset.act = askOff.act;
      btn.textContent = tr('circle.nearbyScreen.chat_hidden_action');
      btn.addEventListener('click', act);
      el.appendChild(btn);
    }
    if (notice) el.appendChild(paintNotice());
    return el;
  }

  function paintNotice() {
    const el = document.createElement('div');
    el.className = 'circle-nearby__notice';
    el.dataset.notice = notice.key;
    el.setAttribute('role', 'status');
    el.textContent = tr(`circle.nearbyScreen.${notice.key}`, notice.vars ?? {});
    return el;
  }

  function paintChat() {
    // One stream in the order things arrived (`nearbyStream`): the room's chat lines, and between them a card for each
    // question someone here asked and each circle offered here. A card is boxed and headed ("Vraag van …"), so it does
    // not read as a chat line: only answering it shows you to the asker.
    const block = document.createElement('div');
    block.className = 'circle-nearby__chat';

    // Said out loud, because a chat window normally implies history and this one has none.
    const eph = document.createElement('div');
    eph.className = 'circle-nearby__chat-ephemeral';
    eph.textContent = tr('circle.nearbyScreen.chat_ephemeral');
    block.appendChild(eph);

    const stream = nearbyStream(safeModel);
    if (!stream.length) {
      const empty = document.createElement('div');
      empty.className = 'circle-nearby__chat-empty';
      empty.textContent = tr('circle.nearbyScreen.chat_empty');
      block.appendChild(empty);
    } else {
      for (const item of stream) {
        if (item.kind === 'ask') { block.appendChild(askCard(item.entry, { inStream: true })); continue; }
        if (item.kind === 'invite') { block.appendChild(inviteCard(item.entry, { inStream: true })); continue; }
        const m = item.line;
        const line = document.createElement('div');
        line.className = 'circle-nearby__chat-line';
        line.dataset.messageId = m.id || '';
        if (m.mine) line.dataset.mine = 'true';
        // who said it and when (shared `nearbyChatLines`), then the words
        const meta = document.createElement('div');
        meta.className = 'circle-nearby__chat-meta';
        meta.textContent = [m.who, m.when].filter(Boolean).join(' · ');
        const words = document.createElement('div');
        words.className = 'circle-nearby__chat-text';
        words.textContent = m.text;
        line.append(meta, words);
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
    send.className = 'cc-btn cc-btn--quiet circle-nearby__chat-send';
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
    return block;
  }

  function paintAskField() {
    const block = document.createElement('div');
    block.className = 'circle-nearby__ask-field';
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
      send.className = 'cc-btn cc-btn--quiet circle-nearby__ask-send';
      send.textContent = tr('circle.nearbyScreen.ask_send');
      form.appendChild(send);

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        if (typeof onSubmitAsk === 'function') onSubmitAsk(text);
      });
      block.appendChild(form);
    } else {
      const askBtn = document.createElement('button');
      askBtn.type = 'button';
      askBtn.className = 'cc-btn cc-btn--primary circle-nearby__ask-compose';
      askBtn.textContent = tr('circle.nearbyScreen.ask_compose');
      askBtn.addEventListener('click', () => { if (typeof onCompose === 'function') onCompose(); });
      block.appendChild(askBtn);
    }

    // Result of the last action — the real reach of a broadcast, or that an answer just made me visible.
    if (notice) block.appendChild(paintNotice());
    return block;
  }

  function paintMyAsks() {
    const block = document.createElement('div');
    block.className = 'circle-nearby__my-asks';
    for (const e of Array.isArray(model?.myAsks) ? model.myAsks : []) {
      const mineRow = document.createElement('div');
      mineRow.className = 'circle-nearby__my-ask';
      mineRow.textContent = tr('circle.nearbyScreen.my_ask_row', {
        heard: e.heard, min: Math.max(1, Math.ceil(((e.ask?.expiresAt ?? Date.now()) - Date.now()) / 60_000)),
      });
      block.appendChild(mineRow);
      // the answers stay here, under my ask: no thread opens; sharing my card is the way to a contact
      for (const a of Array.isArray(e.answers) ? e.answers : []) {
        const who = a.label ?? String(a.from ?? '').slice(0, 8);
        const ans = document.createElement('div');
        ans.className = 'circle-nearby__answer';
        ans.dataset.from = a.from ?? '';
        const line = document.createElement('div');
        line.textContent = tr('circle.nearbyScreen.answer_row', { name: who, text: a.text ?? '' });
        ans.appendChild(line);
        if (typeof onShareCard === 'function') {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'cc-btn cc-btn--quiet circle-nearby__share-card';
          btn.textContent = tr('circle.nearbyScreen.share_card_with', { name: who });
          btn.addEventListener('click', (ev) => onShareCard(a.from, ev));
          ans.appendChild(btn);
        }
        block.appendChild(ans);
      }
    }
    return block;
  }

  function paintAsks() {
    // Every live ask is shown, matching or not. Filtering the room to what resonates with me would make it a
    // recommender — and would leak my own drivers into what I am able to see.
    const asksBlock = document.createElement('div');
    asksBlock.className = 'circle-nearby__asks';

    const asksTitle = document.createElement('div');
    asksTitle.className = 'circle-nearby__asks-title';
    asksTitle.textContent = tr('circle.nearbyScreen.asks_title');
    asksBlock.appendChild(asksTitle);

    for (const entry of asks) asksBlock.appendChild(askCard(entry));
    return asksBlock;
  }

  /** Someone's question: in the Questions tab, and as a card in the Conversation stream (headed with who asked). */
  function askCard(entry, { inStream = false } = {}) {
    const el = document.createElement('div');
    el.className = 'circle-nearby__ask';
    if (entry.resonant) el.classList.add('is-resonant');
    el.dataset.askId = entry.ask?.id || '';
    if (inStream) {
      el.classList.add('circle-nearby__stream-card');
      el.dataset.streamKind = 'ask';
      const headLine = document.createElement('div');
      headLine.className = 'circle-nearby__stream-head';
      headLine.textContent = tr('circle.nearbyScreen.stream_ask_from', { name: entry.who ?? '' });
      el.appendChild(headLine);
    }

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

    const actionBar = document.createElement('div');
    actionBar.className = 'circle-nearby__ask-actions';
    for (const action of Array.isArray(entry.actions) ? entry.actions : []) {
      const labelKey = NEARBY_ASK_LABELS[action];
      if (!labelKey) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `cc-btn cc-btn--quiet circle-nearby__ask-action circle-nearby__ask-action--${action}`;
      btn.dataset.action = action;
      btn.dataset.askId = entry.ask?.id || '';
      btn.textContent = tr(labelKey);
      btn.addEventListener('click', () => {
        if (typeof onAskAction === 'function') onAskAction(action, entry.ask);
      });
      actionBar.appendChild(btn);
    }
    if (actionBar.childElementCount) el.appendChild(actionBar);
    return el;
  }

  function paintPeers() {
    const block = document.createElement('div');
    block.className = 'circle-nearby__peers';
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

      const actions = Array.isArray(row.actions) ? row.actions : [];
      if (actions.length) {
        const actionBar = document.createElement('div');
        actionBar.className = 'circle-nearby__actions';
        for (const action of actions) {
          const labelKey = NEARBY_ACTION_LABELS[action];
          if (!labelKey) continue;   // an action the renderer does not know is not shown raw
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = `cc-btn cc-btn--quiet circle-nearby__action circle-nearby__action--${action}`;
          btn.dataset.action = action;
          btn.dataset.peerId = row.id || '';
          btn.textContent = tr(labelKey);
          btn.addEventListener('click', () => {
            if (typeof onAction === 'function') onAction(action, row);
          });
          actionBar.appendChild(btn);
        }
        if (actionBar.childElementCount) el.appendChild(actionBar);
      }

      list.appendChild(el);
    }
    block.appendChild(list);
    // Rule (b), said ONCE for the room rather than under every stranger: a person you can see is still a stranger.
    if (rows.some((row) => row?.note === 'nearby-not-member')) {
      const note = document.createElement('div');
      note.className = 'circle-nearby__note';
      note.textContent = tr('circle.nearbyScreen.not_member_note');
      block.appendChild(note);
    }
    return block;
  }

  function paintInvites() {
    // Its own block rather than on peer rows: what matters is which CIRCLE is open, not who is holding the door —
    // and two people advertising the same circle is one thing you can join.
    const invitesBlock = document.createElement('div');
    invitesBlock.className = 'circle-nearby__invites';

    const invitesTitle = document.createElement('div');
    invitesTitle.className = 'circle-nearby__invites-title';
    invitesTitle.textContent = tr('circle.nearbyScreen.invites_title');
    invitesBlock.appendChild(invitesTitle);

    for (const entry of invites) invitesBlock.appendChild(inviteCard(entry));
    return invitesBlock;
  }

  /** A circle offered here: in the Questions tab, and as a card in the Conversation stream (headed with who offers it). */
  function inviteCard(entry, { inStream = false } = {}) {
    const el = document.createElement('div');
    el.className = 'circle-nearby__invite';
    el.dataset.circleId = entry.invite?.circleId || '';
    if (inStream) {
      el.classList.add('circle-nearby__stream-card');
      el.dataset.streamKind = 'invite';
      const headLine = document.createElement('div');
      headLine.className = 'circle-nearby__stream-head';
      headLine.textContent = tr('circle.nearbyScreen.stream_invite_from', { name: entry.who ?? '' });
      el.appendChild(headLine);
    }

    const name = document.createElement('div');
    name.className = 'circle-nearby__invite-name';
    name.textContent = entry.invite?.circleName || entry.invite?.circleId || '';
    el.appendChild(name);

    // On every invite: the carrier changed, the gate did not.
    const note = document.createElement('div');
    note.className = 'circle-nearby__invite-note';
    note.textContent = tr('circle.nearbyScreen.join_is_a_join');
    el.appendChild(note);

    const actionBar = document.createElement('div');
    actionBar.className = 'circle-nearby__invite-actions';
    for (const action of Array.isArray(entry.actions) ? entry.actions : []) {
      const labelKey = NEARBY_INVITE_LABELS[action];
      if (!labelKey) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `cc-btn cc-btn--quiet circle-nearby__invite-action circle-nearby__invite-action--${action}`;
      btn.dataset.action = action;
      btn.textContent = tr(labelKey);
      btn.addEventListener('click', () => {
        if (typeof onInviteAction === 'function') onInviteAction(action, entry.invite);
      });
      actionBar.appendChild(btn);
    }
    if (actionBar.childElementCount) el.appendChild(actionBar);
    return el;
  }

  // Which part of the menu is open is paint state, on the container like the picked tab: '' (closed), 'main', 'self'
  // (who you enter as and what the room sees of you), 'card' (your card and what you offer).
  function openMenu(v) {
    container.dataset.nearbyMenu = v || '';
    const el = container.querySelector('.circle-nearby__menu');
    if (!el) return;
    el.hidden = !v;
    for (const part of el.querySelectorAll('[data-menu-view]')) part.hidden = part.dataset.menuView !== v;
  }

  function paintMenu() {
    const spec = nearbyMenu({ visibility, allows, can: { quiet: typeof onSetQuiet === 'function', radio: typeof onSetRadio === 'function' } });
    const menu = document.createElement('div');
    menu.className = 'circle-nearby__menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', tr(spec.titleKey));
    const view = container.dataset.nearbyMenu || '';
    menu.hidden = !view;

    const top = document.createElement('div');
    top.className = 'circle-nearby__menu-top';
    const title = document.createElement('div');
    title.className = 'circle-nearby__menu-title';
    title.textContent = tr(spec.titleKey);
    top.appendChild(title);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'circle-nearby__menu-close';
    close.setAttribute('aria-label', tr('circle.nearbyScreen.menu_close'));
    close.addEventListener('click', () => openMenu(''));
    top.appendChild(close);
    menu.appendChild(top);

    const part = (id) => {
      const el = document.createElement('div');
      el.className = `circle-nearby__menu-part circle-nearby__menu-part--${id}`;
      el.dataset.menuView = id;
      el.hidden = view !== id;
      if (id !== 'main') {
        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'cc-btn cc-btn--quiet circle-nearby__menu-back';
        back.textContent = tr('circle.join.wizard.back');
        back.addEventListener('click', () => openMenu('main'));
        el.appendChild(back);
      }
      menu.appendChild(el);
      return el;
    };
    const groupTitle = (el, key) => {
      const h = document.createElement('div');
      h.className = 'circle-nearby__menu-group';
      h.textContent = tr(key);
      el.appendChild(h);
    };

    // ── main: how you are here · what you show · the chat · the introduction ──
    const main = part('main');
    groupTitle(main, spec.here.titleKey);
    for (const c of spec.here.choices) {
      const lbl = document.createElement('label');
      lbl.className = `circle-nearby__here circle-nearby__here--${c.id}`;
      const radio = document.createElement('input');
      radio.type = 'radio'; radio.name = 'nearby-here'; radio.value = c.id; radio.checked = spec.here.selected === c.id;
      radio.addEventListener('change', () => onHereChoose?.(c.id));
      lbl.appendChild(radio);
      const words = document.createElement('span');
      words.className = 'circle-nearby__here-label';
      words.textContent = tr(c.labelKey);
      lbl.appendChild(words);
      const body = document.createElement('div');
      body.className = 'circle-nearby__here-body';
      body.textContent = tr(c.bodyKey);
      lbl.appendChild(body);
      main.appendChild(lbl);
    }
    groupTitle(main, spec.show.titleKey);
    const v = roomSelf?.view ?? null;
    if (v && (v.self || v.ask)) {
      const row = document.createElement('div');
      row.className = 'circle-nearby__menu-row circle-nearby__menu-row--self';
      const words = document.createElement('span');
      const nameOf = (c) => (c.nameKey ? tr(c.nameKey) : c.name);
      words.textContent = v.self ? tr(spec.show.appearAsKey, { name: nameOf(v.self) }) : tr('circle.nearbyScreen.as_self_pick');
      row.appendChild(words);
      const change = document.createElement('button');
      change.type = 'button';
      change.className = 'cc-btn cc-btn--quiet circle-nearby__menu-change';
      change.textContent = tr(spec.show.changeKey);
      change.addEventListener('click', () => openMenu('self'));
      row.appendChild(change);
      main.appendChild(row);
    }
    const cardRow = document.createElement('button');
    cardRow.type = 'button';
    cardRow.className = 'circle-nearby__menu-row circle-nearby__menu-row--card';
    cardRow.textContent = tr(spec.show.cardKey);
    cardRow.addEventListener('click', () => openMenu('card'));
    main.appendChild(cardRow);
    main.appendChild(allowSwitch('chat', spec.chat.on, spec.chat.offKey));
    if (typeof onIntroAgain === 'function') {
      const intro = document.createElement('button');
      intro.type = 'button';
      intro.className = 'cc-btn cc-btn--quiet circle-nearby__menu-intro';
      intro.textContent = tr(spec.introKey);
      intro.addEventListener('click', () => { openMenu(''); onIntroAgain(); });
      main.appendChild(intro);
    }

    // ── behind "Change": who enters the room, and what the room sees of that self (its finer levels) ──
    const selfView = part('self');
    // WHO ENTERS THE ROOM: the switcher's self (or the one question when several are ticked) — a label, said as one
    if (roomSelf?.view) {
      const rs = document.createElement('div');
      rs.className = 'circle-nearby__as-self';
      const v = roomSelf.view;
      const nameOf = (c) => (c.nameKey ? tr(c.nameKey) : c.name);
      if (v.ask) {
        const q = document.createElement('div');
        q.textContent = tr('circle.nearbyScreen.as_self_pick');
        rs.appendChild(q);
        for (const c of v.choices) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'cc-btn cc-btn--quiet circle-nearby__as-self-choice';
          b.dataset.self = c.id;
          b.textContent = nameOf(c);
          b.addEventListener('click', () => roomSelf.onPick?.(c.id));
          rs.appendChild(b);
        }
      } else if (v.self) {
        const line = document.createElement('div');
        line.className = 'circle-nearby__as-self-line';
        line.textContent = tr('circle.nearbyScreen.as_self', { name: nameOf(v.self) });
        rs.appendChild(line);
      }
      const cav = document.createElement('div');
      cav.className = 'circle-nearby__face-caveat';
      cav.textContent = tr('circle.nearbyScreen.as_self_caveat');
      rs.appendChild(cav);
      selfView.appendChild(rs);
    }
    // What the room sees of the self entering it — its level, kept on that self (so it travels with the persona).
    if (typeof onLevelChange === 'function') {
      const faceBlock = document.createElement('div');
      faceBlock.className = 'circle-nearby__face';
      const faceTitle = document.createElement('div');
      faceTitle.className = 'circle-nearby__face-title';
      faceTitle.textContent = tr('circle.nearbyScreen.face_row');
      faceBlock.appendChild(faceTitle);
      for (const v of NEARBY_LEVELS) {
        const lbl = document.createElement('label');
        lbl.className = `circle-nearby__face-option circle-nearby__face-option--${v}`;
        const radio = document.createElement('input');
        radio.type = 'radio'; radio.name = 'nearby-level'; radio.value = v; radio.checked = level === v;
        radio.addEventListener('change', () => onLevelChange(v));
        lbl.appendChild(radio);
        lbl.appendChild(document.createTextNode(tr(nearbyLevelLabelKey(v))));
        faceBlock.appendChild(lbl);
      }
      const caveat = document.createElement('div');
      caveat.className = 'circle-nearby__face-caveat';
      caveat.textContent = tr('circle.nearbyScreen.face_caveat');
      faceBlock.appendChild(caveat);
      selfView.appendChild(faceBlock);
    }

    // ── behind "My card and what I offer": the card's own switch on top (it gates what is sent), the card, the offer ──
    const cardView = part('card');
    cardView.appendChild(allowSwitch('card', !!allows.card, allows.card ? null : 'circle.nearbyScreen.allow_card_off'));
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

      // "Fill in" from what this room may see of the self entering it — the person still reads and sends it.
      if (typeof onPrefillCard === 'function') {
        const fill = document.createElement('button');
        fill.type = 'button';
        fill.className = 'cc-btn cc-btn--quiet circle-nearby__card-prefill';
        fill.textContent = tr('circle.nearbyScreen.card_prefill');
        fill.addEventListener('click', async () => {
          let got = {};
          try { got = (await onPrefillCard()) ?? {}; } catch { got = {}; }
          if (typeof got.label === 'string' && got.label) label.value = got.label.slice(0, CARD_MAX_LABEL);
        });
        form.appendChild(fill);
      }

      // the same offers switch as the wizard's second step: a prefill the person sees, copied into the card when it is saved
      const offers = offersPicker(form, nearbyWizardStep(2, { offers: ownProfile?.publishedSkills ?? [] }).offers);

      // The consequence, next to the fields. "Everyone in this room" is not obvious from a text box.
      const who = document.createElement('div');
      who.className = 'circle-nearby__card-visible';
      who.textContent = tr('circle.nearbyScreen.card_visible_to');
      form.appendChild(who);

      const save = document.createElement('button');
      save.type = 'submit';
      save.className = 'cc-btn cc-btn--quiet circle-nearby__card-save';
      save.textContent = tr('circle.nearbyScreen.card_save');
      form.appendChild(save);

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = label.value.trim();
        if (!name) return;
        if (typeof onSubmitCard === 'function') onSubmitCard({ label: name, line: line.value.trim(), tags: nearbyCardTags(offers.read()) });
      });
      cardView.appendChild(form);
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
    cardView.appendChild(footer);
    return menu;
  }

  /**
   * What the room self offers, as a switch that copies it into the card as chips the person can remove (a prefill they
   * see, never derived at send); nothing offered yet says where an offer is made. `read()` → `{showOffers, tags}`.
   */
  function offersPicker(parent, spec) {
    if (!spec?.list) {
      const none = document.createElement('div');
      none.className = 'circle-nearby__offers-none';
      none.textContent = tr(spec?.noneKey ?? 'circle.nearbyScreen.wizard2_no_offers');
      parent.appendChild(none);
      return { read: () => ({ showOffers: false, tags: [] }) };
    }
    const lbl = document.createElement('label');
    lbl.className = 'circle-nearby__offers';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = false;   // sets: form — the card's tags, copied in when the card is saved
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(tr(spec.key, spec.vars)));
    parent.appendChild(lbl);
    const chips = document.createElement('div');
    chips.className = 'circle-nearby__offer-chips';
    chips.hidden = true;
    let tags = [...spec.list];
    const paint = () => {
      chips.innerHTML = '';
      for (const tag of tags) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'cc-btn cc-btn--quiet circle-nearby__offer-chip';
        chip.textContent = tag;
        chip.setAttribute('aria-label', tr('circle.mij.driver_remove', { what: tag }));
        chip.addEventListener('click', () => { tags = tags.filter((x) => x !== tag); paint(); });
        chips.appendChild(chip);
      }
    };
    paint();
    cb.addEventListener('change', () => { chips.hidden = !cb.checked; });
    parent.appendChild(chips);
    return { read: () => ({ showOffers: cb.checked, tags: [...tags] }) };
  }

  /** One allow as a switch, with what OTHERS see while it is off (a setting name does not tell its consequence). */
  function allowSwitch(key, live, offKey) {
    const wrap = document.createElement('div');
    wrap.className = 'circle-nearby__allows';
    const label = document.createElement('label');
    label.className = `circle-nearby__allow circle-nearby__allow--${key}`;
    const box = document.createElement('input');
    box.type = 'checkbox';   // sets: local:basis.nearbyAllows — what Nearby lets this device answer
    box.checked = !!live;
    box.dataset.allow = key;
    box.addEventListener('change', () => {
      if (typeof onToggleAllow === 'function') onToggleAllow(key, box.checked);
    });
    label.appendChild(box);
    const text = document.createElement('span');
    text.textContent = tr(`circle.nearbyScreen.allow_${key}`);
    label.appendChild(text);
    wrap.appendChild(label);
    if (offKey) {
      const off = document.createElement('div');
      off.className = `circle-nearby__allow-off circle-nearby__allow-off--${key}`;
      off.textContent = tr(offKey);
      wrap.appendChild(off);
    }
    return wrap;
  }
}
