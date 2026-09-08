/**
 * basis v2 — connection points (web DOM renderer, Nearby step I).
 *
 * A projector over `createConnectionPoints`. The one thing it must get right is the REMOVAL warning:
 * "cut off" and "still reachable another way" are rendered as two separate statements, never merged into
 * one list of affected circles. Merging them is how a person clicks through the warning that mattered.
 *
 * Pure render — the host wires the store, `t`, and the back handler.
 */

import { POINT_SOURCE_LABELS, POINT_STATUS_LABELS, pointStatus } from '../../src/v2/connectionPoints.js';
import { translatorOr } from '../../src/locales/translatorOr.js';

export function renderConnectionPoints(container, {
  points = [],
  t,
  onBack = null,
  onAdopt = null,
  onRemove = null,
  onConfirmRemove = null,
  onCancelRemove = null,
  /** The url currently being confirmed, plus its impact report. */
  removing = null,
  /** `agent.relays.list()` — which of these the device is on RIGHT NOW, and which one is its own. */
  relays = [],
  /** Add a relay by hand: `(url) => void`. Absent ⇒ no field (a shell with no agent to dial with). */
  onAdd = null,
  /** A locale key for what went wrong with the last add, or null. */
  addError = null,
} = {}) {
  const tr = translatorOr(t, 'circleConnectionPoints.js');
  container.innerHTML = '';
  container.classList.add('circle-points');

  if (onBack) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'circle-points__back';
    back.textContent = tr('circle.back');
    back.addEventListener('click', onBack);
    container.appendChild(back);
  }

  const title = document.createElement('h2');
  title.className = 'circle-points__title';
  title.textContent = tr('circle.nearbyScreen.points_title');
  container.appendChild(title);

  const intro = document.createElement('div');
  intro.className = 'circle-points__intro';
  intro.textContent = tr('circle.nearbyScreen.points_intro');
  container.appendChild(intro);

  if (!points.length) {
    const empty = document.createElement('div');
    empty.className = 'circle-points__empty';
    // Also says HOW one arrives — you never have to configure a connection point by hand to join something.
    empty.textContent = tr('circle.nearbyScreen.points_empty');
    container.appendChild(empty);
    appendAddForm(container, { tr, onAdd, addError });   // …but someone running their own relay may want to.
    return container;
  }

  for (const point of points) {
    const el = document.createElement('div');
    el.className = 'circle-points__point';
    el.dataset.url = point.url;
    if (!point.adopted) el.classList.add('is-suggested');

    const url = document.createElement('div');
    url.className = 'circle-points__url';
    url.textContent = point.url;
    el.appendChild(url);

    // Which of these is actually carrying traffic. Since 2026-09-08 a device is on its OWN relay and on
    // every relay its kringen ride, all at once — so the line says which is yours, which are also
    // connected, and which are not, rather than the old one-live-the-rest-reserve story. A POD has no
    // socket at all; it gets its own line plus the host-sees disclosure, as before.
    const live = document.createElement('div');
    if (point.kind === 'pod') {
      live.className = 'circle-points__live is-pod';
      live.textContent = tr('circle.nearbyScreen.point_kind_pod');
      el.appendChild(live);
      const sees = document.createElement('div');
      sees.className = 'circle-points__pod-sees';
      sees.textContent = tr('circle.nearbyScreen.point_pod_host_sees');
      el.appendChild(sees);
    } else {
      const status = pointStatus(point, relays);
      live.className = `circle-points__live is-${status}`;
      live.textContent = tr(POINT_STATUS_LABELS[status]);
      el.appendChild(live);
    }

    const src = document.createElement('div');
    src.className = 'circle-points__source';
    src.textContent = tr(POINT_SOURCE_LABELS[point.source] ?? POINT_SOURCE_LABELS.manual);
    el.appendChild(src);

    // The both-ways mapping, from this side: what rides this point.
    const carries = document.createElement('div');
    carries.className = 'circle-points__carries';
    carries.textContent = point.circles.length
      ? tr('circle.nearbyScreen.point_carries', { circles: point.circles.join(', ') })
      : tr('circle.nearbyScreen.point_carries_none');
    el.appendChild(carries);

    const bar = document.createElement('div');
    bar.className = 'circle-points__actions';

    if (!point.adopted) {
      const adopt = document.createElement('button');
      adopt.type = 'button';
      adopt.className = 'circle-points__adopt';
      adopt.textContent = tr('circle.nearbyScreen.point_adopt');
      adopt.addEventListener('click', () => onAdopt?.(point.url));
      bar.appendChild(adopt);
    }

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'circle-points__remove';
    remove.textContent = tr('circle.nearbyScreen.point_remove');
    remove.addEventListener('click', () => onRemove?.(point.url));
    bar.appendChild(remove);
    el.appendChild(bar);

    // ── The impact preview, in place ────────────────────────────────────────
    if (removing?.url === point.url) {
      const warn = document.createElement('div');
      warn.className = 'circle-points__impact';
      warn.setAttribute('role', 'alert');

      const cutOff = removing.losesReachability ?? [];
      const stillOk = removing.stillReachable ?? [];

      // Rendered as two statements. A circle left with no other point is CUT OFF; one with an alternative
      // is merely inconvenienced, and collapsing them would let the severe case hide inside the mild one.
      if (cutOff.length) {
        const bad = document.createElement('div');
        bad.className = 'circle-points__impact-cutoff';
        bad.textContent = tr('circle.nearbyScreen.remove_cuts_off', { circles: cutOff.join(', ') });
        warn.appendChild(bad);
      }
      if (stillOk.length) {
        const ok = document.createElement('div');
        ok.className = 'circle-points__impact-ok';
        ok.textContent = tr('circle.nearbyScreen.remove_still_ok', { circles: stillOk.join(', ') });
        warn.appendChild(ok);
      }
      // Removing the live point drops the connection until another is chosen — its own event, even when
      // nothing is cut off.
      if (removing.wasActive) {
        const wasActive = document.createElement('div');
        wasActive.className = 'circle-points__impact-active';
        wasActive.textContent = tr('circle.nearbyScreen.remove_was_active');
        warn.appendChild(wasActive);
      }
      if (!cutOff.length && !stillOk.length && !removing.wasActive) {
        const none = document.createElement('div');
        none.className = 'circle-points__impact-none';
        none.textContent = tr('circle.nearbyScreen.remove_nothing');
        warn.appendChild(none);
      }

      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'circle-points__confirm';
      confirm.textContent = tr('circle.nearbyScreen.remove_confirm');
      confirm.addEventListener('click', () => onConfirmRemove?.(point.url));
      warn.appendChild(confirm);

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'circle-points__cancel';
      cancel.textContent = tr('circle.nearbyScreen.remove_cancel');
      cancel.addEventListener('click', () => onCancelRemove?.());
      warn.appendChild(cancel);

      el.appendChild(warn);
    }

    container.appendChild(el);
  }

  appendAddForm(container, { tr, onAdd, addError });
  return container;
}

/**
 * Add a relay by hand — for someone running their own box, or handed one by a friend.
 *
 * It ADDS: the device stays on the relays it is already on. That is worth saying out loud in the hint,
 * because the old model was one relay that a new one replaced, and that is what people expect.
 */
function appendAddForm(container, { tr, onAdd, addError }) {
  if (typeof onAdd !== 'function') return;
  const form = document.createElement('form');
  form.className = 'circle-points__add';

  const title = document.createElement('h3');
  title.className = 'circle-points__add-title';
  title.textContent = tr('circle.nearbyScreen.point_add_title');
  form.appendChild(title);

  const hint = document.createElement('div');
  hint.className = 'circle-points__add-hint';
  hint.textContent = tr('circle.nearbyScreen.point_add_hint');
  form.appendChild(hint);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'circle-points__add-input';
  input.placeholder = tr('circle.nearbyScreen.point_add_placeholder');
  input.setAttribute('aria-label', tr('circle.nearbyScreen.point_add_title'));
  form.appendChild(input);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'circle-points__add-submit cc-btn';
  submit.textContent = tr('circle.nearbyScreen.point_add_button');
  form.appendChild(submit);

  if (addError) {
    const err = document.createElement('div');
    err.className = 'circle-points__add-error';
    err.setAttribute('role', 'alert');
    err.textContent = tr(addError);
    form.appendChild(err);
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    onAdd(input.value.trim());
  });
  container.appendChild(form);
}
