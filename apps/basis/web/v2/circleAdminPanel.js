/**
 * basis v2 — circle admin panel (web DOM renderer, S3 — group ops #8).
 *
 * The per-circle admin surface off the `⋯` menu: the member roster (with role +
 * a remove action) and a post-announcement box. Pure render — the host
 * (`circleApp.js` showAdmin) loads `listGroupMembers` and dispatches the
 * admin-gated stoop ops (`removeMember`, `postAnnouncement`); a non-admin's
 * dispatch is refused server-side, surfaced as a notice.
 *
 * Reports are NOT here: moderation reports live on the ONE §8 surface — the
 * governance "Decisions" panel's Reports section (file · dismiss · act→remove),
 * which supersedes the old read-only `listReports` view this panel used to carry.
 */

export function renderCircleAdminPanel(container, {
  members = [],
  muted = [],
  outboundShares = [],
  outboundCanonical = false,
  busy = false,
  notice = null,
  t,
  onRemove,
  onAnnounce,
  onUnmute,
  onStopShare,
  onBack,
} = {}) {
  if (!container) return container;
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.className = 'cc-admin';

  const header = document.createElement('div');
  header.className = 'cc-admin__header';
  if (typeof onBack === 'function') {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'cc-admin__back';
    back.textContent = tr('circle.admin.back');
    back.addEventListener('click', () => onBack());
    header.appendChild(back);
  }
  const title = document.createElement('h2');
  title.className = 'cc-admin__title';
  title.textContent = tr('circle.admin.title');
  header.appendChild(title);
  container.appendChild(header);

  if (notice) {
    const n = document.createElement('div');
    n.className = 'cc-admin__notice';
    n.textContent = notice;
    container.appendChild(n);
  }

  // ── members ───────────────────────────────────────────────────────────────
  const memSection = document.createElement('section');
  memSection.className = 'cc-admin__section';
  const memTitle = document.createElement('h3');
  memTitle.className = 'cc-admin__section-title';
  memTitle.textContent = tr('circle.admin.members');
  memSection.appendChild(memTitle);

  if (!members.length) {
    const empty = document.createElement('p');
    empty.className = 'cc-admin__empty';
    empty.textContent = tr('circle.admin.no_members');
    memSection.appendChild(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'cc-admin__member-list';
    for (const m of members) {
      const li = document.createElement('li');
      li.className = 'cc-admin__member';
      li.dataset.webid = m.webid ?? '';
      const name = document.createElement('span');
      name.className = 'cc-admin__member-name';
      name.textContent = m.displayName || m.handle || m.webid || '';
      li.appendChild(name);
      if (m.role && m.role !== 'member') {
        const role = document.createElement('span');
        role.className = 'cc-admin__member-role';
        role.textContent = tr(`circle.admin.role.${m.role}`);
        li.appendChild(role);
      }
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'cc-admin__member-remove';
      rm.textContent = tr('circle.admin.remove');
      rm.addEventListener('click', () => { if (typeof onRemove === 'function') onRemove(m); });
      li.appendChild(rm);
      list.appendChild(li);
    }
    memSection.appendChild(list);
  }
  container.appendChild(memSection);

  // ── announcement ────────────────────────────────────────────────────────
  const annSection = document.createElement('section');
  annSection.className = 'cc-admin__section';
  const annTitle = document.createElement('h3');
  annTitle.className = 'cc-admin__section-title';
  annTitle.textContent = tr('circle.admin.announce');
  annSection.appendChild(annTitle);
  const form = document.createElement('form');
  form.className = 'cc-admin__announce';
  const area = document.createElement('textarea');
  area.className = 'cc-admin__announce-input';
  area.rows = 2;
  area.placeholder = tr('circle.admin.announce_placeholder');
  form.appendChild(area);
  const post = document.createElement('button');
  post.type = 'submit';
  post.className = 'cc-admin__announce-post';
  post.textContent = tr('circle.admin.announce_post');
  form.appendChild(post);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = area.value.trim();
    if (!text) return;
    area.value = '';
    if (typeof onAnnounce === 'function') onAnnounce(text);
  });
  annSection.appendChild(form);
  container.appendChild(annSection);

  // (reports moved to the §8 governance "Decisions" Reports section — see the header note)

  // ── muted peers ───────────────────────────────────────────────────────────
  const mutSection = document.createElement('section');
  mutSection.className = 'cc-admin__section';
  const mutTitle = document.createElement('h3');
  mutTitle.className = 'cc-admin__section-title';
  mutTitle.textContent = tr('circle.admin.muted');
  mutSection.appendChild(mutTitle);
  if (!muted.length) {
    const empty = document.createElement('p');
    empty.className = 'cc-admin__empty';
    empty.textContent = tr('circle.admin.no_muted');
    mutSection.appendChild(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'cc-admin__muted-list';
    for (const key of muted) {
      const li = document.createElement('li');
      li.className = 'cc-admin__muted';
      li.dataset.key = key;
      const name = document.createElement('span');
      name.className = 'cc-admin__muted-key';
      name.textContent = String(key).replace(/^webid:/, '');
      li.appendChild(name);
      const un = document.createElement('button');
      un.type = 'button';
      un.className = 'cc-admin__unmute';
      un.textContent = tr('circle.admin.unmute');
      un.addEventListener('click', () => { if (typeof onUnmute === 'function') onUnmute(key); });
      li.appendChild(un);
      list.appendChild(li);
    }
    mutSection.appendChild(list);
  }
  container.appendChild(mutSection);

  // ── outbound shares (objective L — per-share "Stop sharing") ───────────────
  // Lists what THIS circle has shared OUT (source item → target circle). A "Stop sharing" button appears ONLY
  // when the circle's posture is `canonical` (a revocable in-place grant); for copy/trusted/registered the
  // share is a SEPARATE object (not revocable in place), so the row shows the `not_revocable` note instead.
  const shareSection = document.createElement('section');
  shareSection.className = 'cc-admin__section';
  const shareTitle = document.createElement('h3');
  shareTitle.className = 'cc-admin__section-title';
  shareTitle.textContent = tr('circle.share.outbound_title');
  shareSection.appendChild(shareTitle);
  if (!outboundShares.length) {
    const empty = document.createElement('p');
    empty.className = 'cc-admin__empty';
    empty.textContent = tr('circle.share.outbound_empty');
    shareSection.appendChild(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'cc-admin__share-list';
    for (const s of outboundShares) {
      const li = document.createElement('li');
      li.className = 'cc-admin__share';
      li.dataset.itemId = s.itemId ?? '';
      li.dataset.circle = s.toCircleId ?? '';
      const label = document.createElement('span');
      label.className = 'cc-admin__share-row';
      label.textContent = tr('circle.share.outbound_row', { item: s.itemId, circle: s.toCircleId });
      li.appendChild(label);
      if (outboundCanonical) {
        const stop = document.createElement('button');
        stop.type = 'button';
        stop.className = 'cc-admin__share-stop';
        stop.textContent = tr('circle.share.stop');
        stop.addEventListener('click', () => { if (typeof onStopShare === 'function') onStopShare(s); });
        li.appendChild(stop);
      } else {
        const note = document.createElement('span');
        note.className = 'cc-admin__share-note';
        note.textContent = tr('circle.share.not_revocable');
        li.appendChild(note);
      }
      list.appendChild(li);
    }
    shareSection.appendChild(list);
  }
  container.appendChild(shareSection);

  if (busy) {
    const b = document.createElement('div');
    b.className = 'cc-admin__busy';
    b.textContent = tr('circle.admin.saving');
    container.appendChild(b);
  }
  return container;
}
