/**
 * basis v2 — "About me" persona surface (web DOM renderer, personas #1).
 *
 * A read + edit view of ONE persona: the coarse properties it holds (place,
 * ageBand, …) and, per circle, what it SHARES there. Privacy UI, so the honest
 * framing is load-bearing:
 *   • sharing is OPT-IN — every toggle starts withheld (the model's default),
 *   • each circle shows exactly what it would see ("you share: …" / "nothing"),
 *   • the value pickers are the coarse charter buckets only (no free-grained
 *     input; `place` is the one open-coarse free-text field).
 *
 * Pure render over the shared read-model (`src/v2/personaView.js` — web ≡ mobile
 * by construction). The host (`circleApp.js`) loads `getPersonaView`, builds the
 * model, and passes the two edit callbacks that fire the ops:
 *   onSetProperty(key, value)                → setProfileProperty
 *   onToggleDisclosure(circleId, key, on)    → setProfileDisclosure
 */

import { DRIVER_KINDS } from '@onderling/agent-registry';
import { translatorOr } from '../../src/locales/translatorOr.js';

function section(titleText) {
  const el = document.createElement('section');
  el.className = 'cc-aboutme__section';
  const h = document.createElement('h3');
  h.className = 'cc-aboutme__section-title';
  h.textContent = titleText;
  el.appendChild(h);
  return el;
}

export function renderAboutMe(container, {
  model,
  t,
  onSetProperty,
  onSetDriver,
  onToggleDisclosure,
  onShareToCircle,
  onBack,
} = {}) {
  if (!container) return container;
  const tr = translatorOr(t, 'circleAboutMe.js');
  container.innerHTML = '';
  container.className = 'cc-aboutme';

  const header = document.createElement('div');
  header.className = 'cc-aboutme__header';
  if (typeof onBack === 'function') {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'cc-aboutme__back';
    back.textContent = tr('circle.aboutme.back');
    back.addEventListener('click', () => onBack());
    header.appendChild(back);
  }
  const title = document.createElement('h2');
  title.className = 'cc-aboutme__title';
  title.textContent = model?.id
    ? tr('circle.aboutme.title_named', { name: model.id })
    : tr('circle.aboutme.title');
  header.appendChild(title);
  container.appendChild(header);

  if (!model || model.ok !== true) {
    const err = document.createElement('p');
    err.className = 'cc-aboutme__empty';
    err.textContent = tr('circle.aboutme.unavailable');
    container.appendChild(err);
    return container;
  }

  // ── properties ────────────────────────────────────────────────────────────
  const propSec = section(tr('circle.aboutme.properties'));
  const propIntro = document.createElement('p');
  propIntro.className = 'cc-aboutme__intro';
  propIntro.textContent = tr('circle.aboutme.properties_intro');
  propSec.appendChild(propIntro);

  for (const p of (model.properties || [])) {
    const row = document.createElement('div');
    row.className = 'cc-aboutme__prop';
    row.dataset.key = p.key;

    const label = document.createElement('div');
    label.className = 'cc-aboutme__prop-label';
    label.textContent = tr(`circle.aboutme.key.${p.key}`, { defaultValue: p.key });
    row.appendChild(label);

    const value = document.createElement('div');
    value.className = 'cc-aboutme__prop-value';
    value.textContent = p.value != null ? p.value : tr('circle.aboutme.not_set');
    if (p.value == null) value.classList.add('cc-aboutme__prop-value--unset');
    row.appendChild(value);

    // Editor: buckets → a button picker; `place` (free) → a text field + save.
    const editor = document.createElement('div');
    editor.className = 'cc-aboutme__prop-editor';
    if (p.free) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'cc-aboutme__prop-input';
      input.value = p.value ?? '';
      input.placeholder = tr('circle.aboutme.place_placeholder');
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'cc-aboutme__prop-save';
      save.textContent = tr('circle.aboutme.save');
      save.addEventListener('click', () => {
        const v = input.value.trim();
        if (typeof onSetProperty === 'function') onSetProperty(p.key, v);
      });
      editor.append(input, save);
    } else {
      for (const b of (p.buckets || [])) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cc-aboutme__bucket';
        btn.textContent = b;
        if (b === p.value) {
          btn.classList.add('cc-aboutme__bucket--active');
          btn.setAttribute('aria-pressed', 'true');
        } else {
          btn.setAttribute('aria-pressed', 'false');
        }
        btn.addEventListener('click', () => { if (typeof onSetProperty === 'function') onSetProperty(p.key, b); });
        editor.appendChild(btn);
      }
    }
    row.appendChild(editor);
    propSec.appendChild(row);
  }
  container.appendChild(propSec);

  // ── personal drivers (#5) ────────────────────────────────────────────────
  // Open { kind, text, tags } values (goals/hobbies/…), edited with a free-text
  // widget (not the coarse bucket pickers above). Authored here; the on-device
  // matcher reads them to surface items that resonate.
  if (typeof onSetDriver === 'function') {
    const drvSec = section(tr('circle.aboutme.drivers'));
    const drvIntro = document.createElement('p');
    drvIntro.className = 'cc-aboutme__intro';
    drvIntro.textContent = tr('circle.aboutme.drivers_intro');
    drvSec.appendChild(drvIntro);

    for (const d of (model.drivers || [])) {
      const drow = document.createElement('div');
      drow.className = 'cc-aboutme__driver';
      const head = document.createElement('div');
      head.className = 'cc-aboutme__driver-head';
      head.textContent = `${tr(`circle.aboutme.driverkind.${d.kind}`, { defaultValue: d.kind })}: ${d.text || d.tags.join(', ')}`;
      drow.appendChild(head);
      if (d.tags.length) {
        const tagWrap = document.createElement('div');
        tagWrap.className = 'cc-aboutme__driver-tags';
        for (const tg of d.tags) {
          const chip = document.createElement('span');
          chip.className = 'cc-aboutme__driver-tag';
          chip.textContent = tg;
          tagWrap.appendChild(chip);
        }
        drow.appendChild(tagWrap);
      }
      drvSec.appendChild(drow);
    }

    // Add / overwrite a driver (keyed by the label; re-using a label edits it).
    const form = document.createElement('div');
    form.className = 'cc-aboutme__driver-form';
    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'cc-aboutme__driver-input';
    labelInput.placeholder = tr('circle.aboutme.driver_label_ph');
    const kindSel = document.createElement('select');
    kindSel.className = 'cc-aboutme__driver-kind';
    for (const k of DRIVER_KINDS) {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = tr(`circle.aboutme.driverkind.${k}`, { defaultValue: k });
      kindSel.appendChild(opt);
    }
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.className = 'cc-aboutme__driver-input';
    textInput.placeholder = tr('circle.aboutme.driver_text_ph');
    const tagsInput = document.createElement('input');
    tagsInput.type = 'text';
    tagsInput.className = 'cc-aboutme__driver-input';
    tagsInput.placeholder = tr('circle.aboutme.driver_tags_ph');
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'cc-aboutme__driver-add';
    addBtn.textContent = tr('circle.aboutme.driver_add');
    addBtn.addEventListener('click', () => {
      const label = labelInput.value.trim();
      const text = textInput.value.trim();
      const tags = tagsInput.value.trim();
      if (!label || (!text && !tags)) return;   // needs a label + something to match on
      onSetDriver({ key: label, kind: kindSel.value, text, tags });
      labelInput.value = ''; textInput.value = ''; tagsInput.value = '';
    });
    form.append(labelInput, kindSel, textInput, tagsInput, addBtn);
    drvSec.appendChild(form);
    container.appendChild(drvSec);
  }

  // ── per-circle sharing ──────────────────────────────────────────────────
  const shareSec = section(tr('circle.aboutme.sharing'));
  const shareIntro = document.createElement('p');
  shareIntro.className = 'cc-aboutme__intro';
  shareIntro.textContent = tr('circle.aboutme.sharing_intro');
  shareSec.appendChild(shareIntro);

  if (!(model.circles || []).length) {
    const none = document.createElement('p');
    none.className = 'cc-aboutme__empty';
    none.textContent = tr('circle.aboutme.no_circles');
    shareSec.appendChild(none);
  }

  for (const c of (model.circles || [])) {
    const card = document.createElement('div');
    card.className = 'cc-aboutme__circle';
    card.dataset.circleId = c.circleId;

    const cname = document.createElement('div');
    cname.className = 'cc-aboutme__circle-name';
    cname.textContent = c.name;
    card.appendChild(cname);

    // Honest "what this circle sees" line.
    const summary = document.createElement('div');
    summary.className = 'cc-aboutme__circle-summary';
    summary.textContent = c.sharedKeys.length
      ? tr('circle.aboutme.you_share', { keys: c.sharedKeys.join(', ') })
      : tr('circle.aboutme.you_share_nothing');
    card.appendChild(summary);

    if (!c.rows.length) {
      const hint = document.createElement('p');
      hint.className = 'cc-aboutme__circle-hint';
      hint.textContent = tr('circle.aboutme.set_a_property_first');
      card.appendChild(hint);
    }

    for (const r of c.rows) {
      const toggleRow = document.createElement('label');
      toggleRow.className = 'cc-aboutme__toggle';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'cc-aboutme__toggle-box';
      box.checked = r.enabled;
      box.dataset.key = r.key;
      box.addEventListener('change', () => {
        if (typeof onToggleDisclosure === 'function') onToggleDisclosure(c.circleId, r.key, box.checked);
      });
      const span = document.createElement('span');
      span.className = 'cc-aboutme__toggle-label';
      span.textContent = tr('circle.aboutme.share_key', {
        key: tr(`circle.aboutme.key.${r.key}`, { defaultValue: r.key }),
        value: r.value,
      });
      toggleRow.append(box, span);
      card.appendChild(toggleRow);
    }

    // "Share to this circle" — push the current disclosure to the circle's roster (post-join). The
    // toggles above only change LOCAL intent; this is what makes the circle actually see the change.
    if (c.rows.length && typeof onShareToCircle === 'function') {
      const shareBtn = document.createElement('button');
      shareBtn.type = 'button';
      shareBtn.className = 'cc-aboutme__share-btn';
      shareBtn.textContent = tr('circle.aboutme.share_to_circle');
      const status = document.createElement('span');
      status.className = 'cc-aboutme__share-status';
      shareBtn.addEventListener('click', async () => {
        shareBtn.disabled = true;
        status.textContent = tr('circle.aboutme.sharing_now');
        let res;
        try { res = await onShareToCircle(c.circleId); }
        catch (err) { res = { ok: false, reason: err?.message ?? String(err) }; }
        status.textContent = res?.ok
          ? tr('circle.aboutme.shared_ok')
          : tr('circle.aboutme.share_failed', { reason: res?.reason ?? '' });
        shareBtn.disabled = false;
      });
      card.append(shareBtn, status);
    }

    shareSec.appendChild(card);
  }
  container.appendChild(shareSec);

  return container;
}
