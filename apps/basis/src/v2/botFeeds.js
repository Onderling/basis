/**
 * botFeeds — the household bot keeps each person's agenda link filled: it renders their file (`personFeed.js`), seals
 * it to their link's key and puts it on the household's companion, which serves it at `/feed/<id>.<k>.ics`.
 *
 * - `/agenda-link` ALWAYS mints: a new id and key, the old file dropped, the link sent to the person's PRIVATE chat only
 *   and never shown again (their thread keeps a placeholder, never the link).
 * - The link's two halves live on the person's thread row — the bot's own store, sealed at rest — because the bot
 *   re-seals the file after every change; the companion never holds either.
 * - After a change to an appointment, every link is re-rendered (a burst of changes is one push); once at boot too. A
 *   push that fails waits for the next change or boot — nothing is queued.
 * - `/revoke` and the admin's switch going off drop the files: the links go dark.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';
import { mintFeedLink, renderPersonFeed, sealPersonFeed, feedUrls } from './personFeed.js';

/** How long after the last change the links are re-rendered (a burst of changes is one push). */
export const FEED_PUSH_DELAY_MS = param({ key: 'assistant.feedPushDelayMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 3000 });

/**
 * @param {object} a
 * @param {{feedLinkOf: Function, setFeedLink: Function, feedPeople: Function}} a.threads
 * @param {() => Promise<object[]>} a.events        the household's calendar-event items
 * @param {() => Promise<Array<{id: string}>>} a.people   the household's people
 * @param {() => Promise<string>} [a.calendarName]  the name the calendar app shows (the household's)
 * @param {(id: string, envelope: string) => Promise<{ok: boolean}>} a.put    the companion's `feed.put`
 * @param {(id: string) => Promise<{ok: boolean}>} a.drop                 the companion's `feed.drop`
 * @param {string} a.base     the public address the companion is served at (`https://…`)
 */
export function createBotFeeds({ threads, events, people, calendarName = async () => '', put, drop, base, now = Date.now,
  setTimer = (fn, ms) => { const h = setTimeout(fn, ms); h?.unref?.(); return h; }, clearTimer = (h) => clearTimeout(h) }) {
  let timer = null;

  async function fileFor(person, link) {
    const ics = renderPersonFeed({ events: await events(), people: await people(), person, calendarName: await calendarName(), now: now() });
    return sealPersonFeed(ics, link.k);
  }

  /** Re-render one person's file; `{ok}`. */
  async function push(person) {
    const link = threads.feedLinkOf(person);
    if (!link) return { ok: false, reason: 'no-link' };
    const r = await put(link.id, await fileFor(person, link)).catch(() => null);
    return r?.ok ? { ok: true } : { ok: false, reason: 'companion' };
  }

  async function pushAll() {
    const inBook = new Set(((await people().catch(() => [])) ?? []).map((p) => p?.id));
    for (const person of threads.feedPeople()) {
      if (!inBook.has(person)) continue;
      await push(person).catch(() => {});
    }
  }

  /** Drop a person's file and forget their link. */
  async function end(person) {
    const link = threads.feedLinkOf(person);
    if (!link) return { ok: true, had: false };
    await drop(link.id).catch(() => null);
    await threads.setFeedLink(person, null);
    return { ok: true, had: true };
  }

  return {
    /** A new link for this person (the old one goes dark): `{ok, urls}` or `{ok: false, reason}`. */
    async mint(person) {
      const before = threads.feedLinkOf(person);
      const link = mintFeedLink();
      const r = await put(link.id, await fileFor(person, link)).catch(() => null);
      if (!r?.ok) return { ok: false, reason: 'companion' };
      await threads.setFeedLink(person, link);
      if (before) await drop(before.id).catch(() => null);
      return { ok: true, urls: feedUrls(base, link) };
    },
    push,
    pushAll,
    end,
    /** Every link dark (the admin switched the feed off). */
    async endAll() { for (const person of threads.feedPeople()) await end(person); },
    /** A household item changed: an appointment re-renders every link, a moment after the last change. */
    touched(change) {
      const type = change?.after?.type ?? change?.before?.type;
      if (type !== 'calendar-event') return;
      if (timer) clearTimer(timer);
      timer = setTimer(() => { timer = null; pushAll().catch(() => {}); }, FEED_PUSH_DELAY_MS);
    },
  };
}
