/**
 * dispatch — parse a chat-bot text message into a Tasks skill call.
 *
 * Mirrors the shape of the retired household bot's regex command parser
 * (locked V0 grammar there) but for Tasks V1's surface. Pure module
 * — no I/O. Returns:
 *
 *   { kind: 'skill',  skillId, args }       on a single-skill match
 *   { kind: 'reply',  text }                 on a static reply (help, hi, …)
 *   { kind: 'unknown' }                      when nothing matches
 *
 * Grammar (case-insensitive, whitespace-collapsed):
 *
 *   help | ? | /help                  → help reply
 *   hi | hello | hoi                  → greeting reply
 *   open | list | what's open         → listOpen
 *   mine | my tasks                   → listMine
 *   master | i'm master of            → listMyMasteredTasks
 *   review | awaiting                 → listAwaitingApproval
 *   inbox                             → listMyInbox
 *   blocks <id> | tree <id>           → getDagTree(rootId)
 *   claim <id>                        → claimTask
 *   done <id> | complete <id>         → completeTask
 *   submit <id>                       → submitTask
 *   submit <id> note: <text>          → submitTask with note
 *   approve <id>                      → approveTask
 *   reject <id> reason: <text>        → rejectTask
 *   revoke <id> reason: <text>        → revokeTask
 *   appeal <id>                       → appealTask
 *
 * IDs may be a full ULID or a unique short prefix (length ≥ 6,
 * matching item-store's `MIN_PREFIX_LEN`); resolution is the
 * caller's job.
 */

const HELP_TEXT = `Tasks bot — quick commands:
  open                       list open tasks
  mine                       my assignments
  master                     tasks I master
  review                     submissions awaiting my approval
  inbox                      my notifications
  calendar                   subscribe URL for your phone calendar
  invoice                    this month's compensation lines (paid-pros)
  available <state>          set my hint for the current half-day
  week                       show my own week (7×2 grid)
  plan                       suggest slots for my open assignments
  accept <id> [N]            accept the Nth suggestion for <id> (default 1)
  circles                      list every circle I'm in with counts
  proposals                  list open subtask-proposals for me to consent to
  propose <pid> <text>       propose a sub-task on a submitted parent (master/coord)
  accept-proposal <id>       approve a proposal (assignee only) → spawn + roll back parent
  decline-proposal <id> reason: ...   decline a proposal
  force-complete <id> reason: ...     admin override past the dep gate
  blocks <id>                show the sub-tree under <id>
  claim <id>                 claim an open task
  done <id>                  mark complete (self-mark only)
  submit <id> [note: ...]    submit for review (creator/webid mode)
  approve <id>               approve a submission
  reject <id> reason: ...    reject with mandatory reason
  revoke <id> reason: ...    yank an assignment (master only)
  appeal <id>                open chat with the master after a revoke
  help                       this message`;

function _strip(s) { return String(s ?? '').trim().replace(/\s+/g, ' '); }

const RE_ID = /^[A-Za-z0-9_-]+$/;
function _parseIdAndRest(rest) {
  const m = _strip(rest).match(/^(\S+)(?:\s+(.+))?$/);
  if (!m) return { id: '', rest: '' };
  return { id: m[1] ?? '', rest: m[2] ?? '' };
}

function _extractKeyValue(rest, key) {
  // e.g. "note: photo missing" or "reason: pushing forward"
  const re = new RegExp(`(?:^|\\s)${key}\\s*[:=]\\s*(.+)$`, 'i');
  const m = rest.match(re);
  return m ? m[1].trim() : null;
}

/**
 * Parse a chat message into a dispatch action.
 *
 * @param {string} rawText
 * @returns {{kind: 'skill', skillId: string, args: object}
 *         | {kind: 'reply', text: string}
 *         | {kind: 'unknown'}}
 */
export function dispatch(rawText) {
  const text = _strip(rawText).toLowerCase();
  if (!text) return { kind: 'unknown' };

  if (text === 'help' || text === '?' || text === '/help') {
    return { kind: 'reply', text: HELP_TEXT };
  }
  if (['hi', 'hello', 'hoi', 'hey'].includes(text)) {
    return { kind: 'reply', text: 'Hi! Type `help` for commands.' };
  }

  if (text === 'open' || text === 'list' || text === "what's open" || text === 'whats open') {
    return { kind: 'skill', skillId: 'bot.listOpen', args: {} };
  }
  if (text === 'mine' || text === 'my tasks') {
    return { kind: 'skill', skillId: 'bot.listMine', args: {} };
  }
  if (text === 'master' || text === "i'm master of" || text === 'im master of') {
    return { kind: 'skill', skillId: 'bot.listMyMasteredTasks', args: {} };
  }
  if (text === 'review' || text === 'awaiting' || text === 'awaiting approval') {
    return { kind: 'skill', skillId: 'bot.listAwaitingApproval', args: {} };
  }
  if (text === 'inbox') {
    return { kind: 'skill', skillId: 'bot.listMyInbox', args: {} };
  }
  if (text === 'calendar' || text === 'cal' || text === 'sync') {
    return { kind: 'skill', skillId: 'bot.calendar', args: {} };
  }
  if (text === 'invoice' || text === 'invoicing' || text === 'comp') {
    return { kind: 'skill', skillId: 'bot.invoice', args: {} };
  }
  if (text === 'week' || text === 'my week') {
    return { kind: 'skill', skillId: 'bot.week', args: {} };
  }
  if (text === 'plan' || text === 'schedule') {
    return { kind: 'skill', skillId: 'bot.plan', args: {} };
  }
  if (text === 'circles' || text === 'my circles') {
    return { kind: 'skill', skillId: 'bot.circles', args: {} };
  }
  if (text === 'proposals' || text === 'my proposals') {
    return { kind: 'skill', skillId: 'bot.listProposals', args: {} };
  }
  // accept-proposal <id>
  let propM = text.match(/^accept-proposal\s+(\S+)$/);
  if (propM) {
    const id = propM[1];
    if (!RE_ID.test(id)) return { kind: 'reply', text: `Bad id: \`${id}\`.` };
    return { kind: 'skill', skillId: 'bot.acceptProposal', args: { proposalId: id } };
  }
  // decline-proposal <id> [reason: ...]
  propM = text.match(/^decline-proposal\s+(\S+)(?:\s+(.+))?$/);
  if (propM) {
    const id = propM[1];
    if (!RE_ID.test(id)) return { kind: 'reply', text: `Bad id: \`${id}\`.` };
    const note = propM[2] ? _extractKeyValue(propM[2], 'reason') ?? _extractKeyValue(propM[2], 'note') : null;
    return { kind: 'skill', skillId: 'bot.declineProposal', args: { proposalId: id, note: note ?? undefined } };
  }
  // propose <parent-id> <text...>
  const proposeM = text.match(/^propose\s+(\S+)\s+(.+)$/);
  if (proposeM) {
    const parentId = proposeM[1];
    if (!RE_ID.test(parentId)) return { kind: 'reply', text: `Bad parent id: \`${parentId}\`.` };
    const text2 = String(proposeM[2]).trim();
    if (!text2) return { kind: 'reply', text: 'Propose needs sub-task text.' };
    return { kind: 'skill', skillId: 'bot.propose', args: { parentTaskId: parentId, text: text2 } };
  }
  if (text === 'propose') {
    return { kind: 'reply', text: 'Usage: `propose <parent-id> <sub-task title>` (master/coord; needs assignee approval).' };
  }
  // force-complete <id> reason: ...
  const forceM = text.match(/^force-complete\s+(\S+)\s+(.+)$/);
  if (forceM) {
    const id = forceM[1];
    if (!RE_ID.test(id)) return { kind: 'reply', text: `Bad id: \`${id}\`.` };
    const reason = _extractKeyValue(forceM[2], 'reason');
    if (!reason) return { kind: 'reply', text: 'force-complete needs `reason: <text>` (mandatory).' };
    return { kind: 'skill', skillId: 'bot.forceComplete', args: { id, reason } };
  }
  // accept <id> [N]
  const accM = text.match(/^accept\s+(\S+)(?:\s+(\d+))?$/);
  if (accM) {
    const id = accM[1];
    const n = accM[2] ? Number(accM[2]) : 1;
    if (!RE_ID.test(id)) return { kind: 'reply', text: `Bad id: \`${id}\`.` };
    if (!Number.isFinite(n) || n < 1) return { kind: 'reply', text: 'Suggestion index must be ≥ 1.' };
    return { kind: 'skill', skillId: 'bot.accept', args: { taskId: id, n } };
  }
  // available <state>
  let availM = text.match(/^(?:available|avail)\s+(\w+)$/);
  if (availM) {
    return { kind: 'skill', skillId: 'bot.available', args: { state: availM[1] } };
  }
  if (text === 'available' || text === 'avail') {
    return {
      kind: 'reply',
      text: 'Usage: `available <state>` where state is one of `open`, `tight`, `unavailable`.',
    };
  }

  // Single-id verbs.
  const verbs = [
    { re: /^blocks\s+(.+)$/,    skill: 'bot.whatBlocks',  arg: 'rootId' },
    { re: /^tree\s+(.+)$/,      skill: 'bot.whatBlocks',  arg: 'rootId' },
    { re: /^claim\s+(.+)$/,     skill: 'bot.claim',       arg: 'id'     },
    { re: /^done\s+(.+)$/,      skill: 'bot.markComplete', arg: 'id'    },
    { re: /^complete\s+(.+)$/,  skill: 'bot.markComplete', arg: 'id'    },
    { re: /^approve\s+(\S+)$/,  skill: 'bot.approve',     arg: 'id'     },
    { re: /^appeal\s+(.+)$/,    skill: 'bot.appeal',      arg: 'taskId' },
  ];
  for (const v of verbs) {
    const m = text.match(v.re);
    if (m) {
      const id = _strip(m[1]);
      if (!RE_ID.test(id)) {
        return { kind: 'reply', text: `That doesn't look like a valid id: \`${id}\`.` };
      }
      return { kind: 'skill', skillId: v.skill, args: { [v.arg]: id } };
    }
  }

  // Compound verbs with optional note/reason.
  // submit <id> [note: ...]
  let m = text.match(/^submit\s+(\S+)(?:\s+(.+))?$/);
  if (m) {
    const id = m[1];
    if (!RE_ID.test(id)) return { kind: 'reply', text: `Bad id: \`${id}\`.` };
    const args = { id };
    if (m[2]) {
      const note = _extractKeyValue(m[2], 'note');
      if (note) args.note = note;
    }
    return { kind: 'skill', skillId: 'bot.submit', args };
  }
  // reject <id> reason: ...
  m = text.match(/^reject\s+(\S+)\s+(.+)$/);
  if (m) {
    const id = m[1];
    if (!RE_ID.test(id)) return { kind: 'reply', text: `Bad id: \`${id}\`.` };
    const note = _extractKeyValue(m[2], 'reason') ?? _extractKeyValue(m[2], 'note');
    if (!note) {
      return { kind: 'reply', text: 'Reject needs a `reason: <text>` (mandatory).' };
    }
    return { kind: 'skill', skillId: 'bot.reject', args: { id, note } };
  }
  // revoke <id> reason: ...
  m = text.match(/^revoke\s+(\S+)\s+(.+)$/);
  if (m) {
    const id = m[1];
    if (!RE_ID.test(id)) return { kind: 'reply', text: `Bad id: \`${id}\`.` };
    const reason = _extractKeyValue(m[2], 'reason');
    if (!reason) {
      return { kind: 'reply', text: 'Revoke needs a `reason: <text>` (mandatory).' };
    }
    return { kind: 'skill', skillId: 'bot.revoke', args: { id, reason } };
  }

  return { kind: 'unknown' };
}

export { HELP_TEXT };
