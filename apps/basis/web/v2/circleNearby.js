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

/** Row actions → locale key. Unknown ids are skipped rather than shown raw. */
const ACTION_LABELS = {
  'invite-to-circle':   'circle.nearbyScreen.action_invite',
  'request-join':       'circle.nearbyScreen.action_request',
  'open-shared-circle': 'circle.nearbyScreen.action_open',
};

export function renderCircleNearby(container, {
  model = null,
  t,
  onBack,
  onAction = null,
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
  const { rows = [], ownProfile = {}, headerLabel = '', visibility = null } = safeModel;

  // ── Visibility banner ──────────────────────────────────────────────────────
  // Ordered by what a person most needs to know, not by what we asked for:
  // being visible when you asked to be hidden outranks everything else here.
  if (visibility) {
    const key = visibility.degraded    ? 'still_visible'
              : visibility.unavailable ? 'unavailable'
              : visibility.publishing  ? 'visible'
              :                          'hidden';
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

      if (row.proximity) {
        const prox = document.createElement('div');
        prox.className = 'circle-nearby__proximity';
        prox.textContent = row.proximity;
        el.appendChild(prox);
      }

      // Rule (b): a stranger you can see is still a stranger. Say so, rather than
      // letting the absence of an "open" button be the only hint.
      if (row.note === 'nearby-not-member') {
        const note = document.createElement('div');
        note.className = 'circle-nearby__note';
        note.textContent = tr('circle.nearbyScreen.not_member_note');
        el.appendChild(note);
      }

      const actions = Array.isArray(row.actions) ? row.actions : [];
      if (actions.length) {
        const bar = document.createElement('div');
        bar.className = 'circle-nearby__actions';
        for (const action of actions) {
          const labelKey = ACTION_LABELS[action];
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
