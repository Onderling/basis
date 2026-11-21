/**
 * THE CONTENT JUDGE: an items statement that arrived is APPLIED, REFUSED or PARKED by the circle's switches at its own
 * place on the content line (`contentLine.js`), the same on every member's device in any arrival order. The sender's
 * gate (`circleActRefusal`) binds only the sender's app; this is where a switch binds on everyone else's.
 *
 * What it is judged by: the settings changes the settings lane KEPT (its receiver gate decided them: the admins, the
 * circle's rule for changing settings). Only the lane knows that, and the lane is composed by each shell; so the lane,
 * each time it applies, notes its kept changes here, and the items rail reads them. Recorded per DEVICE (keyed on the
 * device's own log, which both sides hold): agents sharing one process (a test, a box with several) never share them.
 * Not noted yet for a circle this run: not known, and a statement parks until the lane has run.
 */
import { linksIndex, contentLineChanges, settingsForContent } from './contentLine.js';
import { itemStatementVerdict, itemTypeCapability } from './circleActGate.js';
import { isAppSurfaceEnabled } from './appFeature.js';
import { isFeatureEnabled } from './circlePolicy.js';


/**
 * Judge one items statement.
 * @param {object} a
 * @param {object} a.body           the verified statement body (`hash`, `kind`, `payload`)
 * @param {'add'|'change'|'remove'} a.act   a row this device does not hold is an add, a held one a change
 * @param {string} [a.type]         the row's type (a remove names it from the held row)
 * @param {(h: string) => object|null} a.linksOf   the items lane's links on this device (`linksIndex`)
 * @param {object[]|undefined} a.kept   the kept settings changes; undefined = not known yet
 * @param {object[]} a.manifests
 * @param {boolean} [a.served]      a head served in answer to this device's own catch-up ask: judged only by its app
 * @param {object} [a.proofs]       this device's kept answers (`contentJudgments.js`): read before a walk, new ones kept
 * @returns {{verdict: 'apply'|'refuse'|'park', code?: string}}
 */
export function judgeItemStatement({ body, act, type = null, linksOf, kept, manifests = [], served = false, proofs = null }) {
  if (kept === undefined) return { verdict: 'park' };
  const rowType = type ?? body?.payload?.item?.type ?? null;
  if (!Array.isArray(kept) || kept.length === 0 || typeof rowType !== 'string') return { verdict: 'apply' };
  const changes = contentLineChanges(kept);
  if (!changes.length) return { verdict: 'apply' };
  const { settings, beforeUnknown } = settingsForContent({ hash: body?.hash, lane: 'items', linksOf, changes, proofs });
  if (beforeUnknown || !settings.length) return { verdict: 'park' };
  const cap = served ? itemTypeCapability(manifests, rowType) : null;
  const verdicts = settings.map((policy) => (served
    ? (cap && !isAppSurfaceEnabled(cap.app, policy ?? {}, isFeatureEnabled) ? { allow: false, code: 'app-disabled' } : { allow: true })
    : itemStatementVerdict({ manifests, policy, type: rowType, act })));
  if (verdicts.every((v) => v.allow)) return { verdict: 'apply' };
  if (verdicts.every((v) => !v.allow)) return { verdict: 'refuse', code: verdicts[0].code };
  return { verdict: 'park' };
}

