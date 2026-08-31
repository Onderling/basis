/**
 * basis v2 — the ENTRUST (toevertrouwen) picker: the WEB DOM projection of a
 * task-scoped MANDATE.
 *
 * A mandate is bounded authority the task owner entrusts to one member for one
 * task. It is TEMPORARY (it lifts the moment the task closes — revoke-on-complete
 * is already wired) and BROKERED (your keys stay with you; only answers travel).
 * The "toegang"/access framing is retired: this is authority you lend, not a door
 * you open.
 *
 * Thin DOM projection (invariant #1): the pure grant/attenuation/legibility
 * DECISIONS live ONCE in shared `../../src/v2/mandate.js` and are consumed here +
 * by the mobile picker (RN) — this file only paints them and dispatches the
 * ALREADY-registered `attachTaskGrant` op. `buildMandateGrant` is re-exported so
 * this module's existing importers/tests keep their single entry point.
 *
 * WAARVOOR (the WHAT) is a DATA-DRIVEN grant-KIND taxonomy — see the shared
 * module for the taxonomy + the resource kind's honest "nog niet actief" state.
 */
import {
  buildMandateGrant,
  grantKindOptions,
  memberLabel,
  memberWebid,
  mandateRoster,
  mandateConfirmEnabled,
  mandateConfirmPayload,
  mandateLegibilityRows,
  RESOURCE_BROKERS,
  DEFAULT_RESOURCE_BROKER,
  RESOURCE_USE_MODES,
  DEFAULT_RESOURCE_USE,
  resourceUseRequiresConsent,
} from '../../src/v2/mandate.js';

// Re-export the shared pure core so existing importers (circleApp, circleView)
// and the picker test keep this file as their single entry point (web≡mobile
// consume the SAME source; no second definition lives here).
export {
  buildMandateGrant,
  GRANT_KIND_SPECS,
  grantKindOptions,
} from '../../src/v2/mandate.js';
import { translatorOr } from '../../src/locales/translatorOr.js';

/**
 * Render the entrust picker into `container`.
 *
 * @param {HTMLElement} container
 * @param {object} o
 * @param {Array}  [o.members=[]]        the circle roster ({webid,name,…})
 * @param {Array}  [o.offerings=[]]      MY offerings ({key,text}); [] → single "namens jou"
 * @param {Array}  [o.resources=[]]      grantable resources ({id,label,grain}); [] → resource kind
 *                                        shows its honest "nog niet actief" placeholder
 * @param {string} o.taskId
 * @param {string} o.myWebid
 * @param {Array}  [o.existingGrants=[]] the task's `source.taskGrants` ({member,skill})
 * @param {function} o.t
 * @param {(g:{taskId,member,grant})=>void} o.onConfirm
 * @param {()=>void} o.onCancel
 * @param {boolean} [o.busy=false]
 * @param {string|null} [o.notice=null]
 * @returns {HTMLElement}
 */
export function renderMandatePicker(container, {
  members = [],
  offerings = [],
  resources = [],
  taskId = null,
  myWebid = null,
  existingGrants = [],
  t,
  onConfirm,
  onCancel,
  busy = false,
  notice = null,
} = {}) {
  if (!container) return container;
  const tr = translatorOr(t, 'mandatePicker.js');
  container.innerHTML = '';
  container.className = 'cc-mandate-picker';

  // Selectable roster — everyone but me (you don't entrust a task to yourself).
  const roster = mandateRoster({ members, myWebid });

  let pickedMember = null;      // WebID
  let pickedWhat = null;        // the selected grant-kind option (from grantKindOptions)
  let pickedBroker = DEFAULT_RESOURCE_BROKER;   // resource kind — broker posture (#29)
  let pickedUse = DEFAULT_RESOURCE_USE;         // resource kind — use-consent

  // ── Header ────────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'cc-mandate-picker__header';
  const title = document.createElement('h3');
  title.className = 'cc-mandate-picker__title';
  title.style.cssText = 'margin:0;font-family:var(--font-sans);color:var(--ink)';
  title.textContent = tr('circle.mandate.heading');
  header.appendChild(title);
  if (typeof onCancel === 'function') {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'cc-mandate-picker__cancel';
    cancel.style.cssText = 'background:none;border:none;color:var(--ink-soft);cursor:pointer;font-size:1.1em';
    cancel.textContent = tr('circle.mandate.cancel');
    cancel.addEventListener('click', () => onCancel());
    header.appendChild(cancel);
  }
  container.appendChild(header);

  const sub = document.createElement('p');
  sub.className = 'cc-mandate-picker__sub';
  sub.style.cssText = 'margin:4px 0 12px;color:var(--ink-soft);font-size:0.9em';
  sub.textContent = tr('circle.mandate.intro');
  container.appendChild(sub);

  if (notice) {
    const n = document.createElement('div');
    n.className = 'cc-mandate-picker__notice';
    n.style.cssText = 'margin:0 0 10px;padding:8px;border-radius:var(--radius-sm);background:var(--paper-2);color:var(--ink);font-size:0.9em';
    n.textContent = notice;
    container.appendChild(n);
  }

  // ── Existing mandates (legibility) ──────────────────────────────────────────
  if (Array.isArray(existingGrants) && existingGrants.length) {
    container.appendChild(renderMandateLegibility(existingGrants, { members, offerings, t: tr }));
  }

  const sectionLabel = (key) => {
    const l = document.createElement('div');
    l.className = 'cc-mandate-picker__label';
    l.style.cssText = 'font-size:0.78em;letter-spacing:0.04em;text-transform:uppercase;color:var(--ink-soft);margin:12px 0 6px';
    l.textContent = tr(key);
    return l;
  };

  const confirmBtn = document.createElement('button');   // referenced by the pickers below

  // ── WHO ─────────────────────────────────────────────────────────────────────
  container.appendChild(sectionLabel('circle.mandate.who_label'));
  if (!roster.length) {
    const empty = document.createElement('p');
    empty.className = 'cc-mandate-picker__empty';
    empty.style.cssText = 'color:var(--ink-soft);font-size:0.9em;margin:0 0 8px';
    empty.textContent = tr('circle.mandate.who_empty');
    container.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'cc-mandate-picker__who';
    list.setAttribute('role', 'radiogroup');
    for (const m of roster) {
      const w = memberWebid(m);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cc-mandate-picker__who-item';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', 'false');
      btn.dataset.member = w;
      btn.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 10px;margin:0 0 4px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--card);color:var(--ink);cursor:pointer';
      btn.textContent = memberLabel(m);
      btn.addEventListener('click', () => {
        pickedMember = w;
        for (const el of list.querySelectorAll('.cc-mandate-picker__who-item')) {
          const on = el.dataset.member === w;
          el.setAttribute('aria-checked', on ? 'true' : 'false');
          el.style.borderColor = on ? 'var(--accent)' : 'var(--line)';
          el.style.background = on ? 'var(--paper-2)' : 'var(--card)';
        }
        syncConfirm();
      });
      list.appendChild(btn);
    }
    container.appendChild(list);
  }

  // ── WAARVOOR (WHAT) — the data-driven grant-KIND taxonomy ────────────────────
  container.appendChild(sectionLabel('circle.mandate.what_label'));
  const whatList = document.createElement('div');
  whatList.className = 'cc-mandate-picker__what';
  whatList.setAttribute('role', 'radiogroup');

  // An honest note area shown when the selected kind can't be issued yet
  // (e.g. the "resource" kind while the brokered device-fetch path is unwired).
  const whatNote = document.createElement('div');
  whatNote.className = 'cc-mandate-picker__what-note';
  whatNote.style.cssText = 'margin:2px 0 4px;padding:8px;border-radius:var(--radius-sm);background:var(--paper-2);color:var(--ink-soft);font-size:0.85em;line-height:1.4';
  whatNote.hidden = true;

  // The resource-only settings panel (broker posture + use-consent, #29 +
  // consent-on-use). Built once below; shown only when an ISSUABLE resource option
  // is selected, so actAs/offering paint identically to before.
  let showResourceSettings = () => {};
  let hideResourceSettings = () => {};

  const selectWhat = (opt) => {
    pickedWhat = opt;
    for (const el of whatList.querySelectorAll('.cc-mandate-picker__what-item')) {
      const on = el.dataset.what === opt.id;
      el.setAttribute('aria-checked', on ? 'true' : 'false');
      el.style.borderColor = on ? 'var(--accent)' : 'var(--line)';
      el.style.background = on ? 'var(--paper-2)' : 'var(--card)';
    }
    if (opt.note) { whatNote.textContent = opt.note; whatNote.hidden = false; }
    else { whatNote.hidden = true; whatNote.textContent = ''; }
    if (opt.kind === 'resource' && opt.active) showResourceSettings();
    else hideResourceSettings();
    syncConfirm();
  };

  // Expand the taxonomy → grouped, selectable option rows. Adding a grant kind is
  // a one-entry change in GRANT_KIND_SPECS; this render stays generic.
  const whatGroups = grantKindOptions({ offerings, resources, t: tr });
  let firstActiveOpt = null;
  for (const group of whatGroups) {
    if (group.groupLabelKey) whatList.appendChild(sectionLabel(group.groupLabelKey));
    for (const opt of group.rows) {
      if (!firstActiveOpt && opt.active) firstActiveOpt = opt;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cc-mandate-picker__what-item';
      btn.setAttribute('role', 'radio');
      btn.dataset.what = opt.id;
      btn.dataset.kind = opt.kind;
      if (!opt.active) btn.dataset.inactive = 'true';
      btn.setAttribute('aria-checked', 'false');
      btn.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 10px;margin:0 0 4px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--card);color:var(--ink);cursor:pointer';
      btn.textContent = opt.label;
      btn.addEventListener('click', () => selectWhat(opt));
      whatList.appendChild(btn);
    }
  }
  container.appendChild(whatList);
  container.appendChild(whatNote);

  // ── Resource settings (broker posture + use-consent) — resource kind only ────
  // A pure, shared decision surface: the broker posture (device-default /
  // companion, #29) and the use-consent (requestable-default / standing). Hidden
  // unless an issuable resource is selected, so the actAs/offering paint is byte-
  // identical to before.
  const resourceSettings = document.createElement('div');
  resourceSettings.className = 'cc-mandate-picker__resource-settings';
  resourceSettings.style.cssText = 'margin:6px 0 2px';
  resourceSettings.hidden = true;

  // A small radio-style toggle group builder (label + one row of options).
  const toggleGroup = (labelKey, options, current, onPick, testKind) => {
    const grp = document.createElement('div');
    grp.className = `cc-mandate-picker__${testKind}`;
    grp.style.cssText = 'margin:0 0 8px';
    grp.appendChild(sectionLabel(labelKey));
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    row.setAttribute('role', 'radiogroup');
    for (const value of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `cc-mandate-picker__${testKind}-item`;
      b.dataset.value = value;
      b.setAttribute('role', 'radio');
      const on = value === current();
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.style.cssText = 'flex:1 1 auto;padding:7px 10px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--card);color:var(--ink);cursor:pointer;font-size:0.88em';
      b.style.borderColor = on ? 'var(--accent)' : 'var(--line)';
      b.style.background = on ? 'var(--paper-2)' : 'var(--card)';
      b.textContent = tr(`circle.mandate.resource.${testKind}_${value}`);
      b.addEventListener('click', () => {
        onPick(value);
        for (const el of row.querySelectorAll(`.cc-mandate-picker__${testKind}-item`)) {
          const sel = el.dataset.value === value;
          el.setAttribute('aria-checked', sel ? 'true' : 'false');
          el.style.borderColor = sel ? 'var(--accent)' : 'var(--line)';
          el.style.background = sel ? 'var(--paper-2)' : 'var(--card)';
        }
        syncResourceHint();
      });
      row.appendChild(b);
    }
    grp.appendChild(row);
    return grp;
  };

  resourceSettings.appendChild(
    toggleGroup('circle.mandate.resource.broker_label', RESOURCE_BROKERS,
      () => pickedBroker, (v) => { pickedBroker = v; }, 'broker'),
  );
  resourceSettings.appendChild(
    toggleGroup('circle.mandate.resource.use_label', RESOURCE_USE_MODES,
      () => pickedUse, (v) => { pickedUse = v; }, 'use'),
  );

  // The both-sides-legible hint that follows the use-consent choice.
  const resourceHint = document.createElement('div');
  resourceHint.className = 'cc-mandate-picker__resource-hint';
  resourceHint.style.cssText = 'font-size:0.82em;color:var(--ink-soft);line-height:1.4;margin-top:2px';
  const syncResourceHint = () => {
    resourceHint.textContent = tr(
      resourceUseRequiresConsent(pickedUse)
        ? 'circle.mandate.resource.use_hint_requestable'
        : 'circle.mandate.resource.use_hint_standing',
    );
  };
  syncResourceHint();
  resourceSettings.appendChild(resourceHint);
  container.appendChild(resourceSettings);

  showResourceSettings = () => { resourceSettings.hidden = false; };
  hideResourceSettings = () => { resourceSettings.hidden = true; };
  // (Default selection happens after syncConfirm is defined — see below.)

  // ── The promise (temporary + brokered) ───────────────────────────────────────
  const promise = document.createElement('div');
  promise.className = 'cc-mandate-picker__promise';
  promise.style.cssText = 'margin:12px 0;padding:10px;border-radius:var(--radius-sm);background:var(--green-bg);color:var(--ink);font-size:0.86em;line-height:1.4';
  for (const key of ['circle.mandate.temporary', 'circle.mandate.brokered']) {
    const line = document.createElement('div');
    line.textContent = tr(key);
    promise.appendChild(line);
  }
  container.appendChild(promise);

  // ── Confirm ───────────────────────────────────────────────────────────────
  confirmBtn.type = 'button';
  confirmBtn.className = 'cc-mandate-picker__confirm';
  confirmBtn.style.cssText = 'width:100%;padding:10px;border:none;border-radius:var(--radius);background:var(--accent);color:var(--accent-contrast);font-weight:600;cursor:pointer';
  confirmBtn.textContent = tr('circle.mandate.confirm');
  const syncConfirm = () => {
    // Confirmable only for an ISSUABLE grant kind — an inactive "nog niet actief"
    // kind (e.g. resource) is selectable/legible but never dispatched. The gate is
    // the SHARED `mandateConfirmEnabled` (web≡mobile).
    const enabled = mandateConfirmEnabled({ busy, pickedMember, pickedWhat });
    confirmBtn.disabled = !enabled;
    confirmBtn.style.opacity = enabled ? '1' : '0.5';
    confirmBtn.style.cursor = enabled ? 'pointer' : 'default';
  };
  confirmBtn.addEventListener('click', () => {
    if (busy || typeof onConfirm !== 'function') return;
    // The SHARED payload builder returns null for a non-issuable selection, so an
    // inactive kind can never be dispatched even if button-gating slips.
    const payload = mandateConfirmPayload({ taskId, myWebid, pickedMember, pickedWhat, pickedBroker, pickedUse });
    if (payload) onConfirm(payload);
  });
  // Default the WAARVOOR to the first issuable option ("namens jou") now that
  // syncConfirm exists (selectWhat calls it). Falls through to a plain sync when
  // there is no active option (defensive).
  if (firstActiveOpt) selectWhat(firstActiveOpt);
  else syncConfirm();
  container.appendChild(confirmBtn);

  return container;
}

/**
 * Compact legibility list for a task's existing mandates — who + what, with the
 * standing note that they lift when the task closes. Pure; exported so the row
 * renderer and the picker share it.
 *
 * @param {Array<{member:string, skill?:string}>} grants
 * @param {object} [o]
 * @param {Array} [o.members=[]]    roster, to resolve a member label
 * @param {Array} [o.offerings=[]]  MY offerings, to resolve a skill label
 * @param {function} [o.t]
 * @returns {HTMLElement}
 */
export function renderMandateLegibility(grants, { members = [], offerings = [], t } = {}) {
  const tr = translatorOr(t, 'mandatePicker.js');
  const wrap = document.createElement('div');
  wrap.className = 'cc-mandate-legibility';
  wrap.style.cssText = 'margin:0 0 8px;padding:8px 10px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--card)';

  const heading = document.createElement('div');
  heading.className = 'cc-mandate-legibility__heading';
  heading.style.cssText = 'font-size:0.78em;letter-spacing:0.04em;text-transform:uppercase;color:var(--ink-soft);margin:0 0 4px';
  heading.textContent = tr('circle.mandate.existing_heading');
  wrap.appendChild(heading);

  const list = document.createElement('ul');
  list.className = 'cc-mandate-legibility__list';
  list.style.cssText = 'list-style:none;margin:0;padding:0';
  // Rows (who + what) are resolved by the SHARED pure builder (web≡mobile).
  for (const r of mandateLegibilityRows(grants, { members, offerings, t: tr })) {
    const li = document.createElement('li');
    li.className = 'cc-mandate-legibility__item';
    li.style.cssText = 'font-size:0.88em;color:var(--ink);margin:0 0 2px';
    li.dataset.member = r.member;
    li.textContent = tr('circle.mandate.existing_row', { who: r.who, what: r.what });
    list.appendChild(li);
  }
  wrap.appendChild(list);

  const note = document.createElement('div');
  note.className = 'cc-mandate-legibility__note';
  note.style.cssText = 'font-size:0.8em;color:var(--ink-soft);margin-top:4px';
  note.textContent = tr('circle.mandate.existing_note');
  wrap.appendChild(note);

  return wrap;
}
