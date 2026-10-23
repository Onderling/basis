/**
 * Household skill registry — the canonical map from manifest op id →
 * skill handler.
 *
 * Extracted 2026-05-20 from `HouseholdAgent.js` so it can be reused by:
 *   - the existing HouseholdAgent slow-path (LLM via renderChat);
 *   the new `apps/household/src/mountable.js` (recombination
 *     demo and any future "household-as-mountable" consumer).
 *
 * Convention: skill handler `(args, skillCtx) → {replies, stateUpdates}`
 * — already the renderChat shape, so household plugs into
 * `@onderling/manifest-host` without an adapter (unlike tasks-v0's SDK
 * skills, which need `apps/tasks-v0/src/mountable.js`'s adapter).
 */

import * as Skills            from './skills/index.js';
import { classifyAndExtract } from './skills/classifyAndExtract.js';

/**
 * Skill-id → handler.  Built once at module load so consumers can
 * dispatch in O(1).  Keep in lockstep with `apps/household/manifest.js`
 * — `manifest-equivalence.test.js`'s drift canary covers ops.
 *
 * @type {Record<string, import('./types.js').SkillHandler>}
 */
export const HOUSEHOLD_SKILL_REGISTRY = Object.freeze({
  // 
  addItem:             Skills.addItem,
  listOpenItems:            Skills.listOpen,
  markComplete:        Skills.markComplete,
  removeItem:          Skills.removeItem,
  // 
  listTasks:           Skills.listTasks,
  claim:               Skills.claim,
  reassign:            Skills.reassign,
  registerName:        Skills.registerName,
  // basis /brief contributor; declared by listOpen's
  // surfaces.chat.brief.summarySkill in manifest.js.
  household_briefSummary: Skills.briefSummary,
  // Slow-path internal
  classifyAndExtract,
  // nudgeCompletion + composeDigest are NOT in the user-facing
  // dispatch — the scheduler invokes them directly.
});

/**
 * No-op contextBuilder — V0 chat-agent does not pre-load pod state
 * into the system prompt.  Inlined here so consumers building a
 * ChatAgent over household's surface can share the same default.
 */
export const noopContextBuilder = async () => '';
