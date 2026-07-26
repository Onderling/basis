/**
 * The display-theme toggle (systeem / licht / donker) — ONE renderer, rendered in more than one place.
 *
 * The control was built into "Mijn gegevens" only, where nobody looks for it (2026-07-22 demo feedback:
 * "the theme toggle exists but is buried"). Rather than copy the DOM into the settings panel, the markup +
 * classes live here once and both surfaces call it — so the pill toggle can never drift into two looks
 * (CLAUDE.md invariant #3).
 *
 * Pure DOM + injected deps: `themePref` is the current choice and `onSetTheme(next)` persists it. The
 * persistence/stamping itself stays in the host (circleApp writes `localStorage['basis.theme']` and stamps
 * `document.documentElement.dataset.theme`; the pre-paint hook in index.html reads the same key at boot).
 */

/** The three choices, least→most specific. `system` = follow the OS (the stored key is removed). */
export const THEME_CHOICES = Object.freeze(['system', 'light', 'dark']);

/**
 * Append the segmented pill toggle to `container`.
 *
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {'system'|'light'|'dark'} opts.themePref  the active choice.
 * @param {(next: string) => void} opts.onSetTheme  persist + apply; absent ⇒ nothing is rendered.
 * @param {(key: string) => string} opts.t          locale lookup (invariant #8 — no baked strings).
 * @param {string} [opts.className='cc-mydata__theme-toggle']  wrapper class, so a host can scope layout.
 * @returns {HTMLElement|null} the toggle element, or null when no handler was wired.
 */
export function renderThemeToggle(container, { themePref, onSetTheme, t, className = 'cc-mydata__theme-toggle' } = {}) {
  if (typeof onSetTheme !== 'function' || !container) return null;
  const tr = typeof t === 'function' ? t : (k) => k;

  const toggle = document.createElement('div');
  toggle.className = className;
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', tr('circle.mydata.theme'));

  for (const th of THEME_CHOICES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `cc-mydata__theme-btn${th === themePref ? ' is-active' : ''}`;
    b.dataset.theme = th;
    b.setAttribute('aria-pressed', th === themePref ? 'true' : 'false');
    b.textContent = tr(`circle.mydata.theme_${th}`);
    b.addEventListener('click', () => onSetTheme(th));
    toggle.appendChild(b);
  }
  container.appendChild(toggle);
  return toggle;
}

export default renderThemeToggle;
