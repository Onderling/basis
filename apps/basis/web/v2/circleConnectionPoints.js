/**
 * basis v2 — connection points (web DOM renderer, Nearby step I).
 *
 * A projector over `createConnectionPoints`. The one thing it must get right is the REMOVAL warning:
 * "cut off" and "still reachable another way" are rendered as two separate statements, never merged into
 * one list of affected circles. Merging them is how a person clicks through the warning that mattered.
 *
 * Pure render — the host wires the store, `t`, and the back handler.
 */

import { POINT_SOURCE_LABELS } from '../../src/v2/connectionPoints.js';

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
} = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
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
    // Also says HOW one arrives — you never configure a connection point by hand to join something.
    empty.textContent = tr('circle.nearbyScreen.points_empty');
    container.appendChild(empty);
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

    // Which one is actually carrying traffic. The substrate connects to one RELAY at a time, so a list
    // that showed them all as equal would be claiming something untrue. A POD has no socket — it is used
    // whenever the circle syncs — so active/standby would be the same lie in the other direction; it gets
    // its own line, plus the host-sees disclosure so the fact from create/join stays visible here too.
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
      live.className = point.active ? 'circle-points__live is-active' : 'circle-points__live is-standby';
      live.textContent = tr(point.active ? 'circle.nearbyScreen.point_active' : 'circle.nearbyScreen.point_standby');
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

  return container;
}
