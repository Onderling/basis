/**
 * wireSkills — single-registration root.
 *
 * Registers every Tasks skill on the process-wide meshAgent ONCE.
 * Skills resolve their per-circle CircleState at dispatch time via the
 * supplied `bundleResolver`. See `./bundleResolver.js` for the
 * single/multi-circle strategies.
 *
 * Design: this is the only place skills get registered. Circle.js
 * goes from "register N times per circle" to "build CircleState; wire
 * once" — see Stoop's 2026-05-08 single-agent-refactor for the
 * functional sketch this mirrors.
 *
 * Mandatory args:
 *   - `meshAgent` — the target `core.Agent`
 *   - `bundleResolver` — `(parts, ctx) → CircleState | null`
 *   - `userSettings` — `{loadShared, updateShared}` for observability
 *
 * Optional:
 *   - `circlesProvider` — `() => Iterable<CircleState>` for the dashboard
 *     skill. Defaults to a single-circle iterator if omitted.
 *   - `members` — when supplied, identity-resolver registers in the
 *     classic single-circle shape with this MemberMap. For multi-circle,
 *     pass `getBundle` instead (returns `{members}` per resolved circle).
 *   - `getBundle` — `(args, ctx) => {members} | null` for multi-circle
 *     identity skills.
 */

import { buildIdentitySkills } from '@onderling/identity-resolver';

import { buildSkills } from './skills/index.js';
import { buildProfileSkills } from './skills/profile.js';
import { buildAppealSkill } from './skills/appeal.js';
import { buildChatSkills } from './skills/chat.js';
import { buildPushTokenSkills } from './skills/pushTokens.js';
import { buildSubtaskSkills } from './skills/subtasks.js';
import { buildInboxSkills } from './skills/inbox.js';
import { buildWorkspaceSkills } from './skills/workspace.js';
// (DESIGN gap, closed 2026-05-27) — `tasks_briefSummary`.
import { buildBriefSummarySkill } from './skills/briefSummary.js';
import { buildObservabilitySkills } from './skills/observability.js';
import { buildCircleControlSkills } from './skills/circleControls.js';
import { buildCustomRoleSkills } from './skills/customRoles.js';
import { buildBotBindingSkills } from './skills/botBindings.js';
import { buildCalendarEmissionSkills } from './skills/calendarEmission.js';
import { buildInvoicingSkills } from './skills/invoicing.js';
import { buildAvailabilitySkills } from './skills/availability.js';
import { buildPlannerSkills } from './skills/planner.js';
import { buildDashboardSkills } from './skills/dashboard.js';
import { buildForceCompleteSkill } from './skills/forceComplete.js';
import { buildBotSkills } from './bot/skills.js';

/**
 * @param {object} args
 * @param {object} args.meshAgent
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 * @param {{loadShared, updateShared}} [args.userSettings]
 *   Optional. When omitted, a no-op default is supplied so the
 *   observability skills register but report empty state when called.
 * @param {() => Iterable<object>} [args.circlesProvider]
 * @param {object} [args.members]
 * @param {(args: object, ctx?: object) => object | null} [args.getBundle]
 * @returns {{registered: string[]}}
 */
export function wireSkills({
  meshAgent,
  bundleResolver,
  userSettings,
  circlesProvider,
  members,
  getBundle,
  // The caller's role in a circle, from the HOST's membership head. Threaded through to the
  // authority gates that need it; absent, those gates refuse rather than guess.
  circleRoleOf = null,
} = {}) {
  if (!meshAgent?.skills?.register) {
    throw new TypeError('wireSkills: meshAgent (with skills registry) required');
  }
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('wireSkills: bundleResolver(parts, ctx) required');
  }

  // No-op userSettings keeps observability skill registration possible
  // even on the V0 zero-config path (createTasksAgent — no settings file).
  const us = userSettings ?? {
    loadShared:   async () => ({}),
    updateShared: async () => ({}),
  };

  const cp = typeof circlesProvider === 'function'
    ? circlesProvider
    : () => {
        // Default: derive single-circle iterator by resolving the empty parts.
        const circle = bundleResolver([], {});
        return circle ? [circle] : [];
      };

  const idsArgs = members
    ? { members }
    : (typeof getBundle === 'function' ? { getBundle } : null);
  if (!idsArgs) {
    throw new TypeError('wireSkills: pass either `members` (single-circle) or `getBundle` (multi-circle) for identity skills');
  }

  const allBuilders = [
    buildIdentitySkills(idsArgs),
    buildSkills({ bundleResolver, circlesProvider: cp, circleRoleOf }),
    buildProfileSkills({ bundleResolver }),
    buildAppealSkill({ bundleResolver }),
    buildChatSkills({ bundleResolver }),
    buildPushTokenSkills({ bundleResolver }),
    buildSubtaskSkills({ bundleResolver }),
    buildInboxSkills({ bundleResolver }),
    buildWorkspaceSkills({ bundleResolver }),
    buildBriefSummarySkill({ bundleResolver }),
    buildObservabilitySkills({ bundleResolver, userSettings: us }),
    buildCircleControlSkills({ bundleResolver }),
    buildCustomRoleSkills({ bundleResolver }),
    buildBotBindingSkills({ bundleResolver }),
    buildCalendarEmissionSkills({ bundleResolver }),
    buildInvoicingSkills({ bundleResolver }),
    buildAvailabilitySkills({ bundleResolver }),
    buildPlannerSkills({ bundleResolver }),
    buildDashboardSkills({ bundleResolver, circlesProvider: cp }),
    buildForceCompleteSkill({ bundleResolver }),
    buildBotSkills({ bundleResolver }),
  ];

  const registered = [];
  for (const defs of allBuilders) {
    for (const def of defs) {
      meshAgent.skills.register(def);
      registered.push(def.id);
    }
  }
  return { registered };
}
