/**
 * THE CONTENT LINE: which settings a CONTENT statement (a chat message, an item snapshot or remove) is judged by, the
 * same on every device in any arrival order. One of the receiver gates' family (governanceReceiverGate.js judges the
 * governed writes); the rails ask this before they apply a statement.
 *
 * The rule: the settings change draws the line, not the sender. A `policy-update` names, per content lane, the lane's
 * tips as the admin's device held them when the change was made (`payload.contentUpTo: {items: [...], chat: [...]}`).
 * A statement is BEHIND a change when it is one of those tips or an ancestor of one (along `parent` and `deps`).
 * Scanned from the NEWEST change: a statement is judged by the settings after the newest change it is not behind;
 * behind every change, by the settings before the oldest (the circle's creation settings: the first version).
 *
 * MISSING HISTORY. Lane statements age out, a joiner never held the older ones, chat can be purged: a walk from a
 * line's tips nearly always ends in a link this device does not hold. So "not behind" has two proofs, either enough:
 * (a) a tip of the line is among the statement's OWN ancestors (tips are mutually unrelated, so the statement is
 * under none of them); (b) the walk from the tips ends without finding it and without a missing link. With neither,
 * the answer is unknown, and every candidate setting is answered: the rail judges under each, and the same verdict
 * under all of them is the verdict. A fresh statement is decided at the newest change, never by old pruned lines.
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
 *
 * Pure: the caller hands the lane's links and the kept settings changes (the ones the settings gate kept).
 */
import { denyWinsMerge, POLICY_UPDATE_KIND } from './policyUpdateLane.js';

/**
 * Where a statement stands to one line.
 * @param {string} hash
 * @param {string[]|undefined} tips  the line on this lane; not an array (a change without a line): unknown
 * @param {(h: string) => ({parent?: string|null, deps?: string[]}|null)} linksOf  null = not held on this device
 * @returns {'behind'|'not-behind'|'unknown'}
 */
export function lineRelation(hash, tips, linksOf) {
  if (!Array.isArray(tips)) return 'unknown';
  const tipSet = new Set(tips.filter((t) => typeof t === 'string'));
  // "behind": the walk from the tips finds it; "not behind" proof (b): that walk is complete and does not
  const seen = new Set();
  const todo = [...tipSet];
  let gap = false;
  while (todo.length) {
    const h = todo.pop();
    if (typeof h !== 'string' || seen.has(h)) continue;
    seen.add(h);
    if (h === hash) return 'behind';
    const links = linksOf(h);
    if (!links) { gap = true; continue; }
    if (links.parent) todo.push(links.parent);
    for (const d of links.deps ?? []) todo.push(d);
  }
  if (!gap) return 'not-behind';
  // proof (a): a tip among the statement's own ancestors (a hash named by a held link counts, held or not)
  const down = new Set();
  const stack = [];
  const first = linksOf(hash);
  if (first) { if (first.parent) stack.push(first.parent); stack.push(...(first.deps ?? [])); }
  while (stack.length) {
    const h = stack.pop();
    if (typeof h !== 'string' || down.has(h)) continue;
    down.add(h);
    if (tipSet.has(h)) return 'not-behind';
    const links = linksOf(h);
    if (!links) continue;
    if (links.parent) stack.push(links.parent);
    for (const d of links.deps ?? []) stack.push(d);
  }
  return 'unknown';
}

/**
 * The kept settings changes as the line rule reads them: per version (ascending), the lines of every statement at that
 * version and the settings in force AFTER it (the deny-wins merge of that version's statements, the fold's own merge).
 * @param {object[]} bodies  verified, KEPT policy-update bodies (`{kind, author, hash, payload}`)
 * @returns {Array<{version: number, lines: Array<object|null>, after: object}>}  a line is null when the statement
 *   carries no `contentUpTo` (never read as an empty line)
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
  return [...byVersion.keys()].sort((x, y) => x - y).map((v) => {
    const atV = byVersion.get(v).sort((a, b) => (a.hash < b.hash ? 1 : a.hash > b.hash ? -1 : 0));
    return {
      version: v,
      lines: atV.map((b) => (b.payload.contentUpTo && typeof b.payload.contentUpTo === 'object' ? b.payload.contentUpTo : null)),
      after: denyWinsMerge(atV.map((b) => b.payload.policy)),
    };
  });
}

/**
 * The settings a content statement is judged by.
 * @param {object} a
 * @param {string} a.hash   the statement
 * @param {'items'|'chat'} a.lane
 * @param {(h: string) => ({parent?: string|null, deps?: string[]}|null)} a.linksOf  the lane's links on this device
 * @param {ReturnType<typeof contentLineChanges>} a.changes
 * @returns {{settings: object[], beforeUnknown?: true}}  one setting: proven. More: the candidates, judged under each.
 *   `beforeUnknown`: the statement may be behind every change this device holds, and the oldest held is not the
 *   circle's first, so the settings before it are not known here.
 */
export function settingsForContent({ hash, lane, linksOf, changes }) {
  const list = Array.isArray(changes) ? changes : [];
  const settings = [];
  const add = (p) => { if (!settings.includes(p)) settings.push(p); };
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const c = list[i];
    // two admins at one version: behind it only when behind every line; not behind as soon as one line proves it
    const rels = c.lines.map((line) => lineRelation(hash, line ? line[lane] : undefined, linksOf));
    if (rels.some((r) => r === 'not-behind')) { add(c.after); return { settings }; }
    if (rels.length && rels.every((r) => r === 'behind')) continue;
    add(c.after);   // unknown: after this change is one reading; the older changes give the others
  }
  // behind (or maybe behind) every change held: the settings before the oldest
  if (list.length && list[0].version === 1) { add(list[0].after); return { settings }; }
  return { settings, beforeUnknown: true };
}
