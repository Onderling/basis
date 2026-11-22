/**
 * basis v2 — "My data" screen (web DOM renderer, privacy + diagnostics).
 *
 * A read-only surface that retires pinboard's privacy + metrics + data-location
 * pages: WHERE your data lives (pod root / relay, `getDataLocation` +
 * `podSignInStatus`), the privacy disclosure (`getPrivacyNotice`), and a usage
 * snapshot (`getMetrics`). Pure render — the host (`circleApp.js` showMyData)
 * loads the pinboard ops and passes the results. The key-management actions
 * (back up · view recovery phrase · restore) are rendered when the host
 * injects the matching callbacks; each launches an existing wizard/skill.
 */

import { renderUserLlmSettings } from './userLlmSettings.js';
import { ownActionsLines } from '../../src/ownActions.js';   // the record's row: its count and its off line, shared
import { renderThemeToggle } from './themeToggle.js';
import { RETENTION_CHOICES_DAYS } from '../../src/v2/retentionPref.js';
import { translatorOr } from '../../src/locales/translatorOr.js';
import { historyStatusLine } from '../../src/v2/historyMirror.js';
import { basisManifest } from '../../src/index.js';
import { deviceListWords } from '../../src/v2/mijWords.js';

export function renderCircleMyData(container, {
  dataLocation = {},
  podStatus = {},
  privacy = [],
  metrics = {},
  t,
  onBack,
  onSignIn,
  // Disconnect the pod (the `signout` op, through the waist); shown when signed in
  onSignOut = null,
  // A bot's `/koppel` link, pasted: `onLinkBot(text)` opens the identity-link sheet, false when it is no bot's link
  onLinkBot = null,
  // the pod provider field: its default and the known providers (podAuth's list)
  podIssuerDefault = null, podIssuers = [],
  onViewMnemonic,
  onRestore,
  onEnroll, onReceivePersonas,
  onExportRecovery,
  onImportRecovery,
  onReplaceDevice,
  // Become the owner of a companion node (the claim it printed), signed by this device.
  onClaimCompanion,
  // what this person used most, per circle, ON THIS DEVICE (`usageRows`) — never synced; `onClearFrequent` forgets it
  frequent = [], onClearFrequent,
  // the person's own record of what they do in the app (ownActions.js): `{on, count, onToggle, onExport, onWipe}`;
  // `onWipe()` resolves to how many went. Absent ⇒ the section is omitted.
  ownActions = null,
  devices = [],
  // this device's id and the browser's name for it: the list says "this device (Firefox on Linux)", never a d-… id
  thisDeviceId = null, deviceName = null,
  onRevokeDevice,
  devicesNeedPhrase = false,
  startScreen = null,
  onSetStartScreen,
  // which round button sits on the docked "+"'s own spot (`plus.middle`, shared plusDial.js): `{value, choices}`
  plusMiddle = null,
  onSetPlusMiddle,
  // The nodes this person owns (a companion they claimed): `[{node, short}]`. `onOpenCompanionGrant(node)` reads what
  // the picker shows (`loadCompanionGrantPicker`: `{ok, targets, choices}` or `{ok: false, message}`);
  // `onGrantCompanion({node, to, families})` grants and resolves to the line to show. Absent ⇒ the section is omitted.
  companions = [],
  // "intrekken onderweg bij n companion(s)" while a deleted contact's revokes have not reached every node; null = none
  companionsPending = null,
  onOpenCompanionGrant = null,
  onGrantCompanion = null,
  // Who the node granted, as lines under it: `onLoadCompanionGrants(node)` → `{ok, rows: [{to, label, may}]}` or
  // `{ok: false, message}`; `onRevokeCompanionGrant({node, to})` revokes and resolves to the line to show.
  onLoadCompanionGrants = null,
  onRevokeCompanionGrant = null,
  // What THIS device keeps of what the owner's devices sync (sync-policy §11): `{ silos: {chat,tasks,contacts}: bool,
  // fileBytes: 'full'|'description', kringenOff: Set<string>, kringen: [{id, name}] }` + `onSetSync({ silo?, value?, fileBytes?, kringId?, on? })`.
  syncSelection = null,
  onSetSync = null,
  onMakePrimary,
  // CONNECTIONS (gekoppelde apparaten) — screens that are yours, somewhere else. Rows come from the
  // shared `connectionRows` projection; the two columns are the whole product question (what it may
  // SEE, what it may DO). Absent handler ⇒ the section is omitted, like every other section here.
  connections = [],
  onUnpairConnection = null,
  // Pairing a NEW connection. `connectionChoices` = { ops, sections } already projected by the
  // shared module (the shell never derives a menu — the menu IS the manifest, projected once).
  // `screenPairing` = the shared pairing (`appScreenPairing.js`): offer → pick one of three codes → grant; it is the
  // only way from a pasted offer to the grant (the shell holds no format knowledge and never calls the op). `onPaired`
  // re-reads the list after a grant. Absent ⇒ no pairing form.
  connectionChoices = null,
  screenPairing = null,
  onPaired = null,
  notifications,
  onToggleNotifications,
  // The personal history mirror (a sealed copy of the device log on the user's own storage).
  // `historyMirror` = { enabled, status } (status = the agent's live historyMirrorStatus(), null
  // when not running); absent ⇒ the section is omitted. The toggle flips the `history.mirror`
  // register param through the one kind-gated write — the agent starts/stops the sink LIVE.
  historyMirror = null,
  onToggleHistoryMirror = null,
  onExportHistory = null,       // one-shot sealed archive download ("mirror to a file")
  // The two delivery settings (2026-07-28). One object, because they are two knobs on one question.
  delivery,               // { sendReceipts, allowFallback } — absent ⇒ the section is omitted
  onSetDelivery,          // (patch) => void
  // Message cleanup — the conversation is the RECORD and never expires by policy; deleting old messages
  // is the user's own explicit act. `onPurgeMessages(days)` deletes conversation entries older than that
  // and returns the count. Absent ⇒ the section is omitted (unchanged surface).
  onPurgeMessages = null,
  // "Never share my global address" — the strictest privacy position in the product. `shareNknAddress`
  // is the current value; absent ⇒ the section is omitted (unchanged surface).
  shareNknAddress = null,
  onSetShareAddress = null,
  surfacePref,            // S6.C — current 'inline' | 'screen' | 'chat'
  chatAi,                 // S6.D — { enriched, reason } for the active circle (shown under "chat")
  onSetSurfacePref,       // (value) => void
  appLang,                // current app language 'nl' | 'en' (global UI language)
  onSetAppLang,           // (lng) => void
  themePref,              // display theme 'system' | 'light' | 'dark' (localStorage basis.theme)
  onSetTheme,             // (v) => void — stamps data-theme live + persists
  userLlm,                // the member's saved assistant endpoint config (userLlmDefault value)
  onSaveUserLlm,          // (cfg) => Promise<string|null>  — persist + apply; returns an error message or null
  validateUserLlm,        // (cfg) => string|null           — confidential-route guard for inline display
  relayUrl,               // in-app relay setting: the saved URL ('' / null = unset ⇒ env fallback)
  relayEnvUrl,            // the build-time env relay URL, shown as the placeholder fallback
  onSaveRelay,            // (url) => Promise<{ok, effective, error?}> — persist + live-reconnect the transport
  // The doors a group's sections open (connection points): the view each opens → what opens it here. A door without
  // one is omitted.
  doors = {},
  // the person's own week overview (a card of the coming week on Saturday morning): `{ on, onToggle }`; on null while
  // it loads or switches; absent = no switch (no clock here)
  weekOverview = undefined,
  // A settings group's screen: the section ids to paint, in order (from `settingsGroupFor`), and its title. Every
  // section is declared under the gear; nothing is painted outside a group.
  only = null,
  groupTitle = null,
} = {}) {
  if (!container) return container;
  const tr = translatorOr(t, 'circleMyData.js');
  container.innerHTML = '';
  container.className = 'cc-mydata';

  const header = document.createElement('div');
  header.className = 'cc-mydata__header';
  if (typeof onBack === 'function') {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'cc-mydata__back';
    back.textContent = tr('circle.settings_home.back');   // a group's back is the settings home
    back.addEventListener('click', () => onBack());
    header.appendChild(back);
  }
  const title = document.createElement('h2');
  title.className = 'cc-mydata__title';
  title.textContent = groupTitle ?? tr('circle.mydata.title');
  header.appendChild(title);
  container.appendChild(header);

  // ── the sections that live under the gear (Instellingen), one painter per declared id ──────────────
  // Painted ONLY on a settings group's screen (`only`, in the manifest's order); the old page paints none of them.
  const painters = {
    'theme': () => {
      // ── display theme (systeem/licht/donker — stored locally, applies live) ──────
      // Bulletin restyle — a mono pill toggle (mirror of onderling.org's #theme-toggle):
      // one segmented control, the active option inverts to ink. onSetTheme persists
      // localStorage['basis.theme'] and stamps/removes document.documentElement.dataset.theme
      // live (systeem = remove, so prefers-color-scheme wins) — wired in circleApp.
      if (typeof onSetTheme === 'function') {
        const sec = section(tr('circle.mydata.theme'));
        renderThemeToggle(sec, { themePref, onSetTheme, t: tr });   // ONE renderer — settings shows the same control
        container.appendChild(sec);
      }
    },
    'language': () => {
      // ── app language (global NL/EN — a user preference, applies app-wide) ───────
      if (typeof onSetAppLang === 'function') {
        const sec = section(tr('circle.mydata.language'));
        for (const lg of ['nl', 'en']) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = `cc-mydata__pref${lg === appLang ? ' is-active' : ''}`;
          b.dataset.lang = lg;
          b.textContent = lg.toUpperCase();
          b.addEventListener('click', () => onSetAppLang(lg));
          sec.appendChild(b);
        }
        container.appendChild(sec);
      }
    },
    'start-screen': () => {
      // where the app opens on this device: Vandaag · the circles list · the tab last used
      if (startScreen && typeof onSetStartScreen === 'function') {
        const sec0 = section(tr('circle.mydata.start_title'));
        const sel = document.createElement('select');
        sel.dataset.role = 'start-screen';
        for (const c of startScreen.choices ?? []) {
          const o = document.createElement('option');
          o.value = c.value;
          o.textContent = tr(c.labelKey);
          if (c.value === startScreen.value) o.selected = true;
          sel.appendChild(o);
        }
        sel.addEventListener('change', () => onSetStartScreen(sel.value));
        sec0.appendChild(sel);
        container.appendChild(sec0);
      }
    },
    'plus-middle': () => {
      // which button a second tap on the "+" runs (chat by default), or none: then a second tap closes it
      if (plusMiddle && typeof onSetPlusMiddle === 'function') {
        const sec = section(tr('circle.params.key.plus_middle'));
        const hint = document.createElement('p');
        hint.className = 'cc-mydata__hint';
        hint.textContent = tr('circle.plus.middle_hint');
        sec.appendChild(hint);
        const sel = document.createElement('select');
        sel.dataset.role = 'plus-middle';
        for (const c of plusMiddle.choices ?? []) {
          const o = document.createElement('option');
          o.value = c.value;
          o.textContent = tr(c.labelKey);
          if (c.value === plusMiddle.value) o.selected = true;
          sel.appendChild(o);
        }
        sel.addEventListener('change', () => onSetPlusMiddle(sel.value));
        sec.appendChild(sel);
        container.appendChild(sec);
      }
    },
    'bot-actions': () => {
      // ── how the bot shows actions (S6.C surface preference) ─────────────────────
      if (typeof onSetSurfacePref === 'function') {
        const sec = section(tr('circle.mydata.surface_pref'));
        const current = surfacePref || 'inline';
        for (const opt of ['inline', 'screen', 'chat']) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = `cc-mydata__pref${opt === current ? ' is-active' : ''}`;
          b.dataset.pref = opt;
          b.textContent = tr(`circle.mydata.surface_pref_${opt}`);
          b.addEventListener('click', () => onSetSurfacePref(opt));
          sec.appendChild(b);
        }
        // S6.D — when "chat" is chosen, show whether AI is enriching it here (chat works
        // without AI; this just tells you if your LLM is helping, or why not).
        if (current === 'chat' && chatAi && chatAi.reason) {
          const note = document.createElement('p');
          note.className = 'cc-mydata__chat-ai';
          const keyByReason = { on: 'chat_ai_on', 'circle-off': 'chat_ai_circle_off', 'no-llm': 'chat_ai_no_llm', 'no-provider': 'chat_ai_no_provider' };
          note.textContent = `${chatAi.enriched ? '✨ ' : ''}${tr(`circle.mydata.${keyByReason[chatAi.reason] ?? 'chat_ai_no_provider'}`)}`;
          sec.appendChild(note);
        }
        container.appendChild(sec);
      }
    },
    'week-overview': () => {
      // the person's own week overview: a card of their coming week, switched here
      if (weekOverview) {
        const sec = section(tr('circle.profile.week_switch'));
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cc-profile__week-toggle cc-switch';
        btn.setAttribute('role', 'switch');   // sets: store:person-clock — your own week overview
        btn.setAttribute('aria-checked', weekOverview.on ? 'true' : 'false');
        btn.dataset.on = weekOverview.on ? 'true' : 'false';
        btn.disabled = weekOverview.on === null;
        btn.textContent = tr(weekOverview.on ? 'circle.profile.week_on' : 'circle.profile.week_off');
        btn.addEventListener('click', () => { if (typeof weekOverview.onToggle === 'function') weekOverview.onToggle(); });
        sec.appendChild(btn);
        container.appendChild(sec);
      }
    },
    'notifications': () => {
      // ── notifications (S5 web-push) ─────────────────────────────────────────────
      if (typeof onToggleNotifications === 'function') {
        const n = notifications || {};
        const notif = section(tr('circle.mydata.notifications'));
        const sub = document.createElement('p');
        sub.className = 'cc-mydata__notif-status';
        sub.textContent = !n.supported
          ? tr('circle.mydata.notif_unsupported')
          : n.subscribed ? tr('circle.mydata.notif_on') : tr('circle.mydata.notif_off');
        notif.appendChild(sub);
        if (n.supported) {
          // the trade is made by turning this ON, so it is stated HERE, above the button, in both
          // states: someone reviewing their settings should see what having it on means. Three lines on
          // purpose — the cost, what is still NOT learned (a bare "affects your privacy" invites imagining
          // worse than the truth), and the escape. Not framed as a warning: most people should turn
          // notifications on, they should just know what they are agreeing to. → docs/decisions.md 2026-07-29
          for (const key of ['notif_privacy', 'notif_privacy_not', 'notif_privacy_escape']) {
            const line = document.createElement('p');
            line.className = `cc-mydata__notif-privacy cc-mydata__${key.replace(/_/g, '-')}`;
            line.textContent = tr(`circle.mydata.${key}`);
            notif.appendChild(line);
          }
          const toggle = document.createElement('button');
          toggle.type = 'button';
          toggle.className = 'cc-mydata__notif-toggle cc-switch';
          toggle.setAttribute('role', 'switch');   // sets: device:web-push — this browser's push subscription
          toggle.setAttribute('aria-checked', n.subscribed ? 'true' : 'false');
          toggle.textContent = n.subscribed ? tr('circle.mydata.notif_disable') : tr('circle.mydata.notif_enable');
          toggle.addEventListener('click', () => onToggleNotifications());
          notif.appendChild(toggle);
        }
        container.appendChild(notif);
      }
    },
    'assistant': () => {
      // ── assistant endpoint (the member's own LLM + embedder) ────────────────────
      if (typeof onSaveUserLlm === 'function') {
        const holder = document.createElement('div');
        holder.className = 'cc-mydata__section';
        renderUserLlmSettings(holder, { current: userLlm || {}, onSave: onSaveUserLlm, validate: validateUserLlm, t: tr });
        container.appendChild(holder);
      }
    },
    'connection-points': () => {
      if (typeof doors.points === 'function') {
        const sec = section(tr('circle.nearbyScreen.points_open'));
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cc-settings__row cc-settings__door--connection-points';
        b.textContent = tr('circle.nearbyScreen.points_open');
        b.addEventListener('click', () => doors.points());
        sec.appendChild(b);
        container.appendChild(sec);
      }
    },
    'delivery': () => {
      // ── delivery (2026-07-28) ───────────────────────────────────────────────────
      // Both lines describe WHAT HAPPENS, not which switch is where. And note what is NOT said: nothing tells
      // you what other people see about your receipt setting, because nothing in the model reveals it — a
      // "others cannot tell" reassurance here would be the first place that leaked.
      if (typeof onSetDelivery === 'function' && delivery) {
        const sec = section(tr('circle.nearbyScreen.delivery_section'));

        const receiptsLine = document.createElement('p');
        receiptsLine.className = 'cc-mydata__delivery-receipts';
        receiptsLine.textContent = tr(delivery.sendReceipts
          ? 'circle.nearbyScreen.delivery_receipts_on'
          : 'circle.nearbyScreen.delivery_receipts_off');
        sec.appendChild(receiptsLine);

        const receiptsBtn = document.createElement('button');
        receiptsBtn.type = 'button';
        receiptsBtn.className = 'cc-mydata__action cc-mydata__delivery-receipts-toggle';
        receiptsBtn.textContent = tr(delivery.sendReceipts
          ? 'circle.nearbyScreen.delivery_receipts_toggle_on'
          : 'circle.nearbyScreen.delivery_receipts_toggle_off');
        receiptsBtn.addEventListener('click', () => onSetDelivery({ sendReceipts: !delivery.sendReceipts }));
        sec.appendChild(receiptsBtn);

        const fallbackLine = document.createElement('p');
        fallbackLine.className = 'cc-mydata__delivery-fallback';
        fallbackLine.textContent = tr(delivery.allowFallback
          ? 'circle.nearbyScreen.delivery_fallback_on'
          : 'circle.nearbyScreen.delivery_fallback_off');
        sec.appendChild(fallbackLine);

        // The cost rides WITH the option to turn it on — never the fix alone.
        const fallbackCost = document.createElement('p');
        fallbackCost.className = 'cc-mydata__delivery-fallback-cost';
        fallbackCost.textContent = tr('circle.nearbyScreen.delivery_fallback_cost');
        sec.appendChild(fallbackCost);

        // The toggle is GONE until the stored setting reaches the send path (2026-08-02).
        //
        // It wrote a preference nothing read: the send path defaults the fallback ON and never consults it, so
        // both states behaved identically while the screen described them as different. A control that changes
        // nothing is a stronger false claim than a sentence — someone presses it and believes they acted. The
        // preference is still stored, so wiring it later restores the control without a migration.
        const fallbackNote = document.createElement('p');
        fallbackNote.className = 'cc-mydata__hint';
        fallbackNote.textContent = tr('circle.nearbyScreen.delivery_fallback_note');
        sec.appendChild(fallbackNote);

        container.appendChild(sec);
      }
    },
    'address-sharing': () => {
      // ── my global address (2026-07-29) ─────────────────────────────────────────
      // Placed with delivery rather than alone: it is the same family of question — how much does the
      // network learn in exchange for reaching you. The cost rides WITH the option, as it does there.
      if (typeof onSetShareAddress === 'function' && shareNknAddress != null) {
        const sec = section(tr('circle.mydata.address_sharing'));

        const line = document.createElement('p');
        line.className = 'cc-mydata__address-sharing';
        line.textContent = tr(shareNknAddress
          ? 'circle.mydata.address_sharing_on'
          : 'circle.mydata.address_sharing_off');
        sec.appendChild(line);

        const cost = document.createElement('p');
        cost.className = 'cc-mydata__address-sharing-cost';
        cost.textContent = tr('circle.mydata.address_sharing_cost');
        sec.appendChild(cost);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cc-mydata__address-sharing-toggle cc-switch';
        btn.setAttribute('role', 'switch');   // sets: param:privacy.shareNknAddress — your global address
        btn.setAttribute('aria-checked', shareNknAddress ? 'true' : 'false');
        btn.textContent = tr(shareNknAddress
          ? 'circle.mydata.address_sharing_toggle_on'
          : 'circle.mydata.address_sharing_toggle_off');
        btn.addEventListener('click', () => onSetShareAddress(!shareNknAddress));
        sec.appendChild(btn);

        container.appendChild(sec);
      }
    },
    'relay': () => {
      const relaySec = section(tr('circle.mydata.relay'));
      if (dataLocation.relayOperator || dataLocation.relayUrl) {
        relaySec.appendChild(kv(tr('circle.mydata.relay'), [dataLocation.relayOperator, dataLocation.relayUrl].filter(Boolean).join(' · ')));
      }
      // In-app relay setting — point the no-server cross-device relay at a reachable server WITHOUT a rebuild. Edited
      // here, inline, as the phone edits it (the two shells were levelled 2026-11-20; it once opened a side panel here).
      if (typeof onSaveRelay === 'function') {
        const row = document.createElement('div');
        row.className = 'cc-mydata__relay-edit';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'cc-mydata__relay-input';
        input.value = relayUrl || '';
        input.placeholder = relayEnvUrl || 'ws://…:8787';
        input.setAttribute('aria-label', tr('circle.mydata.relay_set'));
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'cc-btn cc-btn--quiet cc-mydata__relay-save';
        save.textContent = tr('circle.mydata.relay_save');
        const note = document.createElement('span');
        note.className = 'cc-mydata__relay-note';
        save.addEventListener('click', async () => {
          save.disabled = true; note.textContent = tr('circle.mydata.relay_saving');
          try {
            const r = await onSaveRelay(input.value);
            note.textContent = r && r.ok
              ? tr('circle.mydata.relay_saved', { url: r.effective || tr('circle.mydata.relay_off') })
              : tr('circle.mydata.relay_error', { msg: (r && r.error) || '' });
          } catch (e) { note.textContent = tr('circle.mydata.relay_error', { msg: e?.message ?? '' }); }
          save.disabled = false;
        });
        const hint = document.createElement('p');
        hint.className = 'cc-mydata__relay-hint';
        hint.textContent = tr('circle.mydata.relay_hint');
        row.appendChild(input); row.appendChild(save); row.appendChild(note);
        relaySec.appendChild(row);
        relaySec.appendChild(hint);
      }
      if (relaySec.children.length > 1) container.appendChild(relaySec);
    },
    'device-keeps': () => {
      // ── what this device keeps (sync-policy §11, 2026-09-17) ───────────────────────────────────
      // A device's own choice about itself, read live by every landing, pull and pairing; never on the wire.
      if (typeof onSetSync === 'function' && syncSelection && typeof syncSelection === 'object') {
        const sec = section(tr('circle.mydata.sync'));
        const intro = document.createElement('p');
        intro.className = 'cc-mydata__sync-intro';
        intro.textContent = tr('circle.mydata.sync_intro');
        sec.appendChild(intro);
        const check = (cls, label, checked, onChange) => {
          const row = document.createElement('label');
          row.className = `cc-mydata__sync-row ${cls}`;
          row.style.cssText = 'display:flex;align-items:center;gap:.5rem;padding:.2rem 0;';
          const box = document.createElement('input');
          box.type = 'checkbox'; box.checked = !!checked;   // sets: param:sync.* — what this device keeps (a silo, or a kring)
          box.addEventListener('change', () => onChange(box.checked));
          row.appendChild(box);
          const txt = document.createElement('span'); txt.textContent = label;
          row.appendChild(txt);
          return row;
        };
        for (const silo of ['chat', 'tasks', 'contacts']) {
          sec.appendChild(check(`cc-mydata__sync-silo-${silo}`, tr(`circle.mydata.sync_silo_${silo}`), syncSelection.silos?.[silo] !== false, (on) => onSetSync({ silo, value: on })));
        }
        const files = document.createElement('div');
        files.className = 'cc-mydata__sync-files';
        files.style.cssText = 'display:flex;align-items:center;gap:.5rem;padding:.2rem 0;';
        const filesLabel = document.createElement('span'); filesLabel.textContent = tr('circle.mydata.sync_files');
        const filesSel = document.createElement('select');
        filesSel.className = 'cc-mydata__sync-files-mode';
        for (const mode of ['full', 'description']) {
          const o = document.createElement('option'); o.value = mode; o.textContent = tr(`circle.mydata.sync_files_${mode}`);
          if ((syncSelection.fileBytes ?? 'full') === mode) o.selected = true;
          filesSel.appendChild(o);
        }
        filesSel.addEventListener('change', () => onSetSync({ fileBytes: filesSel.value }));
        files.appendChild(filesLabel); files.appendChild(filesSel);
        sec.appendChild(files);
        const kh = document.createElement('p'); kh.className = 'cc-mydata__sync-kringen-head'; kh.textContent = tr('circle.mydata.sync_kringen');
        sec.appendChild(kh);
        const kringen = Array.isArray(syncSelection.kringen) ? syncSelection.kringen : [];
        if (!kringen.length) {
          const none = document.createElement('p'); none.textContent = tr('circle.mydata.sync_kringen_none'); sec.appendChild(none);
        }
        const off = syncSelection.kringenOff instanceof Set ? syncSelection.kringenOff : new Set(syncSelection.kringenOff ?? []);
        for (const k of kringen) {
          const row = check('cc-mydata__sync-kring', k.name ?? k.id, !off.has(k.id), (on) => onSetSync({ kringId: k.id, on }));
          row.dataset.kringId = k.id;
          sec.appendChild(row);
        }
        container.appendChild(sec);
      }
    },
    'history-mirror': () => {
      // ── the personal history mirror (sealed copy of the device log on your own storage) ────────
      if (historyMirror && typeof onToggleHistoryMirror === 'function') {
        const h = historyMirror;
        const sec2 = section(tr('circle.mydata.history'));
        const state = document.createElement('p');
        state.className = 'cc-mydata__history-status';
        state.dataset.role = 'history-status';
        const line = historyStatusLine({ enabled: h.enabled, status: h.status });
        state.textContent = tr(line.key, line.vars);
        sec2.appendChild(state);
        const what = document.createElement('p');
        what.className = 'cc-mydata__history-what';
        what.textContent = tr('circle.mydata.history_what');
        sec2.appendChild(what);
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'cc-mydata__action cc-mydata__history-toggle';
        toggle.textContent = h.enabled ? tr('circle.mydata.history_disable') : tr('circle.mydata.history_enable');
        toggle.addEventListener('click', () => onToggleHistoryMirror());
        sec2.appendChild(toggle);
        // Export = "mirror to a file" — the same sink, one shot, sealed the same way; needs no pod.
        if (typeof onExportHistory === 'function') {
          const exp = document.createElement('button');
          exp.type = 'button';
          exp.className = 'cc-mydata__action cc-mydata__history-export';
          exp.textContent = tr('circle.mydata.history_export');
          exp.addEventListener('click', () => onExportHistory());
          sec2.appendChild(exp);
        }
        container.appendChild(sec2);
      }
    },
    'message-cleanup': () => {
      // ── message cleanup (the conversation is the RECORD) ────────────────────────
      // Messages never expire by policy — deleting them is the user's own explicit act: pick an age, then
      // confirm the clearly-destructive button (two clicks; the first arms it). The result line reports the
      // real count, and the note says what is NOT touched (decisions/reports compact, they don't delete).
      if (typeof onPurgeMessages === 'function') {
        const sec = section(tr('circle.mydata.cleanup'));

        let chosenDays = RETENTION_CHOICES_DAYS[RETENTION_CHOICES_DAYS.length - 1];
        const row = document.createElement('div');
        row.className = 'cc-mydata__retention';
        const chips = [];
        for (const days of RETENTION_CHOICES_DAYS) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'cc-mydata__action cc-mydata__retention-choice';
          if (days === chosenDays) b.classList.add('is-on');
          b.textContent = tr('circle.mydata.cleanup_older_than', { days });
          b.addEventListener('click', () => {
            chosenDays = days;
            for (const c of chips) c.classList.toggle('is-on', c === b);
            disarm();
          });
          chips.push(b);
          row.appendChild(b);
        }
        sec.appendChild(row);

        const act = document.createElement('button');
        act.type = 'button';
        act.className = 'cc-mydata__action cc-mydata__cleanup-run';
        const result = document.createElement('p');
        result.className = 'cc-mydata__retention-note';
        let armed = false;
        const disarm = () => { armed = false; act.classList.remove('is-armed'); act.textContent = tr('circle.mydata.cleanup_button', { days: chosenDays }); };
        disarm();
        act.addEventListener('click', async () => {
          if (!armed) {
            armed = true;
            act.classList.add('is-armed');
            act.textContent = tr('circle.mydata.cleanup_confirm', { days: chosenDays });
            return;
          }
          let count = 0;
          try { count = (await onPurgeMessages(chosenDays)) ?? 0; } catch { count = 0; }
          disarm();
          result.textContent = tr('circle.mydata.cleanup_done', { count });
        });
        sec.appendChild(act);
        sec.appendChild(result);

        const note = document.createElement('p');
        note.className = 'cc-mydata__retention-note';
        note.textContent = tr('circle.mydata.cleanup_note');
        sec.appendChild(note);

        container.appendChild(sec);
      }
    },
    'privacy': () => {
      // ── privacy ────────────────────────────────────────────────────────────────
      if (Array.isArray(privacy) && privacy.length) {
        const priv = section(tr('circle.mydata.privacy'));
        for (const s of privacy) {
          const item = document.createElement('div');
          item.className = 'cc-mydata__privacy';
          const h = document.createElement('div');
          h.className = 'cc-mydata__privacy-title';
          h.textContent = s.title ?? '';
          const b = document.createElement('p');
          b.className = 'cc-mydata__privacy-body';
          b.textContent = s.body ?? '';
          item.appendChild(h);
          item.appendChild(b);
          priv.appendChild(item);
        }
        container.appendChild(priv);
      }
    },
    'usage': () => {
      // ── usage ──────────────────────────────────────────────────────────────────
      const entries = Object.entries(metrics || {});
      if (entries.length) {
        const usage = section(tr('circle.mydata.usage'));
        for (const [k, v] of entries) {
          usage.appendChild(kv(k, typeof v === 'object' ? JSON.stringify(v) : String(v)));
        }
        container.appendChild(usage);
      }
    },
    'frequent': () => {
      // ── what you use most (this device only) ─────────────────────────────────────
      {
        const sec = section(tr('circle.mydata.frequent'));
        const note = document.createElement('p');
        note.className = 'cc-mydata__note';
        note.textContent = tr('circle.mydata.frequent_note');
        sec.appendChild(note);
        if (Array.isArray(frequent) && frequent.length) {
          for (const r of frequent) sec.appendChild(kv(r.name, r.items.map((i) => `${i.label} ${i.count}`).join(' · ')));
          if (typeof onClearFrequent === 'function') {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'cc-btn cc-btn--quiet cc-mydata__frequent-clear';
            b.textContent = tr('circle.mydata.frequent_clear');
            b.addEventListener('click', () => onClearFrequent());
            sec.appendChild(b);
          }
        } else {
          const none = document.createElement('p');
          none.className = 'cc-mydata__note';
          none.textContent = tr('circle.mydata.frequent_none');
          sec.appendChild(none);
        }
        container.appendChild(sec);
      }
    },
    'own-actions': () => {
      // ── the record of what you do in the app (this device only; ledger L203) ─────
      if (!ownActions) return;
      const sec = section(tr('circle.params.key.ownActions_record'));
      const note = document.createElement('p');
      note.className = 'cc-mydata__note';
      note.textContent = tr('circle.mydata.own_actions_note');
      sec.appendChild(note);
      const btn = (cls, key, fn) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `cc-mydata__action ${cls}`;
        b.textContent = tr(key);
        b.addEventListener('click', fn);
        return b;
      };
      sec.appendChild(btn('cc-mydata__own-actions-toggle', ownActions.on ? 'circle.mydata.history_disable' : 'circle.mydata.history_enable', () => ownActions.onToggle?.()));
      const lines = ownActionsLines({ on: ownActions.on, count: ownActions.count, t: tr });
      if (lines.off) {
        const off = document.createElement('p');
        off.className = 'cc-mydata__note cc-mydata__own-actions-off';
        off.textContent = lines.off;
        sec.appendChild(off);
      }
      const count = document.createElement('p');
      count.className = 'cc-mydata__note cc-mydata__own-actions-count';
      count.textContent = lines.count;
      sec.appendChild(count);
      if (ownActions.count) {
        sec.appendChild(btn('cc-mydata__own-actions-export', 'circle.mydata.own_actions_export', () => ownActions.onExport?.()));
        // two taps: the first arms it and says it cannot be undone, the second wipes (as the message cleanup does)
        let armed = false;
        const wipe = btn('cc-btn--danger cc-mydata__own-actions-wipe', 'circle.mydata.own_actions_wipe', async () => {
          if (!armed) { armed = true; wipe.textContent = tr('circle.mydata.own_actions_wipe_confirm'); return; }
          const n = await Promise.resolve(ownActions.onWipe?.()).catch(() => 0);
          count.textContent = tr('circle.mydata.own_actions_wiped', { n: Number(n) || 0 });
          wipe.remove();
        });
        sec.appendChild(wipe);
      }
      container.appendChild(sec);
    },
    'devices': () => {
      // ── enrolled devices (add-a-device) ─────────────────────────────────────────
      // One row per registry delegation; tombstones shown struck. The revoke door (the phrase-proven
      // ceremony) acts on the live rows — gated on the callback like every identity act above.
      if (typeof onRevokeDevice === 'function' && Array.isArray(devices) && devices.length) {
        const sec = section(tr('circle.mydata.devices'));
        // without the recovery seal this device carries nothing of the person's own scope to the others: say how to fix it
        if (devicesNeedPhrase) {
          const note = document.createElement('p');
          note.dataset.role = 'devices-needs-phrase';
          note.textContent = tr('circle.mydata.devices_needs_phrase');
          sec.appendChild(note);
        }
        for (const d of devices) {
          const row = document.createElement('div');
          row.className = 'cc-mydata__device';
          row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:.6rem;padding:.25rem 0;';
          const label = document.createElement('span');
          label.textContent = deviceListWords(d, { thisDeviceId, deviceName, t: tr });
          if (d.revoked) label.style.textDecoration = 'line-through';
          row.appendChild(label);
          if (!d.revoked) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'cc-btn cc-btn--danger cc-mydata__device-revoke';
            b.textContent = tr('circle.revoke.title');
            b.addEventListener('click', () => onRevokeDevice(d.deviceId));
            row.appendChild(b);
          }
          sec.appendChild(row);
        }
        container.appendChild(sec);
      }
    },
    'agents': () => {
      // ── my agents: the nodes I own, and what another agent may do there ────────────────────────────────
      // One row per node; "give access" asks the node what it can give (its families), then a pick of who (a contact, a
      // linked bot) and the ticks. The node mints the tokens; nothing here decides what a family is.
      if (typeof onOpenCompanionGrant === 'function' && typeof onGrantCompanion === 'function' && Array.isArray(companions) && companions.length) {
        const sec = section(tr('circle.companionGrant.nodes'));
        if (companionsPending) {
          const p = document.createElement('p');
          p.className = 'cc-mydata__companion-pending';
          p.style.cssText = 'font-size:.9em;opacity:.8;margin:.2rem 0;';
          p.textContent = companionsPending;
          sec.appendChild(p);
        }
        for (const c of companions) {
          const row = document.createElement('div');
          row.className = 'cc-mydata__companion';
          row.style.cssText = 'padding:.35rem 0;';
          const head = document.createElement('div');
          head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:.6rem;';
          const name = document.createElement('span');
          name.className = 'cc-mydata__companion-name';
          name.textContent = tr('circle.companionGrant.node_row', { short: c.short });
          const give = document.createElement('button');
          give.type = 'button';
          give.className = 'cc-btn cc-btn--quiet cc-mydata__companion-give';
          give.textContent = tr('circle.companionGrant.give');
          head.append(name, give);
          row.appendChild(head);
          // who holds a grant here — asked of the node, one line each: "<who> — mag: … · intrekken"
          const holders = document.createElement('div');
          holders.className = 'cc-mydata__companion-holders';
          holders.style.cssText = 'font-size:.9em;';
          row.appendChild(holders);
          const paintHolders = async (said = null) => {
            if (typeof onLoadCompanionGrants !== 'function') return;
            const r = await onLoadCompanionGrants(c.node);
            holders.innerHTML = '';
            if (said) {
              const p = document.createElement('p');
              p.style.cssText = 'opacity:.8;margin:.2rem 0;';
              p.textContent = said;
              holders.appendChild(p);
            }
            if (!r?.ok) {
              const p = document.createElement('p');
              p.style.cssText = 'opacity:.75;margin:.2rem 0;';
              p.textContent = r?.message ?? '';
              holders.appendChild(p);
              return;
            }
            for (const h of r.rows) {
              const line = document.createElement('div');
              line.className = 'cc-mydata__companion-holder';
              line.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:.6rem;padding:.1rem 0;';
              const what = document.createElement('span');
              what.textContent = `${h.label} — ${h.may}`;
              const rev = document.createElement('button');
              rev.type = 'button';
              rev.className = 'cc-btn cc-btn--danger cc-mydata__companion-revoke';
              rev.textContent = tr('circle.companionGrant.revoke');
              rev.addEventListener('click', async () => {
                rev.disabled = true;
                const line2 = typeof onRevokeCompanionGrant === 'function' ? await onRevokeCompanionGrant({ node: c.node, to: h.to }) : null;
                await paintHolders(line2);
              });
              line.append(what, rev);
              holders.appendChild(line);
            }
          };
          paintHolders();
          const panel = document.createElement('div');
          panel.className = 'cc-mydata__companion-panel';
          panel.hidden = true;
          row.appendChild(panel);
          const say = (text) => {
            const p = document.createElement('p');
            p.className = 'cc-mydata__companion-note';
            p.style.cssText = 'font-size:.9em;opacity:.8;';
            p.textContent = text;
            panel.appendChild(p);
          };
          give.addEventListener('click', async () => {
            panel.hidden = false;
            panel.innerHTML = '';
            say(tr('circle.companionGrant.loading'));
            const picker = await onOpenCompanionGrant(c.node);
            panel.innerHTML = '';
            if (!picker?.ok) { say(picker?.message ?? tr('circle.companionGrant.failed')); return; }
            if (!picker.targets.length) { say(tr('circle.companionGrant.to_none')); return; }
            const toLabel = document.createElement('label');
            toLabel.style.cssText = 'display:block;margin:.3rem 0;';
            toLabel.textContent = tr('circle.companionGrant.to_label');
            const to = document.createElement('select');
            to.className = 'cc-mydata__companion-to';
            to.style.cssText = 'display:block;width:100%;';
            for (const tg of picker.targets) {
              const o = document.createElement('option');
              o.value = tg.key;
              o.textContent = tg.label;
              to.appendChild(o);
            }
            toLabel.appendChild(to);
            panel.appendChild(toLabel);
            const may = document.createElement('div');
            may.textContent = tr('circle.companionGrant.may_do');
            may.style.cssText = 'font-weight:600;margin:.3rem 0 .2rem;';
            panel.appendChild(may);
            const boxes = picker.choices.map((ch) => {
              const line = document.createElement('label');
              line.style.cssText = 'display:flex;gap:.4rem;align-items:center;padding:.1rem 0;';
              const cb = document.createElement('input');
              cb.type = 'checkbox';   // sets: form — what the companion may do for you
              cb.value = ch.id;
              cb.className = 'cc-mydata__companion-family';
              const txt = document.createElement('span');
              txt.textContent = ch.label;
              line.append(cb, txt);
              panel.appendChild(line);
              return cb;
            });
            const confirm = document.createElement('button');
            confirm.type = 'button';
            confirm.className = 'cc-btn cc-btn--quiet cc-mydata__companion-confirm';
            confirm.textContent = tr('circle.companionGrant.confirm');
            panel.appendChild(confirm);
            confirm.addEventListener('click', async () => {
              const families = boxes.filter((b) => b.checked).map((b) => b.value);
              if (!families.length) { say(tr('circle.companionGrant.nothing_ticked')); return; }
              confirm.disabled = true;
              const line = await onGrantCompanion({ node: c.node, to: to.value, families });
              panel.innerHTML = '';
              say(line);
              paintHolders();
            });
          });
          sec.appendChild(row);
        }
        container.appendChild(sec);
      }
    },
    'connections': () => {
      // ── connections: screens that are yours, somewhere else ────────────────────────────────────
      // Placed beside the devices list because that is the question a person is answering here —
      // "what else of mine is out there" — and the two are told apart by what they can DO: a device
      // holds your keys, a connection holds only the ticks you gave it.
      if (typeof onUnpairConnection === 'function' && Array.isArray(connections) && connections.length) {
        const sec = section(tr('circle.mydata.connections'));
        for (const c of connections) {
          const row = document.createElement('div');
          row.className = 'cc-mydata__connection';
          row.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;gap:.6rem;padding:.35rem 0;';

          const left = document.createElement('div');
          const name = document.createElement('div');
          name.className = 'cc-mydata__connection-name';
          // A key is not a name; the stub keeps two unlabelled connections tellable apart.
          name.textContent = c.label || c.short;
          left.appendChild(name);

          // The two columns, as one honest line each.
          const sees = document.createElement('div');
          sees.className = 'cc-mydata__connection-sees';
          sees.style.cssText = 'opacity:.75;font-size:.9em;';
          sees.textContent = c.sees
            ? tr('circle.mydata.connection_sees', {
              what: [...c.sees.circles, ...(c.sees.device ? [tr('circle.mydata.connection_device_section')] : [])].join(', '),
            })
            // NOT "0 onderdelen": a connection that cannot read is a real shape, and saying so plainly
            // is the difference between an honest row and one that looks broken.
            : tr('circle.mydata.connection_acts_only');
          left.appendChild(sees);

          const does = document.createElement('div');
          does.className = 'cc-mydata__connection-does';
          does.style.cssText = 'opacity:.75;font-size:.9em;';
          does.textContent = tr('circle.mydata.connection_does', { count: c.opCount });
          left.appendChild(does);
          row.appendChild(left);

          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'cc-btn cc-btn--quiet cc-mydata__connection-unpair';
          b.textContent = tr('circle.mydata.connection_unpair');
          b.addEventListener('click', () => onUnpairConnection(c.viewPubKey));
          row.appendChild(b);
          sec.appendChild(row);
        }
        container.appendChild(sec);
      }
    },
    'connection-add': () => {
      // ── pair a new connection ──────────────────────────────────────────────────────────────────
      // Three steps on purpose. A person pastes what the other screen shows; picks, from three, the code that
      // screen shows (the screen door: a planted offer yields a code they cannot find on their screen); and only
      // THEN sees what they are about to hand over — deciding before you can see the choices is not consent.
      if (screenPairing && connectionChoices) {
        const sec = section(tr('circle.mydata.connection_add'));
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'cc-mydata__connection-offer';
        input.placeholder = tr('circle.mydata.connection_offer_placeholder');
        input.style.cssText = 'width:100%;box-sizing:border-box;margin-bottom:.4rem;';
        sec.appendChild(input);

        const note = document.createElement('div');
        note.className = 'cc-mydata__connection-note';
        note.style.cssText = 'font-size:.9em;opacity:.75;min-height:1.2em;';
        sec.appendChild(note);

        // the screen door's step: three codes and 'none of these'
        const codesBox = document.createElement('div');
        codesBox.className = 'cc-mydata__connection-codes';
        codesBox.hidden = true;
        sec.appendChild(codesBox);

        const picker = document.createElement('div');
        picker.className = 'cc-mydata__connection-picker';
        picker.hidden = true;
        sec.appendChild(picker);

        const tickList = (title, items, idOf, labelOf) => {
          const wrap = document.createElement('div');
          wrap.style.cssText = 'margin:.4rem 0;';
          const h = document.createElement('div');
          h.textContent = title;
          h.style.cssText = 'font-weight:600;margin-bottom:.2rem;';
          wrap.appendChild(h);
          for (const it of items) {
            const line = document.createElement('label');
            line.style.cssText = 'display:flex;gap:.4rem;align-items:center;padding:.1rem 0;';
            const cb = document.createElement('input');
            cb.type = 'checkbox';   // sets: form — what the connection is offered
            cb.value = idOf(it);
            const txt = document.createElement('span');
            txt.textContent = labelOf(it);
            line.append(cb, txt);
            wrap.appendChild(line);
          }
          return wrap;
        };

        // WHICH SELF the screen is for, on a device holding more than one (the active self preselected)
        const selfChoice = connectionChoices.self ?? { required: false, options: [], preset: null };
        let selfSelect = null;
        if (selfChoice.required) {
          const wrap = document.createElement('label');
          wrap.style.cssText = 'display:flex;gap:.4rem;align-items:center;margin:.4rem 0;';
          const h = document.createElement('span');
          h.textContent = tr('circle.mydata.connection_as_self');
          selfSelect = document.createElement('select');
          selfSelect.className = 'cc-mydata__connection-self';
          const none = document.createElement('option');
          none.value = '';
          none.textContent = tr('circle.mydata.connection_pick_self');
          selfSelect.appendChild(none);
          for (const o of selfChoice.options) {
            const opt = document.createElement('option');
            opt.value = o.id;
            opt.textContent = o.id === 'default' ? (o.name || tr('circle.persona_default_name')) : (o.name || o.id);
            selfSelect.appendChild(opt);
          }
          selfSelect.value = selfChoice.preset ?? '';
          wrap.append(h, selfSelect);
          picker.appendChild(wrap);
        }

        const opsBox = tickList(tr('circle.mydata.connection_may_do'), connectionChoices.ops ?? [],
          (o) => o.id, (o) => o.label || o.id);
        const secBox = tickList(tr('circle.mydata.connection_may_see'), connectionChoices.sections ?? [],
          (x) => x.id, (x) => x.label || tr('circle.mydata.connection_device_section'));
        picker.append(opsBox, secBox);

        const confirm = document.createElement('button');
        confirm.type = 'button';
        confirm.className = 'cc-btn cc-btn--quiet cc-mydata__connection-confirm';
        confirm.textContent = tr('circle.mydata.connection_confirm');
        picker.appendChild(confirm);

        // A refusal names ITS OWN reason rather than a generic "invalid": a mistyped code, a code from a newer
        // version, a code for something else, a wrong pick and a late one are different problems.
        const refused = (reason) => { note.textContent = tr(`circle.mydata.connection_offer_${reason || 'unreadable'}`); };
        const reset = () => { codesBox.hidden = true; codesBox.textContent = ''; picker.hidden = true; };
        let label = null;
        input.addEventListener('input', async () => {
          reset();
          const text = input.value.trim();
          if (text === '') { note.textContent = ''; screenPairing.cancel(); return; }
          const r = await screenPairing.offer(text);
          if (input.value.trim() !== text) return;   // typed on meanwhile: the newer text answers
          if (!r.ok) { refused(r.reason); return; }
          label = r.label || r.viewPubKey.slice(0, 8);
          note.textContent = tr('circle.mydata.connection_pick_code');
          const choose = async (code) => {
            const p = await screenPairing.pick(code);
            codesBox.hidden = true; codesBox.textContent = '';
            if (!p.ok) { refused(p.reason); return; }
            note.textContent = tr('circle.mydata.connection_recognised', { name: label });
            picker.hidden = false;
          };
          for (const code of r.codes) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'cc-btn cc-btn--quiet cc-mydata__connection-code';
            b.dataset.code = code;
            b.textContent = code;
            b.style.cssText = 'font-family:monospace;letter-spacing:.15em;margin:.2rem .4rem .2rem 0;';
            b.addEventListener('click', () => choose(code));
            codesBox.appendChild(b);
          }
          const none = document.createElement('button');
          none.type = 'button';
          none.className = 'cc-btn cc-btn--quiet cc-mydata__connection-none';
          none.textContent = tr('circle.mydata.connection_none_of_these');
          none.addEventListener('click', () => choose(''));
          codesBox.appendChild(none);
          codesBox.hidden = false;
        });

        confirm.addEventListener('click', async () => {
          if (!screenPairing.picked) { refused('pairing-no-pick'); return; }
          // no self chosen where one must be: say so, grant nothing
          if (selfSelect && !selfSelect.value) { note.textContent = tr('circle.mydata.connection_pick_self'); return; }
          const picked = (box) => [...box.querySelectorAll('input[type=checkbox]')].filter((c) => c.checked).map((c) => c.value);
          const r = await screenPairing.grant({
            ops: picked(opsBox), sections: picked(secBox),
            ...(selfSelect ? { persona: selfSelect.value } : {}),
          });
          if (!r.ok) { refused(r.reason); if (r.reason === 'nothing-picked') return; }
          input.value = ''; if (r.ok) note.textContent = ''; reset();
          if (typeof onPaired === 'function') onPaired();
        });
        container.appendChild(sec);
      }
    },
    // ── Apparaten: the device acts, each a button of its own (gated on its callback: the section only appears where the
    // host wired the existing ceremony) ──────────────────────────────────────────────────────────────────────────────
    // Add-a-device: run the enroll-device ceremony ON THIS device (the phrase is typed here, never on a device that
    // already has authority).
    'device-add': () => actionSection([['cc-mydata__enroll', 'circle.mydata.enroll_device', onEnroll]]),
    // The replace ceremony: after a restore, retire every other device in one act.
    'device-replace': () => actionSection([['cc-mydata__replace', 'circle.mydata.replace_device', onReplaceDevice]]),
    // The member's choice of which device others deliver to first (their primary contact address).
    'device-primary': () => actionSection([['cc-mydata__primary', 'circle.mydata.make_primary', onMakePrimary]]),
    // A companion node of your own: claim it with the line it prints in its log.
    'companion-claim': () => actionSection([['cc-mydata__claim-companion', 'circle.companionClaim.button', onClaimCompanion]]),
    // A household bot's `/koppel` link, pasted: link this person's Basis identity to their row there. The host opens
    // the identity-link sheet (the same one an arriving `#koppel-bot=` link opens); false = not a bot's link.
    'bot-link': () => {
      if (typeof onLinkBot !== 'function') return;
      const sec = actionSection([['cc-mydata__link-bot', 'circle.identityLink.open', () => {
        form.hidden = !form.hidden;
        if (!form.hidden) input.focus?.();
      }]]);
      const form = document.createElement('div');
      form.className = 'cc-mydata__link-bot-form';
      form.hidden = true;
      const hint = document.createElement('p');
      hint.className = 'cc-mydata__hint';
      hint.textContent = tr('circle.identityLink.paste_link');
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'cc-mydata__link-bot-input';
      input.setAttribute('aria-label', tr('circle.identityLink.paste_link'));
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'cc-btn cc-btn--quiet cc-mydata__link-bot-go';
      go.textContent = tr('circle.identityLink.open');
      const note = document.createElement('p');
      note.className = 'cc-mydata__hint cc-mydata__link-bot-note';
      go.addEventListener('click', () => {
        const text = input.value.trim();
        if (!text) return;
        note.textContent = onLinkBot(text) === false ? tr('circle.identityLink.not_a_link') : '';
        if (!note.textContent) { input.value = ''; form.hidden = true; }
      });
      form.append(hint, input, go, note);
      sec.appendChild(form);
    },
    // ── Herstel: the way back, in a group of its own ────────────────────────────────────────────────────────────────
    'recovery-phrase': () => actionSection([['cc-mydata__mnemonic', 'circle.mydata.view_mnemonic', onViewMnemonic]]),
    'restore': () => actionSection([['cc-mydata__restore', 'circle.mydata.restore', onRestore]]),
    // The recovery file: the circle list sealed to the phrase — the pod-less way back.
    'recovery-file': () => actionSection([
      ['cc-mydata__recovery-export', 'circle.mydata.recovery_export', onExportRecovery],
      ['cc-mydata__recovery-import', 'circle.mydata.recovery_import', onImportRecovery],
    ]),
    // After a restore (or any time): which of the person's personas this device also gets — the phrase is typed here.
    'personas-receive': () => actionSection([['cc-mydata__receive-personas', 'circle.mydata.receive_personas', onReceivePersonas]]),
    'storage': () => {
      // ── where your data lives ─────────────────────────────────────────────────
      const storage = section(tr('circle.mydata.storage'));
      const status = podStatus.signedIn
        ? tr('circle.mydata.pod_signed_in', { webid: podStatus.webid ?? '' })
        : tr('circle.mydata.pod_local');
      storage.appendChild(kv(tr('circle.mydata.pod'), status));
      // a sign-in that came back failed says so here, where the person looks for it — with the reason it gave
      if (!podStatus.signedIn && podStatus.signInError) {
        const failed = document.createElement('p');
        failed.className = 'cc-mydata__hint cc-mydata__signin-failed';
        failed.textContent = `${tr('circle.mydata.pod_sign_in_failed')} (${podStatus.signInError})`;
        storage.appendChild(failed);
      }
      // With no pod, say what that COSTS — here, where the state is shown, not at the moment someone tries to
      // leave with their things. A wipe-and-restore walk (2026-08-02) proved the phrase brings back the
      // identity and no circles; learning that while switching devices is learning it too late to act on.
      if (!podStatus.signedIn) {
        const localNote = document.createElement('p');
        localNote.className = 'cc-mydata__hint';
        localNote.textContent = tr('circle.mydata.pod_local_consequence');
        storage.appendChild(localNote);
      }
      // Sign in to a real Solid pod (reuses src/web/podAuth.js) — sealed circles then store there.
      // WHICH POD PROVIDER: a field, as mobile has. The walk found web going straight to Inrupt PodSpaces — a person with
      // any other pod (and the repo's own test pod) could not connect from the web. Pre-filled with the default, the
      // known providers offered as suggestions; what is typed is what sign-in uses.
      if (!podStatus.signedIn && typeof onSignIn === 'function') {
        const issuer = document.createElement('input');
        issuer.type = 'url';
        issuer.className = 'cc-mydata__issuer';
        issuer.value = podIssuerDefault ?? '';
        issuer.placeholder = tr('circle.mydata.pod_issuer');
        issuer.setAttribute('aria-label', tr('circle.mydata.pod_issuer'));
        issuer.dataset.role = 'pod-issuer';
        if (Array.isArray(podIssuers) && podIssuers.length) {
          const list = document.createElement('datalist');
          list.id = 'cc-pod-issuers';
          for (const i of podIssuers) { const o = document.createElement('option'); o.value = i.url; o.label = i.name ?? i.url; list.appendChild(o); }
          storage.appendChild(list);
          issuer.setAttribute('list', list.id);
        }
        storage.appendChild(issuer);
        const signIn = document.createElement('button');
        signIn.type = 'button';
        signIn.className = 'cc-mydata__signin';
        signIn.textContent = tr('circle.mydata.pod_sign_in');
        signIn.addEventListener('click', () => onSignIn(issuer.value.trim() || null));
        storage.appendChild(signIn);
      }
      if (dataLocation.podRoot) storage.appendChild(kv(tr('circle.mydata.pod_root'), dataLocation.podRoot));
      // signed in: the way out again (the phone has had it since the pod moved under the gear)
      if (podStatus.signedIn && typeof onSignOut === 'function') {
        const out = document.createElement('button');
        out.type = 'button';
        out.className = 'cc-btn cc-btn--quiet cc-mydata__signout';
        out.textContent = tr('circle.mydata.pod_signout');
        out.addEventListener('click', () => onSignOut());
        storage.appendChild(out);
      }
      container.appendChild(storage);
    },
  };
  container.classList.add('cc-settings-group');
  for (const id of (Array.isArray(only) ? only : [])) {
    const before = container.children.length;
    painters[id]?.();
    for (let k = before; k < container.children.length; k += 1) container.children[k].dataset.section = id;
  }
  return container;

  // ── helpers ──
  /** A section of one act or two (the button says what it does, so no heading); nothing when no act is wired. */
  function actionSection(acts) {
    const wired = acts.filter(([, , fn]) => typeof fn === 'function');
    if (!wired.length) return null;
    const s = document.createElement('section');
    s.className = 'cc-mydata__section cc-mydata__section--acts';
    for (const [cls, key, fn] of wired) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `cc-mydata__action ${cls}`;
      b.textContent = tr(key);
      b.addEventListener('click', () => fn());
      s.appendChild(b);
    }
    container.appendChild(s);
    return s;
  }
  function section(titleText) {
    const s = document.createElement('section');
    s.className = 'cc-mydata__section';
    const h = document.createElement('h3');
    h.className = 'cc-mydata__section-title';
    h.textContent = titleText;
    s.appendChild(h);
    return s;
  }
  function kv(key, value) {
    const row = document.createElement('div');
    row.className = 'cc-mydata__kv';
    const k = document.createElement('span');
    k.className = 'cc-mydata__k';
    k.textContent = key;
    const v = document.createElement('span');
    v.className = 'cc-mydata__v';
    v.textContent = value;
    row.appendChild(k);
    row.appendChild(v);
    return row;
  }
}
