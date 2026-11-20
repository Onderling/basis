/**
 * THE CONTENT LINE: which settings a CONTENT statement (a chat message, an item snapshot or remove) is judged by, the
 * same on every device in any arrival order. One of the receiver gates' family (governanceReceiverGate.js judges the
 * governed writes); the rails ask this before they apply a statement.
 *
 * The rule: the settings change draws the line, not the sender. A `policy-update` names, per content lane, the lane's
 * tips as the admin's device held them when the change was made (`payload.contentUpTo: {items: [...], chat: [...]}`).
 * A statement is BEHIND a change when it is one of those tips or an ancestor of one (along `parent` and `deps`). In
 * version order, the first change a statement is behind decides: it is judged by the settings in force just before
 * that change. Behind no change: by the newest settings.
 *
 * WHY A LINE HERE AND A STAMP FOR RULES. A rules change carries the settings version its author held
 * (`policyVersion`), and the gate forbids an author's stamps to go back: rules changes are rare and governed, so a
 * stamp that lags is visible. Content is constant and nothing forces a member to show they saw a later version: a
 * member who stamps "made under version 1" forever would never be caught. Only an admin's signed line can put a
 * statement "before" a change, so nothing the sender writes can backdate it, and no stamp is needed.
 *
 * What follows: a switch-off does not reach back (what was made while it was on is behind the change); a statement
 * made while the switch-off was under way is behind nothing and is judged by the new settings (deny-wins, on every
 * device, the author's included); two admins at one version exempt a statement only when it is behind both lines.
 * A link the device does not hold yet leaves the answer unknown: the statement is parked, never judged on a guess.
 *
 * Pure: the caller hands the lane's links and the kept settings changes (the ones the settings gate kept).
 */
import { denyWinsMerge, POLICY_UPDATE_KIND } from './policyUpdateLane.js';

/**
 * Is `hash` one of `tips` or an ancestor of one?
 * @param {string} hash
 * @param {string[]} tips
 * @param {(h: string) => ({parent?: string|null, deps?: string[]}|null)} linksOf  null = not held on this device
 * @returns {{behind: boolean, gap?: true}}  `gap`: a link under the line is not held, so "not behind" is not known
 */
export function isBehindLine(hash, tips, linksOf) {
  const seen = new Set();
  const todo = [...(Array.isArray(tips) ? tips : [])];
  let gap = false;
  while (todo.length) {
    const h = todo.pop();
    if (typeof h !== 'string' || seen.has(h)) continue;
    seen.add(h);
    if (h === hash) return { behind: true };
    const links = linksOf(h);
    if (!links) { gap = true; continue; }
    if (links.parent) todo.push(links.parent);
    for (const d of links.deps ?? []) todo.push(d);
  }
  return gap ? { behind: false, gap: true } : { behind: false };
}

/**
 * The kept settings changes as the line rule reads them: per version (ascending), the lines of every statement at that
 * version and the settings in force BEFORE and AFTER it (after = the deny-wins merge of that version's statements, the
 * fold's own merge; before = the previous version's after, or the circle's defaults `{}` for the first).
 * @param {object[]} bodies  verified, KEPT policy-update bodies (`{kind, author, hash, payload}`)
 * @returns {Array<{version: number, lines: Array<object>, before: object, after: object}>}
 */
export function contentLineChanges(bodies) {
  const byVersion = new Map();
  for (const b of Array.isArray(bodies) ? bodies : []) {
    if (b?.kind !== POLICY_UPDATE_KIND || !b.payload?.policy || typeof b.payload.policy !== 'object') continue;
    const v = Number.parseInt(b.payload.version, 10);
    if (!Number.isFinite(v)) continue;
    if (!byVersion.has(v)) byVersion.set(v, []);
    byVersion.get(v).push(b);
  }
  const out = [];
  let before = {};
  for (const v of [...byVersion.keys()].sort((x, y) => x - y)) {
    const atV = byVersion.get(v).sort((a, b) => (a.hash < b.hash ? 1 : a.hash > b.hash ? -1 : 0));
    const after = denyWinsMerge(atV.map((b) => b.payload.policy));
    out.push({ version: v, lines: atV.map((b) => (b.payload.contentUpTo && typeof b.payload.contentUpTo === 'object' ? b.payload.contentUpTo : {})), before, after });
    before = after;
  }
  return out;
}

/**
 * The settings a content statement is judged by.
 * @param {object} a
 * @param {string} a.hash   the statement
 * @param {'items'|'chat'} a.lane
 * @param {(h: string) => ({parent?: string|null, deps?: string[]}|null)} a.linksOf  the lane's links on this device
 * @param {ReturnType<typeof contentLineChanges>} a.changes
 * @returns {{policy: object}|{park: true}}
 */
export function settingsForContent({ hash, lane, linksOf, changes }) {
  const list = Array.isArray(changes) ? changes : [];
  for (const c of list) {
    let all = c.lines.length > 0;
    let unknown = false;
    for (const line of c.lines) {
      const r = isBehindLine(hash, line?.[lane] ?? [], linksOf);
      if (!r.behind) { all = false; if (r.gap) unknown = true; }
    }
    if (all) return { policy: c.before };
    if (unknown) return { park: true };
  }
  return { policy: list.length ? list[list.length - 1].after : {} };
}
