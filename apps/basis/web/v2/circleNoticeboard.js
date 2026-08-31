/**
 * basis v2 — circle noticeboard / noticeboard (web DOM renderer, S1 #1).
 *
 * The circle noticeboard surface inside a circle's NOTICEBOARD tab: a post composer
 * (ask / offer / lend + text) and the open-post list with per-row actions. Pure
 * render — the host (`circleApp.js`) fetches `listOpen`, computes `mine`, and
 * dispatches the stoop ops (`postRequest` / `respondToItem` / `cancelRequest` /
 * `reportPost` / `markReturned`) behind `onPost` / `onAction`. Mirrors the other
 * `renderX(container, ctx)` components so it's happy-dom-testable.
 *
 * Scope note (S1): basis runs ONE shared stoop agent today (`cc-default-circle`),
 * so this shows the shared circle's posts; per-circle scoping arrives with the pod
 * foundation (REMAINING-WORK §4 E2 / S4).
 */

import { embedChipsOf, embedTypeLabelKey, shortRef, screenForEmbedType } from '../../src/v2/embedChips.js';
import { buildAttachControl } from './attachControl.js';
import { translatorOr } from '../../src/locales/translatorOr.js';

const INTENTS = ['ask', 'offer', 'lend'];

export function renderCircleNoticeboard(container, {
  posts = [],
  t,
  busy = false,
  intent = 'ask',
  onPost,
  onAction,
  onIntent,
  attachment = null,        // the pending image attachment ({thumbnail, name}) or null
  onAttach,                 // (file) => void — host encodes + sets the pending attachment (the FILE entry's media pipeline)
  // (J4) — the ATTACHMENT projector's menu. `attachMenu` is
  // `renderAttachments(basisManifest).attachMenu` (host-computed); the composer's
  // "+" renders it. `attachFileOpId` names the entry that routes through the media
  // pipeline above; `onAttachCommand(entry)` dispatches every other entry (host →
  // callSkill/dispatchReady, params gathered via the form machinery).
  attachMenu = [],
  attachFileOpId = 'embed-file',
  onAttachCommand,
  onClearAttach,            // () => void
  onViewAttachment,         // ({post, att}) => void — open the full image
  onEmbedOpen,              // ({type, ref, screen}) => void — tap a "See also" chip to open the item
} = {}) {
  if (!container) return container;
  const tr = translatorOr(t, 'circleNoticeboard.js');
  container.innerHTML = '';
  container.className = 'cc-noticeboard';

  // ── composer ────────────────────────────────────────────────────────────
  const composer = document.createElement('form');
  composer.className = 'cc-noticeboard__composer';

  const pills = document.createElement('div');
  pills.className = 'cc-noticeboard__intents';
  for (const it of INTENTS) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = `cc-noticeboard__intent${it === intent ? ' is-active' : ''}`;
    pill.dataset.intent = it;
    pill.textContent = tr(`circle.noticeboard.intent.${it}`);
    pill.addEventListener('click', () => { if (typeof onIntent === 'function') onIntent(it); });
    pills.appendChild(pill);
  }
  composer.appendChild(pills);

  const row = document.createElement('div');
  row.className = 'cc-noticeboard__composer-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cc-noticeboard__input';
  input.placeholder = tr(`circle.noticeboard.placeholder.${intent}`);
  row.appendChild(input);
  // (J4) — the projector-driven "+" attach affordance (replaces the hand-coded
  // 📎). The FILE entry still routes through the media pipeline (onAttach); the
  // menu comes from the manifest via renderAttachments. Absent when nothing is
  // usable — a sealed-only p0/p1 circle (no onAttach) with no menu shows none.
  const attachControl = buildAttachControl({
    attachMenu, attachFileOpId, onAttach, onAttachCommand,
    cls: (s) => `cc-noticeboard__${s}`,
    tr, menuLabelKey: 'circle.noticeboard.attach',
  });
  if (attachControl) row.appendChild(attachControl);
  const post = document.createElement('button');
  post.type = 'submit';
  post.className = 'cc-noticeboard__post';
  post.textContent = tr('circle.noticeboard.post');
  row.appendChild(post);
  composer.appendChild(row);

  // pending-attachment preview (thumbnail + remove).
  if (attachment && attachment.thumbnail) {
    const preview = document.createElement('div');
    preview.className = 'cc-noticeboard__attach-preview';
    const img = document.createElement('img');
    img.className = 'cc-noticeboard__attach-thumb';
    img.src = attachment.thumbnail;
    img.alt = attachment.name || tr('circle.noticeboard.attach');
    preview.appendChild(img);
    if (typeof onClearAttach === 'function') {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'cc-noticeboard__attach-remove';
      rm.textContent = '✕';
      rm.setAttribute('aria-label', tr('circle.noticeboard.attach_remove'));
      rm.addEventListener('click', () => onClearAttach());
      preview.appendChild(rm);
    }
    composer.appendChild(preview);
  }

  // S3 #4 — a lend post can carry a return-by date (drives the notifier reminder).
  let due = null;
  if (intent === 'lend') {
    const dueRow = document.createElement('label');
    dueRow.className = 'cc-noticeboard__due';
    const dueLabel = document.createElement('span');
    dueLabel.textContent = tr('circle.noticeboard.due');
    due = document.createElement('input');
    due.type = 'date';
    due.className = 'cc-noticeboard__due-input';
    dueRow.appendChild(dueLabel);
    dueRow.appendChild(due);
    composer.appendChild(dueRow);
  }

  composer.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text && !attachment) return;   // an image-only post is valid
    input.value = '';
    const dueAt = due?.value ? Date.parse(due.value) : undefined;
    if (typeof onPost === 'function') onPost({ intent, text, ...(Number.isFinite(dueAt) ? { dueAt } : {}) });
  });
  container.appendChild(composer);

  if (busy) {
    const b = document.createElement('div');
    b.className = 'cc-noticeboard__busy';
    b.textContent = tr('circle.noticeboard.posting');
    container.appendChild(b);
  }

  // ── post list ───────────────────────────────────────────────────────────
  if (!posts.length) {
    const empty = document.createElement('div');
    empty.className = 'cc-noticeboard__empty';
    empty.textContent = tr('circle.noticeboard.empty');
    container.appendChild(empty);
    return container;
  }

  const list = document.createElement('ul');
  list.className = 'cc-noticeboard__list';
  for (const p of posts) {
    const li = document.createElement('li');
    li.className = `cc-noticeboard__post-row cc-noticeboard__post-row--${p.type || 'ask'}`;
    li.dataset.postId = p.id;

    const badge = document.createElement('span');
    badge.className = `cc-noticeboard__badge cc-noticeboard__badge--${p.type || 'ask'}`;
    badge.textContent = tr(`circle.noticeboard.intent.${p.type || 'ask'}`);
    li.appendChild(badge);

    const text = document.createElement('div');
    text.className = 'cc-noticeboard__text';
    text.textContent = p.text ?? p.label ?? '';
    li.appendChild(text);

    // embeds[] — cross-object references this post carries (a task / event /
    // other post). Surfaced as "See also" chips; the embed's own label, else a
    // shortened ref. (Resolving the ref to a live card is a follow-up.)
    const embeds = embedChipsOf(p);
    if (embeds.length) {
      const wrap = document.createElement('div');
      wrap.className = 'cc-noticeboard__embeds';
      const heading = document.createElement('span');
      heading.className = 'cc-noticeboard__embeds-label';
      heading.textContent = tr('circle.embed.see_also');
      wrap.appendChild(heading);
      for (const e of embeds) {
        const screen = screenForEmbedType(e.type);
        const tappable = !!(screen && !e.locked && typeof onEmbedOpen === 'function');
        const chip = document.createElement(tappable ? 'button' : 'span');
        if (tappable) chip.type = 'button';
        chip.className = `cc-noticeboard__embed cc-noticeboard__embed--${e.type}${tappable ? ' cc-noticeboard__embed--tappable' : ''}`;
        chip.dataset.ref = e.ref;
        const typeKey = embedTypeLabelKey(e.type);
        const typeLabel = tr(typeKey);
        const typeText = (typeLabel && typeLabel !== typeKey) ? typeLabel : e.type;
        chip.textContent = `${e.icon} ${typeText}: ${e.label ?? shortRef(e.ref)}`;
        if (tappable) chip.addEventListener('click', () => onEmbedOpen({ type: e.type, ref: e.ref, screen }));
        wrap.appendChild(chip);
      }
      li.appendChild(wrap);
    }

    // inline image attachments: render the thumbnail; tap opens the full image.
    const atts = Array.isArray(p.attachments) ? p.attachments : [];
    if (atts.length) {
      const gallery = document.createElement('div');
      gallery.className = 'cc-noticeboard__attachments';
      for (const att of atts) {
        if (!att?.thumbnail) continue;
        const img = document.createElement('img');
        img.className = 'cc-noticeboard__att';
        img.src = att.thumbnail;
        img.alt = tr('circle.noticeboard.attach');
        img.loading = 'lazy';
        if (att.width && att.height) img.style.aspectRatio = `${att.width} / ${att.height}`;
        if (typeof onViewAttachment === 'function') {
          img.style.cursor = 'zoom-in';
          img.addEventListener('click', () => onViewAttachment({ post: p, att }));
        }
        gallery.appendChild(img);
      }
      if (gallery.childNodes.length) li.appendChild(gallery);
    }

    // Drivers #5 (b) — a resonance badge when this post matches MY private drivers (matched on-device).
    // The existing "respond" chip below IS the anonymous reach-out (respondToItem → @handle DM).
    if (p.resonance?.reason) {
      const badge = document.createElement('div');
      badge.className = 'cc-noticeboard__resonance';
      badge.textContent = `✨ ${tr('circle.noticeboard.resonates', { reason: p.resonance.reason })}`;
      li.appendChild(badge);
    }

    const meta = document.createElement('div');
    meta.className = 'cc-noticeboard__meta';
    meta.textContent = [p.addedByLabel || p.addedBy, p.when].filter(Boolean).join(' · ');
    li.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'cc-noticeboard__actions';
    const chip = (action, labelKey, extraClass = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `cc-noticeboard__chip${extraClass}`;
      b.dataset.action = action;
      b.textContent = tr(labelKey);
      b.addEventListener('click', () => { if (typeof onAction === 'function') onAction({ action, post: p }); });
      actions.appendChild(b);
    };
    if (!p.mine) chip('respond', 'circle.noticeboard.action.respond');
    if (p.type === 'lend' && p.mine) chip('assign', 'circle.noticeboard.action.assign');
    if (p.type === 'lend' && p.mine) chip('markReturned', 'circle.noticeboard.action.returned');
    if (p.mine) chip('cancel', 'circle.noticeboard.action.cancel');
    if (!p.mine) chip('report', 'circle.noticeboard.action.report', ' cc-noticeboard__chip--muted');
    if (!p.mine) chip('mute', 'circle.noticeboard.action.mute', ' cc-noticeboard__chip--muted');
    li.appendChild(actions);

    list.appendChild(li);
  }
  container.appendChild(list);
  return container;
}
