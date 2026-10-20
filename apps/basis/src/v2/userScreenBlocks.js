/**
 * basis v2 — multi-circle screen materializer (Plan α.2.b).
 *
 * Takes a user-defined Screen + the user's full circle list, and
 * materializes each block by gathering data from the screen's
 * circleFilter (or all circles when filter is null).  Result shape
 * matches what `circleScreen` / `CircleScreenView` already render —
 * per-block `{blockId, type, status, content}` — so the existing
 * renderers consume screen output unchanged.
 *
 * (muted): drop blocks from circles in the `mutedCircleIds` set.
 * "Hide entirely" applies BEFORE the per-block merge — a muted circle
 * contributes nothing.
 *
 * Per-block circle-aware sources:
 *   announcement / text / photo  → circle-agnostic; render once
 *   noticeboard                  → merge stream rows across circles,
 *                                  sort newest-first, cap to limit
 *   agenda                       → merge calendar events across the
 *                                  user's circles (calendar IS user-
 *                                  scoped today; multi-circle is a
 *                                  follow-up once events carry
 *                                  circleId), cap to limit
 *   rules                        → multi-circle is ambiguous; degrade
 *                                  to "first circle only" with a
 *                                  diagnostic in the content
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';
import { acrossCircles } from './acrossCircles.js';
import { presenterFor, nounsDeclaring } from './declaredPresenters.js';
import { primaryActionFor } from './rowPrimary.js';
import { materializeOnboarding } from './onboardingStrip.js';
import { encodeGenericOpId } from '@onderling/app-manifest';
import { carriesLabels, normLabel } from './itemLabels.js';
import { calendarManifest } from '../../../calendar/manifest.js';
import { tasksManifest } from '../../../tasks-v0/manifest.js';
import { householdManifest } from '../../../household/manifest.js';
import { effectiveCircleIds, isAllCircles } from './userScreens.js';
import { circleRows } from './circleStream.js';
import { normalizeRulesDoc, isRulesEmpty } from './circleRules.js';
import { materializeBlock as _materializeCircleBlock } from './circleRecipeBlocks.js';
import { buildTilePreviews } from './circleTilePreviews.js';
import { OWN_DEVICES_SCOPE } from './grantsManifest.js';
import { isPairCircleId } from './pairCircleId.js';
import { normalizeAvailability, isPushSuppressed } from './memberAvailability.js';
import { linkedBotsOf } from './identityLink.js';
import { bookRowsOf } from './contactsSource.js';
import { deviceDelegationsOf, ownedNodesOf } from '@onderling/agent-registry';

/**
 * Materialize a Screen.  Returns Promise<Array<MaterializedBlock>>
 * matching `materializeRecipe`'s output shape.
 *
 * @param {object} args
 * @param {object} args.screen
 * @param {object} args.hostOps              { callSkill, eventLog, circles }
 * @param {Set<string>|Array<string>} [args.mutedCircleIds]
 *        circles the local user has muted; their data is suppressed
 *        per ("hide entirely").
 * @returns {Promise<Array<object>>}
 */
/** A notes block on a page shows the recent ones: touched within this many days, at most this many (newest first). */
export const NOTES_RECENT_DAYS = param({ key: 'vandaag.notesRecentDays', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 7 });
export const NOTES_RECENT_LIMIT = param({ key: 'vandaag.notesRecentLimit', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 3 });

export async function materializeScreen({ screen, hostOps = {}, mutedCircleIds = null } = {}) {
  if (!screen || !Array.isArray(screen?.blocks) || screen.blocks.length === 0) return [];
  const muted = mutedCircleIds instanceof Set
    ? mutedCircleIds
    : new Set(Array.isArray(mutedCircleIds) ? mutedCircleIds : []);

  const allCircleIds = (hostOps.circles ?? []).map((c) => c?.id).filter(Boolean);
  const filterIds = effectiveCircleIds(screen, allCircleIds);
  const activeCircleIds = filterIds.filter((id) => !muted.has(id));
  // When the user has muted EVERY circle in the filter, an empty active
  // list means circle-aware blocks render empty ("hide entirely").

  // whose rows are "mine": in each circle, the self this device speaks as there (a persona's circle is the persona's) —
  // the host hands `selfIn(circleId)`; a host without personas may name one person (`myWebid`), else it is asked once
  const needsMe = (b) => b?.type === 'tasks' || b?.type === 'identityLine' || (['items', 'notes'].includes(b?.type) && b?.config?.scope === 'mine');
  let ops = hostOps;
  if (typeof hostOps.selfIn !== 'function') {
    let me = hostOps.myWebid ?? null;
    if (!me && typeof hostOps.callSkill === 'function' && screen.blocks.some(needsMe)) {
      me = await hostOps.callSkill('pinboard', 'whoAmI', {}).then((r) => r?.webid ?? null).catch(() => null);
    }
    ops = { ...hostOps, selfIn: () => me };
  }

  return Promise.all(screen.blocks.map((block) => materializeOneBlock({
    block, activeCircleIds, allCircleIds, hostOps: ops,
    screenIsAll: isAllCircles(screen),
  })));
}

/* ─────────────────────────────────────────────────────────────────────── */

async function materializeOneBlock({ block, activeCircleIds: pageCircleIds, hostOps, screenIsAll }) {
  // THE BLOCK'S OWN CIRCLES: a block may narrow the page's circles to some of them (`config.circleIds`); never widen
  const want = Array.isArray(block?.config?.circleIds) ? block.config.circleIds.filter((c) => typeof c === 'string' && c) : [];
  const activeCircleIds = want.length ? pageCircleIds.filter((id) => want.includes(id)) : pageCircleIds;
  try {
    switch (block?.type) {
      // Circle-agnostic: identical to per-circle materializer's behaviour.
      case 'announcement':
      case 'text':
      case 'photo':
        return await _materializeCircleBlock({ block, hostOps });

      case 'noticeboard':
        return materializeNoticeboard(block, activeCircleIds, hostOps);

      // ONE block for any item type over the one cross-circle projection; a screen that still holds the older
      // `tasks` / `calendar` block is read as the items block it is (no second path to keep in step)
      case 'items':
        return await materializeItems(block, activeCircleIds, hostOps, { pageIsAll: screenIsAll });
      case 'calendar':
        return await materializeItems({ ...block, config: { noun: 'calendar-event', scope: 'all', ...(block.config ?? {}) } }, activeCircleIds, hostOps, { pageIsAll: screenIsAll });
      case 'tasks':
        return await materializeItems({ ...block, config: { ...(block.config ?? {}), noun: 'task', scope: block.config?.scope === 'all' ? 'all' : 'mine' } }, activeCircleIds, hostOps, { pageIsAll: screenIsAll });
      // the notes across circles — the block a labels filter means something on (notes carry tags)
      // On a page only the RECENT ones by default (touched this week, newest first, three): "meer" opens the block whole
      // (`expandedPage`: every note); a page's own "within" / cap, set in Customise, wins.
      case 'notes':
        return await materializeItems({ ...block, config: { withinDays: NOTES_RECENT_DAYS, limit: NOTES_RECENT_LIMIT, ...(block.config ?? {}), noun: 'note', scope: block.config?.scope === 'mine' ? 'mine' : 'all' } }, activeCircleIds, hostOps, { pageIsAll: screenIsAll });

      case 'rules':
        return await materializeRules(block, activeCircleIds, hostOps, screenIsAll);

      // the circles with news: each circle's unread lines (another person's, since this device last looked), newest first
      case 'circlesUnread':
        return materializeCirclesUnread(block, activeCircleIds, hostOps);

      // the first steps on this device: the cards left (handle · what Basis is · begin)
      case 'onboarding':
        return materializeOnboarding(block, hostOps);

      // Me's own blocks: the name with the readings its config names, and the person's agents and devices
      case 'identityLine':
        return await materializeIdentityLine(block, activeCircleIds, hostOps);
      case 'agents':
        return await materializeAgents(block, hostOps);

      default:
        return { blockId: block?.id, type: block?.type, status: 'error',
                 content: {}, error: 'unknown type' };
    }
  } catch (err) {
    return { blockId: block?.id, type: block?.type, status: 'error',
             content: {}, error: String(err?.message ?? err) };
  }
}

/**
 * The circles where something is new: the circle tiles' own count (`buildTilePreviews` — another person's line on the
 * human lane, since this device last looked), for the page's circles, newest first, capped by the block's limit.
 * `hostOps.seenAt` and `hostOps.myRefs` are what the tiles use; without them every line counts as new once.
 */
function materializeCirclesUnread(block, activeCircleIds, { eventLog, circles, seenAt = {}, myRefs = [] } = {}) {
  const limit = clampInt(block.config?.limit, 1, 50, 5);
  const base = { blockId: block.id, type: 'circlesUnread', titleKey: 'circle.recipe.block.circlesUnread' };
  if (!eventLog?.query || activeCircleIds.length === 0) return { ...base, status: 'empty', content: { items: [] } };
  const wanted = new Set(activeCircleIds);
  const inPage = (circles ?? []).filter((c) => c?.id && wanted.has(c.id));
  const previews = buildTilePreviews({ events: eventLog.query({ excludeMuted: true }), circles: inPage, seenAt: seenAt ?? {}, myRefs: myRefs ?? [] });
  const items = inPage
    .map((c) => ({ circleId: c.id, name: c.name ?? null, unread: previews[c.id]?.unread ?? 0, subtitle: previews[c.id]?.subtitle ?? null, ts: previews[c.id]?.ts ?? 0 }))
    .filter((r) => r.unread > 0)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit);
  return { ...base, status: items.length > 0 ? 'ok' : 'empty', content: { items } };
}

/**
 * The readings an identity line may show, each answering one thing about now. `open` and `next` name no noun: they
 * cover whatever nouns DECLARE the facets they read (`mine` + `done`; a scheduled moment, `order: 'asc'`).
 */
export const MIJ_READINGS = Object.freeze(['availability', 'online', 'unread', 'open', 'next']);

/**
 * The identity line: the person's name and the readings the block's config names, in that order. A reading whose
 * source the shell did not hand (availability, online) or that has nothing to say (no appointment coming) is left out
 * — never a guess.
 */
async function materializeIdentityLine(block, activeCircleIds, hostOps = {}) {
  const { callSkill } = hostOps;
  const want = (Array.isArray(block.config?.readings) ? block.config.readings : []).filter((r) => MIJ_READINGS.includes(r));
  // the self Mij shows (the switcher's one ticked persona): its own name; the default is the person's profile name
  const self = hostOps.mijSelf && hostOps.mijSelf.id && hostOps.mijSelf.id !== 'default' ? hostOps.mijSelf : null;
  let name = self ? (self.name ?? null) : null;
  if (!self) {
    try {
      const prof = typeof callSkill === 'function' ? await callSkill('pinboard', 'getMyProfile', {}) : null;
      name = prof?.entry?.displayName || prof?.entry?.handle || null;
    } catch { /* nameless: the painter says "Mij" */ }
  }
  const now = typeof hostOps.now === 'function' ? hostOps.now() : Date.now();
  const readings = [];
  for (const key of want) {
    if (key === 'availability') {
      if (!hostOps.availability) continue;
      const a = normalizeAvailability(hostOps.availability);
      if (a.holiday.active && isPushSuppressed({ ...a, quietHours: { ...a.quietHours, enabled: false } }, new Date(now))) readings.push({ key, state: 'away', until: a.holiday.until });
      else if (isPushSuppressed(a, new Date(now))) readings.push({ key, state: 'quiet', until: a.quietHours.to });
      else readings.push({ key, state: 'available' });
    } else if (key === 'online') {
      const on = typeof hostOps.online === 'function' ? hostOps.online() : hostOps.online;
      if (typeof on === 'boolean') readings.push({ key, on });
    } else if (key === 'unread') {
      const r = materializeCirclesUnread({ id: block.id, config: { limit: 50 } }, activeCircleIds, hostOps);
      readings.push({ key, count: (r.content?.items ?? []).reduce((n, row) => n + (row.unread ?? 0), 0) });
    } else if (key === 'open') {
      // what is mine and not done, over every noun declaring both
      let count = 0; let answered = false;
      for (const noun of nounsDeclaring((p) => Boolean(p.mine && p.done))) {
        const r = await materializeItems({ id: block.id, config: { noun, scope: 'mine', limit: 200, openOnly: true } }, activeCircleIds, hostOps);
        if (r.status !== 'error') { answered = true; count += (r.content?.items ?? []).length; }
      }
      if (answered) readings.push({ key, count });
    } else if (key === 'next') {
      // the soonest thing still to come, over every noun whose moment is scheduled — the circles' and my own
      let next = null;
      for (const noun of nounsDeclaring((p) => p.order === 'asc')) {
        const r = await materializeItems({ id: block.id, config: { noun, scope: 'all', horizonDays: 30, limit: 20 } }, activeCircleIds, hostOps);
        const row = (r.content?.items ?? []).find((x) => x.when && x.when >= now);
        if (row && (!next || row.when < next.when)) next = row;
      }
      if (next) readings.push({ key, title: next.label, when: next.when, circleName: next.circleName ?? '' });
    }
  }
  return { blockId: block.id, type: 'identityLine', status: 'ok', content: { name, readings } };
}

/**
 * The person's agents and devices: the live devices on their registry entry (this one marked — and listed even when
 * it is not among the delegations, as a first device is not), the nodes they claimed, the bots linked to them. One
 * row each; read-only — what may be done with one lives in My data.
 */
async function materializeAgents(block, { callSkill, deviceId: personDeviceId = null, mijSelf = null } = {}) {
  // the self Mij shows: a persona's own registry entry and its own device id here; the bots are the person's (default)
  const self = mijSelf && mijSelf.id && mijSelf.id !== 'default' ? mijSelf : null;
  const deviceId = self ? (self.deviceId ?? null) : personDeviceId;
  const base = { blockId: block.id, type: 'agents', titleKey: 'circle.recipe.block.agents' };
  if (typeof callSkill !== 'function') return { ...base, status: 'empty', content: { items: [] } };
  const entry = await callSkill('agents', 'getProfileProperties', { id: self ? self.id : 'default' }).catch(() => null);
  const props = { properties: entry?.properties ?? {} };
  const items = Object.values(deviceDelegationsOf(props))
    .filter((d) => d && !d.revoked)
    .map((d) => ({ kind: 'device', label: d.label || null, here: Boolean(deviceId) && d.deviceId === deviceId }));
  if (!items.some((d) => d.here)) items.unshift({ kind: 'device', label: null, here: true });
  for (const n of Object.values(ownedNodesOf(props))) {
    const addr = typeof n?.address === 'string' ? n.address : '';
    items.push({ kind: 'companion', label: n?.label || (addr ? `${addr.slice(0, 8)}…` : null), here: false });
  }
  const contacts = self ? [] : await callSkill('pinboard', 'listContacts', {}).then((r) => r?.contacts ?? []).catch(() => []);
  const bots = new Set(linkedBotsOf(contacts));
  const names = new Map();
  for (const c of bookRowsOf({ contacts })) for (const a of [c?.peerAddr, c?.webid]) if (a) names.set(a, c.displayName || c.handle || null);
  for (const addr of bots) items.push({ kind: 'bot', label: names.get(addr) || `${addr.slice(0, 8)}…`, here: false });
  return { ...base, status: 'ok', content: { items } };
}

function materializeNoticeboard(block, activeCircleIds, { eventLog, circles } = {}) {
  const limit = clampInt(block.config?.limit, 1, 100, 5);
  if (!eventLog?.query || activeCircleIds.length === 0) {
    return { blockId: block.id, type: 'noticeboard', status: 'empty', content: { items: [] } };
  }
  const events = eventLog.query({ excludeMuted: true });
  // The projector takes a circle LIST, so a multi-circle Screen is one call. This used to loop per circle
  // and merge by hand — hand-rolling the very thing a Screen expresses (`circleFilter` IS a scope), which is
  // what made the missing list-scope obvious. Rows stay newest-first and each keeps its `circleId` for the
  // tag, exactly as before.
  const items = circleRows({ events, circles: circles ?? [], circleId: activeCircleIds })
    .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
    .slice(0, limit);
  return {
    blockId: block.id, type: 'noticeboard',
    status: items.length > 0 ? 'ok' : 'empty',
    content: { items },
  };
}

/** The item types a person also keeps of their own (no circle, the own-devices store): an items block shows those beside the circles'. */
const OWN_NOUNS = new Set(['calendar-event', 'note']);

/** The apps whose `list` a cross-circle items block may resolve (first that answers the noun). */
export const ITEM_MANIFESTS = Object.freeze([
  { appOrigin: 'calendar', manifest: calendarManifest },
  { appOrigin: 'tasks', manifest: tasksManifest },
  { appOrigin: 'household', manifest: householdManifest },
]);

/**
 * An `items` block: `{noun, scope: 'mine'|'all', limit, horizonDays}` across the screen's active circles, through
 * `acrossCircles` (the type's own list per circle, its presenter for mine / order). Appointments also take the person's
 * own calendar (no circle) — the fold keeps those on the person's store.
 */
async function materializeItems(block, activeCircleIds, { callSkill, selfIn = () => null, circles, selfSet = null } = {}, { pageIsAll = true } = {}) {
  const noun = String(block.config?.noun ?? '');
  const scope = block.config?.scope === 'mine' ? 'mine' : 'all';
  const limit = clampInt(block.config?.limit, 1, 200, 10);
  const horizonDays = clampInt(block.config?.horizonDays, 1, 365, 14);
  const empty = { blockId: block.id, type: 'items', status: 'empty', content: { noun, scope, items: [] } };
  // a person's OWN items of this type (no circle) show beside the circles' — on a page over every circle (muting a
  // circle hides that circle, never me) and a block not narrowed to some circles
  const withOwn = OWN_NOUNS.has(noun) && pageIsAll && !(Array.isArray(block.config?.circleIds) && block.config.circleIds.length);
  if (typeof callSkill !== 'function' || (activeCircleIds.length === 0 && !withOwn)) return empty;
  const presenter = presenterFor(noun);
  if (!presenter) return { blockId: block.id, type: 'items', status: 'error', content: { noun }, error: 'no presenter' };
  const names = new Map((circles ?? []).map((c) => [c?.id, c?.name ?? '']));
  const isAgenda = noun === 'calendar-event';
  const until = Date.now() + horizonDays * 86_400_000;
  // appointments shared WITH me by a contact live in our pair circle (a two-member circle, kept off the circle list):
  // the agenda over every circle reads those too — appointments only, nothing else of a pair circle
  let readIds = activeCircleIds;
  if (isAgenda && withOwn) {
    const mine = ((await callSkill('pinboard', 'listMyCircles', {}).catch(() => null))?.circles ?? []).map((c) => (typeof c === 'string' ? c : c?.groupId));
    readIds = [...new Set([...activeCircleIds, ...mine.filter((id) => isPairCircleId(id))])];
  }
  const r = readIds.length ? await acrossCircles({
    circles: readIds.map((id) => ({ id, name: names.get(id) ?? '' })), noun, scope, me: selfIn, limit: 500,
    manifests: ITEM_MANIFESTS,
    callSkill: (app, op, args) => callSkill(app, op, isAgenda ? { ...args, days: horizonDays } : args),
    genericFor: (circleId) => ({ list: async (n) => (await callSkill('household', encodeGenericOpId('household', 'list', n), { circleId }))?.result ?? [] }),
  }) : { ok: true, items: [] };
  let rows = r.ok ? r.items : [];
  let ownError = null;
  if (withOwn) {
    // my own (no circle), beside the circles': appointments from my own agenda, notes from my own store
    const own = isAgenda
      ? await callSkill('calendar', 'listEvents', { days: horizonDays }).catch((err) => { ownError = String(err?.message ?? err); return null; })
      : await callSkill('household', encodeGenericOpId('household', 'list', noun), { circleId: OWN_DEVICES_SCOPE }).catch((err) => { ownError = String(err?.message ?? err); return null; });
    // the self that made each own item (it is changed as that self, never another): its maker's webid among this
    // device's selves; no maker, or 'me' (an own appointment is made as 'me'), is the default's; a webid no self here
    // holds is a self not run on this device — null, so the row stays read-only
    const byWebid = new Map((selfSet?.held ?? []).filter((x) => x?.webid).map((x) => [x.webid, x.id]));
    const makerOf = (e) => byWebid.get(e.createdBy) ?? (!selfSet || e.createdBy == null || e.createdBy === 'me' ? 'default' : null);
    let mine = (Array.isArray(own?.items) ? own.items : []).map((e) => ({ ...e, circleId: null, circleName: '', own: true, maker: makerOf(e) }));
    if (scope === 'mine') mine = mine.filter((e) => presenter.isMine(e, selfIn(null)));
    // the switcher's set: an own item shows when the self that made it is on; one no self here made shows with the default
    if (selfSet && Array.isArray(selfSet.on) && selfSet.on.length) {
      const on = new Set(selfSet.on);
      mine = mine.filter((e) => on.has(e.maker ?? 'default'));
    }
    const sign = presenter.order === 'asc' ? 1 : -1;
    rows = [...rows, ...mine].filter((e) => !isAgenda || !presenter.when(e) || presenter.when(e) <= until)
      .sort((a, b) => sign * ((presenter.when(a) || 0) - (presenter.when(b) || 0)));
  }
  // THE BLOCK'S FILTERS (Vandaag's "Pas aan"): labels — on a type that carries them (its schema has `tags`), a row
  // shows when one of its tags is among the block's labels; a type without labels ignores the filter — and a relative
  // date, "within N days" (an agenda's is its horizon above), by the type's own moment (`presenter.when`)
  const labels = Array.isArray(block.config?.labels) ? block.config.labels.map(normLabel).filter(Boolean) : [];
  if (labels.length && carriesLabels(noun)) rows = rows.filter((row) => Array.isArray(row.tags) && row.tags.some((tg) => labels.includes(normLabel(tg))));
  // a reading's "open": rows its noun declares done are left out (a block shows them, as it always has)
  if (block.config?.openOnly === true) rows = rows.filter((row) => !presenter.isDone?.(row));
  const withinDays = Number(block.config?.withinDays);
  if (!isAgenda && Number.isFinite(withinDays) && withinDays > 0) {
    const now = Date.now();
    const span = withinDays * 86_400_000;
    rows = rows.filter((row) => { const w = presenter.when(row); return !w || Math.abs(w - now) <= span; });
  }
  // nothing answered (every circle, and my own calendar when it is asked): a failure, said as one
  if (!r.ok && r.reason === 'unreachable' && (!withOwn || ownError)) return { blockId: block.id, type: 'items', status: 'error', content: { noun }, error: r.error };
  const items = rows.slice(0, limit).map((row) => ({
    id: row.id, label: row.label ?? presenter.label(row), when: presenter.when(row) || null,
    circleId: row.circleId ?? null, circleName: row.circleName ?? '', ...(row.own ? { own: true } : {}), mine: presenter.isMine(row, selfIn(row.circleId ?? null)),
    // what a chore row also shows: its words, its state, its "see also" links
    text: row.text ?? row.label ?? presenter.label(row), ...(row.state ? { state: row.state } : {}), ...(Array.isArray(row.embeds) ? { embeds: row.embeds } : {}),
    // the row's own words, without the moment the merged label is stamped with (a card says the moment its own way)
    title: presenter.label(row),
    // done by its noun's declaration (`presents.done`): the day's shape folds it under "gedaan"
    ...(presenter.isDone?.(row) ? { done: true } : {}),
    // the row's ONE action, declared by its noun (`presents.primary`): done · open the sheet on it · open its circle
    ...((() => { const p = primaryActionFor(row, noun); return p ? { primary: p } : {}; })()),
    // an own row's own words, as made (the "+" sheet opens on them to change or remove it)
    ...(row.own ? { maker: row.maker ?? null } : {}),
    ...(row.own ? { fields: { ...((row.body ?? row.text) != null ? { body: row.body ?? row.text } : {}), ...(row.title != null ? { title: row.title } : {}), ...(row.startsAt ? { when: row.startsAt } : {}) } } : {}),
  }));
  return { blockId: block.id, type: 'items', status: items.length ? 'ok' : 'empty', content: { noun, scope, items } };
}

async function materializeRules(block, activeCircleIds, { callSkill } = {}, screenIsAll = false) {
  if (typeof callSkill !== 'function' || activeCircleIds.length === 0) {
    return { blockId: block.id, type: 'rules', status: 'empty',
             content: { rules: null, doc: normalizeRulesDoc(null) } };
  }
  // Rules are per-circle.  For a multi-circle screen we degrade to the
  // first circle's rules with a `multiCircle` flag the renderer can
  // surface as a hint ("Showing rules of <name> only — pick a single
  // circle to focus.").  Single-circle (or screenIsAll with 1 circle)
  // renders cleanly.
  const cid = activeCircleIds[0];
  const res = await callSkill('pinboard', 'getGroupRules', { groupId: cid });
  const rules = res?.rules ?? null;
  const docRaw = rules?.source?.doc ?? rules?.doc ?? null;
  const doc = normalizeRulesDoc(docRaw);
  const multiCircle = activeCircleIds.length > 1 || (screenIsAll && activeCircleIds.length > 1);
  return {
    blockId: block.id, type: 'rules',
    status: isRulesEmpty(doc) ? 'empty' : 'ok',
    content: { rules, doc, multiCircle, shownCircleId: cid },
  };
}

/* ─────────────────────────────────────────────────────────────────────── */

function clampInt(v, lo, hi, fallback) {
  const n = typeof v === 'number' && Number.isFinite(v) ? (v | 0) : fallback;
  return Math.max(lo, Math.min(hi, n));
}
