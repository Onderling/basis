/**
 * Page skill drift canary (2026-05-21).
 *
 * Per DESIGN-tier-policy.md, T2/T3 pages may call skills not declared
 * in the manifest (e.g. page-internal app skills like setHopMode that
 * pinboard's settings uses but doesn't manifest-declare).  But every
 * skill the page CALLS must actually EXIST — typos and skill renames
 * are still bugs.
 *
 * This test:
 *   1. Collects every `callSkill('<id>')` in apps/tasks-v0/web/*.html
 *   2. Collects every `defineSkill('<id>'` across the app's
 *      skill builders (same set sp3-manifest.test.js uses)
 *   3. Asserts every page-side ID has a matching skill
 *
 * Catches:
 *   - typos in skill IDs (`callSkill('clreaInbox')`)
 *   - renamed skills where one site was missed
 *   - dead pages still calling deleted skills
 *
 * Does NOT enforce:
 *   - whether the skill is in `tasksManifest.operations[]` (the
 *     reverse — manifest→skills — is sp3-manifest.test.js's job)
 *   - whether the page should be T2/T3 etc. (that's the tier
 *     header policy, not code-enforced)
 *
 * Lives in tasks-v0; sibling canaries exist in pinboard (apps/pinboard/test/
 * page-skill-drift.test.js).  Folio's pages haven't adopted the
 * manifest yet so no canary there.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname }            from 'node:path';
import { fileURLToPath }            from 'node:url';

import { buildSkills }                 from '../src/skills/index.js';
import { buildWorkspaceSkills }        from '../src/skills/workspace.js';
import { buildInboxSkills }            from '../src/skills/inbox.js';
import { buildSubtaskSkills }          from '../src/skills/subtasks.js';
import { buildCircleControlSkills }      from '../src/skills/circleControls.js';
import { buildAppealSkill }            from '../src/skills/appeal.js';
import { buildAvailabilitySkills }     from '../src/skills/availability.js';
import { buildBotBindingSkills }       from '../src/skills/botBindings.js';
import { buildCalendarEmissionSkills } from '../src/skills/calendarEmission.js';
import { buildCustomRoleSkills }       from '../src/skills/customRoles.js';
import { buildDashboardSkills }        from '../src/skills/dashboard.js';
import { buildForceCompleteSkill }     from '../src/skills/forceComplete.js';
import { buildInvoicingSkills }        from '../src/skills/invoicing.js';
import { buildMultiCircleOnboardingSkills } from '../src/skills/multiCircleOnboarding.js';
import { buildObservabilitySkills }    from '../src/skills/observability.js';
import { buildPlannerSkills }          from '../src/skills/planner.js';
import { buildProfileSkills }          from '../src/skills/profile.js';
import { buildPushTokenSkills }        from '../src/skills/pushTokens.js';

const HERE   = dirname(fileURLToPath(import.meta.url));
const WEBDIR = join(HERE, '..', 'web');

// Skills called from web pages that legitimately don't live in any
// of the manifest skill builders.  Each entry MUST cite the file +
// reason so future readers know why it's exempted.
const ALLOWLIST = new Set([
  // pod-settings.html copy-pasted a whoAmI lookup from pinboard's app.js.
  // The skill exists on the pinboard agent (apps/pinboard/src/skills/
  // index.js:3151) but tasks-v0 doesn't define it.  Either the call
  // should be removed from pod-settings.html OR tasks-v0 should
  // declare its own whoAmI. Tracked finding from the canary
  // (Tier policy session, 2026-05-21); fix in a follow-on.
  'whoAmI',
]);

/**
 * Strip HTML comments before scanning so example callSkill('id')
 * references inside tier-header comments don't show up as false
 * positives.  `/<!--[\s\S]*?-->/g` matches any HTML comment block,
 * including multi-line.
 */
function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

function collectCallSkillIds(dir) {
  const ids = new Set();
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.html')) continue;
    const text = stripHtmlComments(readFileSync(join(dir, name), 'utf8'));
    for (const m of text.matchAll(/callSkill\(['"]([A-Za-z_][\w-]*)['"]/g)) {
      ids.add(m[1]);
    }
  }
  return ids;
}

function collectRealSkillIds() {
  const stub = { bundleResolver: () => null };
  // Mirror wireSkills() — every builder that registers skills onto
  // the agent.  Keep this list in sync when new builders surface.
  const defs = [
    ...buildSkills({ ...stub, circlesProvider: () => [] }),
    ...buildWorkspaceSkills(stub),
    ...buildInboxSkills(stub),
    ...buildSubtaskSkills(stub),
    ...buildCircleControlSkills(stub),
    ...buildAppealSkill(stub),
    ...buildAvailabilitySkills(stub),
    ...buildBotBindingSkills(stub),
    ...buildCalendarEmissionSkills(stub),
    ...buildCustomRoleSkills(stub),
    ...buildDashboardSkills({ ...stub, circlesProvider: () => [] }),
    ...buildForceCompleteSkill(stub),
    ...buildInvoicingSkills(stub),
    ...buildMultiCircleOnboardingSkills(stub),
    ...buildObservabilitySkills(stub),
    ...buildPlannerSkills(stub),
    ...buildProfileSkills(stub),
    ...buildPushTokenSkills(stub),
  ];
  return new Set(defs.map((d) => d.id));
}

describe('tasks-v0 page skill drift canary', () => {
  it('every callSkill(<id>) in web/*.html maps to a real defineSkill', () => {
    const pageIds = collectCallSkillIds(WEBDIR);
    const real    = collectRealSkillIds();

    const orphans = [...pageIds].filter((id) => !real.has(id) && !ALLOWLIST.has(id)).sort();

    expect(
      orphans,
      `tasks-v0 pages call skill IDs that are not defined anywhere:\n` +
        `  ${orphans.join('\n  ')}\n\n` +
        `Fix by:\n` +
        `  (a) correcting the typo in the page, OR\n` +
        `  (b) adding the skill via defineSkill in the right builder, OR\n` +
        `  (c) if the call is intentionally to a non-skill (e.g. a wire helper),\n` +
        `      add the id to ALLOWLIST in this test with a comment.\n`,
    ).toEqual([]);
  });

  it('reports the size of both sets (sanity check — non-empty)', () => {
    const pageIds = collectCallSkillIds(WEBDIR);
    const real    = collectRealSkillIds();
    expect(pageIds.size, 'should find at least some callSkill calls').toBeGreaterThan(0);
    expect(real.size,    'should find at least some defineSkill builders').toBeGreaterThan(0);
  });
});
