/**
 * assistantOps — the door's own ops (`assistantManifest`), answered by the door: a person's thread settings, and the
 * bot admin's app list, status and users. Composed around the door's callSkill (`withAssistantOps`).
 */
import { parsePairingOffer } from './connectionPairing.js';
import { checkExport, countExport } from './householdExport.js';
import { isSealedExport, openExport } from './householdExportSeal.js';
import { REMINDER_LEAD_KEY, REMINDER_LEAD_CHOICES, reminderLeadFrom, ASSIGN_POLICIES, ASSIGN_POLICY_KEY, BOT_ROLES, NAMES_POLICIES, NAMES_KEY, PASSED_POLICIES, PASSED_KEY, PASSED_DAYS_KEY, CANCEL_POLICIES, CANCEL_KEY, REMINDERS_KEY, REMINDERS_MODES, QUIET_KEY, isQuietHours, assignPolicyFrom, namesPolicyFrom, passedPolicyFrom, passedDaysFrom, cancelPolicyFrom, remindersModeFrom, quietHoursFrom } from './botSettings.js';
import { assistantManifest } from './assistantManifest.js';
import { SURFACE_PREFS } from './surfacePref.js';

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

export function withAssistantOps({ callSkill, threads, t, refusal = null, admin = {} }) {
  const levelOf = (op) => assistantManifest.operations.find((o) => o.id === op)?.visibility ?? 'authenticated';
  /** What a settings op's buttons can set, and the value it has now, for this person. */
  const PERSON_SETTINGS = {
    'assistant-memory':    { values: ['off', 'short', 'long'], now: (id) => threads.modeOf(id) },
    'assistant-reminders': { values: ['on', 'off'], now: (id) => (threads.remindersOn(id) ? 'on' : 'off') },
    'assistant-overview':  { values: ['on', 'off'], now: (id) => (threads.overviewOn(id) ? 'on' : 'off') },
    'assistant-language':  { values: ['nl', 'en', 'auto'], now: (id) => threads.langOf(id) ?? 'auto' },
    'assistant-view':      { values: [...SURFACE_PREFS], now: (id) => threads.viewOf(id) },
  };
  /** The household's settings (`/huishouden <key> <value>`), each a row. */
  const HOUSEHOLD_SETTINGS = [
    ['assign', ASSIGN_POLICY_KEY, ASSIGN_POLICIES, assignPolicyFrom], ['names', NAMES_KEY, NAMES_POLICIES, namesPolicyFrom],
    ['passed', PASSED_KEY, PASSED_POLICIES, passedPolicyFrom], ['cancel', CANCEL_KEY, CANCEL_POLICIES, cancelPolicyFrom],
    ['reminders', REMINDERS_KEY, REMINDERS_MODES, remindersModeFrom],
  ];
  const slashOf = (opId) => assistantManifest.operations.find((o) => o.id === opId)?.surfaces?.slash?.command ?? null;
  return async (app, op, args = {}, ctx = {}) => {
    if (app !== 'assistant') return callSkill(app, op, args, ctx);
    const caller = typeof ctx?.caller === 'string' && ctx.caller ? ctx.caller : null;
    if (caller && typeof refusal === 'function') {
      const refused = await refusal(op, caller, levelOf(op));
      // the host gate's refusal (`{layer, code}`, the one shape) rides along; the door says the admin's line
      if (refused) return { ok: false, error: { code: refused.code ?? String(refused), message: t('circle.bot.admin_only') }, refusal: refused };
    }
    try {
      // `/apps on tasks`: with no required param the router keeps the line as `_match` for the op to split.
      if (op === 'assistant-apps') return appsOp(args?.change ?? args?._match);
      if (op === 'assistant-settings') return settingsOp(args?.change ?? args?._match);
      if (op === 'assistant-role') return roleOp(args?.spec ?? args?._match);
      if (op === 'assistant-status') return { ok: true, message: await statusText() };
      if (op === 'assistant-users') return { ok: true, message: await usersText() };
      if (op === 'assistant-cohort') return cohortOp(args?.spec ?? args?._match);
      if (op === 'assistant-invite') return inviteOp();
      if (op === 'assistant-rotate') return rotateOp();
      if (op === 'assistant-revoke') return revokeOp(args?.who);
      if (op === 'assistant-menu') return menuOp(caller ?? ctx?.threadId, caller);
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
      if (PERSON_SETTINGS[op] && !(args?.mode ?? args?.lang ?? args?._match)) return oneSettingOp(threadId, op);
      if (op === 'assistant-memory') {
        const mode = args?.mode ?? args?._match;
        threads.setMode(threadId, mode);
        return { ok: true, message: tp(`circle.bot.memory_${mode}`) };
      }
      if (op === 'weekOverview') return { ok: true, message: await weekOverviewText(ctx, tp) };
      if (op === 'assistant-reminders' || op === 'assistant-overview') {
        const mode = switchOf(args?.mode ?? args?._match);
        if (!mode) return { ok: false, error: { code: 'invalid-argument', message: tp('circle.bot.switch_usage', { command: op === 'assistant-reminders' ? '/herinneringen' : '/overzicht' }) } };
        const which = op === 'assistant-reminders' ? 'reminders' : 'overview';
        if (which === 'reminders') threads.setReminders(threadId, mode === 'on'); else threads.setOverview(threadId, mode === 'on');
        return { ok: true, message: tp(`circle.bot.${which}_${mode}`) };
      }
      if (op === 'assistant-language') {
        const lang = args?.lang ?? args?._match;
        threads.setLang(threadId, lang);
        const tn = personT(threadId);
        return { ok: true, message: lang === 'auto' ? tn('circle.bot.lang_auto') : tn('circle.bot.lang_set', { lang }) };
      }
    } catch (err) {
      return { ok: false, error: { code: 'invalid-argument', message: err?.message ?? String(err) } };
    }
    return { ok: false, error: 'unknown-op', app, op };
  };

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

  async function settingsOp(change) {
    const current = async () => {
      const r = await callSkill('params', 'list-user-params', {}).catch(() => null);
      const of = (key) => (r?.params ?? []).find((p) => p.key === key)?.value;
      return t('circle.bot.settings_list', { assign: assignPolicyFrom(of(ASSIGN_POLICY_KEY)), names: namesPolicyFrom(of(NAMES_KEY)), passed: passedPolicyFrom(of(PASSED_KEY)), days: passedDaysFrom(of(PASSED_DAYS_KEY)), cancel: cancelPolicyFrom(of(CANCEL_KEY)), reminders: remindersModeFrom(of(REMINDERS_KEY)), quiet: quietHoursFrom(of(QUIET_KEY)), lead: reminderLeadFrom(of(REMINDER_LEAD_KEY)) });
    };
    const [what, value] = String(change ?? '').trim().split(/\s+/).filter(Boolean);
    if (!what) return { ok: true, message: await current() };
    const usage = { ok: false, error: { code: 'invalid-argument', message: t('circle.bot.settings_usage') } };
    if (what === 'days') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0) return usage;
      await callSkill('params', 'set-param', { key: PASSED_DAYS_KEY, value: n });
      return { ok: true, message: await current() };
    }
    if (what === 'lead') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0 || n > 240) return usage;
      await callSkill('params', 'set-param', { key: REMINDER_LEAD_KEY, value: n });
      return { ok: true, message: await current() };
    }
    if (what === 'quiet') {
      if (!isQuietHours(value)) return usage;
      await callSkill('params', 'set-param', { key: QUIET_KEY, value });
      return { ok: true, message: await current() };
    }
    const setting = { assign: [ASSIGN_POLICY_KEY, ASSIGN_POLICIES], names: [NAMES_KEY, NAMES_POLICIES], passed: [PASSED_KEY, PASSED_POLICIES], cancel: [CANCEL_KEY, CANCEL_POLICIES], reminders: [REMINDERS_KEY, REMINDERS_MODES] }[what];
    if (!setting || !setting[1].includes(value)) return usage;
    await callSkill('params', 'set-param', { key: setting[0], value });
    return { ok: true, message: await current() };
  }


  /** `/role <naam> coordinator|member|observer`: a person's role on the bot — the same words a circle's roster uses. */
  async function roleOp(spec) {
    const words = String(spec ?? '').trim().split(/\s+/).filter(Boolean);
    const role = words.pop();
    const name = words.join(' ');
    if (!name || !BOT_ROLES.includes(role)) return { ok: false, error: { code: 'invalid-argument', message: t('circle.bot.role_usage') } };
    if (typeof admin.setRole !== 'function') return { ok: false, error: 'unwired' };
    const row = await admin.setRole(name, role);
    if (!row) return { ok: false, error: t('circle.bot.role_nobody', { name }) };
    return { ok: true, message: t('circle.bot.role_set', { name: row.displayName ?? name, role }) };
  }


  /**
   * A person's week, asked AS them: their open chores (with a date) and the coming appointments go through the gate as
   * that person; the two counts (open on the shopping list, chores nobody holds) are the household's, and name nobody.
   */
  async function weekOverviewText(ctx, tp = t) {
    const pad = (n) => String(n).padStart(2, '0');
    const localDay = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso).slice(0, 10) : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    const asThem = (a, o, x) => callSkill(a, o, x, ctx);
    const itemsOf = (r) => (Array.isArray(r?.items) ? r.items : []);
    const mine = itemsOf(await asThem('tasks', 'listMine', {}).catch(() => null));
    const events = itemsOf(await asThem('calendar', 'listEvents', { days: 7 }).catch(() => null));
    const shopping = itemsOf(await callSkill('lists', 'listEntries', { list: tp('circle.lists.template.shopping') }).catch(() => null));
    const open = itemsOf(await callSkill('tasks', 'listOpen', {}).catch(() => null));
    const unheld = open.filter((it) => ![...(Array.isArray(it.assignees) ? it.assignees : []), it.assignee].some(Boolean)).length;
    const lines = [];
    if (mine.length) {
      lines.push(tp('circle.bot.overview_mine'));
      // a chore's date on the household's clock (the box runs in its zone): a local midnight is the day before in UTC
      for (const c of mine) lines.push(`• ${c.text ?? c.title ?? c.label ?? ''}${c.dueAt ? ` (${localDay(c.dueAt)})` : ''}`);
    }
    if (events.length) {
      lines.push(tp('circle.bot.overview_events'));
      for (const e of events) lines.push(`• ${e.label ?? e.title ?? ''}`);
    }
    if (shopping.length) lines.push(tp('circle.bot.overview_shopping', { n: shopping.length, list: tp('circle.lists.template.shopping') }));
    if (unheld) lines.push(tp('circle.bot.overview_unheld', { n: unheld }));
    return [tp('circle.bot.overview_head'), ...(lines.length ? lines : [tp('circle.bot.overview_none')])].join('\n');
  }

  async function statusText() {
    const s = typeof admin.status === 'function' ? ((await admin.status()) ?? {}) : {};
    const apps = admin.catalogue ? admin.catalogue.apps().join(', ') : '';
    const status = t('circle.bot.status', {
      apps, model: s.model ?? '—', door: s.door ?? '—', turns: s.turns ?? 'off',
      memory: s.memory ?? '—', users: s.users ?? '—',
    });
    // people the bot cannot write to first (no private chat): the admin hears how many
    return Number(s.unreachable) > 0 ? `${status}\n${t('circle.bot.unreachable', { count: s.unreachable })}` : status;
  }

  async function cohortOp(spec) {
    if (!admin.admission) return { ok: false, error: 'unwired' };
    const [people, days] = String(spec ?? '').trim().split(/\s+/).map(Number);
    if (!(people >= 1) || !(days > 0)) return { ok: false, error: { code: 'invalid-argument', message: t('circle.bot.cohort_usage') } };
    const c = await admin.admission.openCohort({ ceiling: people, days });
    return { ok: true, message: t('circle.bot.cohort_open', { people: c.ceiling, until: new Date(c.expiresAt).toISOString().slice(0, 10) }) };
  }

  async function inviteOp() {
    if (!admin.admission) return { ok: false, error: 'unwired' };
    const code = await admin.admission.code();
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
    const said = t('circle.bot.revoked', { who: row.displayName ?? row.id });
    return { ok: true, message: dropped ? `${said} ${t('circle.bot.revoked_screens', { n: dropped })}` : said };
  }


  /**
   * `/instellingen`: one row per settings op this person's role reaches — the gate decides, as for the op itself — with
   * its value now and a button per value that calls the op. Painted per the person's view: buttons in the chat
   * (`inline`), a pointer to their connected screen (`screen`), or words (`chat`; the inbox door is always chat).
   */
  async function menuOp(person, caller) {
    if (!person) return { ok: false, error: 'no-thread' };
    const tp = personT(person);
    const reaches = async (opId) => !caller || typeof refusal !== 'function' || !(await refusal(opId, caller, levelOf(opId)));
    const row = typeof admin.users === 'function' ? ((await admin.users()) ?? []).find((u) => u.id === person) : null;
    const view = row && row.channel !== 'telegram' ? 'chat' : threads.viewOf(person);
    if (view === 'screen') {
      const mine = typeof admin.screens?.list === 'function' ? await admin.screens.list(person) : [];
      return { ok: true, message: tp(mine.length ? 'circle.bot.menu_on_screen' : 'circle.bot.menu_offer_screen') };
    }
    const lines = [tp('circle.bot.menu_head')];
    const buttons = [];
    const valueLabel = (v) => tp(`circle.bot.value_${v}`);
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
      const now = reminderLeadFrom((r?.params ?? []).find((p) => p.key === REMINDER_LEAD_KEY)?.value);
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
    const isPrivate = Boolean(row) && (row.channel !== 'telegram' || String(ctx?.chatId ?? '') === String(row.uid ?? ''));
    const r = await admin.screens.confirm(person, answer, { isPrivate });
    if (r.ok) return { ok: true, message: tp(r.declined ? 'circle.bot.screen_declined' : 'circle.bot.screen_confirmed') };
    const key = { 'not-private': 'screen_confirm_not_private', expired: 'screen_confirm_expired', 'nothing-pending': 'screen_confirm_nothing' }[r.reason] ?? 'screen_confirm_failed';
    return { ok: false, error: { code: r.reason ?? 'failed', message: tp(`circle.bot.${key}`) } };
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
    return { ok: true, message: tp('circle.bot.screens_list', { list: rows.join('\n') }) };
  }

  async function usersText() {
    const rows = typeof admin.users === 'function' ? await admin.users() : [];
    if (!rows.length) return t('circle.bot.users_none');
    // Under `assistant.names: none` no name leaves the bot — not even to the admin's door: the rows by their id.
    const r = await callSkill('params', 'list-user-params', {}).catch(() => null);
    const hideNames = namesPolicyFrom((r?.params ?? []).find((p) => p.key === NAMES_KEY)?.value) === 'none';
    return rows.map((u) => `${hideNames ? u.id : (u.displayName ?? u.id)} — ${u.role ?? '?'}`).join('\n');
  }
}
