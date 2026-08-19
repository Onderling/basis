/**
 * basis v2 — personal circle override (web DOM renderer).
 *
 * The calling member's own deviations from a circle's defaults: chat off,
 * reveal-open, agents-may-contact-me, and flow-through (claimed tasks /
 * calendar → "My things"). Controlled render over a `memberOverride`
 * (`@onderling/circlePolicy`); toggles fire `onChange(patch)`; the host
 * merges + re-renders + persists. Pure → unit-testable under happy-dom.
 *
 * also the member's capability OPT-OUTS: given the circle's admin `policy` + the merged
 * manifest `sources`, list the OPT-OUTABLE capabilities (admin freedom 'optional' or a privacy floor)
 * and let the member decline them. Declining writes `capabilityOptOuts`; the same gate then refuses them.
 */
import { buildCapabilityMatrix } from '@onderling/app-manifest';

const TOP_TOGGLES = ['chatOff', 'revealOpen', 'agentsMayContactMe'];
const FLOW_TOGGLES = ['tasksToPersonal', 'calendarToPersonal'];
// per-circle push toggles (audit). Same shape as
// the existing TOP_TOGGLES / FLOW_TOGGLES row pattern; the locale lives
// under its own namespace (`circle.member.notifications.*`) so the four
// strings are reusable by mobile + chat without sitting under the
// override sheet.
const PUSH_TOGGLES = [
  { key: 'onMention',      i18n: 'on_mention' },
  { key: 'onEveryMessage', i18n: 'on_message' },
  { key: 'onNewItem',      i18n: 'on_new_item' },
  { key: 'onProposal',     i18n: 'on_proposal' },
];

export function renderCircleOverride(container, { override, t, onChange, onBack, onSave, sources = [], policy = {} } = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  const emit = (patch) => { if (typeof onChange === 'function') onChange(patch); };
  container.innerHTML = '';
  container.classList.add('circle-override');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-override__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  container.appendChild(back);

  const head = document.createElement('h2');
  head.className = 'circle-override__title';
  head.textContent = tr('circle.override.title');
  container.appendChild(head);

  for (const key of TOP_TOGGLES) {
    container.appendChild(toggleRow({
      cls: 'circle-override__toggle',
      key,
      checked: !!override?.[key],
      label: tr(`circle.override.${key}`),
      onToggle: (checked) => emit({ [key]: checked }),
    }));
  }

  const pushSec = document.createElement('section');
  pushSec.className = 'circle-override__push';
  const pushTitle = document.createElement('h3');
  pushTitle.className = 'circle-override__section-title';
  pushTitle.textContent = tr('circle.member.notifications.section_title');
  pushSec.appendChild(pushTitle);
  for (const { key, i18n } of PUSH_TOGGLES) {
    pushSec.appendChild(toggleRow({
      cls: 'circle-override__push-toggle',
      key,
      checked: !!override?.push?.[key],
      label: tr(`circle.member.notifications.${i18n}`),
      onToggle: (checked) => emit({ push: { [key]: checked } }),
    }));
  }
  container.appendChild(pushSec);

  const flowSec = document.createElement('section');
  flowSec.className = 'circle-override__flow';
  const flowTitle = document.createElement('h3');
  flowTitle.className = 'circle-override__section-title';
  flowTitle.textContent = tr('circle.override.flowThrough');
  flowSec.appendChild(flowTitle);
  for (const key of FLOW_TOGGLES) {
    flowSec.appendChild(toggleRow({
      cls: 'circle-override__flow-toggle',
      key,
      checked: !!override?.flowThrough?.[key],
      label: tr(`circle.override.${key}`),
      onToggle: (checked) => emit({ flowThrough: { [key]: checked } }),
    }));
  }
  container.appendChild(flowSec);

  // the member's capability opt-outs (only the opt-outable caps of enabled apps).
  renderCapabilityOptOuts(container, { sources, policy, override, tr, emit });

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'circle-override__save';
  save.textContent = tr('circle.settings.save');
  save.addEventListener('click', () => { if (typeof onSave === 'function') onSave(); });
  container.appendChild(save);

  return container;
}

/**
 * the member's capability opt-outs. Lists the OPT-OUTABLE capabilities (admin freedom
 * 'optional' or a privacy floor) of the enabled apps; a checked box = "I participate", unchecking =
 * opt out. Emits the FULL updated `capabilityOptOuts` list (mergeMemberOverride replaces it wholesale).
 */
function renderCapabilityOptOuts(container, { sources, policy, override, tr, emit }) {
  if (!Array.isArray(sources) || !sources.length) return;
  const matrix = buildCapabilityMatrix(sources, {
    enabledApps: Array.isArray(policy?.apps) && policy.apps.length ? policy.apps : null,
    template:    policy?.capabilities || {},
    optOuts:     override?.capabilityOptOuts || [],
  });
  const optOutable = matrix.filter((r) => r.enabled && r.optOutable);
  if (!optOutable.length) return;

  const current = new Set(override?.capabilityOptOuts || []);
  const sec = document.createElement('section');
  sec.className = 'circle-override__caps';
  const title = document.createElement('h3');
  title.className = 'circle-override__section-title';
  title.textContent = tr('circle.override.capabilities');
  sec.appendChild(title);

  const byApp = new Map();
  for (const r of optOutable) { if (!byApp.has(r.app)) byApp.set(r.app, []); byApp.get(r.app).push(r); }
  for (const [app, rows] of byApp) {
    const h = document.createElement('h4');
    h.className = 'circle-override__subhead';
    h.textContent = tr(`circle.settings.app.${app}`, { defaultValue: app });
    sec.appendChild(h);
    for (const r of rows) {
      const floorTag = r.privacyFloor ? ` (${tr('circle.settings.privacyFloor')})` : '';
      const row = toggleRow({
        cls: 'circle-override__cap-toggle',
        key: r.key,
        checked: !r.optedOut,   // checked = participate; unchecking opts out
        label: `${tr(`circle.settings.verb.${r.atom}`, { defaultValue: r.atom })} · ${r.noun}${floorTag}`,
        onToggle: (participate) => {
          const next = new Set(current);
          if (participate) next.delete(r.key); else next.add(r.key);
          emit({ capabilityOptOuts: [...next] });
        },
      });
      row.dataset.cap = r.key;
      sec.appendChild(row);
    }
  }
  container.appendChild(sec);
}

function toggleRow({ cls, key, checked, label, onToggle }) {
  const row = document.createElement('label');
  row.className = cls;
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = checked;
  box.dataset.key = key;
  box.addEventListener('change', () => onToggle(box.checked));
  const span = document.createElement('span');
  span.textContent = label;
  row.append(box, span);
  return row;
}
