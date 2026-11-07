/**
 * One row of the blocked list in words: the name the person saw when they blocked, and the day — never the key.
 * "Jan (geblokkeerd 6 nov)"; a block with no name kept (one made before names were kept, or from the slash command
 * with a bare address) reads "Iemand (geblokkeerd 6 nov)". Unblocking still works by the stored key.
 *
 * @param {{ key: string, label?: string|null, at?: number|null }} entry
 * @param {{ t: (k: string, v?: object) => string, lang?: string, tz?: string }} opts
 * @returns {string}
 */
export function blockedRowWords(entry, { t, lang = 'nl', tz } = {}) {
  const date = typeof entry?.at === 'number'
    ? new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'nl-NL', { day: 'numeric', month: 'short', ...(tz ? { timeZone: tz } : {}) }).format(new Date(entry.at))
    : null;
  const name = typeof entry?.label === 'string' && entry.label.trim() ? entry.label.trim() : null;
  if (name) return date ? t('circle.admin.muted_row', { name, date }) : name;
  return date ? t('circle.admin.muted_row_unnamed', { date }) : t('circle.reply.who_someone');
}
