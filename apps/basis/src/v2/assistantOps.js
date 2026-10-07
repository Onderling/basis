/**
 * assistantOps — the door's own ops (`assistantManifest`), answered by the door: a person's thread settings, and the
 * bot admin's app list, status and users. Composed around the door's callSkill (`withAssistantOps`).
 */
import { parsePairingOffer } from './connectionPairing.js';
import { screenLabel } from './botScreens.js';
import { personNamed, linkedKeyOf } from './botUsers.js';
import { MIN_PASSPHRASE } from './exportKeyFile.js';
import { checkExport, countExport } from './householdExport.js';
import { isSealedExport, openExport } from './householdExportSeal.js';
import { REMINDER_LEAD_CHOICES, ASSIGN_POLICIES, ASSIGN_POLICY_KEY, BOT_ROLES, NAMES_POLICIES, NAMES_KEY, PASSED_POLICIES, PASSED_KEY, PASSED_DAYS_KEY, CANCEL_POLICIES, CANCEL_KEY, REMINDERS_KEY, REMINDERS_MODES, QUIET_KEY, ROLES_KEY, ROLES_PRESETS, rolesPresetFrom, HOUSEHOLD_IN_APP_KEY, IN_APP_MODES, inAppModeFrom, USAGE_VISIBLE_KEY, USAGE_VISIBILITY, usageVisibleFrom, MONTHLY_TOKEN_LIMIT_KEY, monthlyTokenLimitFrom, isQuietHours, assignPolicyFrom, namesPolicyFrom, passedPolicyFrom, passedDaysFrom, cancelPolicyFrom, remindersModeFrom, quietHoursFrom } from './botSettings.js';
import { REMINDER_RULES_KEY, reminderRulesFrom, reminderRulesValue, reminderLayerFromWords, leadOf, withLead, describeRules } from './reminderWords.js';
import { layeredRules, reminderOccurrences } from './reminderOccurrences.js';
import { upcoming } from './intentions.js';
import { assistantManifest } from './assistantManifest.js';
import { createIntentionBook } from './intentionBook.js';
import { createOwnDevicesStore } from './ownDevicesStore.js';
import { WEEK_OVERVIEW_OP, weekOverviewOn, switchWeekOverview } from './weekOverviewRows.js';
import { inQuiet } from './botReminders.js';
import { wallClockInTz } from '@onderling/notifier';
import { peopleRows } from './botPeople.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';
import { isOwnTelegramChat } from './doorBridges.js';
import { cachedShare } from './botUsage.js';
import { SURFACE_PREFS } from './surfacePref.js';

/** How many entries of one part the week overview shows before it says how many more there are. */
export const WEEK_OVERVIEW_MAX_ITEMS = param({ key: 'assistant.weekOverviewMaxItems', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 15 });

/**
 * The door's callSkill, with its own ops handled here, and nothing else changed.
 *   - `assistant-memory` / `assistant-language` set the CALLING thread's row (the thread id the door passes in `ctx`);
 *   - `assistant-apps` / `assistant-settings` / `assistant-status` / `assistant-users` are the bot admin's: the app list,
 *     the bot's settings (who may give a chore to whom), how it is doing,
 *     who it serves.
 * Every one of them asks the host gate first (`refusal`), at the level its op declares (`visibility`, default
 * `authenticated`): a member reaches their own thread's settings, only the admin (`trusted`) the admin's ops.
 * @param {object} a
 * @param {(app:string, op:string, args:object, ctx?:object) => Promise<any>} a.callSkill
 * @param {ReturnType<import('./botThreads.js').createBotThreads>} a.threads
 * @param {(key:string, params?:object) => string} a.t
 * @param {(opId:string, caller:string, visibility:string) => Promise<object|null>} [a.refusal]  the host gate: a
 *        refusal `{layer, code}`, or null. Absent → no caller is checked (a door without admitted people).
 * @param {{catalogue?: ReturnType<import('../telegram/assistantCatalogue.js').createDoorCatalogue>,
 *          status?: () => object|Promise<object>, users?: () => Promise<object[]>,
 *          admission?: ReturnType<import('./botAdmission.js').createBotAdmission>,
 *          revoke?: (who: string) => Promise<object|null>,
 *          inviteLink?: (code: string) => string|null}} [a.admin]  what the admin's ops read and change
 */
/** A switch in the door's words: "uit" is off (never "not off, so on"); a word it does not know is null. */
const SWITCH_WORDS = Object.freeze({ on: 'on', aan: 'on', ja: 'on', yes: 'on', off: 'off', uit: 'off', nee: 'off', no: 'off' });
const switchOf = (word) => SWITCH_WORDS[String(word ?? '').trim().toLowerCase()] ?? null;

/**
 * The writing ops whose change may concern others (an appointment made, moved or cancelled; a chore given): the door
 * tells them, at once, after the op (`announcements.js`). A read never does.
 */
const ANNOUNCED_OPS = Object.freeze(new Set([
  'calendar.addEvent', 'calendar.cancelEvent',
  'lists.addToList', 'lists.makeChore', 'lists.editEntry',
  'tasks.reassignTask', 'tasks.editTask',
]));

export function withAssistantOps({ callSkill, threads, t, refusal = null, admin = {}, now = Date.now, intentions = {}, announcer = null }) {
  // The planned work of the people this door serves (the week overview's row): the host's own-devices store; a
  // composition that hands none keeps it in memory.
  const book = intentions.book ?? createIntentionBook({ store: createOwnDevicesStore(), actor: 'door', now });
  const levelOf = (op) => assistantManifest.operations.find((o) => o.id === op)?.visibility ?? 'authenticated';
  /** What a settings op's buttons can set, and the value it has now, for this person. */
  const PERSON_SETTINGS = {
    'assistant-memory':    { values: ['off', 'short', 'long'], now: (id) => threads.modeOf(id) },
    'assistant-reminders': { values: ['on', 'off'], now: (id) => (threads.remindersOn(id) ? 'on' : 'off') },
    'assistant-overview':  { values: ['on', 'off'], now: (id) => (weekOverviewOn(book, id) ? 'on' : 'off') },
    'assistant-language':  { values: ['nl', 'en', 'auto'], now: (id) => threads.langOf(id) ?? 'auto' },
    'assistant-view':      { values: [...SURFACE_PREFS], now: (id) => threads.viewOf(id) },
    // the person's own quiet hours: the household's (`huis`), or one of a few common ones (any other: `/stil 22:30-07:30`)
    'assistant-quiet':     { values: ['huis', '22:00-07:00', '23:00-08:00', '23:00-09:00'], now: (id) => threads.quietOf?.(id) ?? 'huis' },
  };
  /** The household's settings (`/huishouden <key> <value>`), each a row. */
  const HOUSEHOLD_SETTINGS = [
    ['assign', ASSIGN_POLICY_KEY, ASSIGN_POLICIES, assignPolicyFrom], ['names', NAMES_KEY, NAMES_POLICIES, namesPolicyFrom],
    ['passed', PASSED_KEY, PASSED_POLICIES, passedPolicyFrom], ['cancel', CANCEL_KEY, CANCEL_POLICIES, cancelPolicyFrom],
    ['reminders', REMINDERS_KEY, REMINDERS_MODES, remindersModeFrom],
    ['usage', USAGE_VISIBLE_KEY, USAGE_VISIBILITY, usageVisibleFrom],
    ['roles', ROLES_KEY, ROLES_PRESETS, rolesPresetFrom],
    ['app', HOUSEHOLD_IN_APP_KEY, IN_APP_MODES, inAppModeFrom],
  ];
  const slashOf = (opId) => assistantManifest.operations.find((o) => o.id === opId)?.surfaces?.slash?.command ?? null;
  /** An op's declared step-up, from the door's catalogue (any app), else the door's own manifest. */
  const stepUpOf = (app, opId) => {
    for (const e of admin.catalogue?.catalogue?.()?.opsById?.values?.() ?? []) {
      if (e?.appOrigin === app && e?.op?.id === opId) return e.op.stepUp ?? null;
    }
    return app === 'assistant' ? (assistantManifest.operations.find((o) => o.id === opId)?.stepUp ?? null) : null;
  };
  const door = async (app, op, args = {}, ctx = {}) => {
    const caller = typeof ctx?.caller === 'string' && ctx.caller ? ctx.caller : null;
    // A call from a circle the bot joined never reaches the door's own ops — a person's settings, the overview, the
    // admin's book, exports, screens are the household's. A circle's admin is `trusted` in the host gate (their circle's
    // admin column needs it), which is also the level the bot's admin ops ask for: so refused here, before any op.
    if (app === 'assistant' && typeof ctx?.doorCircleId === 'string' && ctx.doorCircleId) {
      return { ok: false, error: { code: 'not-in-this-circle', message: t('circle.bot.kring_not_here') } };
    }
    // A screen's call to an op that declares a step-up (any app's) runs only after a yes in the private chat: held here,
    // before any app is handed the call, so a screen that skips its own confirm changes nothing. The host gate first: a
    // screen whose person may not do it is refused, not asked about.
    if (ctx?.via === 'screen' && stepUpOf(app, op) === 'private-door') {
      const refused = caller && typeof refusal === 'function' ? await refusal(op, caller, app === 'assistant' ? levelOf(op) : undefined) : null;
      if (refused) return { ok: false, error: { code: refused.code ?? String(refused), message: t('circle.bot.admin_only') }, refusal: refused };
      return holdForYes(caller, app, op, args, ctx);
    }
    if (app !== 'assistant') {
      const res = announcer && ANNOUNCED_OPS.has(`${app}.${op}`) ? await announcer.around(() => callSkill(app, op, args, ctx), ctx) : await callSkill(app, op, args, ctx);
      return askOnce(app, op, args, ctx, res);
    }
    if (caller && typeof refusal === 'function') {
      const refused = await refusal(op, caller, levelOf(op));
      // the host gate's refusal (`{layer, code}`, the one shape) rides along; the door says the admin's line
      if (refused) return { ok: false, error: { code: refused.code ?? String(refused), message: t('circle.bot.admin_only') }, refusal: refused };
    }
    try {
      if (op === 'assistant-screen-approve') return approveOp(caller ?? ctx?.threadId, args?.answer ?? args?._match, ctx);
      if (op === 'assistant-link') return linkOp(caller ?? ctx?.threadId, args?.offer ?? args?._match, ctx);
      if (op === 'assistant-link-confirm') return linkConfirmOp(caller ?? ctx?.threadId, args?.answer ?? args?._match, ctx);
      if (op === 'assistant-inapp') return inAppOp(caller ?? ctx?.threadId, args?.answer ?? args?._match, ctx);
      if (op === 'assistant-unlink') return unlinkOp(caller ?? ctx?.threadId, ctx);
      if (op === 'assistant-circle') return circleOp(caller ?? ctx?.threadId, args?.spec ?? args?._match, ctx);
      if (op === 'assistant-circles') return circlesOp(caller ?? ctx?.threadId);
      // the export key's set and unlock exist for a screen alone: they run only as the yes to a screen's request
      if (op === 'assistant-export-key-set' || op === 'assistant-export-key-unlock') {
        if (ctx?.steppedUp !== true) return { ok: false, error: { code: 'screen-only', message: t('circle.bot.export_key_screen_only') } };
        return exportKeyOp(op, args?.passphrase, personT(caller ?? ctx?.threadId));
      }
      // `/apps on tasks`: with no required param the router keeps the line as `_match` for the op to split.
      if (op === 'assistant-apps') return appsOp(args?.change ?? args?._match);
      if (op === 'assistant-settings') return settingsOp(args?.change ?? args?._match, caller ?? ctx?.threadId, caller, ctx);
      if (op === 'assistant-role') return roleOp(args?.who, args?.role);
      if (op === 'assistant-status') return { ok: true, message: await statusText() };
      if (op === 'assistant-users') {
        const preset = rolesPresetFrom(await userParam(ROLES_KEY));
        // each row also carries the word a person reads for its role (under flat: "lid" for a member and a coordinator)
        const items = (await peopleFor(caller)).map((it) => ({ ...it, roleWord: roleWordFor(it.role, preset) }));
        return { ok: true, items, message: usersText(items, preset) };
      }
      if (op === 'assistant-people') return peopleOp(caller ?? ctx?.threadId);
      if (op === 'assistant-cohort') return cohortOp(args?.spec ?? args?._match);
      if (op === 'assistant-invite') return inviteOp(args?.role ?? args?._match);
      if (op === 'assistant-rotate') return rotateOp();
      if (op === 'assistant-revoke') return revokeOp(args?.who);
      if (op === 'assistant-menu') return menuOp(caller ?? ctx?.threadId, caller, ctx);
      if (op === 'assistant-usage') return usageOp(caller ?? ctx?.threadId);
      if (op === 'assistant-view') return viewOp(caller ?? ctx?.threadId, args?.mode ?? args?._match);
      if (op === 'assistant-screen') return screenOp(caller ?? ctx?.threadId, args?.how ?? args?._match);
      if (op === 'assistant-screen-paste') return screenPasteOp(caller ?? ctx?.threadId, args?.offer ?? args?._match);
      if (op === 'assistant-screen-confirm') return screenConfirmOp(caller ?? ctx?.threadId, args?.answer ?? args?._match, ctx);
      if (op === 'assistant-screens') return screensOp(caller ?? ctx?.threadId, args?.change ?? args?._match);
      if (op === 'assistant-exports') return exportsOp();
      if (op === 'assistant-export') return exportNowOp();
      if (op === 'assistant-import') return importOp(args?.file ?? args?._match, { preview: args?.preview === true });
      const threadId = typeof ctx?.threadId === 'string' && ctx.threadId ? ctx.threadId : null;
      if (!threadId) return { ok: false, error: 'no-thread' };
      // a person's own op answers in their language (`/taal`, set after this call for the language op itself)
      const tp = personT(threadId);
      // a switch asked without its value: how it stands now, with a button per value (as `/instellingen` paints it)
      if (PERSON_SETTINGS[op] && !(args?.mode ?? args?.lang ?? args?.hours ?? args?.rules ?? args?._match)) return oneSettingOp(threadId, op);
      if (op === 'assistant-memory') {
        const mode = args?.mode ?? args?._match;
        threads.setMode(threadId, mode);
        return { ok: true, message: tp(`circle.bot.memory_${mode}`) };
      }
      if (op === 'weekOverview') return { ok: true, message: await weekOverviewText(ctx, tp) };
      // the planned overview: sent to the person's own door, as them — and not in their quiet hours ("not yet": the
      // runner keeps it due until the day is over)
      if (op === WEEK_OVERVIEW_OP) {
        if (typeof intentions.sendToPerson !== 'function') return { ok: false, error: 'unwired' };
        const quiet = intentions.quietOf?.(threadId) ?? null;
        if (quiet && inQuiet(wallClockInTz(now(), intentions.tz ?? 'UTC'), quiet)) return { ok: false, notYet: 'quiet' };
        const r = await intentions.sendToPerson(threadId, { text: await weekOverviewText(ctx, tp) });
        return r?.ok ? { ok: true } : { ok: false, reason: r?.reason ?? 'not-sent' };
      }
      if (op === 'assistant-quiet') {
        const w = String(args?.hours ?? args?._match ?? '').trim().toLowerCase();
        if (w === 'huis' || w === 'house') { threads.setQuiet(threadId, null); return { ok: true, message: tp('circle.bot.quiet_house') }; }
        if (!isQuietHours(w)) return { ok: false, error: { code: 'invalid-argument', message: tp('circle.bot.quiet_usage') } };
        threads.setQuiet(threadId, w);
        return { ok: true, message: tp('circle.bot.quiet_set', { hours: w }) };
      }
      if (op === 'assistant-reminders') return remindersOp(threadId, args, tp);
      if (op === 'remindMe') return remindMeOp(threadId, args, ctx, tp);
      if (op === 'assistant-planned') return plannedOp(threadId, tp);
      if (op === 'assistant-overview') {
        const mode = switchOf(args?.mode ?? args?._match);
        if (!mode) return { ok: false, error: { code: 'invalid-argument', message: tp('circle.bot.switch_usage', { command: op === 'assistant-reminders' ? '/herinneringen' : '/overzicht' }) } };
        const which = op === 'assistant-reminders' ? 'reminders' : 'overview';
        if (which === 'reminders') threads.setReminders(threadId, mode === 'on'); else await switchWeekOverview(book, threadId, mode === 'on');
        return { ok: true, message: tp(`circle.bot.${which}_${mode}`) };
      }
      if (op === 'assistant-language') {
        const lang = args?.lang ?? args?._match;
        threads.setLang(threadId, lang);
        const tn = personT(threadId);
        return { ok: true, message: lang === 'auto' ? tn('circle.bot.lang_auto') : tn('circle.bot.lang_set', { lang: tn(`circle.bot.value_${lang}`) }) };
      }
    } catch (err) {
      return { ok: false, error: { code: 'invalid-argument', message: err?.message ?? String(err) } };
    }
    return { ok: false, error: 'unknown-op', app, op };
  };
  return door;

  /**
   * The question, once per person: at their first dated add, when they have no reminders of their own, the reply asks
   * how they want to be reminded — four buttons, each a `/herinneringen` of its own ("zoals altijd" = the household's).
   * After that never unprompted. An add that was refused, or a second one of the same thing, asks nothing.
   */
  function askOnce(app, op, args, ctx, res) {
    if (!res?.ok || res.duplicate) return res;
    const person = (typeof ctx?.caller === 'string' && ctx.caller) || (typeof ctx?.threadId === 'string' && ctx.threadId) || null;
    if (!person || !threads?.reminderAskedOf || threads.reminderAskedOf(person) || threads.reminderDefaultOf(person)) return res;
    const dated = (app === 'calendar' && op === 'addEvent')
      || (app === 'lists' && (op === 'addToList' || op === 'makeChore') && Boolean(args?.due ?? args?.dueAt ?? args?.when));
    if (!dated) return res;
    threads.markReminderAsked(person);
    const tp = personT(person);
    const slash = slashOf('assistant-reminders');
    const buttons = [['ask_morning', 'ochtend'], ['ask_hour', '60'], ['ask_none', 'geen'], ['ask_usual', 'huis']]
      .map(([label, words]) => ({ label: tp(`circle.bot.${label}`), slash: `${slash} ${words}` }));
    return { ...res, message: [res.message, tp('circle.bot.reminders_ask')].filter(Boolean).join('\n\n'), quickReplies: [...(res.quickReplies ?? []), ...buttons] };
  }

  /**
   * `/gepland`: what the bot will send THIS person in the coming week — their reminders as their layers make them, and
   * their planned rows (a missed one says so), in time order. An admin also sees the household's own rules, never
   * anyone's personal extras. Read from the record each time; nothing is stored for it.
   */
  async function plannedOp(person, tp) {
    if (typeof intentions.sources !== 'function') return { ok: false, error: 'unwired' };
    const at = now();
    const tz = intentions.tz ?? 'UTC';
    const horizon = 7 * 86_400_000;
    const lang = threads?.langOf?.(person) ?? 'nl';
    const when = (ms) => new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'nl-NL', { timeZone: tz, weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
    const rows = (await intentions.users?.().catch(() => null)) ?? [];
    const household = await householdReminderRules();
    const lines = [];
    const remindersOn = threads.remindersOn(person);
    if (remindersOn) {
      const { events = [], chores = [] } = (await intentions.sources().catch(() => null)) ?? {};
      const rulesFor = (item, pid) => layeredRules({ household, personDefault: threads.reminderDefaultOf?.(pid) ?? null, item: item?.reminders ?? null, personItem: threads.reminderExtraOf?.(pid, item?.id) ?? null });
      // computed for THIS person only: an appointment for everyone is theirs too, a named one only if it names them —
      // and nobody else's layers are ever read
      for (const o of reminderOccurrences({ events, chores, people: [{ id: person }], now: at, tz, rulesFor, horizon })) {
        if (o.personId === person) lines.push({ at: o.at, text: tp('circle.bot.planned_reminder', { when: when(o.at), title: o.text, rule: describeRules([o.rule], tp) }) });
      }
    }
    for (const o of upcoming({ rows: book.rows().filter((r) => r.actsAs === person), now: at, tz, horizon })) {
      const what = tp(`circle.bot.planned_${String(o.label ?? 'row').replace(/-/g, '_')}`);
      lines.push({ at: o.at, text: tp(o.state === 'skipped' ? 'circle.bot.planned_skipped' : 'circle.bot.planned_row', { when: when(o.at), what }) });
    }
    lines.sort((a, b) => a.at - b.at);
    const out = [tp('circle.bot.planned_head'), ...(lines.length ? lines.map((l) => `• ${l.text}`) : [tp('circle.bot.planned_none')])];
    if (!remindersOn) out.push(tp('circle.bot.planned_reminders_off'));
    if (rows.find((r) => r.id === person)?.role === 'admin') out.push('', tp('circle.bot.planned_household', { rules: describeRules(household, tp) }));
    return { ok: true, message: out.join('\n') };
  }

  /** The household's reminder rules as they stand. */
  async function householdReminderRules() {
    const r = await callSkill('params', 'list-user-params', {}).catch(() => null);
    return reminderRulesFrom((r?.params ?? []).find((p) => p.key === REMINDER_RULES_KEY)?.value);
  }

  /**
   * `/herinneringen`: on or off; or WHEN, as the person's own default over the household's (`60`, `ook avond`, `geen`);
   * `huis` follows the household again. A word it does not know sets nothing.
   */
  async function remindersOp(person, args, tp) {
    const words = String(args?.rules ?? args?.mode ?? args?._match ?? '').trim();
    const sw = switchOf(words);
    if (sw) { threads.setReminders(person, sw === 'on'); return { ok: true, message: tp(`circle.bot.reminders_${sw}`) }; }
    const household = await householdReminderRules();
    if (/^(huis|house|standaard|default)$/i.test(words)) {
      threads.setReminderDefault(person, null);
      return { ok: true, message: tp('circle.bot.reminders_rules_household', { rules: describeRules(household, tp) }) };
    }
    const layer = reminderLayerFromWords(words);
    if (!layer) return { ok: false, error: { code: 'invalid-argument', message: tp('circle.bot.reminders_usage') } };
    threads.setReminderDefault(person, layer);
    // asking for reminders at a time is asking for reminders: a person who had them off gets them again
    if (layer.rules.length) threads.setReminders(person, true);
    const now = layeredRules({ household, personDefault: layer }).map((r) => r.rule);
    return { ok: true, message: tp('circle.bot.reminders_rules_set', { rules: describeRules(now, tp) }) };
  }

  /**
   * `remindMe`: the person's own reminders for ONE appointment or chore — found by its words among what THEY see (the
   * calendar and the lists, read as them), written on their thread row only. "gewoon" drops their own for it.
   */
  async function remindMeOp(person, args, ctx, tp) {
    const q = String(args?.item ?? '').trim().toLowerCase();
    const words = String(args?.rules ?? '').trim();
    const usual = /^(gewoon|normaal|usual|normal)$/i.test(words);
    const layer = usual ? null : reminderLayerFromWords(words);
    if (!q || (!usual && !layer)) return { ok: false, error: { code: 'invalid-argument', message: tp('circle.bot.remind_me_usage') } };
    const asThem = (a, o, x) => callSkill(a, o, x, { ...ctx, caller: person, threadId: person }).catch(() => null);
    const rows = (r) => (Array.isArray(r?.items) ? r.items : []);
    const seen = new Map();
    for (const e of rows(await asThem('calendar', 'listEvents', { days: 60 }))) if (e?.id) seen.set(e.id, e);
    for (const list of rows(await asThem('lists', 'listLists', {}))) {
      const name = list?.label ?? list?.text;
      if (!name) continue;
      for (const c of rows(await asThem('lists', 'listEntries', { list: name }))) if (c?.id && (c.dueAt || c.startsAt) && !c.done) seen.set(c.id, c);
    }
    const titleOf = (i) => String(i?.title ?? i?.label ?? i?.text ?? '');
    const hits = [...seen.values()].filter((i) => i.id === args?.item || titleOf(i).toLowerCase().includes(q));
    if (!hits.length) return { ok: false, error: { code: 'not-found', message: tp('circle.bot.remind_me_not_found', { item: args.item }) } };
    if (hits.length > 1) return { ok: true, message: tp('circle.bot.remind_me_which', { items: hits.map(titleOf).join(' · ') }) };
    const [hit] = hits;
    threads.setReminderExtra(person, hit.id, layer);
    if (!layer) return { ok: true, message: tp('circle.bot.remind_me_cleared', { item: titleOf(hit) }) };
    return { ok: true, message: tp(layer.mode === 'add' ? 'circle.bot.remind_me_added' : 'circle.bot.remind_me_set', { item: titleOf(hit), rules: describeRules(layer.rules, tp) }) };
  }

  /** The translator for a person: their fixed `/taal` language, else the door's. */
  function personT(threadId) {
    const lang = threads?.langOf?.(threadId) ?? null;
    return lang ? (k, p) => t(k, p, lang) : t;
  }

  async function appsOp(change) {
    const cat = admin.catalogue;
    if (!cat) return { ok: false, error: 'unwired' };
    const [action, name] = String(change ?? '').trim().split(/\s+/).filter(Boolean);
    const list = () => t('circle.bot.apps_list', { on: cat.apps().join(', '), available: cat.available().join(', ') });
    if (!action) return { ok: true, message: list() };
    if ((action !== 'on' && action !== 'off') || !name) return { ok: false, error: { code: 'invalid-argument', message: t('circle.bot.apps_usage') } };
    if (!cat.available().includes(name)) return { ok: false, error: { code: 'unknown-app', message: t('circle.bot.apps_unknown', { app: name }) } };
    const now = cat.apps();
    const next = action === 'on' ? [...new Set([...now, name])] : now.filter((a) => a !== name);
    if (!next.length) return { ok: false, error: { code: 'invalid-argument', message: t('circle.bot.apps_none_left') } };
    await cat.setApps(next);
    return { ok: true, message: list() };
  }

  /** The bot's settings (parameters of its device): who may give a chore to whom. The admin's; never the model's. */
  /** The export files on the box, newest first. */
  async function exportsOp() {
    if (!admin.exports) return { ok: false, error: 'unwired' };
    const names = await admin.exports.names();
    return { ok: true, message: names.length ? t('circle.bot.exports_list', { names: names.join('\n') }) : t('circle.bot.exports_none') };
  }

  /** One export now, onto the shelf: its name, and whether it is sealed. */
  async function exportNowOp() {
    if (!admin.exports || typeof admin.exports.writeNow !== 'function') return { ok: false, error: 'unwired' };
    const name = await admin.exports.writeNow();
    if (!name) return { ok: false, error: { code: 'failed', message: t('circle.bot.export_failed') } };
    const sealed = typeof admin.exports.read === 'function' ? isSealedExport(await admin.exports.read(name).catch(() => null)) : false;
    return { ok: true, message: t(sealed ? 'circle.bot.export_written_sealed' : 'circle.bot.export_written_plain', { name }) };
  }

  /** Close the key unlocked on the box (after an import, or a real attempt that failed). */
  async function lock() { if (typeof admin.lockKey === 'function') await admin.lockKey().catch(() => {}); }

  /** Read an export back (the admin's; asked first — `preview` answers the question with what the file holds). */
  async function importOp(name, { preview = false } = {}) {
    if (!admin.exports || typeof admin.importFile !== 'function') return { ok: false, error: 'unwired' };
    const file = String(name ?? '').trim();
    let data;
    try { data = await admin.exports.read(file); }
    catch { return { ok: false, error: { code: 'invalid-argument', message: t('circle.bot.import_no_file', { name: file }) } }; }
    // A sealed file opens only with the admin's key, unlocked ON THE BOX with the passphrase (never through a chat)
    if (isSealedExport(data)) {
      const secret = typeof admin.unlockedKey === 'function' ? await admin.unlockedKey() : null;
      if (!secret) return { ok: false, error: { code: 'locked', message: t('circle.bot.import_locked', { name: file }) } };
      try { data = openExport(data, secret); }
      catch {
        // a real attempt that failed closes the key too (a preview keeps it open: its question needs it)
        if (!preview) await lock();
        return { ok: false, error: { code: 'invalid-argument', message: t('circle.bot.import_not_this_key', { name: file }) } };
      }
    }
    const checked = checkExport(data);
    if (!checked.ok) { if (!preview) await lock(); return { ok: false, error: { code: 'invalid-argument', message: t('circle.bot.import_unreadable', { name: file }) } }; }
    const c = countExport(data);
    if (preview) return { ok: true, vars: c, message: t('circle.bot.import_confirm_counts', { name: file, ...c }) };
    // the unlocked key was for this import: it does not stay on the box, whatever the import did
    let r;
    try { r = await admin.importFile(data); } finally { await lock(); }
    if (!r?.ok) {
      // part-way: what was restored before it stopped is said too
      const partly = r?.done ? `\n${t('circle.bot.import_done', { ...r.done })}` : '';
      return { ok: false, error: { code: 'failed', message: t('circle.bot.import_unreadable', { name: file }) + partly } };
    }
    const missed = (r.notRestored ?? []).length;
    return { ok: true, message: t('circle.bot.import_done', { ...r.done }) + (missed ? `\n${t('circle.bot.import_missed', { count: missed })}` : '') };
  }

  async function settingsOp(change, person, caller, ctx) {
    const current = async () => {
      const r = await callSkill('params', 'list-user-params', {}).catch(() => null);
      const of = (key) => (r?.params ?? []).find((p) => p.key === key)?.value;
      return t('circle.bot.settings_list', { assign: assignPolicyFrom(of(ASSIGN_POLICY_KEY)), names: namesPolicyFrom(of(NAMES_KEY)), passed: passedPolicyFrom(of(PASSED_KEY)), days: passedDaysFrom(of(PASSED_DAYS_KEY)), cancel: cancelPolicyFrom(of(CANCEL_KEY)), reminders: remindersModeFrom(of(REMINDERS_KEY)), quiet: quietHoursFrom(of(QUIET_KEY)), lead: leadOf(reminderRulesFrom(of(REMINDER_RULES_KEY))), usage: usageVisibleFrom(of(USAGE_VISIBLE_KEY)), roles: rolesPresetFrom(of(ROLES_KEY)), app: inAppModeFrom(of(HOUSEHOLD_IN_APP_KEY)) });
    };
    const [what, value, ...more] = String(change ?? '').trim().split(/\s+/).filter(Boolean);
    if (!what) return { ok: true, message: await current() };
    const usage = { ok: false, error: { code: 'invalid-argument', message: t('circle.bot.settings_usage') } };
    // the write's own answer decides: a refused set is said, never answered with the list as it was
    const set = async (key, val) => {
      const r = await callSkill('params', 'set-param', { key, value: val }).catch(() => null);
      if (!r?.ok) return { ok: false, error: { code: 'not-saved', message: t('circle.bot.settings_failed') } };
      // a setting others follow (the Telegram menus follow the roles) is told; the roles' answer says the screens' part
      try { admin.onSettingChanged?.(key); } catch { /* the setting stands */ }
      const extra = key === ROLES_KEY ? `\n${personT(person)('circle.bot.roles_changed')}` : '';
      // saved: the menu as it now stands (the new value ticked), as the person's view paints it
      const menu = person ? await menuOp(person, caller, ctx) : null;
      if (!menu?.ok) return { ok: true, message: `${await current()}${extra}` };
      return { ...menu, message: `${personT(person)('circle.bot.settings_saved')}${extra}\n\n${menu.message}` };
    };
    if (what === 'days') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0) return usage;
      return set(PASSED_DAYS_KEY, n);
    }
    // the household's reminder rules: `lead 15` rewrites its short notice; `rules ochtend avond 15` (or `ook …`) the list
    const householdRules = async () => reminderRulesFrom((await callSkill('params', 'list-user-params', {}).catch(() => null))?.params?.find((p) => p.key === REMINDER_RULES_KEY)?.value);
    if (what === 'lead') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0 || n > 240) return usage;
      return set(REMINDER_RULES_KEY, reminderRulesValue(withLead(await householdRules(), n)));
    }
    if (what === 'rules') {
      const layer = reminderLayerFromWords([value, ...more].filter(Boolean).join(' '));
      if (!layer) return usage;
      const next = layer.mode === 'add' ? [...new Set([...(await householdRules()), ...layer.rules])] : layer.rules;
      return set(REMINDER_RULES_KEY, reminderRulesValue(next));
    }
    if (what === 'quiet') {
      if (!isQuietHours(value)) return usage;
      return set(QUIET_KEY, value);
    }
    const setting = { assign: [ASSIGN_POLICY_KEY, ASSIGN_POLICIES], names: [NAMES_KEY, NAMES_POLICIES], passed: [PASSED_KEY, PASSED_POLICIES], cancel: [CANCEL_KEY, CANCEL_POLICIES], reminders: [REMINDERS_KEY, REMINDERS_MODES], roles: [ROLES_KEY, ROLES_PRESETS], usage: [USAGE_VISIBLE_KEY, USAGE_VISIBILITY], app: [HOUSEHOLD_IN_APP_KEY, IN_APP_MODES] }[what];
    if (!setting || !setting[1].includes(value)) return usage;
    return set(setting[0], value);
  }


  /** `/role <who> <role>` (or the screen's two fields): a person's role on the bot — the same words a circle's roster uses. */
  async function roleOp(who, role) {
    const name = String(who ?? '').trim();
    if (!name || !BOT_ROLES.includes(role)) return { ok: false, error: { code: 'invalid-argument', message: t('circle.bot.role_usage') } };
    // under the flat preset a member and a coordinator are the same: two words, member and observer
    if (role === 'coordinator' && rolesPresetFrom(await userParam(ROLES_KEY)) === 'flat') {
      return { ok: false, error: { code: 'invalid-argument', message: t('circle.bot.role_flat_two_words') } };
    }
    if (typeof admin.setRole !== 'function') return { ok: false, error: 'unwired' };
    const row = await admin.setRole(name, role);
    if (!row) return { ok: false, error: t('circle.bot.role_nobody', { name }) };
    return { ok: true, message: t('circle.bot.role_set', { name: row.displayName ?? name, role }) };
  }



  /**
   * A person's week, asked AS them: the coming appointments, what is on the shopping list, and every open chore with who
   * holds it and its day — the lists are read through the gate as that person, so a chore's holder is worded as the
   * household's names setting lets them see ("jij", a name, or "opgepakt"). A long list shows its first entries and
   * how many more.
   */
  async function weekOverviewText(ctx, tp = t) {
    const pad = (n) => String(n).padStart(2, '0');
    // a chore's day, and its time when it has one (a due at the day's 00:00 is a day)
    const localDay = (iso) => {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
      const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return d.getHours() || d.getMinutes() ? `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}` : day;
    };
    const asThem = (a, o, x) => callSkill(a, o, x, ctx);
    const itemsOf = (r) => (Array.isArray(r?.items) ? r.items : []);
    const labelOf = (i) => i?.label ?? i?.text ?? i?.title ?? '';
    const max = WEEK_OVERVIEW_MAX_ITEMS;
    const more = (n) => (n > max ? [tp('circle.bot.overview_more', { n: n - max })] : []);
    const events = itemsOf(await asThem('calendar', 'listEvents', { days: 7 }).catch(() => null));
    // every list with open entries — the seeded ones are not kinds (Frits 2026-10-06: "the given lists are contingent"):
    // a list holding chores shows one per line (who, when), a list of plain lines on one line; the Agenda is the
    // appointments part above, never a list of lines
    const lists = itemsOf(await asThem('lists', 'listLists', {}).catch(() => null));
    const parts = [];
    for (const list of lists) {
      const name = list.label ?? list.text;
      if (!name) continue;
      const entries = itemsOf(await asThem('lists', 'listEntries', { list: name }).catch(() => null)).filter((c) => !c?.done);
      if (!entries.length || entries.every((c) => c?.type === 'calendar-event')) continue;
      parts.push({ name, entries: entries.filter((c) => c?.type !== 'calendar-event') });
    }
    const lines = [];
    if (events.length) {
      lines.push(tp('circle.bot.overview_events'));
      for (const e of events.slice(0, max)) lines.push(`• ${labelOf(e)}`);
      lines.push(...more(events.length));
    }
    for (const { name, entries } of parts) {
      if (entries.some((c) => c?.state)) {
        lines.push(tp('circle.bot.overview_list', { list: name, items: '' }).trimEnd());
        // a chore's date on the household's clock (the box runs in its zone): a local midnight is the day before in UTC
        for (const c of entries.slice(0, max)) { const due = c.dueAt; lines.push(`• ${labelOf(c)}${due ? ` (${localDay(due)})` : ''}`); }
        lines.push(...more(entries.length));
      } else {
        const items = entries.slice(0, max).map(labelOf).filter(Boolean).join(', ');
        lines.push([tp('circle.bot.overview_list', { list: name, items }), ...more(entries.length)].join(' '));
      }
    }
    return [tp('circle.bot.overview_head'), ...(lines.length ? lines : [tp('circle.bot.overview_none')])].join('\n');
  }

  /** A number in the person's language ("3.000" in Dutch, "3,000" in English). */
  function countIn(lang) { return (n) => new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'nl-NL').format(n); }
  async function userParam(key) { return ((await callSkill('params', 'list-user-params', {}).catch(() => null))?.params ?? []).find((p) => p.key === key)?.value; }

  /** The household's model use this month, against the monthly limit (counts only). */
  async function householdUsageLine(tp, lang = null) {
    const c = threads.householdUsage(now());
    const limit = monthlyTokenLimitFrom(await userParam(MONTHLY_TOKEN_LIMIT_KEY));
    const fmt = countIn(lang);
    return tp('circle.bot.usage_household', { calls: c.calls, tokens: fmt(c.prompt), cached: cachedShare(c), limit: fmt(limit), share: Math.round((c.prompt / limit) * 100) });
  }

  /**
   * `/verbruik`: what the model cost this month for this person — their own count, always; the household's total for the
   * admin, and for everyone when the admin set it so (`/huishouden usage members`). Never another person's count.
   */
  async function usageOp(person) {
    if (!person || typeof threads?.usageOf !== 'function') return { ok: false, error: 'unwired' };
    const tp = personT(person);
    const lang = threads.langOf?.(person) ?? null;
    const own = threads.usageOf(person, now());
    const lines = [tp('circle.bot.usage_you', { calls: own.calls, tokens: countIn(lang)(own.prompt), cached: cachedShare(own) })];
    const row = typeof admin.users === 'function' ? ((await admin.users()) ?? []).find((u) => u.id === person) : null;
    if (row?.role === 'admin' || usageVisibleFrom(await userParam(USAGE_VISIBLE_KEY)) === 'members') lines.push(await householdUsageLine(tp, lang));
    return { ok: true, message: lines.join('\n') };
  }

  async function statusText() {
    const s = typeof admin.status === 'function' ? ((await admin.status()) ?? {}) : {};
    const apps = admin.catalogue ? admin.catalogue.apps().join(', ') : '';
    const status = t('circle.bot.status', {
      apps, model: s.model ?? '—', door: s.door ?? '—', turns: s.turns ?? 'off',
      memory: s.memory ?? '—', users: s.users ?? '—',
    });
    const month = typeof threads?.householdUsage === 'function' ? `\n${await householdUsageLine(t)}` : '';
    // people the bot cannot write to first (no private chat): the admin hears how many
    return Number(s.unreachable) > 0 ? `${status}${month}\n${t('circle.bot.unreachable', { count: s.unreachable })}` : `${status}${month}`;
  }

  async function cohortOp(spec) {
    if (!admin.admission) return { ok: false, error: 'unwired' };
    const [p, d, w] = String(spec ?? '').trim().split(/\s+/);
    const people = Number(p); const days = Number(d);
    const role = roleWord(w);
    if (!(people >= 1) || !(days > 0) || !role) return { ok: false, error: { code: 'invalid-argument', message: t('circle.bot.cohort_usage') } };
    const c = await admin.admission.openCohort({ ceiling: people, days, ...(role === 'none' ? {} : { role }) });
    return { ok: true, message: t('circle.bot.cohort_open', { people: c.ceiling, until: new Date(c.expiresAt).toISOString().slice(0, 10) }) };
  }

  /** A role word an admin types (`lid` is a member): one of the bot's roles, or null. */
  function roleWord(w) { const v = String(w ?? '').trim().toLowerCase(); if (!v) return 'none'; if (v === 'lid') return 'member'; return BOT_ROLES.includes(v) ? v : null; }

  async function inviteOp(word) {
    if (!admin.admission) return { ok: false, error: 'unwired' };
    // the role the person gets is inside the code (a changed word makes it invalid)
    const role = roleWord(word);
    if (!role) return { ok: false, error: { code: 'invalid-argument', message: t('circle.bot.invite_usage') } };
    const code = await admin.admission.code(role === 'none' ? {} : { role });
    if (!code) return { ok: false, error: { code: 'no-cohort', message: t('circle.bot.cohort_none') } };
    // On a door with a link form (Telegram's `t.me/<bot>?start=<code>`), the link too: tapping it sends the code.
    const link = typeof admin.inviteLink === 'function' ? admin.inviteLink(code) : null;
    return { ok: true, message: [t('circle.bot.invite_code', { code }), ...(link ? [t('circle.bot.invite_link', { link })] : [])].join('\n') };
  }

  async function rotateOp() {
    if (!admin.admission) return { ok: false, error: 'unwired' };
    await admin.admission.rotate();
    return { ok: true, message: t('circle.bot.cohort_closed') };
  }

  async function revokeOp(who) {
    if (typeof admin.revoke !== 'function') return { ok: false, error: 'unwired' };
    const row = await admin.revoke(who);
    if (!row) return { ok: false, error: { code: 'unknown-user', message: t('circle.bot.revoke_unknown', { who: String(who ?? '') }) } };
    // a person who is no longer admitted keeps no screen
    const dropped = typeof admin.screens?.dropAll === 'function' ? await admin.screens.dropAll(row.id) : 0;
    // …and is no longer in the household's circle on their own app (by the key they linked)
    const evicted = linkedKeyOf(row) && typeof admin.householdInApp?.evict === 'function'
      ? ((await admin.householdInApp.evict(linkedKeyOf(row)).catch(() => null))?.removed ?? 0) : 0;
    const said = t('circle.bot.revoked', { who: row.displayName ?? row.id });
    const parts = [said, ...(dropped ? [t('circle.bot.revoked_screens', { n: dropped })] : []), ...(evicted ? [t('circle.bot.revoked_circle')] : [])];
    return { ok: true, message: parts.join(' ') };
  }


  /**
   * `/instellingen`: one row per settings op this person's role reaches — the gate decides, as for the op itself — with
   * its value now and a button per value that calls the op. Painted per the person's view: buttons in the chat
   * (`inline`), a pointer to their connected screen (`screen`), or words (`chat`; the inbox door is always chat).
   */
  async function menuOp(person, caller, ctx = {}) {
    if (!person) return { ok: false, error: 'no-thread' };
    const tp = personT(person);
    const reaches = async (opId) => !caller || typeof refusal !== 'function' || !(await refusal(opId, caller, levelOf(opId)));
    const row = typeof admin.users === 'function' ? ((await admin.users()) ?? []).find((u) => u.id === person) : null;
    // asked from a screen: the screen paints the buttons, whatever the person's chat view is
    const view = ctx?.via === 'screen' ? 'inline' : (row && row.channel !== 'telegram' ? 'chat' : threads.viewOf(person));
    if (view === 'screen') {
      const mine = typeof admin.screens?.list === 'function' ? await admin.screens.list(person) : [];
      return { ok: true, message: tp(mine.length ? 'circle.bot.menu_on_screen' : 'circle.bot.menu_offer_screen') };
    }
    const lines = [tp('circle.bot.menu_head')];
    const buttons = [];
    const valueLabel = (v) => (isQuietHours(v) ? v : tp(`circle.bot.value_${v}`));
    const settingsOps = assistantManifest.operations.filter((o) => o.group === 'settings' && o.id !== 'assistant-settings');
    for (const o of settingsOps) {
      const spec = PERSON_SETTINGS[o.id];
      if (!spec || !(await reaches(o.id))) continue;
      const now = spec.now(person);
      lines.push(tp('circle.bot.menu_row', { label: tp(`circle.bot.menu_${o.id}`), value: valueLabel(now) }));
      for (const v of spec.values) buttons.push({ label: `${tp(`circle.bot.menu_${o.id}`)}: ${valueLabel(v)}${v === now ? ' ✓' : ''}`, slash: `${slashOf(o.id)} ${v}` });
    }
    if (await reaches('assistant-settings')) {
      const r = await callSkill('params', 'list-user-params', {}).catch(() => null);
      const of = (key) => (r?.params ?? []).find((p) => p.key === key)?.value;
      lines.push('', tp('circle.bot.menu_household'));
      for (const [key, paramKey, values, from] of HOUSEHOLD_SETTINGS) {
        const now = from(of(paramKey));
        lines.push(tp('circle.bot.menu_row', { label: tp(`circle.bot.menu_${key}`), value: valueLabel(now) }));
        for (const v of values) buttons.push({ label: `${tp(`circle.bot.menu_${key}`)}: ${valueLabel(v)}${v === now ? ' ✓' : ''}`, slash: `${slashOf('assistant-settings')} ${key} ${v}` });
      }
    }
    if (await reaches('assistant-settings')) {
      // the minutes before an appointment for the short-notice reminder (a number, so its own row)
      const r = await callSkill('params', 'list-user-params', {}).catch(() => null);
      const now = leadOf(reminderRulesFrom((r?.params ?? []).find((p) => p.key === REMINDER_RULES_KEY)?.value));
      const leadLabel = (n) => (n === 0 ? tp('circle.bot.value_lead_off') : tp('circle.bot.value_lead_min', { n }));
      lines.push(tp('circle.bot.menu_row', { label: tp('circle.bot.menu_lead'), value: leadLabel(now) }));
      for (const n of REMINDER_LEAD_CHOICES) buttons.push({ label: `${tp('circle.bot.menu_lead')}: ${leadLabel(n)}${n === now ? ' ✓' : ''}`, slash: `${slashOf('assistant-settings')} lead ${n}` });
    }
    if (view === 'chat') return { ok: true, message: [...lines, '', tp('circle.bot.menu_in_words')].join('\n') };
    return { ok: true, message: lines.join('\n'), quickReplies: buttons };
  }

  /** One person setting as it stands, with a button per value (the bare `/herinneringen`, `/taal`, …). */
  function oneSettingOp(person, opId) {
    const tp = personT(person);
    const spec = PERSON_SETTINGS[opId];
    const now = spec.now(person);
    const label = tp(`circle.bot.menu_${opId}`);
    return {
      ok: true,
      message: tp('circle.bot.menu_row', { label, value: tp(`circle.bot.value_${now}`) }),
      quickReplies: spec.values.map((v) => ({ label: `${tp(`circle.bot.value_${v}`)}${v === now ? ' ✓' : ''}`, slash: `${slashOf(opId)} ${v}` })),
    };
  }

  /** `/weergave knoppen|scherm|chat` (the words of either language, or the values themselves). */
  function viewOp(person, word) {
    if (!person) return { ok: false, error: 'no-thread' };
    const tp = personT(person);
    const w = String(word ?? '').trim().toLowerCase();
    // without a word: how it stands, a button per choice (as the other switches answer)
    if (!w) return oneSettingOp(person, 'assistant-view');
    const view = SURFACE_PREFS.find((v) => v === w || ['nl', 'en'].some((lng) => String(t(`circle.bot.view_word_${v}`, undefined, lng)).toLowerCase() === w));
    if (!view) return { ok: false, error: { code: 'invalid-argument', message: tp('circle.bot.view_usage') } };
    threads.setView(person, view);
    return { ok: true, message: tp('circle.bot.view_set', { view: tp(`circle.bot.view_word_${view}`) }) };
  }

  /**
   * `/scherm`: a screen for this person. A member gets the one-time link; the admin, by default, the paste route (the
   * screen makes its own code and they paste it back — no secret in the chat); `/scherm link` gives anyone the link.
   */
  async function screenOp(person, how) {
    if (!person || !admin.screens) return { ok: false, error: 'unwired' };
    const tp = personT(person);
    const row = typeof admin.users === 'function' ? ((await admin.users()) ?? []).find((u) => u.id === person) : null;
    const wantsLink = /^\s*link\s*$/i.test(String(how ?? ''));
    if (row?.role === 'admin' && !wantsLink && typeof admin.screens.startPaste === 'function') {
      const r = await admin.screens.startPaste(person, (link) => tp('circle.bot.screen_paste_link', { link }));
      if (!r.ok) return { ok: false, error: { code: r.reason, message: tp(r.reason === 'no-app-url' ? 'circle.bot.screen_no_app' : 'circle.bot.screen_not_reachable') } };
      return { ok: true, message: tp('circle.bot.screen_sent_privately') };
    }
    // the link goes to the person's PRIVATE door only; the chat it was asked in (maybe a group) hears where it went
    const r = await admin.screens.start(person, (link, minutes) => tp('circle.bot.screen_link', { link, minutes }), tp('circle.bot.screen_link_remembered'));
    if (!r.ok) {
      const key = r.reason === 'no-app-url' ? 'circle.bot.screen_no_app' : 'circle.bot.screen_not_reachable';
      return { ok: false, error: { code: r.reason, message: tp(key) } };
    }
    return { ok: true, message: tp('circle.bot.screen_sent_privately') };
  }

  /**
   * `/koppelen <code>` (or `/koppelen geen`): the answer to a screen's offer — the code the person picked. It counts only from the person's PRIVATE door: on Telegram the
   * chat whose id is their own (a group's is not), the inbox always.
   */
  async function screenConfirmOp(person, word, ctx) {
    if (!person || !admin.screens?.confirm) return { ok: false, error: 'unwired' };
    const tp = personT(person);
    // the code the person picked (or typed), or "none of these"; anything else drops the offer too
    const answer = String(word ?? '').trim();
    if (!answer) return { ok: false, error: { code: 'invalid-argument', message: tp('circle.bot.screen_confirm_usage') } };
    const row = typeof admin.users === 'function' ? ((await admin.users()) ?? []).find((u) => u.id === person) : null;
    const isPrivate = Boolean(row) && (row.channel !== 'telegram' || isOwnTelegramChat(ctx?.chatId, row.uid));
    const r = await admin.screens.confirm(person, answer, { isPrivate });
    if (r.ok && r.declined) return { ok: true, message: tp('circle.bot.screen_declined') };
    // connected: and where the screen is from now on (the page itself became it; this link brings it back)
    if (r.ok) return { ok: true, message: r.reopen ? tp('circle.bot.screen_confirmed_open', { link: r.reopen }) : tp('circle.bot.screen_confirmed') };
    const key = { 'not-private': 'screen_confirm_not_private', expired: 'screen_confirm_expired', 'nothing-pending': 'screen_confirm_nothing' }[r.reason] ?? 'screen_confirm_failed';
    return { ok: false, error: { code: r.reason ?? 'failed', message: tp(`circle.bot.${key}`) } };
  }

  /**
   * A screen's step-up request: what it will do, in the book's words, then held and asked in the person's private chat.
   * The person a revoke or a role change names is looked up FIRST — unknown → refused, nothing asked — and the held
   * request takes their id, so the question and the act cannot differ. What the screen typed is one line, capped.
   */
  async function holdForYes(person, app, op, args, ctx) {
    const tp = personT(person);
    if (!person || !admin.stepUp || !ctx?.viewPubKey) return { ok: false, error: { code: 'step-up-unwired', message: tp('circle.bot.stepup_unwired') } };
    const plan = await stepUpPlan(app, op, args, tp);
    if (!plan.ok) return plan;
    const what = said(tp, `circle.bot.stepup_what.${op}`, { arg: plan.shown }) ?? tp('circle.bot.stepup_what_op', { op: slashOf(op) ?? op, arg: plan.shown });
    // the request's id is in the words too: a door with no buttons (the inbox) answers by typing it
    const screen = screenLabel(ctx.screenLabel) ?? tp('circle.connectScreen.label');
    const extra = plan.note ? ` ${plan.note}` : '';
    const question = (id) => ({ text: `${tp('circle.bot.stepup_question', { screen, what, id })}${extra}`, buttons: [{ id: `/bevestig ja ${id}`, label: tp('circle.bot.stepup_yes') }, { id: `/bevestig nee ${id}`, label: tp('circle.bot.stepup_no') }] });
    const r = await admin.stepUp.hold(person, { app, op, args: plan.args, viewPubKey: ctx.viewPubKey }, question);
    if (!r.ok) return { ok: false, error: { code: r.reason, message: tp('circle.bot.screen_not_reachable') } };
    return { ok: true, pending: true, message: tp('circle.bot.stepup_asked') };
  }

  /** The args a held request runs with, and how the question shows them: `{ok, args, shown}` or a refusal. */
  async function stepUpPlan(app, op, args, tp) {
    if (app === 'assistant' && (op === 'assistant-export-key-set' || op === 'assistant-export-key-unlock')) return exportKeyPlan(op, args, tp);
    const typed = screenLabel(args?.who ?? args?._match) ?? '—';
    if (app !== 'assistant' || (op !== 'assistant-revoke' && op !== 'assistant-role')) return { ok: true, args, shown: typed };
    const rows = typeof admin.users === 'function' ? ((await admin.users()) ?? []) : [];
    const nameOf = async (row) => ((await namesHidden()) ? row.id : (row.displayName ?? row.id));
    if (op === 'assistant-revoke') {
      const row = personNamed(rows, args?.who ?? args?._match);
      if (!row) return { ok: false, error: { code: 'unknown-user', message: tp('circle.bot.revoke_unknown', { who: typed }) } };
      return { ok: true, args: { who: row.id }, shown: await nameOf(row) };
    }
    const role = args?.role;
    if (!String(args?.who ?? '').trim() || !BOT_ROLES.includes(role)) return { ok: false, error: { code: 'invalid-argument', message: tp('circle.bot.role_usage') } };
    const row = personNamed(rows, args.who);
    if (!row || row.role === 'admin') return { ok: false, error: { code: 'unknown-user', message: tp('circle.bot.role_nobody', { name: typed }) } };
    return { ok: true, args: { who: row.id, role }, shown: `${await nameOf(row)} → ${role}` };
  }

  /**
   * `/bevestig ja|nee <id>`: the answer to the screen's request with that id. It counts only from the person's PRIVATE
   * door (on Telegram the chat whose id is their own; never a group, never a screen). A yes runs that request as their
   * typed line — the host gate asks again — and the screen hears the outcome; an answer naming a replaced request runs
   * nothing.
   */
  async function approveOp(person, word, ctx) {
    if (!person || !admin.stepUp) return { ok: false, error: 'unwired' };
    const tp = personT(person);
    const [answer, id] = String(word ?? '').trim().split(/\s+/);
    const yes = switchOf(answer);
    if (!yes) return { ok: false, error: { code: 'invalid-argument', message: tp('circle.bot.stepup_usage') } };
    const row = typeof admin.users === 'function' ? ((await admin.users()) ?? []).find((u) => u.id === person) : null;
    const isPrivate = ctx?.via !== 'screen' && Boolean(row) && (row.channel !== 'telegram' || isOwnTelegramChat(ctx?.chatId, row.uid));
    const r = await admin.stepUp.answer(person, yes === 'on', id, { isPrivate });
    if (!r.ok) {
      const key = { 'not-private': 'not_private', expired: 'expired', replaced: 'replaced', 'no-id': 'usage' }[r.reason] ?? 'nothing';
      return { ok: false, error: { code: r.reason, message: tp(`circle.bot.stepup_${key}`) } };
    }
    if (r.declined) return { ok: true, message: tp('circle.bot.stepup_declined') };
    let out;
    try { out = await door(r.req.app, r.req.op, r.req.args, { caller: person, threadId: person, steppedUp: true, ...(ctx?.chatId != null ? { chatId: ctx.chatId } : {}) }); }
    finally { r.req.args = null; }   // a held secret (a passphrase) does not outlive its yes
    await admin.stepUp.done(r.req, out?.ok !== false);
    return out;
  }

  /**
   * The export key's set or unlock, checked BEFORE the question: wired, a passphrase long enough, a key to unlock. The
   * passphrase is never shown (`—`); when a key is set already, the question says what replacing it means.
   */
  async function exportKeyPlan(op, args, tp) {
    const key = admin.exportKey;
    if (!key) return { ok: false, error: { code: 'unwired', message: tp('circle.bot.stepup_unwired') } };
    const pass = args?.passphrase;
    if (typeof pass !== 'string' || pass.length < MIN_PASSPHRASE) return { ok: false, error: { code: 'too-short', message: tp('circle.bot.export_key_too_short', { n: MIN_PASSPHRASE }) } };
    if (op === 'assistant-export-key-set' && args?.passphraseAgain !== pass) return { ok: false, error: { code: 'mismatch', message: tp('circle.bot.export_key_mismatch') } };
    if (op === 'assistant-export-key-unlock' && !key.exists()) return { ok: false, error: { code: 'no-key', message: tp('circle.bot.export_key_none') } };
    const note = op === 'assistant-export-key-set' && key.exists() ? tp('circle.bot.stepup_export_key_replaces') : null;
    return { ok: true, args: { passphrase: pass }, shown: '—', ...(note ? { note } : {}) };
  }

  /** The export key's set or unlock, after the yes — the box's own core; the answer names the act, never the secret. */
  async function exportKeyOp(op, passphrase, tp) {
    const key = admin.exportKey;
    if (!key) return { ok: false, error: 'unwired' };
    if (op === 'assistant-export-key-set') {
      const r = await key.set(passphrase);
      if (!r.ok) return { ok: false, error: { code: r.reason, message: tp('circle.bot.export_key_too_short', { n: MIN_PASSPHRASE }) } };
      return { ok: true, message: tp(r.replaced ? 'circle.bot.export_key_replaced' : 'circle.bot.export_key_set') };
    }
    const r = await key.unlock(passphrase);
    if (!r.ok) return { ok: false, error: { code: r.reason, message: tp(r.reason === 'wrong-passphrase' ? 'circle.bot.export_key_wrong' : 'circle.bot.export_key_none') } };
    return { ok: true, message: tp('circle.bot.export_key_unlocked') };
  }

  /** Under `assistant.names: none` no name leaves the bot — not even to the admin's door. */
  async function namesHidden() {
    const r = await callSkill('params', 'list-user-params', {}).catch(() => null);
    return namesPolicyFrom((r?.params ?? []).find((p) => p.key === NAMES_KEY)?.value) === 'none';
  }

  /** A locale line, or null when the key has no words (it comes back as the key). */
  function said(tr, key, params) {
    const out = tr(key, params);
    return typeof out === 'string' && out && !out.startsWith(key) ? out : null;
  }

  /** Is this turn from the person's PRIVATE door (on Telegram the chat whose id is their own; the inbox always)? */
  async function fromPrivateDoor(person, ctx) {
    const row = typeof admin.users === 'function' ? ((await admin.users()) ?? []).find((u) => u.id === person) : null;
    return ctx?.via !== 'screen' && Boolean(row) && (row.channel !== 'telegram' || isOwnTelegramChat(ctx?.chatId, row.uid));
  }

  /**
   * `/koppel` — a person's Basis identity linked to their row. Alone: the link their app opens (to their private door).
   * With the app's offer (pasted in their private chat): checked, then the question that says what linking means.
   */
  async function linkOp(person, offer, ctx) {
    const link = admin.identityLink;
    if (!person || !link) return { ok: false, error: 'unwired' };
    const tp = personT(person);
    if (!String(offer ?? '').trim()) {
      const r = await link.start(person, (url) => tp('circle.bot.link_open_app', { link: url }));
      return r?.ok ? { ok: true, message: tp('circle.bot.screen_sent_privately') } : { ok: false, error: { code: r?.reason ?? 'failed', message: tp('circle.bot.screen_no_app') } };
    }
    if (!(await fromPrivateDoor(person, ctx))) return { ok: false, error: { code: 'not-private', message: tp('circle.bot.link_not_private') } };
    const question = (codes) => ({
      text: tp('circle.bot.link_question'),
      buttons: [...codes.map((c) => ({ id: `/koppel-code ${c}`, label: c })), { id: '/koppel-code geen', label: tp('circle.bot.screen_confirm_none') }],
    });
    const r = await link.pasted(person, offer, question);
    if (r.ok && r.already) return { ok: true, message: tp('circle.bot.link_already') };
    if (r.ok) return { ok: true, message: tp('circle.bot.link_asked') };
    const key = { 'another-bot': 'link_another_bot', 'key-on-another-row': 'link_key_taken', 'row-has-a-key': 'link_row_has_key' }[r.reason] ?? 'link_not_an_offer';
    return { ok: false, error: { code: r.reason, message: tp(`circle.bot.${key}`) } };
  }

  /** `/koppel-code <code>` — from the private door only. */
  async function linkConfirmOp(person, answer, ctx) {
    const link = admin.identityLink;
    if (!person || !link) return { ok: false, error: 'unwired' };
    const tp = personT(person);
    const r = await link.confirm(person, answer, { isPrivate: await fromPrivateDoor(person, ctx) });
    if (r.ok && r.linked) {
      // the household in their own app too? Asked only where the admin said so, and only here (privately, just linked)
      if (!admin.householdInApp || inAppModeFrom(await userParam(HOUSEHOLD_IN_APP_KEY)) !== 'on') return { ok: true, message: tp('circle.bot.link_done') };
      return {
        ok: true, message: `${tp('circle.bot.link_done')}\n\n${tp('circle.bot.inapp_question')}`,
        quickReplies: [{ label: tp('circle.bot.stepup_yes'), slash: '/inapp ja' }, { label: tp('circle.bot.stepup_no'), slash: '/inapp nee' }],
      };
    }
    if (r.ok && r.declined) return { ok: true, message: tp('circle.bot.link_declined') };
    const key = { 'not-private': 'link_not_private', expired: 'screen_confirm_expired', 'nothing-pending': 'link_nothing' }[r.reason] ?? 'link_failed';
    return { ok: false, error: { code: r.reason ?? 'failed', message: tp(`circle.bot.${key}`) } };
  }

  /**
   * `/inapp ja|nee` — the household in the person's own app: an invite into the household's circle, bound to the key
   * their `/koppel` linked (only that key redeems it, once, within a day), sent here, privately. Only where the admin
   * turned it on, only from the private door, only once linked.
   */
  async function inAppOp(person, answer, ctx) {
    const inApp = admin.householdInApp;
    if (!person || !inApp) return { ok: false, error: 'unwired' };
    const tp = personT(person);
    if (inAppModeFrom(await userParam(HOUSEHOLD_IN_APP_KEY)) !== 'on') return { ok: false, error: { code: 'off', message: tp('circle.bot.inapp_off') } };
    if (!(await fromPrivateDoor(person, ctx))) return { ok: false, error: { code: 'not-private', message: tp('circle.bot.link_not_private') } };
    const yes = switchOf(String(answer ?? '').trim().toLowerCase());
    if (!yes) return { ok: false, error: { code: 'invalid-argument', message: tp('circle.bot.inapp_usage') } };
    if (yes === 'off') return { ok: true, message: tp('circle.bot.inapp_declined') };
    const row = typeof admin.users === 'function' ? ((await admin.users()) ?? []).find((u) => u.id === person) : null;
    const key = linkedKeyOf(row);
    if (!key) return { ok: false, error: { code: 'not-linked', message: tp('circle.bot.inapp_link_first') } };
    const r = await inApp.inviteFor(key).catch((e) => ({ ok: false, reason: e?.message ?? 'failed' }));
    if (!r?.ok || !r.uri) return { ok: false, error: { code: r?.reason ?? 'failed', message: tp('circle.bot.inapp_failed') } };
    return { ok: true, message: r.link ? tp('circle.bot.inapp_invite_link', { link: r.link, invite: r.uri }) : tp('circle.bot.inapp_invite', { invite: r.uri }) };
  }

  /** `/ontkoppel` — from the private door only: the key goes, and its screen grants. */
  async function unlinkOp(person, ctx) {
    const link = admin.identityLink;
    if (!person || !link) return { ok: false, error: 'unwired' };
    const tp = personT(person);
    const r = await link.unlink(person, { isPrivate: await fromPrivateDoor(person, ctx) });
    if (r.ok) return { ok: true, message: tp('circle.bot.unlink_done') };
    return { ok: false, error: { code: r.reason, message: tp(r.reason === 'not-private' ? 'circle.bot.link_not_private' : 'circle.bot.unlink_nothing') } };
  }

  /**
   * `/kring <invite>` · `/kring ja|nee <id>` · `/kring los <naam>` — the bot's circles, from the admin's private chat. The
   * invite is checked, then asked about there: the circle's name, its rules, and that the bot keeps its data on this box.
   */
  async function circleOp(person, spec, ctx) {
    const circles = admin.circles;
    if (!person || !circles) return { ok: false, error: 'unwired' };
    const tp = personT(person);
    const isPrivate = await fromPrivateDoor(person, ctx);
    const words = String(spec ?? '').trim().split(/\s+/).filter(Boolean);
    const first = String(words[0] ?? '').toLowerCase();
    if (!words.length) return { ok: false, error: { code: 'invalid-argument', message: tp('circle.bot.kring_usage') } };
    if (first === 'los' || first === 'leave') {
      const r = await circles.leaveNamed(words.slice(1).join(' '), { isPrivate });
      if (r.ok) return { ok: true, message: tp('circle.bot.kring_left', { name: r.name }) };
      const key = { 'not-private': 'kring_not_private', 'unknown-circle': 'kring_unknown' }[r.reason] ?? 'kring_leave_failed';
      return { ok: false, error: { code: r.reason, message: tp(`circle.bot.${key}`, { name: words.slice(1).join(' ') }) } };
    }
    const yes = switchOf(first);
    if (yes && words.length <= 2) {
      const r = await circles.answer(person, yes === 'on', words[1], { isPrivate });
      if (r.ok && r.joined) return { ok: true, message: tp('circle.bot.kring_joined', { name: r.name }) };
      if (r.ok && r.declined) return { ok: true, message: tp('circle.bot.kring_declined', { name: r.name }) };
      const key = { 'not-private': 'kring_not_private', expired: 'screen_confirm_expired', 'nothing-pending': 'kring_nothing', replaced: 'stepup_replaced', 'admin-unreachable': 'kring_admin_offline' }[r.reason] ?? 'kring_join_failed';
      return { ok: false, error: { code: r.reason, message: tp(`circle.bot.${key}`, { name: r.name ?? '' }) } };
    }
    const question = ({ name, rules, id, handle }) => ({
      text: tp('circle.bot.kring_question', { name, rules: rules || tp('circle.bot.kring_no_rules'), id, handle }),
      buttons: [{ id: `/kring ja ${id}`, label: tp('circle.bot.stepup_yes') }, { id: `/kring nee ${id}`, label: tp('circle.bot.stepup_no') }],
    });
    const r = await circles.offered(person, words.join(' '), question, { isPrivate });
    if (r.ok && r.already) return { ok: true, message: tp('circle.bot.kring_already', { name: r.name ?? '' }) };
    if (r.ok) return { ok: true, message: tp('circle.bot.kring_asked') };
    const key = { 'not-private': 'kring_not_private', 'not-an-invite': 'kring_not_an_invite' }[r.reason] ?? 'screen_not_reachable';
    return { ok: false, error: { code: r.reason, message: tp(`circle.bot.${key}`) } };
  }

  /** `/kringen` — the circles the bot joined. */
  async function circlesOp(person) {
    const circles = admin.circles;
    if (!circles) return { ok: false, error: 'unwired' };
    const tp = personT(person);
    const list = await circles.list();
    if (!list.length) return { ok: true, message: tp('circle.bot.kringen_none') };
    return { ok: true, message: tp('circle.bot.kringen_list', { list: list.map((c) => `• ${c.name}`).join('\n') }) };
  }

  /** `/koppel-scherm <code>`: a screen's own connect code, pasted; the same question follows. */
  async function screenPasteOp(person, text) {
    if (!person || !admin.screens?.pasted) return { ok: false, error: 'unwired' };
    const tp = personT(person);
    const offer = parsePairingOffer(String(text ?? '').trim());
    if (!offer.ok) return { ok: false, error: { code: offer.reason, message: tp('circle.bot.screen_paste_usage') } };
    const r = await admin.screens.pasted(person, { viewPubKey: offer.viewPubKey, nonce: offer.nonce, label: offer.label });
    if (!r.ok) return { ok: false, error: { code: r.reason, message: tp('circle.bot.screen_confirm_failed') } };
    return { ok: true, message: tp('circle.bot.screen_paste_asked') };
  }

  /** `/schermen` (the person's screens) · `/schermen los <n>` (drop one). */
  async function screensOp(person, change) {
    if (!person || !admin.screens) return { ok: false, error: 'unwired' };
    const tp = personT(person);
    const m = /^\s*(?:los|drop|remove)\s+(\d+)\s*$/i.exec(String(change ?? ''));
    if (m) {
      const r = await admin.screens.drop(person, Number(m[1]));
      return r.ok ? { ok: true, message: tp('circle.bot.screen_dropped', { i: m[1] }) }
        : { ok: false, error: { code: r.reason ?? 'no-such-screen', message: tp('circle.bot.screen_no_such', { i: m[1] }) } };
    }
    const list = await admin.screens.list(person);
    if (!list.length) return { ok: true, message: tp('circle.bot.screens_none') };
    const rows = list.map((g, i) => tp('circle.bot.screens_row', { i: i + 1, label: g.label ?? 'scherm', n: (g.ops ?? []).length }));
    const reopen = typeof admin.screens.reopenLink === 'function' ? admin.screens.reopenLink() : null;
    return { ok: true, message: [tp('circle.bot.screens_list', { list: rows.join('\n') }), ...(reopen ? [tp('circle.bot.screens_open', { link: reopen })] : [])].join('\n') };
  }

  /** The bot's people as rows, under the names ceiling, for the person who asks (the one read; `botPeople.js`). */
  async function peopleFor(caller) {
    const rows = typeof admin.users === 'function' ? ((await admin.users()) ?? []) : [];
    const r = await callSkill('params', 'list-user-params', {}).catch(() => null);
    return peopleRows({ rows, setting: (r?.params ?? []).find((p) => p.key === NAMES_KEY)?.value, callerId: caller ?? null });
  }

  /**
   * `/wie` — who is in the household, for anyone in it: the people by NAME as the names setting lets the asker see them
   * (`peopleRows`, the chores' rule), with their role word; the asker as "jij". Never an id (a person without a name the
   * asker may read is left out), never whether someone linked an app — that is the admin's `/users`.
   */
  async function peopleOp(person) {
    if (!person) return { ok: false, error: 'no-thread' };
    const tp = personT(person);
    const preset = rolesPresetFrom(await userParam(ROLES_KEY));
    const rows = typeof admin.users === 'function' ? ((await admin.users()) ?? []) : [];
    const me = rows.find((r) => r.id === person) ?? null;
    const word = (role) => roleWordFor(role, preset);
    const lines = [`• ${tp('circle.bot.people_you')}${me?.role ? ` — ${word(me.role)}` : ''}`];
    for (const it of await peopleFor(person)) {
      const row = rows.find((r) => r.id === it.id);
      if (it.id === person || row?.hidden || !row?.displayName || it.label !== row.displayName) continue;
      lines.push(`• ${it.label} — ${word(it.role)}`);
    }
    return { ok: true, message: [tp('circle.bot.people_head'), ...lines].join('\n') };
  }

  /** `/users` in words: the rows, painted (a linked Basis app is said, never its key). */
  /** The word a person reads for a role: under flat a member and a coordinator are one word, "lid". */
  function roleWordFor(role, preset) {
    return preset === 'flat' && (role === 'member' || role === 'coordinator') ? t('circle.bot.role_word_lid') : (role ?? '?');
  }

  function usersText(items, preset = 'standard') {
    if (!items.length) return t('circle.bot.users_none');
    // under flat a member and a coordinator are one word: "lid"
    const word = (role) => roleWordFor(role, preset);
    return items.map((u) => `${u.label} — ${word(u.role)}${u.linked ? ` · ${t('circle.bot.users_linked')}` : ''}`).join('\n');
  }

}
