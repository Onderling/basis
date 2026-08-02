/**
 * basis v2 — "Mij → persona's" (web DOM renderer, bulletin design language).
 *
 * Three stacked sections over the shared read-model (`src/v2/personaView.js`
 * → buildMijViewModel; web ≡ mobile by construction):
 *   1. MIJN ALGEMENE PERSONA — the default profile's properties as rows
 *      (mono key · value · ladder hint) + offerings/drivers as chips with a
 *      dashed "+ vaardigheid of drijfveer" inline form,
 *   2. PERSONA'S — one card per profile; the root card is the truth layer
 *      (rust border); other cards show per key: volgt-algemeen / EIGEN / ∅,
 *   3. PER KRING — the who-sees-what table (persona × key × rung × released
 *      value + a charter column), with dashed share-affordances.
 *
 * Pure render — the host (`circleApp.js`) owns the op calls:
 *   onSetProperty(key, value)                        → setProfileProperty (default profile)
 *   onAddOffering({text, tags})                         → setProfileDriver   (kind 'offering')
 *   onCreatePersona(name)                            → createProfile
 *   onToggleDisclosure(circleId, key, on, personaId) → setProfileDisclosure
 *   onShareToCircle(circleId, personaId)             → push the release to the roster
 */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Bulletin section chrome: rust eyebrow + tagline above a 3px ink top-rule. */
function section(tr, eyebrowKey, taglineKey) {
  const sec = el('section', 'cc-mij__section');
  const head = el('div', 'cc-mij__head');
  head.appendChild(el('span', 'cc-mij__eyebrow', tr(eyebrowKey)));
  head.appendChild(el('span', 'cc-mij__tagline', tr(taglineKey)));
  sec.appendChild(head);
  return sec;
}

/** Localised finest→coarsest ladder hint, e.g. "ladder: wijk → gemeente → regio → ∅". */
function ladderHint(tr, ladder) {
  if (!Array.isArray(ladder) || !ladder.length) return '';
  const rungs = ladder.map((r) => tr(`circle.mij.rung.${r}`, { defaultValue: r }));
  return tr('circle.mij.ladder_hint', { ladder: rungs.join(' → ') });
}

export function renderMij(container, {
  model,
  t,
  lang = 'nl',
  onSetProperty,
  onAddOffering,
  onCreatePersona,
  onToggleDisclosure,
  onShareToCircle,
  onSetPicture,
  resolvePicture,
  currentPicture = null,
} = {}) {
  if (!container) return container;
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.className = 'cc-mij';

  if (!model || model.ok !== true) {
    container.appendChild(el('p', 'cc-mij__empty-note', tr('circle.mij.unavailable')));
    return container;
  }

  container.appendChild(renderGeneral(tr, model, { onSetProperty, onAddOffering, onSetPicture, resolvePicture, currentPicture, lang }));
  container.appendChild(renderPersonas(tr, model, { onCreatePersona }));
  container.appendChild(renderCircles(tr, model, { onToggleDisclosure, onShareToCircle }));
  return container;
}

// ── 1 · MIJN ALGEMENE PERSONA — de waarheidslaag ────────────────────────────
// `lang` is threaded in rather than closed over: this is a module-level function, not nested inside
// `renderMij`, so the `lang` it used to read resolved to NOTHING and the coarse-category chip threw a
// ReferenceError — taking the persona screen down for anyone whose offering carries a category.
function renderGeneral(tr, model, { onSetProperty, onAddOffering, onSetPicture, resolvePicture, currentPicture, lang = 'nl' }) {
  const sec = section(tr, 'circle.mij.general_eyebrow', 'circle.mij.general_tagline');
  const panel = el('div', 'cc-mij__panel');

  // Profile picture — a media-typed persona attribute. Pick an image → the host
  // seals + stores it (and re-seals it per circle on disclosure). The preview
  // resolves the sealed inline thumbnail via the injected resolver. Only shown
  // when the host wires the seam (a sealed-capable circle) — no unsealed upload.
  if (typeof onSetPicture === 'function') {
    const picRow = el('div', 'cc-mij__row cc-mij__row--picture');
    picRow.dataset.key = 'profilePicture';
    picRow.appendChild(el('span', 'cc-mij__key', tr('circle.mij.profilePicture')));
    const preview = document.createElement('img');
    preview.className = 'cc-mij__picture-preview';
    preview.alt = tr('circle.mij.profilePicture');
    if (currentPicture && typeof resolvePicture === 'function') {
      Promise.resolve(resolvePicture(currentPicture)).then((u) => { if (u) preview.src = u; }).catch(() => { /* keep empty */ });
    }
    picRow.appendChild(preview);
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.className = 'cc-mij__picture-input';
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (f) onSetPicture(f);
    });
    picRow.appendChild(fileInput);
    panel.appendChild(picRow);
  }

  for (const p of (model.general?.properties || [])) {
    const row = el('div', 'cc-mij__row');
    row.dataset.key = p.key;
    row.appendChild(el('span', 'cc-mij__key', tr(`circle.aboutme.key.${p.key}`, { defaultValue: p.key })));

    // A property may carry an `l10n` prefix (e.g. availability) so its value +
    // bucket OPTIONS localise; charter attributes have none and show raw values.
    const valLabel = (v) => (p.l10n && v != null ? tr(`${p.l10n}.${v}`, { defaultValue: v }) : v);

    // Value cell — a quiet button that flips open the inline editor beneath.
    const valueBtn = el('button', 'cc-mij__value-btn', valLabel(p.value) ?? tr('circle.mij.not_set'));
    valueBtn.type = 'button';
    if (p.value == null) valueBtn.classList.add('cc-mij__value-btn--unset');
    row.appendChild(valueBtn);

    row.appendChild(el('span', 'cc-mij__ladder', ladderHint(tr, p.ladder)));

    if (typeof onSetProperty === 'function') {
      valueBtn.addEventListener('click', () => {
        const open = row.querySelector('.cc-mij__editor');
        if (open) { open.remove(); return; }
        const editor = el('div', 'cc-mij__editor');
        if (p.free) {
          const input = el('input', 'cc-mij__input');
          input.type = 'text';
          input.value = p.value ?? '';
          input.placeholder = tr('circle.aboutme.place_placeholder');
          const save = el('button', 'cc-btn cc-btn--primary', tr('circle.aboutme.save'));
          save.type = 'button';
          save.addEventListener('click', () => onSetProperty(p.key, input.value.trim()));
          editor.append(input, save);
        } else {
          // A whenField property (availability) can carry an optional free-text "when" note
          // (the descriptor's finest 'detail' rung). Compose { state, when } when a when is
          // present; a bare state string otherwise — the store keeps it opaque either way.
          let whenDraft = p.when ?? '';
          const compose = (state) => (p.whenField && whenDraft.trim() ? { state, when: whenDraft.trim() } : state);
          for (const b of (p.buckets || [])) {
            const btn = el('button', 'cc-btn', valLabel(b));
            btn.type = 'button';
            if (b === p.value) btn.classList.add('is-active');
            btn.addEventListener('click', () => onSetProperty(p.key, compose(b)));
            editor.appendChild(btn);
          }
          if (p.whenField) {
            const whenInput = el('input', 'cc-mij__input');
            whenInput.type = 'text';
            whenInput.value = whenDraft;
            whenInput.placeholder = tr('circle.mij.availability_when_ph');
            whenInput.addEventListener('input', () => { whenDraft = whenInput.value; });
            const whenSave = el('button', 'cc-btn cc-btn--primary', tr('circle.aboutme.save'));
            whenSave.type = 'button';
            whenSave.addEventListener('click', () => onSetProperty(p.key, compose(p.value ?? p.buckets[0])));
            editor.append(whenInput, whenSave);
          }
        }
        row.appendChild(editor);
      });
    }
    panel.appendChild(row);
  }

  // Offerings & drivers — chips (bold text · mono tags · "≈ categorie" badge).
  const offeringsRow = el('div', 'cc-mij__row cc-mij__row--offerings');
  offeringsRow.appendChild(el('span', 'cc-mij__key', tr('circle.mij.offerings_label')));
  const chips = el('div', 'cc-mij__chips');
  for (const d of (model.general?.drivers || [])) {
    const chip = el('span', 'cc-mij__chip');
    chip.appendChild(el('b', 'cc-mij__chip-text', d.text || d.tags.join(', ')));
    for (const tg of d.tags) chip.appendChild(el('span', 'cc-mij__chip-tag', tg));
    // "≈ categorie" — the coarse rung this item coarsens to under disclosure:
    // for offerings the taxonomy category (user-picked or derived, via the
    // read-model); other driver kinds show their kind label.
    const coarse = d.categoryId
      ? ((d.categoryLabel && (d.categoryLabel[lang] || d.categoryLabel.nl)) || d.categoryId)
      : tr(`circle.aboutme.driverkind.${d.kind}`, { defaultValue: d.kind });
    chip.appendChild(el('span', 'cc-mij__chip-badge', tr('circle.mij.approx', { category: coarse })));
    chips.appendChild(chip);
  }
  offeringsRow.appendChild(chips);
  offeringsRow.appendChild(el('span', 'cc-mij__ladder', ladderHint(tr, ['all', 'none'])));
  panel.appendChild(offeringsRow);

  if (typeof onAddOffering === 'function') {
    const add = el('button', 'cc-mij__add', tr('circle.mij.offering_add'));
    add.type = 'button';
    add.addEventListener('click', () => {
      const open = panel.querySelector('.cc-mij__form');
      if (open) { open.remove(); return; }
      const form = el('div', 'cc-mij__form');
      const text = el('input', 'cc-mij__input');
      text.type = 'text';
      text.placeholder = tr('circle.mij.offering_text_ph');
      const tags = el('input', 'cc-mij__input');
      tags.type = 'text';
      tags.placeholder = tr('circle.mij.offering_tags_ph');
      const save = el('button', 'cc-btn cc-btn--primary', tr('circle.mij.offering_save'));
      save.type = 'button';
      save.addEventListener('click', () => {
        const textV = text.value.trim();
        const tagsV = tags.value.trim();
        if (!textV && !tagsV) return;              // nothing to match on
        onAddOffering({ text: textV, tags: tagsV });
      });
      const cancel = el('button', 'cc-btn cc-btn--ghost', tr('circle.mij.offering_cancel'));
      cancel.type = 'button';
      cancel.addEventListener('click', () => form.remove());
      form.append(text, tags, save, cancel);
      panel.appendChild(form);
      text.focus();
    });
    panel.appendChild(add);
  }

  sec.appendChild(panel);
  return sec;
}

// ── 2 · PERSONA'S — filters + uitzonderingen op de algemene ────────────────
function renderPersonas(tr, model, { onCreatePersona }) {
  const sec = section(tr, 'circle.mij.personas_eyebrow', 'circle.mij.personas_tagline');
  const grid = el('div', 'cc-mij__grid');

  for (const p of (model.personas || [])) {
    const card = el('article', p.isDefault ? 'cc-mij__card cc-mij__card--root' : 'cc-mij__card');
    card.dataset.personaId = p.id;
    const head = el('div', 'cc-mij__card-head');
    head.appendChild(el('h4', 'cc-mij__card-name', p.name));
    if (p.isDefault) head.appendChild(el('span', 'cc-mij__card-tag', tr('circle.mij.truth_tag')));
    card.appendChild(head);

    for (const entry of (p.entries || [])) {
      const line = el('div', 'cc-mij__entry');
      line.dataset.key = entry.key;
      line.appendChild(el('span', 'cc-mij__entry-key', tr(`circle.aboutme.key.${entry.key}`, { defaultValue: entry.key })));
      if (entry.state === 'own') {
        // The root card's own values ARE the general truth — no EIGEN mark there.
        if (!p.isDefault) line.appendChild(el('span', 'cc-mij__own-mark', tr('circle.mij.own_mark')));
        // Value-localised keys (availability) show their localised token, not a raw one.
        const ownDisp = (entry.l10n && entry.value != null)
          ? tr(`${entry.l10n}.${entry.value}`, { defaultValue: entry.value })
          : entry.value;
        line.appendChild(el('b', 'cc-mij__own-value', ownDisp ?? ''));
      } else if (entry.state === 'inherit') {
        line.appendChild(el('span', 'cc-mij__inherit', tr('circle.mij.follows_general')));
      } else {
        line.appendChild(el('span', 'cc-mij__absent', tr('circle.mij.absent')));
      }
      card.appendChild(line);
    }
    grid.appendChild(card);
  }

  // Dashed potential-action card: a new persona (createProfile).
  const add = el('button', 'cc-mij__add-card', tr('circle.mij.new_persona'));
  add.type = 'button';
  if (typeof onCreatePersona === 'function') {
    add.addEventListener('click', () => {
      const open = grid.querySelector('.cc-mij__form');
      if (open) { open.remove(); return; }
      const form = el('div', 'cc-mij__form cc-mij__card');
      const name = el('input', 'cc-mij__input');
      name.type = 'text';
      name.placeholder = tr('circle.mij.new_persona_ph');
      const create = el('button', 'cc-btn cc-btn--primary', tr('circle.mij.new_persona_create'));
      create.type = 'button';
      create.addEventListener('click', () => { const v = name.value.trim(); if (v) onCreatePersona(v); });
      const cancel = el('button', 'cc-btn cc-btn--ghost', tr('circle.mij.new_persona_cancel'));
      cancel.type = 'button';
      cancel.addEventListener('click', () => form.remove());
      form.append(name, create, cancel);
      grid.appendChild(form);
      name.focus();
    });
  } else {
    add.disabled = true;
    add.title = tr('circle.mij.new_persona_unavailable');
  }
  grid.appendChild(add);

  sec.appendChild(grid);
  return sec;
}

// ── 3 · PER KRING — wie ziet wat ────────────────────────────────────────────
function renderCircles(tr, model, { onToggleDisclosure, onShareToCircle }) {
  const sec = section(tr, 'circle.mij.circles_eyebrow', 'circle.mij.circles_tagline');
  const circles = model.circles || [];
  if (!circles.length) {
    sec.appendChild(el('p', 'cc-mij__empty-note', tr('circle.mij.no_circles')));
    return sec;
  }

  const panel = el('div', 'cc-mij__panel');
  const wrap = el('div', 'cc-mij__table-wrap');
  const table = el('table', 'cc-mij__table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const col of ['col_circle', 'col_persona', 'col_key', 'col_level', 'col_shared', 'col_charter']) {
    headRow.appendChild(el('th', null, tr(`circle.mij.${col}`)));
  }
  headRow.appendChild(el('th', null, ''));    // action column (withdraw / push)
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');

  const charterCell = (circle, key) => {
    if (!circle.charter) return el('td', 'cc-mij__cell-charter cc-mij__empty', tr('circle.mij.charter_none'));
    const req = circle.charter.requests.find((r) => r.key === key);
    return el('td', 'cc-mij__cell-charter', req
      ? tr('circle.mij.charter_max', { rung: req.maxRung ? tr(`circle.mij.rung.${req.maxRung}`, { defaultValue: req.maxRung }) : '' }).trim()
      : '');
  };

  for (const c of circles) {
    if (!c.rows.length) {
      const trEl = document.createElement('tr');
      trEl.dataset.circleId = c.circleId;
      trEl.appendChild(el('td', 'cc-mij__cell-circle', c.name));
      const empty = el('td', 'cc-mij__empty', tr('circle.mij.nothing_shared'));
      empty.colSpan = 6;
      trEl.appendChild(empty);
      tbody.appendChild(trEl);
    }
    let prevPersona = null;
    c.rows.forEach((r, i) => {
      const trEl = document.createElement('tr');
      trEl.dataset.circleId = c.circleId;
      trEl.dataset.key = r.key;
      trEl.appendChild(el('td', 'cc-mij__cell-circle', i === 0 ? c.name : ''));
      const firstOfGroup = r.personaId !== prevPersona;
      trEl.appendChild(el('td', null, firstOfGroup ? r.personaName : ''));
      prevPersona = r.personaId;
      trEl.appendChild(el('td', 'cc-mij__key', tr(`circle.aboutme.key.${r.key}`, { defaultValue: r.key })));
      trEl.appendChild(el('td', 'cc-mij__cell-level',
        r.rung ? tr(`circle.mij.rung.${r.rung}`, { defaultValue: r.rung }) : tr('circle.mij.level_all')));
      const relDisp = (r.l10n && r.released != null)
        ? tr(`${r.l10n}.${r.released}`, { defaultValue: r.released })
        : r.released;
      trEl.appendChild(el('td', r.released != null ? 'cc-mij__cell-released' : 'cc-mij__empty', relDisp ?? '—'));
      trEl.appendChild(charterCell(c, r.key));

      const action = el('td', 'cc-mij__cell-action');
      if (firstOfGroup && typeof onShareToCircle === 'function') {
        // Push this persona's current release to the circle roster (the toggles
        // only change LOCAL intent — this makes the circle actually see it).
        const push = el('button', 'cc-btn cc-btn--quiet', tr('circle.aboutme.share_to_circle'));
        push.type = 'button';
        const status = el('span', 'cc-mij__share-status');
        push.addEventListener('click', async () => {
          push.disabled = true;
          status.textContent = tr('circle.aboutme.sharing_now');
          let res;
          try { res = await onShareToCircle(c.circleId, r.personaId); }
          catch (err) { res = { ok: false, reason: err?.message ?? String(err) }; }
          status.textContent = res?.ok
            ? tr('circle.aboutme.shared_ok')
            : tr('circle.aboutme.share_failed', { reason: res?.reason ?? '' });
          push.disabled = false;
        });
        action.append(push, status);
      }
      if (typeof onToggleDisclosure === 'function') {
        const remove = el('button', 'cc-mij__row-remove', '×');
        remove.type = 'button';
        remove.title = tr('circle.mij.share_remove', { key: r.key });
        remove.setAttribute('aria-label', tr('circle.mij.share_remove', { key: r.key }));
        remove.addEventListener('click', () => onToggleDisclosure(c.circleId, r.key, false, r.personaId));
        action.appendChild(remove);
      }
      trEl.appendChild(action);
      tbody.appendChild(trEl);
    });

    // Dashed add-affordance: share one more general-persona property here.
    if (c.addable.length && typeof onToggleDisclosure === 'function') {
      const trEl = document.createElement('tr');
      trEl.dataset.circleId = c.circleId;
      const td = document.createElement('td');
      td.colSpan = 7;
      const add = el('button', 'cc-mij__add-share', tr('circle.mij.share_add'));
      add.type = 'button';
      add.addEventListener('click', () => {
        const open = td.querySelector('.cc-mij__form');
        if (open) { open.remove(); return; }
        const form = el('div', 'cc-mij__form');
        for (const key of c.addable) {
          const btn = el('button', 'cc-btn', tr(`circle.aboutme.key.${key}`, { defaultValue: key }));
          btn.type = 'button';
          btn.addEventListener('click', () => onToggleDisclosure(c.circleId, key, true, model.defaultId));
          form.appendChild(btn);
        }
        td.appendChild(form);
      });
      td.appendChild(add);
      trEl.appendChild(td);
      tbody.appendChild(trEl);
    }
  }

  table.appendChild(tbody);
  wrap.appendChild(table);
  panel.appendChild(wrap);
  sec.appendChild(panel);
  return sec;
}
