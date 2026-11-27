/**
 * basis v2 — circle rules editor (web DOM renderer).
 *
 * The six governance questions as a single editable form over a rules
 * document; required questions (purpose + agreements) gate Save. A
 * "preview" action shows the assembled document as a joiner would consent
 * to it. Controlled render: the host passes `doc` + handlers + `t`, merges
 * `onChange` patches, re-renders, and persists on `onSave`. A save goes through the circle's rule for changing the
 * rules (the host calls `changeRulesDoor`); an approved change reaches the other members on the rules-update lane.
 */
import { RULES_QUESTIONS, isRulesComplete } from '../../src/v2/circleRules.js';
import { translatorOr } from '../../src/locales/translatorOr.js';

// 5.5d — `onPreview` removed: the join wizard now inlines the consent
// rendering from the same doc, so a separate preview-as-joiner button
// on the editor is redundant (admin previews by joining a test invite).
/**
 * @param {HTMLElement} container
 * @param {object} args
 * @param {object} args.doc
 * @param {Function} args.t
 * @param {Function} [args.onChange]
 * @param {Function} [args.onBack]
 * @param {Function} [args.onSave]
 * @param {string|null} [args.notice]          what the last save came to, in words (a proposal opened · refused)
 */
export function renderRulesEditor(container, {
  doc = {}, t, onChange, onBack, onSave, notice = null,
} = {}) {
  const tr = translatorOr(t, 'circleRulesEditor.js');
  const emit = (patch) => { if (typeof onChange === 'function') onChange(patch); };
  container.innerHTML = '';
  container.classList.add('circle-rules');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'cc-btn cc-btn--quiet circle-rules__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  container.appendChild(back);

  const head = document.createElement('h2');
  head.className = 'circle-rules__title';
  head.textContent = tr('circle.rules.title');
  container.appendChild(head);

  for (const q of RULES_QUESTIONS) {
    const field = document.createElement('label');
    field.className = 'circle-rules__field';
    field.dataset.field = q.key;
    if (q.required) field.dataset.required = 'true';

    const label = document.createElement('span');
    label.className = 'circle-rules__q';
    label.textContent = tr(`circle.rules.q.${q.key}`) + (q.required ? ' *' : '');
    field.appendChild(label);

    const area = document.createElement('textarea');
    area.className = 'circle-rules__input';
    area.dataset.field = q.key;
    area.value = doc[q.key] ?? '';
    area.addEventListener('input', () => emit({ [q.key]: area.value }));
    field.appendChild(area);

    container.appendChild(field);
  }

  const complete = isRulesComplete(doc);
  if (!complete) {
    const note = document.createElement('div');
    note.className = 'circle-rules__note';
    note.textContent = tr('circle.rules.required_note');
    container.appendChild(note);
  }

  if (notice) {
    const said = document.createElement('div');
    said.className = 'circle-rules__notice';
    said.setAttribute('role', 'status');
    said.textContent = notice;
    container.appendChild(said);
  }

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'cc-btn cc-btn--quiet circle-rules__save';
  save.textContent = tr('circle.rules.save');
  save.disabled = !complete;
  save.addEventListener('click', () => { if (complete && typeof onSave === 'function') onSave(); });
  container.appendChild(save);

  return container;
}
