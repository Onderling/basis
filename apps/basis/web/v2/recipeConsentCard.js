/**
 * recipeConsentCard — the REVIEWED apply-recipe surface (B · consent-card tail, web DOM).
 *
 * Vanilla DOM matching the app's other consent modals (`extensionConsentCard.js`); `doc`/`t` injectable
 * for tests. Renders the platform-neutral review model from `buildRecipeConsentModel` — what the recipe
 * would ENABLE (capabilities + features + settings) and, for the OPT-OUTABLE caps, a checkbox per cap so
 * the user can decline the optional ones — and resolves Agree / Decline.
 *
 *   - Decline  → `onDecline()` (nothing is applied).
 *   - Agree    → `onAgree({ declinedKeys })` where `declinedKeys` are the opt-outable caps left UNCHECKED.
 *
 * The card renders NO logic: the model is built in shared `src/` (invariants #1/#2) and Agree flows through
 * the caller's `applyReviewedRecipe`. Every string via `t()` (circle.recipeConsent.*); NO hardcoded English.
 */

import { t as defaultT } from '../../src/localisation.js';

function btn(doc, label, onClick) {
  const b = doc.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.className = 'cc-btn cc-btn--quiet';   // circle.css primitives (bulletin buttons)
  b.addEventListener('click', onClick);
  return b;
}

/** A human label for a capability key "<app> <atom> <noun>", falling back to the raw parts. */
function capLabel(t, cap) {
  const verb = t(`circle.settings.verb.${cap.atom}`, { defaultValue: cap.atom });
  return `${verb} · ${cap.noun}`;
}

/**
 * Show the recipe consent card for a `buildRecipeConsentModel` result.
 *
 * @param {object} model  from buildRecipeConsentModel (enabledCaps, features, settings, consent)
 * @param {object} [opts]
 * @param {(res:{declinedKeys:string[]})=>void} [opts.onAgree]
 * @param {()=>void} [opts.onDecline]
 * @param {Document} [opts.doc]
 * @param {Function} [opts.t]
 * @returns {{ close: () => void, el: HTMLElement }}
 */
export function renderRecipeConsentCard(model, { onAgree, onDecline, doc = globalThis.document, t = defaultT } = {}) {
  const overlay = doc.createElement('div');
  overlay.className = 'recipe-consent-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:9999;';

  const panel = doc.createElement('div');
  panel.className = 'recipe-consent-card';
  panel.style.cssText = 'background:var(--card);max-width:460px;width:90%;max-height:85vh;overflow:auto;padding:20px;border-radius:12px;font-family:system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.2);';
  overlay.appendChild(panel);

  const close = () => { try { overlay.remove(); } catch { /* already gone */ } };

  const h = doc.createElement('h3');
  h.style.cssText = 'margin:0 0 6px;';
  h.textContent = t('circle.recipeConsent.title');
  panel.appendChild(h);

  const intro = doc.createElement('p');
  intro.style.cssText = 'margin:0 0 12px;color:var(--ink-soft);';
  intro.textContent = t('circle.recipeConsent.intro');
  panel.appendChild(intro);

  const caps = Array.isArray(model?.enabledCaps) ? model.enabledCaps : [];
  const features = Array.isArray(model?.features) ? model.features : [];
  const settings = Array.isArray(model?.settings) ? model.settings : [];
  const optItems = Array.isArray(model?.consent?.items) ? model.consent.items : [];
  const optKeys = new Set(optItems.map((i) => i.key));

  // ── ENABLES: capabilities + features + settings the recipe turns on ─────────
  if (caps.length || features.length || settings.length) {
    const label = doc.createElement('p');
    label.style.cssText = 'margin:8px 0 4px;font-weight:600;';
    label.textContent = t('circle.recipeConsent.enables');
    panel.appendChild(label);

    const ul = doc.createElement('ul');
    ul.className = 'recipe-consent-card__enables';
    ul.style.cssText = 'margin:0 0 8px;padding-left:18px;';
    for (const cap of caps) {
      // The mandatory (non-opt-outable) caps render as plain list items; the opt-outable ones get a
      // checkbox row below so the two groups read distinctly.
      if (optKeys.has(cap.key)) continue;
      const li = doc.createElement('li');
      li.dataset.cap = cap.key;
      li.textContent = capLabel(t, cap);
      ul.appendChild(li);
    }
    for (const f of features) {
      const li = doc.createElement('li');
      li.dataset.feature = f;
      li.textContent = t(`circle.settings.feat.${f}`, { defaultValue: f });
      ul.appendChild(li);
    }
    for (const s of settings) {
      const li = doc.createElement('li');
      li.dataset.setting = s.key;
      li.textContent = `${s.key}: ${String(s.value)}`;
      ul.appendChild(li);
    }
    if (ul.children.length) panel.appendChild(ul);
  }

  // ── OPTIONAL: an opt-out checkbox per opt-outable cap (checked = keep it on) ─
  const boxes = [];
  if (optItems.length) {
    const label = doc.createElement('p');
    label.style.cssText = 'margin:12px 0 4px;font-weight:600;';
    label.textContent = t('circle.recipeConsent.optional');
    panel.appendChild(label);

    for (const item of optItems) {
      const row = doc.createElement('label');
      row.className = 'recipe-consent-card__opt';
      row.dataset.cap = item.key;
      row.style.cssText = 'display:flex;align-items:center;gap:8px;margin:4px 0;';
      const box = doc.createElement('input');
      box.type = 'checkbox';   // sets: form — a capability this consent keeps or declines
      box.checked = !item.optedOut;   // default keep-on; a pre-declined cap starts unchecked
      box.dataset.optCap = item.key;
      const span = doc.createElement('span');
      span.textContent = capLabel(t, item);
      row.append(box, span);
      panel.appendChild(row);
      boxes.push({ key: item.key, box });
    }

    const hint = doc.createElement('p');
    hint.style.cssText = 'color:var(--ink-soft);font-size:.9em;margin:6px 0 0;';
    hint.textContent = t('circle.recipeConsent.optional_hint');
    panel.appendChild(hint);
  }

  // ── actions ─────────────────────────────────────────────────────────────────
  const actions = doc.createElement('div');
  actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:16px;';
  actions.appendChild(btn(doc, t('circle.recipeConsent.decline'), () => { close(); onDecline?.(); }));
  const agree = btn(doc, t('circle.recipeConsent.agree'), () => {
    const declinedKeys = boxes.filter((b) => !b.box.checked).map((b) => b.key);
    close();
    onAgree?.({ declinedKeys });
  });
  agree.className = 'recipe-consent-card__agree cc-btn cc-btn--primary';
  actions.appendChild(agree);
  panel.appendChild(actions);

  doc.body.appendChild(overlay);
  return { close, el: panel };
}
