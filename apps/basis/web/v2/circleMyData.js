/**
 * basis v2 — "My data" screen (web DOM renderer, privacy + diagnostics).
 *
 * A read-only surface that retires stoop's privacy + metrics + data-location
 * pages: WHERE your data lives (pod root / relay, `getDataLocation` +
 * `podSignInStatus`), the privacy disclosure (`getPrivacyNotice`), and a usage
 * snapshot (`getMetrics`). Pure render — the host (`circleApp.js` showMyData)
 * loads the stoop ops and passes the results. The key-management actions
 * (back up · view recovery phrase · restore) are rendered when the host
 * injects the matching callbacks; each launches an existing wizard/skill.
 */

import { renderUserLlmSettings } from './userLlmSettings.js';
import { renderThemeToggle } from './themeToggle.js';
import { RETENTION_CHOICES_DAYS } from '../../src/v2/retentionPref.js';

export function renderCircleMyData(container, {
  dataLocation = {},
  podStatus = {},
  privacy = [],
  metrics = {},
  t,
  onBack,
  onSignIn,
  onBackup,
  onViewMnemonic,
  onRestore,
  notifications,
  onToggleNotifications,
  // The two delivery settings (2026-07-28). One object, because they are two knobs on one question.
  delivery,               // { sendReceipts, allowFallback } — absent ⇒ the section is omitted
  onSetDelivery,          // (patch) => void
  // P1 §4 tail — how long this device keeps conversations. `retentionDays` = the current choice;
  // `onSetRetention(days)` = the pick. Absent ⇒ the section is omitted (unchanged surface).
  retentionDays = null,
  onSetRetention = null,
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
  onOpenRelayPanel,       // Objective D / Surface 4:  => void — open the set-relay op in the docked
                          // side-panel (openPagePanel). When provided, the relay row is an entry button that
                          // routes through the generic panel instead of the bespoke inline form below.
} = {}) {
  if (!container) return container;
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.className = 'cc-mydata';

  const header = document.createElement('div');
  header.className = 'cc-mydata__header';
  if (typeof onBack === 'function') {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'cc-mydata__back';
    back.textContent = tr('circle.mydata.back');
    back.addEventListener('click', () => onBack());
    header.appendChild(back);
  }
  const title = document.createElement('h2');
  title.className = 'cc-mydata__title';
  title.textContent = tr('circle.mydata.title');
  header.appendChild(title);
  container.appendChild(header);

  // ── where your data lives ─────────────────────────────────────────────────
  const storage = section(tr('circle.mydata.storage'));
  const status = podStatus.signedIn
    ? tr('circle.mydata.pod_signed_in', { webid: podStatus.webid ?? '' })
    : tr('circle.mydata.pod_local');
  storage.appendChild(kv(tr('circle.mydata.pod'), status));
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
  if (!podStatus.signedIn && typeof onSignIn === 'function') {
    const signIn = document.createElement('button');
    signIn.type = 'button';
    signIn.className = 'cc-mydata__signin';
    signIn.textContent = tr('circle.mydata.pod_sign_in');
    signIn.addEventListener('click', () => onSignIn());
    storage.appendChild(signIn);
  }
  if (dataLocation.podRoot) storage.appendChild(kv(tr('circle.mydata.pod_root'), dataLocation.podRoot));
  if (dataLocation.relayOperator || dataLocation.relayUrl) {
    storage.appendChild(kv(tr('circle.mydata.relay'), [dataLocation.relayOperator, dataLocation.relayUrl].filter(Boolean).join(' · ')));
  }
  // In-app relay setting — point the no-server cross-device relay at a reachable server WITHOUT a rebuild.
  // Objective D / Surface 4: when the host wires `onOpenRelayPanel`, the edit is routed through the
  // generic docked side-panel (openPagePanel's simple-form for the `set-relay` op) instead of the bespoke
  // inline field. The button is the entry point; the panel builds the form from set-relay's params + dispatches.
  if (typeof onOpenRelayPanel === 'function') {
    const row = document.createElement('div');
    row.className = 'cc-mydata__relay-edit';
    const current = document.createElement('span');
    current.className = 'cc-mydata__relay-note';
    current.textContent = tr('circle.mydata.relay_current', { url: relayUrl || relayEnvUrl || tr('circle.mydata.relay_off') });
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'cc-mydata__relay-open';
    open.textContent = tr('circle.mydata.relay_open');
    open.addEventListener('click', () => onOpenRelayPanel());
    const hint = document.createElement('p');
    hint.className = 'cc-mydata__relay-hint';
    hint.textContent = tr('circle.mydata.relay_hint');
    row.appendChild(current);
    row.appendChild(open);
    storage.appendChild(row);
    storage.appendChild(hint);
  } else if (typeof onSaveRelay === 'function') {
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
    save.className = 'cc-mydata__relay-save';
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
    storage.appendChild(row);
    storage.appendChild(hint);
  }
  container.appendChild(storage);

  // ── key management (S5) ─────────────────────────────────────────────────────
  // Back up / reveal recovery phrase / restore. Each is gated on its callback so
  // the section only appears where the host wired the (existing) wizard/skill.
  const acts = [
    ['cc-mydata__backup',   'circle.mydata.backup',         onBackup],
    ['cc-mydata__mnemonic', 'circle.mydata.view_mnemonic',  onViewMnemonic],
    ['cc-mydata__restore',  'circle.mydata.restore',        onRestore],
  ].filter(([, , fn]) => typeof fn === 'function');
  if (acts.length) {
    const keys = section(tr('circle.mydata.keys'));
    for (const [cls, key, fn] of acts) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `cc-mydata__action ${cls}`;
      b.textContent = tr(key);
      b.addEventListener('click', () => fn());
      keys.appendChild(b);
    }
    container.appendChild(keys);
  }

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
      toggle.className = 'cc-mydata__action cc-mydata__notif-toggle';
      toggle.textContent = n.subscribed ? tr('circle.mydata.notif_disable') : tr('circle.mydata.notif_enable');
      toggle.addEventListener('click', () => onToggleNotifications());
      notif.appendChild(toggle);
    }
    container.appendChild(notif);
  }

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
    btn.className = 'cc-mydata__action cc-mydata__address-sharing-toggle';
    btn.textContent = tr(shareNknAddress
      ? 'circle.mydata.address_sharing_toggle_on'
      : 'circle.mydata.address_sharing_toggle_off');
    btn.addEventListener('click', () => onSetShareAddress(!shareNknAddress));
    sec.appendChild(btn);

    container.appendChild(sec);
  }

  // ── how long this device keeps conversations (P1 §4 tail) ──────────────────
  // ONE control, for the chat window only — the one number a person has an opinion about. The line
  // under it says what happens to the rest, because "older messages are removed" would be a lie about
  // the audit trail, which compacts into a summary instead of disappearing.
  if (typeof onSetRetention === 'function' && retentionDays != null) {
    const sec = section(tr('circle.mydata.retention'));

    const row = document.createElement('div');
    row.className = 'cc-mydata__retention';
    for (const days of RETENTION_CHOICES_DAYS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cc-mydata__action cc-mydata__retention-choice';
      if (days === retentionDays) b.classList.add('is-on');
      b.textContent = tr('circle.mydata.retention_days', { days });
      b.addEventListener('click', () => onSetRetention(days));
      row.appendChild(b);
    }
    sec.appendChild(row);

    const note = document.createElement('p');
    note.className = 'cc-mydata__retention-note';
    note.textContent = tr('circle.mydata.retention_note');
    sec.appendChild(note);

    container.appendChild(sec);
  }

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

  // ── assistant endpoint (the member's own LLM + embedder) ────────────────────
  if (typeof onSaveUserLlm === 'function') {
    const holder = document.createElement('div');
    holder.className = 'cc-mydata__section';
    renderUserLlmSettings(holder, { current: userLlm || {}, onSave: onSaveUserLlm, validate: validateUserLlm, t: tr });
    container.appendChild(holder);
  }

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

  // ── usage ──────────────────────────────────────────────────────────────────
  const entries = Object.entries(metrics || {});
  if (entries.length) {
    const usage = section(tr('circle.mydata.usage'));
    for (const [k, v] of entries) {
      usage.appendChild(kv(k, typeof v === 'object' ? JSON.stringify(v) : String(v)));
    }
    container.appendChild(usage);
  }
  return container;

  // ── helpers ──
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
