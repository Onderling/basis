/**
 * workspace skills — Tasks V1 Phase 8 UI helpers.
 *
 * Skills the workspace UI calls to compose its screens:
 *
 *   - `getCircleConfig()` — read-only snapshot of the live CircleConfig.
 *     The UI uses this for: members chips on /circle, role display,
 *     subtasksAdminApprovalDepth in /add, etc.
 *
 *   - `listAwaitingApproval()` — items in the `submitted` lifecycle
 *     state (have a `reviewLog` whose tail is `submit`). Powers the
 *     /review page.
 *
 *   - `listSubtaskRequests()` — items of type `subtask-request` that
 *     are not yet completed. Admin/coord only. Powers the admin
 *     queue surface inside /circle.
 *
 *   - `getDagTree({rootId})` — returns the `treeOf` projection
 *     starting at `rootId` (or, when `rootId` omitted, every
 *     top-level task expanded). Powers /dag.
 *
 *   - `listMyMasteredTasks()` — open tasks whose `master === from`.
 *     Powers the "I'm master of" tab on /mine.
 *
 * All skills are read-only; no role-policy gating beyond the
 * obvious (subtask requests are admin-visible).
 */

import { defineSkill } from '@onderling/core';

import { computeStatus as itemStoreComputeStatus, itemTreeFor } from '@onderling/item-store';
import { treeOf } from '../dag-tree.js';
import { effectiveStatus, unmetDeps } from '../dag.js';
import { argsFromParts } from '../bundleResolver.js';
// DESIGN gap #2 (2026-05-27) — `_sync` reply envelope for staleness hints.
import { simulateSync, decorateWithLastSync } from './_syncEnvelope.js';
import { INBOX_KIND, isInboxItem } from '@onderling/item-types';

/**
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 */
export function buildWorkspaceSkills({ bundleResolver } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildWorkspaceSkills: bundleResolver(parts, ctx) required');
  }

  return [
    defineSkill('getCircleConfig', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const lc = circle.liveCircle;
      return { circle: lc ? { ...lc } : null };
    }, {
      description: 'Read the live CircleConfig (read-only snapshot).',
    }),

    defineSkill('listAwaitingApproval', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const open = await circle.itemStore.listOpen();
      const closed = await circle.itemStore.listClosed();
      const pending = open
        .filter((it) => itemStoreComputeStatus(it) === 'submitted')
        // include DAG `status` so the Review UI can disable the
        // Approve button + show open-deps tooltip when the parent
        // can't actually be closed yet.
        .map((it) => ({
          ...it,
          status:   effectiveStatus(it, open, closed),
          openDeps: unmetDeps(it, open, closed),
        }));
      return { items: decorateWithLastSync(pending), viewer: from ?? null, _sync: simulateSync() };
    }, {
      description: 'List items in the submitted state (awaiting approval).',
    }),

    defineSkill('listSubtaskRequests', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const role = circle.roles?.[from];
      if (role !== 'admin' && role !== 'coordinator') {
        return { error: 'admin or coordinator required' };
      }
      const open = (await circle.itemStore.listOpen({ type: 'inbox-item' }))
        .filter((i) => isInboxItem(i, INBOX_KIND.SUBTASK_REQUEST));
      return { items: open };
    }, {
      description: 'List pending subtask-request items (admin/coord only).',
    }),

    defineSkill('getDagTree', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      const open   = await circle.itemStore.listOpen();
      const closed = await circle.itemStore.listClosed();
      const all = [...open, ...closed];

      if (typeof a.rootId === 'string' && a.rootId) {
        const tree = treeOf(a.rootId, all);
        return { tree };
      }

      // No rootId → return one tree per top-level task (not contained by any parent). A task is a CHILD when
      // it carries the containment edge `containedBy`.
      const isChild = (t) => Array.isArray(t.containedBy) && t.containedBy.length > 0;
      const tops = all.filter((t) => !isChild(t) && !isInboxItem(t, INBOX_KIND.SUBTASK_REQUEST));
      const trees = tops.map((t) => treeOf(t.id, all)).filter(Boolean);
      return { trees };
    }, {
      description: 'Return the sub-task tree rooted at rootId, or every top-level tree.',
    }),

    defineSkill('listMyMasteredTasks', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      if (!from) return { items: [] };
      const open = await circle.itemStore.listOpen();
      const closed = await circle.itemStore.listClosed();
      const mastered = open
        .filter((it) => (it.master ?? it.addedBy) === from)
        .map((it) => ({
          ...it,
          status:   effectiveStatus(it, open, closed),
          openDeps: unmetDeps(it, open, closed),
        }));
      return { items: decorateWithLastSync(mastered), _sync: simulateSync() };
    }, {
      description: 'Open tasks where the caller is the master.',
    }),

    // The approvals inbox for pending CLAIMS: tasks I MASTER whose claim awaits my confirmation (explicit-
    // confirm, not yet ratified). Rows carry `status: 'pending-confirmation'`, so the manifest's confirmClaim
    // button surfaces on each by construction. Parity with `listAwaitingApproval` (the submitted-tasks review).
    defineSkill('listMyPendingClaims', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      if (!from) return { items: [] };
      const open = await circle.itemStore.listOpen();
      const closed = await circle.itemStore.listClosed();
      const pending = open
        .filter((it) => (it.master ?? it.addedBy) === from
          && effectiveStatus(it, open, closed) === 'pending-confirmation')
        .map((it) => ({ ...it, status: effectiveStatus(it, open, closed), openDeps: unmetDeps(it, open, closed) }));
      return { items: decorateWithLastSync(pending), viewer: from ?? null, _sync: simulateSync() };
    }, {
      description: 'List tasks I master whose claim is awaiting my confirmation.',
    }),

    /**
     * getItemTree({itemId, circleId?}) — M4 Phase 3.3c decentralised
     * cross-pod read path.
     *
     * Walks the task's `embeds`/`dependencies` graph via item-store's
     * `treeOf`, resolving the 3 canonical cross-pod ref shapes
     * (`urn:dec:item:` → local, `pseudo-pod://` → pseudo-pod ring,
     * `http(s)://` → another member's pod) through
     * `createCrossPodRefResolver`. Permission failures surface as
     * `{source:'placeholder', reason:'PERMISSION_DENIED'}` nodes (the
     * cross-pod-refs.md three-tier render fallback), never throwing.
     *
     * Agent-side by design: Tasks web + mobile are both thin A2A
     * clients, so the walk lives here and serves BOTH equally — one
     * device-independent path (the platform-parity principle). Mirror
     * of Stoop's `getItemTree` skill (commit `a2685c6`).
     *
     * Tasks stores `embeds` at the top level on the task item (unlike
     * Stoop's `source.embeds` shape). Both are bridged here for
     * forward-compatibility.
     */
    defineSkill('getItemTree', async ({ parts, from, envelope }) => {
      const circle = bundleResolver(parts, { envelope, from });
      if (!circle) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      // One implementation, in the package that owns `treeOf` — stoop has the same op and this body
      // was copied from it.
      return itemTreeFor({
        itemId:        a.itemId,
        getById:       (id) => circle.itemStore.getById(id),
        pseudoPodRead: typeof circle.pseudoPod?.read === 'function' ? (ref) => circle.pseudoPod.read(ref) : undefined,
      });
    }, {
      description: 'Walk a task\'s embeds/deps tree, materialising cross-pod refs (the decentralised read path).',
      visibility:  'authenticated',
    }),
  ];
}
