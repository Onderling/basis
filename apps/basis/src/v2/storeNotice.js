/**
 * storeNotice — the one notice every shell shows when a store on this device holds data it could not read.
 *
 * A store that could not read what it holds keeps the bytes and refuses every save over them (`mapSnapshotGate` and
 * the settings saves in `@onderling/local-store`); each such store reports into one register there
 * (`notReadableStores`). Kept quietly, that is a loss the person finds later: what they change meanwhile is not saved.
 * So every shell reads the register through THIS view and says it — the web a bar at the top, the phone a banner on
 * the launcher, the box a line in its log (an operator page later). The view decides the words, once:
 *
 * - the REASON picks the text: data a newer build wrote → "update the app"; anything else (bytes that do not parse,
 *   a read that failed) → "if this stays, use Report a problem". One newer store among others still says update;
 * - the COST line names what is affected as plain kind words (messages, lists, settings…), never a store's name or
 *   path, in one fixed order, each once. After an update the change is saved; without one it is not. With both
 *   causes at once, each gets its own line, so no kind is promised what an update does not do.
 */

/** The order kind words are listed in. */
const KIND_ORDER = ['messages', 'lists', 'tasks', 'posts', 'settings', 'data'];

/**
 * @param {Array<{ name: string, kind: string, reason: string }>} stores  `notReadableStores()`
 * @param {(key: string, vars?: object) => string} t
 * @returns {null | { reason: 'version'|'unreadable', text: string, cost: string }}
 */
export function storeNoticeView(stores, t) {
  if (!Array.isArray(stores) || stores.length === 0) return null;
  const newer = stores.filter((s) => s?.reason === 'version');
  const other = stores.filter((s) => s?.reason !== 'version');
  const reason = newer.length ? 'version' : 'unreadable';
  // what an update fixes and what it does not are said apart: one promise per line, never one over both
  const lines = [];
  if (newer.length) lines.push(t('circle.storeNotice.costAfterUpdate', { what: kindWords(newer, t) }));
  if (other.length) lines.push(t('circle.storeNotice.costNotSaved', { what: kindWords(other, t) }));
  // the headline speaks of the update; the damaged part keeps its own way out
  if (newer.length && other.length) lines.push(t('circle.storeNotice.reportHint'));
  return {
    reason,
    text: t(reason === 'version' ? 'circle.storeNotice.newer' : 'circle.storeNotice.unreadable'),
    cost: lines.join(' '),
  };
}

/** The kinds of these stores as plain words, each once, in the fixed order, joined ('berichten, lijsten en …'). */
function kindWords(stores, t) {
  const kinds = KIND_ORDER.filter((k) => stores.some((s) => (KIND_ORDER.includes(s?.kind) ? s.kind : 'data') === k));
  const words = kinds.map((k) => t(`circle.storeNotice.kind.${k}`));
  return words.length <= 1
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')}${t('circle.storeNotice.and')}${words[words.length - 1]}`;
}
