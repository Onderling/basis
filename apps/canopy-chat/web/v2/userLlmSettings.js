// userLlmSettings.js — a small settings control for the member's PERSONAL default LLM (the value
// `resolveCircleLlm` consults when a circle's policy is 'user'). Renders mode radios; a change persists
// via the injected `@canopy/pod-client`/`userLlmDefault` store. The personal default never overrides a
// circle that forbids (`off`) or mandates (`local`/`cloud`) — it only applies under 'user'.

const MODES = ['off', 'local', 'cloud'];

/**
 * Render the radios into `container` (replacing its contents). Pure: `onChange(mode)` fires on select.
 * @param {Element} container
 * @param {{ current?: {mode?:string}, onChange?: (mode:string)=>void, t?: (k:string)=>string }} [opts]
 */
export function renderUserLlmSettings(container, { current = { mode: 'off' }, onChange, t = (k) => k } = {}) {
  while (container.firstChild) container.removeChild(container.firstChild);
  const sec = document.createElement('section');
  sec.className = 'cc-user-llm';
  const title = document.createElement('div');
  title.className = 'cc-user-llm__title';
  title.textContent = t('settings.userLlm.title');
  sec.appendChild(title);

  const mode = MODES.includes(current?.mode) ? current.mode : 'off';
  for (const m of MODES) {
    const label = document.createElement('label');
    label.className = 'cc-user-llm__opt';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'user-llm';
    radio.value = m;
    radio.checked = m === mode;
    radio.addEventListener('change', () => { if (radio.checked && typeof onChange === 'function') onChange(m); });
    const span = document.createElement('span');
    span.textContent = t(`settings.userLlm.${m}`);
    label.append(radio, span);
    sec.appendChild(label);
  }
  container.appendChild(sec);
  return sec;
}

/**
 * Wire the control to a store ({ get, set } — `createUserLlmDefaultStore`): load the current value,
 * render, and persist + re-render on change. Returns the rendered section.
 */
export async function mountUserLlmSettings(container, { store, t } = {}) {
  const current = store && typeof store.get === 'function' ? await store.get() : { mode: 'off' };
  const onChange = async (mode) => {
    if (store && typeof store.set === 'function') await store.set(mode);
    renderUserLlmSettings(container, { current: { mode }, onChange, t });   // reflect the new selection
  };
  return renderUserLlmSettings(container, { current, onChange, t });
}
