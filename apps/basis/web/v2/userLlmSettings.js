// userLlmSettings.js — the member's PERSONAL assistant endpoint config (web DOM renderer). Lets a
// member point the circle assistant at their OWN LLM + embedder from the UI (not just a build-time env
// var): a preset (posture) + the LLM base URL/model + the embedder base URL/model + an optional API key.
// The value `resolveCircleLlm` consults when a circle's policy is 'user'. The confidential-route guard
// (passed in as `validate`) runs before save, so a "confidential" preset can't be pointed at a host
// that could read raw circle text. Pure render: `onSave(cfg)` persists + applies; `validate(cfg)` → msg|null.

const PRESETS = ['off', 'local-ollama', 'confidential-proxy', 'openai-compatible'];

/**
 * @param {Element} container
 * @param {{ current?: object, onSave?: (cfg:object)=>(Promise<string|null>|string|null),
 *           validate?: (cfg:object)=>(string|null), t?: (k:string)=>string }} [opts]
 */
export function renderUserLlmSettings(container, { current = {}, onSave, validate, t = (k) => k } = {}) {
  if (!container) return container;
  while (container.firstChild) container.removeChild(container.firstChild);
  // working copy the inputs mutate; persisted only on Save.
  const cfg = {
    preset: PRESETS.includes(current.preset) ? current.preset : 'off',
    llmBaseUrl: current.llmBaseUrl || '', llmModel: current.llmModel || '',
    embedBaseUrl: current.embedBaseUrl || '', embedModel: current.embedModel || '',
    apiKey: current.apiKey || '', attestation: !!current.attestation,
  };

  const sec = document.createElement('section');
  sec.className = 'cc-user-llm';

  const title = document.createElement('div');
  title.className = 'cc-user-llm__title';
  title.textContent = t('circle.userLlm.title');
  sec.appendChild(title);

  const hint = document.createElement('div');
  hint.className = 'cc-user-llm__hint';
  hint.textContent = t('circle.userLlm.hint');
  sec.appendChild(hint);

  // ── preset selector ─────────────────────────────────────────────────────────
  const presetWrap = document.createElement('div');
  presetWrap.className = 'cc-user-llm__presets';
  for (const p of PRESETS) {
    const label = document.createElement('label');
    label.className = 'cc-user-llm__opt';
    const radio = document.createElement('input');
    radio.type = 'radio'; radio.name = 'user-llm-preset'; radio.value = p; radio.checked = p === cfg.preset;
    radio.addEventListener('change', () => { if (radio.checked) { cfg.preset = p; renderFields(); } });
    const span = document.createElement('span');
    span.textContent = t(`circle.userLlm.preset.${p}`);
    label.append(radio, span);
    presetWrap.appendChild(label);
  }
  sec.appendChild(presetWrap);

  // ── endpoint fields (shown when preset ≠ off) ───────────────────────────────
  const fields = document.createElement('div');
  fields.className = 'cc-user-llm__fields';
  sec.appendChild(fields);

  const msg = document.createElement('div');
  msg.className = 'cc-user-llm__msg';
  sec.appendChild(msg);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'cc-btn cc-btn--quiet cc-user-llm__save';
  saveBtn.textContent = t('circle.userLlm.save');
  saveBtn.addEventListener('click', onSaveClick);
  sec.appendChild(saveBtn);

  function textField(key, labelKey, { placeholder = '', password = false } = {}) {
    const row = document.createElement('label');
    row.className = 'cc-user-llm__field';
    const cap = document.createElement('span');
    cap.textContent = t(labelKey);
    const inp = document.createElement('input');
    inp.type = password ? 'password' : 'text';
    inp.value = cfg[key] || '';
    inp.placeholder = placeholder;
    inp.autocapitalize = 'off'; inp.autocomplete = 'off'; inp.spellcheck = false;
    inp.addEventListener('input', () => { cfg[key] = inp.value; });
    row.append(cap, inp);
    return row;
  }

  function renderFields() {
    fields.innerHTML = '';
    msg.textContent = '';
    if (cfg.preset === 'off') return;
    fields.appendChild(textField('llmBaseUrl', 'circle.userLlm.llmBaseUrl', { placeholder: 'http://localhost:11434' }));
    fields.appendChild(textField('llmModel', 'circle.userLlm.llmModel', { placeholder: 'qwen2.5:7b-instruct' }));
    fields.appendChild(textField('embedBaseUrl', 'circle.userLlm.embedBaseUrl', { placeholder: t('circle.userLlm.embedBaseUrl_ph') }));
    fields.appendChild(textField('embedModel', 'circle.userLlm.embedModel', { placeholder: 'qwen3-embedding-4b' }));
    fields.appendChild(textField('apiKey', 'circle.userLlm.apiKey', { password: true }));
    // attestation only matters for the confidential preset (the documented Option-B bypass).
    if (cfg.preset === 'confidential-proxy') {
      const row = document.createElement('label');
      row.className = 'cc-user-llm__field cc-user-llm__attest';
      const chk = document.createElement('input');
      chk.type = 'checkbox'; chk.checked = !!cfg.attestation;
      chk.addEventListener('change', () => { cfg.attestation = chk.checked; });
      const cap = document.createElement('span');
      cap.textContent = t('circle.userLlm.attestation');
      row.append(chk, cap);
      fields.appendChild(row);
    }
  }

  async function onSaveClick() {
    msg.className = 'cc-user-llm__msg';
    // confidential-route guard (inline) BEFORE persisting.
    const err = typeof validate === 'function' ? validate(cfg) : null;
    if (err) { msg.classList.add('is-error'); msg.textContent = err; return; }
    let applyErr = null;
    if (typeof onSave === 'function') { try { applyErr = await onSave({ ...cfg }); } catch (e) { applyErr = e?.message || String(e); } }
    if (applyErr) { msg.classList.add('is-error'); msg.textContent = applyErr; return; }
    msg.classList.add('is-ok'); msg.textContent = t('circle.userLlm.saved');
  }

  renderFields();
  container.appendChild(sec);
  return sec;
}
