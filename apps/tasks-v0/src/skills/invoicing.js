/**
 * invoicing — Tasks.
 *
 * Three skills + one internal helper:
 *
 *   - `recordInvoiceLine` (helper, not a registered skill) — appends a
 *     `{taskId, completedAt, hours, notes, rate?}` row to
 *     `<circle-pod>/tasks/invoicing/<webid>/<isoMonth>.json`.
 *
 *   - `getCompensation({memberWebid, month?})` — admin OR self only.
 *     Returns `{lines, totals}`. `totals.amount` (rate × hours) is
 *     informational, not authoritative — see risk §4.
 *
 *   - `setMemberCompensation({memberWebid, compensated, rate?})` —
 *     admin only. Mutates the live circle config.
 *
 *   - `setCompensationEnabled({enabled})` — admin only. Toggles the
 *     circle-level switch.
 *
 * `wireInvoicing` (in `Circle.js`) listens for `item-completed` events
 * and dispatches `recordInvoiceLine` when the completer is a paid-pro.
 * The blob shape is intentionally minimal so any spreadsheet can pull it.
 */

import { defineSkill } from '@onderling/core';

import { argsFromParts } from '../bundleResolver.js';
import { makeRoleOf } from './roleOf.js';

function isoMonthOf(epochMs) {
  const d = new Date(epochMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function invoicePath(circleId, webid, isoMonth) {
  return `mem://tasks/circles/${encodeURIComponent(circleId)}/invoicing/${encodeURIComponent(webid)}/${encodeURIComponent(isoMonth)}.json`;
}

/**
 * Append an invoice line to the right month-blob. Best-effort:
 * persistence failures don't block the completion path.
 *
 * @param {object} args
 * @param {object} args.dataSource
 * @param {string} args.circleId
 * @param {object} args.member       circle member object (for rate lookup)
 * @param {object} args.task         the just-completed task
 */
export async function recordInvoiceLine({ dataSource, circleId, member, task }) {
  if (!dataSource?.write || !circleId || !member?.webid || !task?.id) return;
  const completedAt = task.completedAt ?? Date.now();
  const month       = isoMonthOf(completedAt);
  const path        = invoicePath(circleId, member.webid, month);

  const line = {
    taskId:      task.id,
    completedAt,
    hours:       Number.isFinite(task.estimateMinutes)
      ? task.estimateMinutes / 60
      : null,
    notes:       task.notes ?? null,
    ...(Number.isFinite(member.rate) ? { rate: member.rate } : {}),
  };

  let existing = [];
  try {
    const raw = await dataSource.read(path);
    if (raw) existing = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(existing)) existing = [];
  } catch { /* fall through with existing = [] */ }

  // Idempotency — don't append the same taskId twice (e.g. on a
  // double-emit during a glitchy reconnect).
  if (existing.some((l) => l?.taskId === line.taskId)) return;
  existing.push(line);
  try { await dataSource.write(path, JSON.stringify(existing)); } catch { /* noop */ }
}

/**
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 *   Resolver returns a CircleState; per-CircleState `onCompensationChange`
 *   callback re-attaches the item-completed listener in `Circle.js`.
 */
export function buildInvoicingSkills({ bundleResolver, roleOf = makeRoleOf(null) } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildInvoicingSkills: bundleResolver(parts, ctx) required');
  }

  return [
    defineSkill('getCompensation', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      const lc = circle.liveCircle ?? {};
      const target = a.memberWebid ?? from;
      if (typeof target !== 'string' || !target) {
        return { error: 'memberWebid required (or call as self)' };
      }
      // Admin sees anyone; member sees only own.
      const role = await roleOf(circle, from);
      if (role !== 'admin' && from !== target) {
        return { error: 'admin required to view another member\'s compensation' };
      }
      const month = typeof a.month === 'string' && /^\d{4}-\d{2}$/.test(a.month)
        ? a.month
        : isoMonthOf(Date.now());
      const path = invoicePath(lc.circleId ?? 'unknown', target, month);
      let lines = [];
      try {
        const raw = await circle.dataSource.read(path);
        if (raw) lines = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!Array.isArray(lines)) lines = [];
      } catch { /* lines stays [] */ }

      const member = (lc.members ?? []).find((m) => m?.webid === target);
      const rate   = Number.isFinite(member?.rate) ? member.rate : null;
      const totals = {
        count: lines.length,
        hours: lines.reduce((s, l) => s + (Number.isFinite(l?.hours) ? l.hours : 0), 0),
        ...(rate !== null
          ? { amount: lines.reduce((s, l) => s + (Number.isFinite(l?.hours) ? l.hours * rate : 0), 0) }
          : {}),
      };
      return { memberWebid: target, month, lines, totals, rate, currency: lc.compensation?.currency ?? null };
    }, {
      description: 'Read compensation lines for a paid-pro (admin OR self).',
      visibility:  'authenticated',
    }),

    defineSkill('setMemberCompensation', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const role = await roleOf(circle, from);
      if (role !== 'admin') return { error: 'admin required' };
      const a = argsFromParts(parts);
      if (typeof a.memberWebid !== 'string' || !a.memberWebid.trim()) {
        return { error: 'memberWebid required' };
      }
      const lc = circle.liveCircle ?? {};
      const members = lc.members ?? [];
      const idx = members.findIndex((m) => m?.webid === a.memberWebid);
      if (idx < 0) return { error: 'memberWebid is not a circle member' };
      const next = members.map((m, i) => i === idx
        ? {
            ...m,
            ...(typeof a.compensated === 'boolean' ? { compensated: a.compensated } : {}),
            ...(Number.isFinite(a.rate) ? { rate: a.rate } : {}),
          }
        : m);
      circle.circleMutator({ members: next });
      try { circle.onCompensationChange?.(); } catch { /* noop */ }
      return { ok: true, memberWebid: a.memberWebid };
    }, {
      description: 'Mark a member as compensated and (optionally) set their rate (admin only).',
      visibility:  'authenticated',
    }),

    defineSkill('setCompensationEnabled', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const role = await roleOf(circle, from);
      if (role !== 'admin') return { error: 'admin required' };
      const a = argsFromParts(parts);
      if (typeof a.enabled !== 'boolean') return { error: 'enabled (boolean) required' };
      const lc = circle.liveCircle ?? {};
      const next = { ...(lc.compensation ?? {}), enabled: a.enabled };
      circle.circleMutator({ compensation: next });
      try { circle.onCompensationChange?.(); } catch { /* noop */ }
      return { ok: true, enabled: a.enabled };
    }, {
      description: 'Turn the per-circle invoicing/compensation feature on or off (admin only).',
      visibility:  'authenticated',
    }),
  ];
}

export { isoMonthOf, invoicePath };
