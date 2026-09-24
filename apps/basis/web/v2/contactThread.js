/**
 * basis v2 — contact DM thread (web DOM renderer, feedback-extension).
 *
 * Pure render of a 1:1 conversation with a contact-bot: a header (with a back
 * link to the roster), the message list (user + bot bubbles, with optional
 * reply-buttons), and a composer. The host injects the message list + `t` +
 * handlers; the conversational transport (the contact-thread channel over
 * sa.peer) + the message state live in `circleApp.js`, so this stays unit-
 * testable under happy-dom. Mirrors the other `renderX(container, ctx)`
 * components.
 */

import { createComposerCommands } from '../../src/v2/composerCommands.js';
import { translatorOr } from '../../src/locales/translatorOr.js';
import { returnedMarkerKey } from '../../src/v2/contactDelete.js';
import { paintFace } from './faceView.js';

// Privacy-badge palette (§10c) — the discrete states map to Onderling status tokens (mirrors
// apps/basis/src/v2/theme.js). Colour AMPLIFIES the shape; quiet is a NEUTRAL slate outline (never green).
const PRIVACY_BADGE_STYLE = {
  quiet:   { fg: 'var(--ink-soft)', bg: 'transparent', border: 'var(--line)' }, // neutral outline
  sharing: { fg: 'var(--blue)', bg: 'var(--blue-bg)', border: 'var(--blue)' }, // soft-blue fill
  risk:    { fg: 'var(--danger)', bg: 'var(--amber-bg)', border: 'var(--danger)' }, // amber→red
};

// One-time <style> for the flip-to-risk pulse (a subtle emphasis, then settle — never a flashing nag).
let _privacyPulseInjected = false;
function _ensurePrivacyPulseKeyframes() {
  if (_privacyPulseInjected || typeof document === 'undefined' || !document.head) return;
  _privacyPulseInjected = true;
  const style = document.createElement('style');
  style.textContent = '@keyframes cc-privacy-pulse{0%{transform:scale(1)}30%{transform:scale(1.12)}60%{transform:scale(.97)}100%{transform:scale(1)}}.cc-cthread__privacy.is-pulse{animation:cc-privacy-pulse .9s ease-in-out 2}';
  document.head.appendChild(style);
}

export function renderContactThread(container, {
  name = '',
  face = null,       // the contact's own face as the lane carries it (a `data:image/` thumb) — null = the initial
  messages = [],
  skills = [],
  busy = false,
  error = null,
  t,
  onSend,
  onBack,
  onButtonTap,
  onSkillTap,
  inputValue = '',   // pre-fill the composer (inline edit: ✏ a point → its text appears, editable)
  inputHint = '',    // optional placeholder override (e.g. "Editing point N")
  langValue = null,        // when set (+ onLangChange), render an NL/EN picker in the header (a bot thread's language)
  onLangChange = null,
  floor = null,            // the contact's pre-send floor, when declared: { label } — said once under the header
  privacy = null,          // per-circle privacy indicator (§10c): { level:'quiet'|'sharing'|'risk', icon, label, pulse? }
  onPrivacyTap = null,     // tap the badge → the surface's why/change affordance (surface.showPrivacy)
  sealed = null,           // what a direct message here is sealed to: { level:'person'|'device', label } (the shared contact seal mark); null = not decided yet
  hidden = null,           // L106: is this contact hidden from Contacten? true/false paints Verbergen/Tonen; null = not a person (a bot) → no control
  onToggleHidden = null,   // (hidden: boolean) => void — the person's own act; a message from the contact does the same as `false`
  contactId = null,        // the thread's key, on the root as data-contact-id — what a probe reads to name the open thread
  onOpenLens = null,       // L125: () => void — "what does this contact see of you?"; a person's thread only (with `hidden`)
  onDelete = null,         // L114: () => void — delete this contact (the shell confirms first); a person's thread only
  deletedAt = null,        // L114: when this contact was deleted — a return after it says "verwijderd", not "verborgen"
} = {}) {
  if (!container) return container;
  const tr = translatorOr(t, 'contactThread.js');
  container.innerHTML = '';
  container.className = 'cc-cthread';
  if (contactId) container.dataset.contactId = String(contactId);

  // ── header ────────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'cc-cthread__header';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'cc-cthread__back';
  back.textContent = tr('circle.contacts.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  header.appendChild(back);
  // The contact's face beside their name — the same slot Contacten and a roster row use, so the person you
  // opened is visibly the person you were looking at.
  const avatar = document.createElement('span');
  avatar.className = 'cc-cthread__face cc-contacts__icon';
  paintFace(avatar, { face, name });
  header.appendChild(avatar);
  const title = document.createElement('h2');
  title.className = 'cc-cthread__title';
  title.textContent = tr('circle.contacts.thread_title', { name });
  header.appendChild(title);
  // Per-circle privacy INDICATOR (§10c) — a persistent, icon-first badge. Only rendered when the host passes
  // `privacy` (i.e. privacyState().applicable). SHAPE carries meaning, colour AMPLIFIES (never colour-alone):
  // quiet → 🛡 neutral outline (grey, NOT green), sharing → 🛡 filled soft-blue, risk → ⚠️ amber→red. The ⚠ is
  // EARNED (level==='risk'); tap → the why/change affordance. A one-time subtle pulse when the state flips to risk.
  if (privacy && (privacy.level === 'quiet' || privacy.level === 'sharing' || privacy.level === 'risk')) {
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = `cc-cthread__privacy cc-cthread__privacy--${privacy.level}${privacy.pulse ? ' is-pulse' : ''}`;
    badge.dataset.level = privacy.level;
    const st = PRIVACY_BADGE_STYLE[privacy.level] || PRIVACY_BADGE_STYLE.quiet;
    Object.assign(badge.style, {
      color: st.fg, background: st.bg, border: `1px solid ${st.border}`, borderRadius: '999px',
      padding: '2px 10px', marginLeft: '8px', fontSize: '12px', fontWeight: '600', lineHeight: '1.4',
      cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap',
    });
    const label = privacy.label || privacy.level;
    badge.textContent = `${privacy.icon || (privacy.level === 'risk' ? '⚠️' : '🛡')} ${label}`;
    badge.setAttribute('aria-label', label);
    badge.title = label;
    badge.addEventListener('click', () => { if (typeof onPrivacyTap === 'function') onPrivacyTap(); });
    header.appendChild(badge);
    if (privacy.pulse) _ensurePrivacyPulseKeyframes();
  }
  // What a direct message here is sealed to. Sealed to the PERSON: this device holds their current person key,
  // so a device they revoke cannot read it. Sealed to the DEVICE only: no key on record yet — as before; their
  // next card or a shared circle brings it. The host decides (the agent's own seal resolution); this paints.
  if (sealed && (sealed.level === 'person' || sealed.level === 'device') && sealed.label) {
    const mark = document.createElement('span');
    mark.className = `cc-cthread__sealed cc-cthread__sealed--${sealed.level}`;
    mark.dataset.level = sealed.level;
    Object.assign(mark.style, {
      marginLeft: '8px', fontSize: '12px', lineHeight: '1.4', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '4px',
      color: sealed.level === 'person' ? '#2e7d4f' : '#5b5d55',   // the theme's STATUS green / inkSoft
    });
    mark.textContent = `${sealed.level === 'person' ? '🔐' : '🔒'} ${sealed.label}`;
    mark.title = sealed.label;
    header.appendChild(mark);
  }
  // language picker (feedback thread): the participant chooses the BOT's language; the whole thread re-renders.
  if ((langValue === 'nl' || langValue === 'en') && typeof onLangChange === 'function') {
    const toggle = document.createElement('div');
    toggle.className = 'cc-cthread__lang';
    for (const lg of ['nl', 'en']) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `cc-cthread__lang-btn${langValue === lg ? ' is-active' : ''}`;
      b.textContent = lg.toUpperCase();
      b.dataset.lang = lg;
      b.addEventListener('click', () => onLangChange(lg));
      toggle.appendChild(b);
    }
    header.appendChild(toggle);
  }
  // HIDE / SHOW (L106, Frits 2026-09-19): the person takes this contact out of their sight, or back. The row
  // stays — their circles, this thread and the pair roster untouched — and a message from them brings them back;
  // the note under the control says exactly that, so nobody hides someone expecting silence (that is Blokkeren).
  if (typeof hidden === 'boolean' && typeof onToggleHidden === 'function') {
    const hide = document.createElement('button');
    hide.type = 'button';
    hide.className = 'cc-cthread__hide';
    hide.dataset.hidden = String(hidden);
    hide.textContent = tr(hidden ? 'circle.contacts.unhide' : 'circle.contacts.hide');
    hide.addEventListener('click', () => onToggleHidden(!hidden));
    header.appendChild(hide);
  }
  // WHAT THEY SEE (L125, Frits 2026-09-24): which persona this contact sees you as, and how much — changed here,
  // beside the other per-contact control. A person's thread only: a bot has no pair roster to say a release on.
  if (typeof hidden === 'boolean' && typeof onOpenLens === 'function') {
    const lens = document.createElement('button');
    lens.type = 'button';
    lens.className = 'cc-cthread__lens';
    lens.textContent = tr('circle.contacts.lens.open');
    lens.addEventListener('click', () => onOpenLens());
    header.appendChild(lens);
  }
  // DELETE (L114): hide + leave the pair circle — a relationship act. The shell asks first (the confirm is the undo).
  if (typeof hidden === 'boolean' && typeof onDelete === 'function') {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'cc-cthread__delete';
    del.textContent = tr('circle.contacts.delete');
    del.addEventListener('click', () => onDelete());
    header.appendChild(del);
  }
  container.appendChild(header);
  if (typeof hidden === 'boolean' && typeof onToggleHidden === 'function') {
    const note = document.createElement('div');
    note.className = 'cc-cthread__hide-note';
    note.textContent = tr('circle.contacts.hide_note');
    container.appendChild(note);
  }
  // The pre-send floor, said where the participant reads before typing: personal details are removed on
  // this device before a message leaves it. Only for a contact that declared it.
  if (floor && floor.label) {
    const note = document.createElement('div');
    note.className = 'cc-cthread__floor';
    note.textContent = `🛡 ${floor.label}`;
    container.appendChild(note);
  }

  // ── messages ──────────────────────────────────────────────────────────────
  const log = document.createElement('div');
  log.className = 'cc-cthread__log';
  for (const m of messages) {
    // The turn that brought a hidden contact back carries the mark (`returned`, decided where it first landed
    // and stored with the turn): a SYSTEM line above its bubble — "Je had dit contact verborgen." — so the person
    // understands why someone they removed is back in their list. Neither side's bubble.
    const markerKey = returnedMarkerKey(m, deletedAt);
    if (markerKey) {
      const sys = document.createElement('div');
      sys.className = 'cc-cthread__system';
      sys.textContent = tr(markerKey);
      log.appendChild(sys);
    }
    const row = document.createElement('div');
    const side = m.origin === 'user' ? 'user' : 'bot';
    row.className = `cc-cthread__msg cc-cthread__msg--${side}`;
    if (m.pending) row.classList.add('is-pending');
    const bubble = document.createElement('div');
    bubble.className = 'cc-cthread__bubble';
    bubble.textContent = m.text ?? '';
    // A turn that answers a NOTICEBOARD POST says so — a reply lands here from a person the reader
    // may have never spoken to, and without the marker it reads as a message out of nowhere.
    if (m.replyTo) {
      const ref = document.createElement('div');
      ref.className = 'cc-cthread__reply-ref';
      ref.textContent = tr('circle.contacts.reply_to_post');
      bubble.prepend(ref);
    }
    // A received peer-wire FILE rides the turn ({id, name, mime, size, dataB64} — the thread is its
    // durable home). An image shows itself; everything gets its name, size and a native download —
    // a data: href needs no store round-trip because the bytes ARE here.
    if (m.file && typeof m.file === 'object') {
      bubble.classList.add('cc-cthread__bubble--file');
      const f = m.file;
      if (typeof f.mime === 'string' && f.mime.startsWith('image/') && f.dataB64) {
        const img = document.createElement('img');
        img.className = 'cc-cthread__file-preview';
        img.src = `data:${f.mime};base64,${f.dataB64}`;
        img.alt = f.name ?? '';
        bubble.appendChild(img);
      }
      const meta = document.createElement('div');
      meta.className = 'cc-cthread__file-meta';
      const kb = Number.isFinite(f.size) ? ` · ${(f.size / 1024).toFixed(0)} KB` : '';
      meta.textContent = `📎 ${f.name ?? '(file)'}${kb}`;
      bubble.appendChild(meta);
      if (f.dataB64) {
        const dl = document.createElement('a');
        dl.className = 'cc-cthread__file-download';
        dl.href = `data:${f.mime ?? 'application/octet-stream'};base64,${f.dataB64}`;
        dl.download = f.name ?? 'file';
        dl.textContent = tr('circle.fileShare.download');
        bubble.appendChild(dl);
      }
    }
    row.appendChild(bubble);
    if (Array.isArray(m.buttons) && m.buttons.length) {
      const btnRow = document.createElement('div');
      btnRow.className = 'cc-cthread__buttons';
      for (const b of m.buttons) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cc-cthread__btn';
        btn.dataset.buttonId = b.id ?? '';
        btn.textContent = b.label ?? b.id ?? '';
        btn.addEventListener('click', () => { if (typeof onButtonTap === 'function') onButtonTap(b, m); });
        btnRow.appendChild(btn);
      }
      row.appendChild(btnRow);
    }
    log.appendChild(row);
  }
  if (busy) {
    const pend = document.createElement('div');
    pend.className = 'cc-cthread__sending';
    pend.textContent = tr('circle.contacts.sending');
    log.appendChild(pend);
  }
  container.appendChild(log);

  if (error) {
    const err = document.createElement('div');
    err.className = 'cc-cthread__error';
    err.textContent = tr('circle.contacts.send_failed', { name });
    container.appendChild(err);
  }

  // ── skill quick-actions — the bot's exposed skills as chips ──────
  if (Array.isArray(skills) && skills.length) {
    const skillRow = document.createElement('div');
    skillRow.className = 'cc-cthread__skills';
    for (const sk of skills) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'cc-cthread__skill';
      chip.dataset.skillId = sk.id;
      chip.textContent = `/${sk.id}`;
      if (sk.description) chip.title = sk.description;
      chip.addEventListener('click', () => { if (typeof onSkillTap === 'function') onSkillTap(sk); });
      skillRow.appendChild(chip);
    }
    container.appendChild(skillRow);
  }

  // ── composer ──────────────────────────────────────────────────────────────
  // The typed door. This thread already knew what the peer exposes (`skills`, the chips above) and had
  // no way to TYPE any of it — a `/` line went out as chat. Mobile had a hand-written parser for the
  // same thing; both now read the one seam, so "what can I do here" has one answer per context and one
  // implementation. A bot is a contact, so this is also how a person asks a bot what it offers.
  const commands = createComposerCommands({ kind: 'contact', skills });
  const composer = document.createElement('form');
  composer.className = 'cc-cthread__composer';
  const suggestEl = document.createElement('ul');
  suggestEl.className = 'cc-cthread__suggest';
  suggestEl.hidden = true;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cc-cthread__input';
  input.placeholder = inputHint || tr('circle.contacts.composer', { name });
  if (inputValue) { input.value = inputValue; }
  const paintSuggest = () => {
    const rows = commands.suggest(input.value);
    suggestEl.replaceChildren();
    for (const row of rows) {
      const li = document.createElement('li');
      li.className = 'cc-cthread__suggest-item';
      li.dataset.opId = row.opId;
      const cmd = document.createElement('span');
      cmd.className = 'cc-cthread__suggest-cmd';
      cmd.textContent = row.command;
      li.appendChild(cmd);
      if (row.hint) {
        const hint = document.createElement('span');
        hint.className = 'cc-cthread__suggest-hint';
        hint.textContent = row.hint;
        li.appendChild(hint);
      }
      // Fill the command plus a space, the way the circle composer does — then keep typing arguments.
      // `mousedown`, not `click`: the input blurs first otherwise and the list is gone before the tap.
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        input.value = `${row.command} `;
        paintSuggest();
        input.focus();
      });
      suggestEl.appendChild(li);
    }
    suggestEl.hidden = rows.length === 0;
  };
  input.addEventListener('input', paintSuggest);
  container.appendChild(suggestEl);
  composer.appendChild(input);
  const sendBtn = document.createElement('button');
  sendBtn.type = 'submit';
  sendBtn.className = 'cc-cthread__send';
  sendBtn.textContent = tr('circle.contacts.send');
  composer.appendChild(sendBtn);
  composer.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    suggestEl.hidden = true;
    // A command this peer offers runs; anything else — including a `/` line they do not expose — is an
    // ordinary turn, because in a conversation a slash is sometimes just a slash.
    const cmd = commands.parse(text);
    if (cmd && typeof onSkillTap === 'function') { onSkillTap({ id: cmd.opId }, cmd.rest); return; }
    if (typeof onSend === 'function') onSend(text);
  });
  container.appendChild(composer);

  return container;
}

