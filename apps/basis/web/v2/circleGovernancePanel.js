/**
 * basis v2 — governance panel (web DOM renderer, Phase 4 §5 L4).
 *
 * A thin renderer over the shared `buildGovernanceView` model (web ≡ mobile — the mobile
 * screen renders the SAME model). Draws each open proposal: what it is, its decision-class,
 * the live tally + deadline, and — for this viewer — vote buttons (member-vote), the admin
 * override (past deadline), or a read-only status. No logic here; the host owns the
 * governance host factory + re-invokes on each action. Unit-testable under happy-dom.
 */

import { GOVERNANCE_ACTIONS, GOVERNANCE_CLASSES, decisionClassFor } from '../../src/v2/circlePolicy.js';

/** decision-class / action / status → a locale key (values carry hyphens; keys don't). */
const CLASS_KEY = { 'any-admin': 'any_admin', 'admin-quorum': 'admin_quorum', 'member-vote': 'member_vote' };

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/**
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {{open:object[], closed:object[], hasOpen:boolean}} opts.view  buildGovernanceView output
 * @param {function} opts.t
 * @param {(proposalId:string, choice:'yes'|'no')=>void} [opts.onVote]
 * @param {(proposalId:string)=>void} [opts.onOverride]
 * @param {object} [opts.policy]        the circle policy (its governance map drives the settings control)
 * @param {boolean} [opts.isAdmin]      show the admin-only decision-class settings
 * @param {(action:string, cls:string)=>void} [opts.onSetClass]  change a governed action's class
 * @param {(ref:string)=>void} [opts.onReviewDisputed]  open a removeMember proposal for an equivocator (L3)
 */
export function renderGovernancePanel(container, { view = { open: [], closed: [] }, t, onVote, onOverride, policy = null, isAdmin = false, onSetClass, onReviewDisputed } = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.classList.add('circle-governance');

  container.appendChild(el('h2', 'circle-governance__title', tr('circle.governance.title')));

  // L3 — equivocation alert: authors caught telling different peers different things. The
  // fork-proof is self-verifying; the circle reviews + removes via the normal removeMember class.
  const disputed = view?.disputed ?? [];
  for (const d of disputed) {
    const warn = el('div', 'circle-governance__disputed');
    warn.dataset.disputed = d.ref;
    warn.appendChild(el('span', 'circle-governance__disputed-line', tr('circle.governance.disputed_line', { who: d.label || d.ref })));
    const rb = el('button', 'circle-governance__disputed-review', tr('circle.governance.review_remove'));
    rb.type = 'button';
    rb.addEventListener('click', () => onReviewDisputed?.(d.ref));
    warn.appendChild(rb);
    container.appendChild(warn);
  }

  const open = view?.open ?? [];
  if (!open.length) {
    container.appendChild(el('p', 'circle-governance__empty', tr('circle.governance.none')));
  }

  for (const row of open) {
    const card = el('div', 'circle-governance__card');
    card.dataset.proposal = row.proposalId;

    const head = el('div', 'circle-governance__head');
    const actionLabel = tr(`circle.governance.action.${row.action}`);
    head.appendChild(el('span', 'circle-governance__action', row.subjectLabel ? `${actionLabel}: ${row.subjectLabel}` : actionLabel));
    head.appendChild(el('span', 'circle-governance__class', tr(`circle.governance.class.${CLASS_KEY[row.decisionClass] ?? 'any_admin'}`)));
    card.appendChild(head);

    // status pill + live tally (member-vote)
    const meta = el('div', 'circle-governance__meta');
    const statusKey = row.approved ? 'approved' : row.rejected ? 'rejected' : 'pending';
    meta.appendChild(el('span', `circle-governance__status circle-governance__status--${statusKey}`, tr(`circle.governance.status.${statusKey}`)));
    if (row.tally) {
      meta.appendChild(el('span', 'circle-governance__tally',
        tr('circle.governance.tally', { yes: row.tally.yes, need: row.tally.need, of: row.tally.of })));
    }
    if (row.deadline != null) {
      meta.appendChild(el('span', 'circle-governance__deadline', tr('circle.governance.deadline')));
    }
    if (row.approved && row.awaitingEnactment) {
      meta.appendChild(el('span', 'circle-governance__awaiting', tr('circle.governance.awaiting_enactment')));
    }
    card.appendChild(meta);

    // affordances — vote (member) / override (admin, past deadline)
    if (row.canVote) {
      const actions = el('div', 'circle-governance__actions');
      for (const choice of ['yes', 'no']) {
        const b = el('button', `circle-governance__vote circle-governance__vote--${choice}${row.myVote === choice ? ' is-mine' : ''}`,
          tr(`circle.governance.vote_${choice}`));
        b.type = 'button';
        b.dataset.choice = choice;
        b.addEventListener('click', () => onVote?.(row.proposalId, choice));
        actions.appendChild(b);
      }
      card.appendChild(actions);
    }
    if (row.canOverride) {
      const ob = el('button', 'circle-governance__override', tr('circle.governance.override'));
      ob.type = 'button';
      ob.addEventListener('click', () => onOverride?.(row.proposalId));
      card.appendChild(ob);
    }
    container.appendChild(card);
  }

  // Settled proposals — a compact read-only history.
  const closed = view?.closed ?? [];
  if (closed.length) {
    const hist = el('div', 'circle-governance__history');
    hist.appendChild(el('h3', 'circle-governance__history-title', tr('circle.governance.history')));
    for (const row of closed) {
      const statusKey = row.approved ? 'approved' : 'rejected';
      const line = el('div', 'circle-governance__closed');
      const actionLabel = tr(`circle.governance.action.${row.action}`);
      line.appendChild(el('span', 'circle-governance__closed-what', row.subjectLabel ? `${actionLabel}: ${row.subjectLabel}` : actionLabel));
      line.appendChild(el('span', `circle-governance__status circle-governance__status--${statusKey}`, tr(`circle.governance.status.${statusKey}`)));
      hist.appendChild(line);
    }
    container.appendChild(hist);
  }

  // Admin-only "who decides what" settings — the decision-class per governed action.
  if (isAdmin && typeof onSetClass === 'function') {
    const settings = el('div', 'circle-governance__settings');
    settings.appendChild(el('h3', 'circle-governance__settings-title', tr('circle.governance.settings_title')));
    for (const action of GOVERNANCE_ACTIONS) {
      const current = decisionClassFor(policy, action);
      const row = el('div', 'circle-governance__setting');
      row.dataset.action = action;
      row.appendChild(el('span', 'circle-governance__setting-action', tr(`circle.governance.action.${action}`)));
      const select = el('select', 'circle-governance__setting-select');
      for (const cls of GOVERNANCE_CLASSES) {
        const opt = el('option', null, tr(`circle.governance.class.${CLASS_KEY[cls]}`));
        opt.value = cls;
        select.appendChild(opt);
      }
      select.value = current;   // reflect the current class (set after options exist)
      select.addEventListener('change', () => onSetClass(action, select.value));
      row.appendChild(select);
      settings.appendChild(row);
    }
    container.appendChild(settings);
  }
  return container;
}
