/**
 * bot skills — chat-bot wrappers around the V1 skill set.
 *
 * Each `bot.*` skill thin-wraps an existing Tasks skill, but:
 *   - returns a chat-shaped `{text, buttons?}` reply (the bridge
 *     posts that into the chat surface) instead of the raw JSON
 *     payload the web UI consumes;
 *   - carries an explicit `via: 'bot'` annotation in the audit log
 *     by setting `actorDisplayName: '<webid> (via bot)'` (so audit
 *     viewers can distinguish "Anna via web" from "Anna via bot");
 *   - resolves a short id prefix to a full ULID via item-store's
 *     fuzzy resolver pattern (chat users won't type 26-char ULIDs).
 *
 * The dispatcher (`./wireBotChannel.js`) routes incoming chat
 * messages to these skills via `agent.skills.get(skillId).handler`.
 *
 * **Authz** is enforced by the underlying Tasks skills via the
 * role-policy gate; the bot does NOT bypass it. Result: a bot user
 * bound to a `member` webid cannot approve tasks (just like in the
 * web UI) — they get a `permission denied` reply.
 *
 * bot skills resolve a CircleState via `bundleResolver` then
 * inject `circleId` into every inner-skill `callUnderlying` call so
 * the inner skill's own bundleResolver picks the same circle.
 */

import { defineSkill } from '@onderling/core';

import { argsFromParts } from '../bundleResolver.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/**
 * Default skill opts for every `bot.*` defineSkill call.
 *
 * follow-up A + C — `policy: 'requires-token'` makes
 * PolicyEngine actually verify a presented `CapabilityToken`
 * (signature + expiry + scope + issuer trust + revocation list).
 * Without it, transport-arrived calls to `bot.*` would short-circuit
 * past the token check.
 *
 * The legacy trust-map dispatch path bypasses PolicyEngine entirely
 * (it calls `skill.handler(...)` directly with `from: webid`), so
 * this policy field affects only the cap-token transport path.
 */
const BOT_SKILL_OPTS = {
  description: undefined,        // overridden per skill
  visibility:  'authenticated',
  policy:      'requires-token',
};

/**
 * Resolve the effective actor for a bot.* handler.
 *
 * cap-token path: when the inbound envelope carries a token
 * with `constraints.actingAs`, the bot is authorised to act AS that
 * webid. We honour it instead of `envelope._from` (which is the
 * bot's own pubKey, not a circle member).
 *
 * Legacy direct-call path: `from` is set explicitly by
 * `wireBotChannel` to the bound webid; envelope is null.
 */
function effectiveActor({ from, envelope }) {
  const tok = envelope?.payload?._token;
  const actingAs = tok?.constraints?.actingAs;
  if (typeof actingAs === 'string' && actingAs) return actingAs;
  return from;
}

// Parameter register (#36) — minimum short-id prefix length for fuzzy resolve (scope:device, kind:internal).
const MIN_PREFIX_LEN = param({ key: 'tasksV0.minPrefixLen', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 6 });

/**
 * Resolve a short prefix to a full id. Returns null if no match,
 * the full id on a unique match, or an error string when ambiguous.
 *
 * Chat-friendly UX for IDs: users type the first 6+ chars; the
 * bot expands them.
 */
async function _resolveId(itemStore, raw) {
  if (typeof raw !== 'string' || !raw) return { error: 'no id supplied' };
  // Full id path — find the item if it exists, else fall back to
  // prefix search (handles cases where listOpen returned a hash-id
  // that's not in the open list any more).
  const exact = await itemStore.getById(raw).catch(() => null);
  if (exact) return { id: exact.id };

  if (raw.length < MIN_PREFIX_LEN) {
    return { error: `id prefix too short (need ≥ ${MIN_PREFIX_LEN} chars)` };
  }
  const open   = await itemStore.listOpen();
  const closed = await itemStore.listClosed();
  const all    = [...open, ...closed];
  const lc     = raw.toLowerCase();
  const matches = all.filter((it) => String(it.id ?? '').toLowerCase().startsWith(lc));
  if (matches.length === 0) return { error: `no task matches \`${raw}\`` };
  if (matches.length > 1)  return { error: `ambiguous prefix \`${raw}\` (${matches.length} matches)` };
  return { id: matches[0].id };
}

function _shortId(id) {
  return typeof id === 'string' ? id.slice(0, 8) : '';
}

function _formatItemLine(it) {
  const status =
    (it.completedAt && 'complete') ||
    (it.assignee && 'claimed') ||
    'open';
  const due = it.dueAt ? ` due ${new Date(it.dueAt).toLocaleDateString()}` : '';
  const assignee = it.assignee ? ` → ${String(it.assignee).split('/').pop()}` : '';
  return `• ${_shortId(it.id)}  [${status}] ${it.text}${assignee}${due}`;
}

function _formatTree(node, depth = 0) {
  if (!node) return '';
  const pad = '  '.repeat(depth);
  const it = node.item ?? {};
  const status =
    (it.completedAt && 'complete') ||
    (it.assignee && 'claimed') ||
    'open';
  let out = `${pad}• ${_shortId(it.id)}  [${status}] ${it.text}\n`;
  for (const c of node.children ?? []) out += _formatTree(c, depth + 1);
  return out;
}

/**
 * Re-dispatch into the underlying skill via its registered handler.
 * Annotate the actor display name with `(via bot)` so audit-log
 * viewers can tell apart UI vs bot actions.
 *
 * we inject `circleId` into the inner skill's args so its own
 * `bundleResolver(parts, ctx)` picks the same circle the bot resolved.
 * In single-circle mode this is harmless (singleCircleResolver ignores
 * args); in multi-circle mode it's load-bearing.
 */
async function callUnderlying(agent, skillId, args, from, circleId) {
  const def = agent.skills.get(skillId);
  if (!def) return { error: `underlying skill not registered: ${skillId}` };
  return def.handler({
    parts:    [{ type: 'DataPart', data: { ...args, circleId } }],
    from,
    agent,
    envelope: null,
    actorDisplayName: `${from} (via bot)`,
  });
}

/**
 * Build the bot.* skills.
 *
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 */
export function buildBotSkills({ bundleResolver } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildBotSkills: bundleResolver(parts, ctx) required');
  }

  return [
    defineSkill('bot.listOpen', async ({ parts, from, envelope, agent }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { text: 'circleId required' };
      const actor = effectiveActor({ from, envelope });
      const r = await callUnderlying(agent, 'listOpen', {}, actor, circle.circleId);
      const items = (r?.items ?? []).filter((it) => it.type !== 'subtask-request').slice(0, 20);
      if (items.length === 0) return { text: 'No open tasks.' };
      return { text: `*Open (${items.length}):*\n` + items.map(_formatItemLine).join('\n') };
    }, { ...BOT_SKILL_OPTS, description: 'Bot: list open tasks (chat-formatted).' }),

    defineSkill('bot.listMine', async ({ parts, from, envelope, agent }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { text: 'circleId required' };
      const actor = effectiveActor({ from, envelope });
      const r = await callUnderlying(agent, 'listMine', {}, actor, circle.circleId);
      const items = (r?.items ?? []).slice(0, 20);
      if (items.length === 0) return { text: 'Nothing assigned to you.' };
      return { text: `*Assigned to you (${items.length}):*\n` + items.map(_formatItemLine).join('\n') };
    }, { ...BOT_SKILL_OPTS, description: 'Bot: list my assignments.' }),

    defineSkill('bot.listMyMasteredTasks', async ({ parts, from, envelope, agent }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { text: 'circleId required' };
      const actor = effectiveActor({ from, envelope });
      const r = await callUnderlying(agent, 'listMyMasteredTasks', {}, actor, circle.circleId);
      const items = (r?.items ?? []).filter((it) => it.type !== 'subtask-request').slice(0, 20);
      if (items.length === 0) return { text: 'You don\'t master any open tasks.' };
      return { text: `*You master (${items.length}):*\n` + items.map(_formatItemLine).join('\n') };
    }, { ...BOT_SKILL_OPTS, description: 'Bot: list tasks where I am master.' }),

    defineSkill('bot.listAwaitingApproval', async ({ parts, from, envelope, agent }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { text: 'circleId required' };
      const actor = effectiveActor({ from, envelope });
      const r = await callUnderlying(agent, 'listAwaitingApproval', {}, actor, circle.circleId);
      const items = (r?.items ?? []).slice(0, 20);
      if (items.length === 0) return { text: 'No submissions awaiting approval.' };
      return { text: `*Awaiting approval (${items.length}):*\n` + items.map(_formatItemLine).join('\n') };
    }, { ...BOT_SKILL_OPTS, description: 'Bot: submitted tasks waiting on an approver.' }),

    defineSkill('bot.listMyInbox', async ({ parts, from, envelope, agent }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { text: 'circleId required' };
      const actor = effectiveActor({ from, envelope });
      const r = await callUnderlying(agent, 'listMyInbox', { limit: 20 }, actor, circle.circleId);
      const items = (r?.items ?? []).slice(0, 20);
      if (items.length === 0) return { text: 'Inbox is empty. ✓' };
      const lines = items.map((it) => {
        const when = it.addedAt ? new Date(it.addedAt).toLocaleString() : '';
        return `• ${it.text}  _${when}_`;
      });
      return { text: `*Inbox (${items.length}):*\n` + lines.join('\n') };
    }, { ...BOT_SKILL_OPTS, description: 'Bot: my inbox notifications.' }),

    defineSkill('bot.whatBlocks', async ({ parts, from, envelope, agent }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { text: 'circleId required' };
      const actor = effectiveActor({ from, envelope });
      const a = argsFromParts(parts);
      const resolved = await _resolveId(circle.itemStore, a.rootId);
      if (resolved.error) return { text: resolved.error };
      const r = await callUnderlying(agent, 'getDagTree', { rootId: resolved.id }, actor, circle.circleId);
      if (!r?.tree) return { text: `Task \`${_shortId(resolved.id)}\` has no sub-tree.` };
      return { text: '```\n' + _formatTree(r.tree).trimEnd() + '\n```' };
    }, { ...BOT_SKILL_OPTS, description: 'Bot: render the sub-task tree under <id>.' }),

    defineSkill('bot.claim', async ({ parts, from, envelope, agent }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { text: 'circleId required' };
      const actor = effectiveActor({ from, envelope });
      const a = argsFromParts(parts);
      const resolved = await _resolveId(circle.itemStore, a.id);
      if (resolved.error) return { text: resolved.error };
      const r = await callUnderlying(agent, 'claimTask', { id: resolved.id }, actor, circle.circleId);
      if (r?.result?.error === 'already-claimed') {
        return { text: `Already claimed by ${String(r.result.current.assignee ?? '?').split('/').pop()}.` };
      }
      if (r?.result?.assignee) {
        return { text: `Claimed \`${_shortId(resolved.id)}\` ✓` };
      }
      return { text: `Claim error: ${JSON.stringify(r)}` };
    }, { ...BOT_SKILL_OPTS, description: 'Bot: claim an open task.' }),

    defineSkill('bot.markComplete', async ({ parts, from, envelope, agent }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { text: 'circleId required' };
      const actor = effectiveActor({ from, envelope });
      const a = argsFromParts(parts);
      const resolved = await _resolveId(circle.itemStore, a.id);
      if (resolved.error) return { text: resolved.error };
      try {
        const r = await callUnderlying(agent, 'completeTask', { id: resolved.id }, actor, circle.circleId);
        if (r?.error === 'has-open-dependencies') {
          const shortIds = (r.openDeps ?? []).map(_shortId).join(', ');
          return { text: `Can't close — ${r.openDeps?.length ?? 0} open sub-task(s): ${shortIds}.` };
        }
        if (r?.task?.completedAt) return { text: `Done: \`${_shortId(resolved.id)}\` ✓` };
        return { text: `Couldn't complete: ${JSON.stringify(r)}` };
      } catch (err) {
        return { text: `Error: ${err?.message ?? err}` };
      }
    }, { ...BOT_SKILL_OPTS, description: 'Bot: mark a task complete (self-mark mode).' }),

    defineSkill('bot.submit', async ({ parts, from, envelope, agent }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { text: 'circleId required' };
      const actor = effectiveActor({ from, envelope });
      const a = argsFromParts(parts);
      const resolved = await _resolveId(circle.itemStore, a.id);
      if (resolved.error) return { text: resolved.error };
      const args = { id: resolved.id };
      if (a.note) args.note = a.note;
      try {
        const r = await callUnderlying(agent, 'submitTask', args, actor, circle.circleId);
        if (r?.task) return { text: `Submitted \`${_shortId(resolved.id)}\` for review ✓` };
        return { text: `Submit error: ${JSON.stringify(r)}` };
      } catch (err) {
        return { text: `Error: ${err?.message ?? err}` };
      }
    }, { ...BOT_SKILL_OPTS, description: 'Bot: submit a task for review.' }),

    defineSkill('bot.approve', async ({ parts, from, envelope, agent }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { text: 'circleId required' };
      const actor = effectiveActor({ from, envelope });
      const a = argsFromParts(parts);
      const resolved = await _resolveId(circle.itemStore, a.id);
      if (resolved.error) return { text: resolved.error };
      try {
        const r = await callUnderlying(agent, 'approveTask', { id: resolved.id }, actor, circle.circleId);
        if (r?.error === 'has-open-dependencies') {
          const shortIds = (r.openDeps ?? []).map(_shortId).join(', ');
          return { text: `Can't approve — ${r.openDeps?.length ?? 0} open sub-task(s): ${shortIds}.` };
        }
        if (r?.task?.completedAt) return { text: `Approved \`${_shortId(resolved.id)}\` ✓` };
        return { text: `Approve error: ${JSON.stringify(r)}` };
      } catch (err) {
        return { text: `Error: ${err?.message ?? err}` };
      }
    }, { ...BOT_SKILL_OPTS, description: 'Bot: approve a submitted task.' }),

    defineSkill('bot.reject', async ({ parts, from, envelope, agent }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { text: 'circleId required' };
      const actor = effectiveActor({ from, envelope });
      const a = argsFromParts(parts);
      const resolved = await _resolveId(circle.itemStore, a.id);
      if (resolved.error) return { text: resolved.error };
      if (!a.note) return { text: 'Reject needs a `reason: <text>` (mandatory).' };
      try {
        const r = await callUnderlying(agent, 'rejectTask', { id: resolved.id, note: a.note }, actor, circle.circleId);
        if (r?.task) return { text: `Rejected \`${_shortId(resolved.id)}\` ✓` };
        return { text: `Reject error: ${JSON.stringify(r)}` };
      } catch (err) {
        return { text: `Error: ${err?.message ?? err}` };
      }
    }, { ...BOT_SKILL_OPTS, description: 'Bot: reject a submission with a mandatory reason.' }),

    defineSkill('bot.revoke', async ({ parts, from, envelope, agent }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { text: 'circleId required' };
      const actor = effectiveActor({ from, envelope });
      const a = argsFromParts(parts);
      const resolved = await _resolveId(circle.itemStore, a.id);
      if (resolved.error) return { text: resolved.error };
      if (!a.reason) return { text: 'Revoke needs a `reason: <text>` (mandatory).' };
      try {
        const r = await callUnderlying(agent, 'revokeTask', { id: resolved.id, reason: a.reason }, actor, circle.circleId);
        if (r?.task) return { text: `Revoked \`${_shortId(resolved.id)}\` ✓` };
        return { text: `Revoke error: ${JSON.stringify(r)}` };
      } catch (err) {
        return { text: `Error: ${err?.message ?? err}` };
      }
    }, { ...BOT_SKILL_OPTS, description: 'Bot: revoke an assignment with a mandatory reason.' }),

    defineSkill('bot.circles', async ({ parts, from, envelope, agent }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { text: 'circleId required' };
      const actor = effectiveActor({ from, envelope });
      const r = await callUnderlying(agent, 'getMyCircles', {}, actor, circle.circleId);
      if (r?.error) return { text: `Error: ${r.error}` };
      const circles = r?.circles ?? [];
      if (circles.length === 0) return { text: 'You don\'t belong to any circles yet.' };
      const lines = circles.map((c) => {
        const c1 = c.counts ?? {};
        const overdue = c1.overdue > 0 ? ` · ${c1.overdue} overdue` : '';
        return `• *${c.name}* (${c.kind}): ${c1.open ?? 0} open${overdue} · ${c1.mine ?? 0} mine`;
      });
      return { text: '*Your circles:*\n' + lines.join('\n') };
    }, { ...BOT_SKILL_OPTS, description: 'Bot: list every circle the calling actor belongs to.' }),

    defineSkill('bot.plan', async ({ parts, from, envelope, agent }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { text: 'circleId required' };
      const actor = effectiveActor({ from, envelope });
      const r = await callUnderlying(agent, 'suggestSchedule', {}, actor, circle.circleId);
      if (r?.error) return { text: `Error: ${r.error}` };
      const sugg = (r?.suggestions ?? []).slice(0, 3);
      if (sugg.length === 0) return { text: 'No suggestions — nothing in your queue with a deadline.' };
      const fmtDt = (ms) => {
        const d = new Date(ms);
        return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      };
      const lines = sugg.map((s, i) => {
        const idShort = _shortId(s.taskId);
        const span = s.fits
          ? `${fmtDt(s.slotStart)} → ${fmtDt(s.slotEnd)}`
          : '(no slot)';
        return `${i + 1}. ${idShort}  ${span}  _${s.reason}_`;
      });
      return {
        text: '*Top suggestions* (top 3):\n' + lines.join('\n')
              + '\n\nTo accept: `accept <id> <N>` (default N=1).',
      };
    }, { ...BOT_SKILL_OPTS, description: 'Bot: top-3 suggested slots for my open assignments.' }),

    defineSkill('bot.accept', async ({ parts, from, envelope, agent }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { text: 'circleId required' };
      const actor = effectiveActor({ from, envelope });
      const a = argsFromParts(parts);
      const taskId = a.taskId;
      const n = Number.isFinite(a.n) && a.n > 0 ? a.n : 1;
      // Re-suggest then take the Nth — simpler than maintaining a
      // chatId-keyed cache and survives restarts. Slight cost in
      // recompute but the planner is sub-second.
      const sugg = await callUnderlying(agent, 'suggestSchedule', {}, actor, circle.circleId);
      if (sugg?.error) return { text: `Error: ${sugg.error}` };
      const matches = (sugg?.suggestions ?? []).filter(
        (s) => s.taskId === taskId || s.taskId.toLowerCase().startsWith(String(taskId).toLowerCase()),
      );
      if (matches.length === 0) return { text: `No suggestions for task \`${taskId}\` — run \`plan\` to refresh.` };
      const target = matches[n - 1];
      if (!target)              return { text: `Only ${matches.length} suggestion(s) for \`${taskId}\`.` };
      if (!target.fits)         return { text: `Suggestion ${n} for \`${taskId}\` doesn't fit (${target.reason}).` };
      const r = await callUnderlying(agent, 'acceptSchedule', {
        taskId:    target.taskId,
        slotStart: target.slotStart,
        slotEnd:   target.slotEnd,
      }, actor, circle.circleId);
      if (r?.error) return { text: `Error: ${r.error}` };
      const when = new Date(target.slotStart).toLocaleString();
      return { text: `Accepted \`${_shortId(target.taskId)}\` for ${when}.` };
    }, { ...BOT_SKILL_OPTS, description: 'Bot: accept a planner suggestion for a task.' }),

    defineSkill('bot.available', async ({ parts, from, envelope, agent }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { text: 'circleId required' };
      const actor = effectiveActor({ from, envelope });
      const a = argsFromParts(parts);
      const state = String(a.state ?? '').toLowerCase();
      if (!['open', 'tight', 'unavailable'].includes(state)) {
        return { text: 'Valid states: `open`, `tight`, `unavailable`.' };
      }
      // Compute current week + half-day in the actor's perceived tz.
      const now = new Date();
      const day = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'][(now.getDay() + 6) % 7];
      const half = now.getHours() < 12 ? 'am' : 'pm';
      const isoDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const dayNum = (isoDay.getUTCDay() + 6) % 7;
      isoDay.setUTCDate(isoDay.getUTCDate() - dayNum + 3);
      const yearStart = new Date(Date.UTC(isoDay.getUTCFullYear(), 0, 4));
      const weekNo = Math.ceil(((isoDay - yearStart) / 86_400_000 + 1) / 7);
      const week = `${isoDay.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
      const r = await callUnderlying(agent, 'setMyAvailability', { week, day, half, state }, actor, circle.circleId);
      if (r?.error) return { text: `Error: ${r.error}` };
      return { text: `Set ${day} ${half}: *${state}*. (Week ${week}.)` };
    }, { ...BOT_SKILL_OPTS, description: 'Bot: set my availability for the current half-day.' }),

    defineSkill('bot.week', async ({ parts, from, envelope, agent }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { text: 'circleId required' };
      const actor = effectiveActor({ from, envelope });
      const r = await callUnderlying(agent, 'getMyAvailability', {}, actor, circle.circleId);
      if (r?.error) return { text: `Error: ${r.error}` };
      if (!r?.enabled) return { text: 'Availability hints are off for this circle.' };
      if (!r?.optedIn) return { text: 'You haven\'t opted in. Open the Availability page in the web UI to opt in.' };
      const days = ['mon','tue','wed','thu','fri','sat','sun'];
      const symbols = { open: '✓', tight: '~', unavailable: '✗', unknown: '·' };
      const head = `*Week ${r.week}*`;
      const rows = [
        '       am   pm',
        ...days.map((d) => {
          const am = r.grid?.[`${d}-am`] ?? 'unknown';
          const pm = r.grid?.[`${d}-pm`] ?? 'unknown';
          return `  ${d}    ${symbols[am]}    ${symbols[pm]}`;
        }),
      ];
      return { text: head + '\n```\n' + rows.join('\n') + '\n```' };
    }, { ...BOT_SKILL_OPTS, description: 'Bot: render my week as a chip grid.' }),

    defineSkill('bot.invoice', async ({ parts, from, envelope, agent }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { text: 'circleId required' };
      const actor = effectiveActor({ from, envelope });
      const r = await callUnderlying(agent, 'getCompensation', {}, actor, circle.circleId);
      if (r?.error) return { text: `Error: ${r.error}` };
      const lines = r?.lines ?? [];
      if (lines.length === 0) {
        return { text: 'No compensation recorded for you this month.' };
      }
      const month = r.month ?? '';
      const totalH = r.totals?.hours ?? 0;
      const totalAmt = r.totals?.amount;
      const cur = r.currency ?? '';
      const headerLine = `*Compensation — ${month}* (${lines.length} task${lines.length === 1 ? '' : 's'}, ${totalH.toFixed(2)} h${typeof totalAmt === 'number' ? `, ${totalAmt.toFixed(2)} ${cur}`.trim() : ''})`;
      const rows = lines.map((l) => {
        const when = new Date(l.completedAt ?? 0).toLocaleDateString();
        const h = Number.isFinite(l.hours) ? `${l.hours.toFixed(2)}h` : '—';
        return `• ${_shortId(l.taskId)} · ${when} · ${h}`;
      });
      return { text: [headerLine, ...rows, '', '_Amounts are informational, not authoritative._'].join('\n') };
    }, { ...BOT_SKILL_OPTS, description: 'Bot: this month\'s compensation lines for the calling member.' }),

    defineSkill('bot.calendar', async ({ parts, from, envelope, agent }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { text: 'circleId required' };
      const actor = effectiveActor({ from, envelope });
      const r = await callUnderlying(agent, 'getCalendarEmissionUrl', {}, actor, circle.circleId);
      if (r?.error) return { text: `Error: ${r.error}` };
      if (!r?.enabled) {
        return { text: 'Calendar sync is off for this circle. An admin can turn it on with `setCalendarEmission`.' };
      }
      return {
        text: `Subscribe in your phone calendar:\n\`${r.url}\`\n\n(One-time setup. New tasks show up automatically afterwards.)`,
      };
    }, { ...BOT_SKILL_OPTS, description: 'Bot: subscribe URL for the calling member.' }),

    defineSkill('bot.appeal', async ({ parts, from, envelope, agent }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { text: 'circleId required' };
      const actor = effectiveActor({ from, envelope });
      const a = argsFromParts(parts);
      const resolved = await _resolveId(circle.itemStore, a.taskId);
      if (resolved.error) return { text: resolved.error };
      const r = await callUnderlying(agent, 'appealTask', { taskId: resolved.id }, actor, circle.circleId);
      if (r?.ok) return { text: `Appeal opened for \`${_shortId(resolved.id)}\` ✓` };
      return { text: `Appeal error: ${r?.error ?? JSON.stringify(r)}` };
    }, { ...BOT_SKILL_OPTS, description: 'Bot: open a chat thread with the master to appeal a revoke.' }),

    // post-submit consent flow (chat-side mirror of the web UI).

    defineSkill('bot.propose', async ({ parts, from, envelope, agent }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { text: 'circleId required' };
      const actor = effectiveActor({ from, envelope });
      const a = argsFromParts(parts);
      const resolved = await _resolveId(circle.itemStore, a.parentTaskId);
      if (resolved.error) return { text: resolved.error };
      const r = await callUnderlying(agent, 'proposeSubtask',
        { parentTaskId: resolved.id, text: a.text }, actor, circle.circleId);
      if (r?.error) return { text: `Propose error: ${r.error}` };
      if (r?.queued) {
        const who = String(r.assignee ?? '').split('/').pop() || r.assignee;
        return { text: `Proposed sub-task to ${who}. They\'ll see it in their inbox.` };
      }
      return { text: `Propose: ${JSON.stringify(r)}` };
    }, { ...BOT_SKILL_OPTS, description: 'Bot: propose a sub-task on a submitted parent (master/coord).' }),

    defineSkill('bot.acceptProposal', async ({ parts, from, envelope, agent }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { text: 'circleId required' };
      const actor = effectiveActor({ from, envelope });
      const a = argsFromParts(parts);
      const resolved = await _resolveId(circle.itemStore, a.proposalId);
      if (resolved.error) return { text: resolved.error };
      const r = await callUnderlying(agent, 'approveSubtaskProposal', { proposalId: resolved.id }, actor, circle.circleId);
      if (r?.error) return { text: `Accept error: ${r.error}` };
      if (r?.ok) {
        return {
          text: `Approved. Sub-task \`${_shortId(r.task.id)}\` spawned; your submission rolled back to claimed.`,
        };
      }
      return { text: `Accept: ${JSON.stringify(r)}` };
    }, { ...BOT_SKILL_OPTS, description: 'Bot: approve a subtask-proposal (assignee only).' }),

    defineSkill('bot.declineProposal', async ({ parts, from, envelope, agent }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { text: 'circleId required' };
      const actor = effectiveActor({ from, envelope });
      const a = argsFromParts(parts);
      const resolved = await _resolveId(circle.itemStore, a.proposalId);
      if (resolved.error) return { text: resolved.error };
      const r = await callUnderlying(agent, 'declineSubtaskProposal',
        { proposalId: resolved.id, note: a.note }, actor, circle.circleId);
      if (r?.error) return { text: `Decline error: ${r.error}` };
      return { text: `Declined \`${_shortId(resolved.id)}\` ✓ — your submission stays valid.` };
    }, { ...BOT_SKILL_OPTS, description: 'Bot: decline a subtask-proposal (assignee only).' }),

    defineSkill('bot.listProposals', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { text: 'circleId required' };
      const actor = effectiveActor({ from, envelope });
      // List subtask-proposal items targeting `actor`. Inline against the
      // resolved circle's itemStore.
      const open = await circle.itemStore.listOpen({ type: 'subtask-proposal' });
      const mine = open.filter((it) => it?.source?.targetAssignee === actor);
      if (mine.length === 0) {
        return { text: 'No subtask-proposals waiting on you. ✓' };
      }
      const lines = mine.map((p) => {
        const proposer = String(p.source?.requestedBy ?? '?').split('/').pop();
        return `• \`${_shortId(p.id)}\`  from ${proposer} — ${p.text.replace(/^Sub-task proposal: /, '')}`;
      });
      return {
        text: `*Subtask-proposals waiting (${mine.length}):*\n` + lines.join('\n')
              + '\n\nReply: `accept-proposal <id>` or `decline-proposal <id> reason: …`',
      };
    }, { ...BOT_SKILL_OPTS, description: 'Bot: list open subtask-proposals waiting on the calling actor.' }),

    defineSkill('bot.forceComplete', async ({ parts, from, envelope, agent }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { text: 'circleId required' };
      const actor = effectiveActor({ from, envelope });
      const a = argsFromParts(parts);
      const resolved = await _resolveId(circle.itemStore, a.id);
      if (resolved.error) return { text: resolved.error };
      const r = await callUnderlying(agent, 'forceCompleteTask',
        { id: resolved.id, reason: a.reason }, actor, circle.circleId);
      if (r?.error) return { text: `Force-complete error: ${r.error}` };
      return { text: `Force-completed \`${_shortId(resolved.id)}\` ✓ — reason recorded in audit log.` };
    }, { ...BOT_SKILL_OPTS, description: 'Bot: admin force-complete past the dependency gate (mandatory reason).' }),
  ];
}
