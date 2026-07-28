// Feedback surface for basis — hosts the feedback-pipeline bot inside the chat shell.
// basis's free-text path is otherwise a dead end; when a thread is in FEEDBACK MODE
// (entered via /feedback), free text is routed to the bot, which runs the on-device floor +
// the same review/consent journey as Telegram.
//
// M1.4 — the bot is CO-HOSTED on the participant's shared @onderling/core InternalBus via the
// production InternalBusBridge (no network), and consent is SIGNED with the participant's own
// identity (so a verify-enabled project accepts it). The bot OWNS its LLM route (resolved from
// config.llm via the M0 guardrail — never a separate setLlmRoute here), so raw pre-consent text
// can only reach a safe (local/loopback/attested) model. DOM-free + testable: the host injects
// `emit(reply)` — the sink that renders a bot reply ({chatId, text, buttons}) into the thread.

import { InternalBus } from '@onderling/core';
// Single sanctioned import point into feedback (F1 boundary — the package `./public` barrel;
// relative until the F3 physical carve makes it a published-package specifier).
import {
  InternalBusBridge, connectFeedbackParticipant, BasisBot, InMemoryCentralPod,
  validateProjectConfig, exampleProjectConfig, applyLlmRoute, assertCleanRouteSafe,
} from 'onderling-feedback/public';
// Privacy-first logging (web ≡ mobile). PII-safe by construction — we log event CODES + scalar counts here,
// never message text, points, or identities. A dump handle is exposed so a bug report / debug can read it.
import { log, dumpLogs, formatLogs } from '@onderling/logger';
// Property-layer charter consent (shared, pure): given the project's declared charter, collect the
// participant's opt-in coarse attributes + package what rides the contribution. See charterConsent.js.
import {
  charterFromConfig, consentItems, emptyConsent, setConsentValue, toggleConsent, consentRelease, consentWarning,
} from './charterConsent.js';
// Per-circle privacy state — the discrete indicator model (§10c). Pure; the shell renders from it.
import { circlePrivacyState } from './circlePrivacyState.js';
// The anonymous bug-report packager (shared, pure). Carries NO identity — see bugReport.js.
import { buildReportEnvelope } from './bugReport.js';
// REUSE the restore wizard's mnemonic validation (word-count / 12-or-24) rather than reimplementing it — the
// same helpers the web/RN restore wizards use. No mnemonic/crypto logic lives here: the reveal/restore is done
// by the host skills (revealOwnerPhrase / restoreOwnerPhrase) reached through the injected `callSkill`.
import { isMnemonicValid, mnemonicWordCount } from '../core/wizards/restoreFromMnemonicState.js';

// One place both shells load, so the dump is retrievable on either without extra wiring. (A user-facing
// "Report a problem" screen that shows + sends this is the next logging slice.)
if (typeof globalThis !== 'undefined' && !globalThis.onderlingDumpLogs) {
  globalThis.onderlingLogs = dumpLogs;
  globalThis.onderlingDumpLogs = () => formatLogs();
}

// "Report a problem" copy — the PII-safe framing + trigger labels, localised in-place. The feedback surface
// is outside the circle `t()` system (the bot owns its i18n via config.language); we mirror that here with a
// 2-language dict so both strings live ONCE, in shared code (web ≡ mobile by construction). The `intro`
// promises what the log CANNOT contain — the guarantee the logger enforces by construction (no message text,
// names, or addresses; only event codes + counts).
const REPORT_STRINGS = {
  nl: {
    header: '🛠 Probleem melden',
    intro:  'Hieronder staan technische notities van je apparaat. Ze bevatten géén berichten, namen of adressen — alleen gebeurteniscodes en aantallen. Bekijk ze en kopieer ze als je iets wilt melden.',
    empty:  '(nog niets vastgelegd)',
    hint:   'Werkt er iets niet?',
    button: '🛠 Probleem melden',
    send:      '📨 Anoniem versturen',
    sent_ok:   '✅ Bedankt — je anonieme melding is verstuurd.',
    sent_fail: '⚠ Versturen is niet gelukt. Je kunt de notities kopiëren en handmatig melden.',
    no_sink:   'ℹ Versturen is hier niet ingesteld. Kopieer de notities om ze te melden.',
  },
  en: {
    header: '🛠 Report a problem',
    intro:  'Below are technical notes from your device. They contain no messages, names, or addresses — only event codes and counts. Review and copy them if you want to report something.',
    empty:  '(nothing recorded yet)',
    hint:   'Something not working?',
    button: '🛠 Report a problem',
    send:      '📨 Send anonymously',
    sent_ok:   '✅ Thanks — your anonymous report was sent.',
    sent_fail: '⚠ Sending failed. You can copy the notes and report them manually.',
    no_sink:   'ℹ Sending isn’t set up here. Copy the notes to report them.',
  },
};

// "Secure your access" copy — the no-login participant's identity IS their owner-root recovery phrase (the
// feedback pseudonym derives from it), so backing it up + restoring it belongs IN the feedback onboarding.
// Same 2-language dict pattern as REPORT_STRINGS (web ≡ mobile: the strings live ONCE, in shared code). The
// warning states the hard truth the crypto enforces — the phrase IS the access and we cannot recover it.
const ACCESS_STRINGS = {
  nl: {
    hint:            '🔐 Beveilig je toegang',
    backup_button:   '🔑 Toegang veiligstellen',
    restore_button:  '♻ Herstellen met een zin',
    backup_header:   '🔑 Je herstelzin',
    backup_intro:    'Dit is je toegang. Bewaar deze woorden op een veilige plek — wie ze heeft, is jou. We kunnen ze niet voor je herstellen. Selecteer en kopieer de zin.',
    backup_fail:     '⚠ Je herstelzin kon niet worden opgehaald. Probeer het later opnieuw.',
    restore_prompt:  'Plak je herstelzin (12 of 24 woorden) en verstuur. Zo herstel je je toegang op dit apparaat. Typ /stop om te annuleren.',
    restore_invalid: '⚠ Dat lijkt geen geldige herstelzin — verwacht 12 of 24 woorden. Plak de zin opnieuw of typ /stop om te annuleren.',
    restore_ok:      '✅ Toegang hersteld. Herlaad de app om verder te gaan met je herstelde identiteit.',
    restore_fail:    '⚠ Herstellen is niet gelukt: {msg}',
    restore_cancel:  'Herstellen geannuleerd.',
  },
  en: {
    hint:            '🔐 Secure your access',
    backup_button:   '🔑 Back up your access',
    restore_button:  '♻ Restore from a phrase',
    backup_header:   '🔑 Your recovery phrase',
    backup_intro:    'This is your access. Save these words somewhere safe — whoever has them is you. We can’t recover them for you. Select and copy the phrase.',
    backup_fail:     '⚠ Couldn’t retrieve your recovery phrase. Please try again later.',
    restore_prompt:  'Paste your recovery phrase (12 or 24 words) and send. This restores your access on this device. Type /stop to cancel.',
    restore_invalid: '⚠ That doesn’t look like a valid recovery phrase — expected 12 or 24 words. Paste it again, or type /stop to cancel.',
    restore_ok:      '✅ Access restored. Reload the app to continue with your restored identity.',
    restore_fail:    '⚠ Restore failed: {msg}',
    restore_cancel:  'Restore cancelled.',
  },
};

// Re-export so the app can create + CACHE the participant's own pod outside the surface — a language
// switch rebuilds the surface (fresh /help in the new language) while REUSING the same pods, so the
// participant's local Stage-1 contributions survive the switch (mirrors mobile FeedbackThreadScreen).
export { InMemoryCentralPod };

/**
 * @param {object} a
 * @param {object} [a.config]     a feedback ProjectConfig (defaults to the worked example). The
 *                                LLM route lives in `config.llm` (set config.llm.baseURL in the
 *                                browser — the bot owns the route).
 * @param {object} [a.pod]        a CentralPod (value/Promise/thunk); defaults to in-memory
 * @param {object} [a.bus]        the participant's shared InternalBus (defaults to a private one)
 * @param {{publicKey:string,sign:(b:Uint8Array)=>Uint8Array}} [a.identity]  the participant's SIGNER
 *                                (seam 4 — a `{publicKey, sign()}` closure from the basis vault;
 *                                consent is signed with it. A raw `{publicKey, privateKey}` keypair is
 *                                also accepted for standalone use. The signer is only wired to the bot
 *                                when the project requires signatures — see the `privacy.verify` gate below.)
 * @param {(chatId:string)=>object} [a.identityFor]  per-thread signer (defaults to `identity`)
 * @param {(reply:{chatId:string,text:string,buttons?:Array})=>void} a.emit  render sink
 * @param {(envelope:object)=>Promise<{ok:boolean, reason?:string}>} [a.sendReport]  ANONYMOUS bug-report sink.
 *                                Receives the identity-free envelope (buildReportEnvelope). Defaults to a safe
 *                                async no-op returning `{ok:false, reason:'no-sink'}` (the real target — a
 *                                bot+relay+dev pod — is deliberately out of scope; only the interface is here).
 * @param {string} [a.app]        non-identifying app name for the report envelope (e.g. 'basis')
 * @param {string} [a.version]    non-identifying app/build version for the report envelope
 * @param {(origin:string, opId:string, args:object)=>Promise<any>} [a.callSkill]  the host callSkill seam,
 *                                used ONLY for the "Secure your access" affordances — reveal the owner-root
 *                                recovery phrase (`revealOwnerPhrase`) + restore one (`restoreOwnerPhrase`),
 *                                both on the `household` agent. No mnemonic/crypto logic lives here.
 * @param {boolean} [a.accessButton]  web idiom — offer "Back up your access" + "Restore from a phrase" as
 *                                bubble-buttons in the onboarding greeting (mirrors `reportButton`). Mobile can
 *                                surface the same via chrome using the exposed `backup()`/`restore()` methods.
 */
export function createFeedbackSurface({ config, projectId, lang, pod, centralPod, controlStore, bus, identity, identityFor, llmBaseURL, llmModel, emit, verify, reportButton, sendReport, app, version, callSkill, accessButton } = {}) {
  if (typeof emit !== 'function') throw new Error('createFeedbackSurface: emit(reply) is required');
  // Injected ANONYMOUS bug-report sink. Default is a safe async no-op: the real target (a bot+relay+dev
  // pod) is wired by the host when available; without it the send affordance degrades to "copy the notes".
  // It only ever receives the identity-free envelope from buildReportEnvelope (see bugReport.js).
  const sink = (typeof sendReport === 'function') ? sendReport : async () => ({ ok: false, reason: 'no-sink' });
  const cfg = validateProjectConfig(config || exampleProjectConfig);
  // the dispatcher's projectId drives the verify-round match; without an explicit config it defaults to
  // exampleProjectConfig.projectId, which won't equal the ACTIVATION projectId (the bot/cohort) — so the
  // verify poll filtered out the lead's round. Bind it to the activation project.
  if (projectId) cfg.projectId = projectId;
  // `lang` lets the PARTICIPANT choose the bot's language (overriding the project default) — it drives the
  // bot's strings + the on-device pipeline language (clean/summarise), so the whole thread + cards localise.
  if (lang === 'nl' || lang === 'en') cfg.language = { ...cfg.language, preferred: lang };
  // route ownership → the bot: the route lives in config.llm; `llmBaseURL`/`llmModel` are the browser's
  // no-env convenience to point config.llm at its (local/loopback) endpoint + the model that endpoint
  // actually serves (the default `qwen2.5:7b-instruct` 404s on a Privatemode proxy). Install + M0 check.
  if (llmBaseURL) cfg.llm.baseURL = llmBaseURL;
  if (llmModel) cfg.llm.model = llmModel;
  applyLlmRoute(cfg.llm || {});
  assertCleanRouteSafe(cfg.llm || {});

  const sharedBus = bus || new InternalBus();
  // Verify-summary loop: a background poll surfaces a round the PM opens WHILE the app is open. `relay`
  // wraps the caller's emit to notice when a verify bubble is shown (its buttons carry fp:verify*) so the
  // poll doesn't re-summarise (re-open) the same round every tick; a user turn clears the guard.
  let awaitingVerify = false;
  const relay = (r) => {
    const isVerify = Array.isArray(r?.buttons) && r.buttons.some((b) => String(b?.id || b?.action || '').startsWith('fp:verify'));
    if (isVerify) awaitingVerify = true;
    // PII-safe: log the reply KIND + button count — never the text/points. (This is exactly the trace that
    // would have shown, on mobile, that consent emitted nothing.)
    log.info('feedback', 'emit', { kind: r?.kind || (isVerify ? 'verify' : 'text'), btns: (r?.buttons || []).length });
    emit(r);
  };
  // "Report a problem": surface the PII-safe on-device log for the user to review (and copy) — the user-facing
  // half of the logging model. Emitted DIRECTLY (not via `relay`/the bot): it's a surface affordance, not a bot
  // reply, so it must not touch the verify re-poll guard. Localised to the bot's language. Same code both shells.
  const emitReport = (threadId) => {
    const S = REPORT_STRINGS[cfg.language?.preferred === 'nl' ? 'nl' : 'en'];
    const body = formatLogs();
    log.info('feedback', 'report.open', { n: dumpLogs().length });   // PII-safe: only the record COUNT
    // The panel keeps the COPY affordance (logText/copyText) AND now offers an anonymous SEND button. The
    // button id (`fp:report:send`) routes back through `handle()` → `emitReportSend` in BOTH shells (web ≡
    // mobile): no platform-specific dispatch, only the trigger placement differs.
    emit({ chatId: String(threadId), kind: 'report', report: true, text: `${S.header}\n\n${S.intro}`, logText: body || S.empty, copyText: body, buttons: [{ id: 'fp:report:send', label: S.send }] });
  };
  // Anonymous SEND: package the PII-safe dump into an identity-free envelope (buildReportEnvelope) and hand
  // it to the injected sink, then emit a localised result bubble. `at` is injected at the call site so the
  // envelope is testable. Never touches the bot / verify guard — it's a surface affordance, same as emitReport.
  const emitReportSend = async (threadId) => {
    const S = REPORT_STRINGS[cfg.language?.preferred === 'nl' ? 'nl' : 'en'];
    const envelope = buildReportEnvelope({ records: dumpLogs(), app, version, at: Date.now() });
    log.info('feedback', 'report.send', { n: envelope.n });   // PII-safe: only the record COUNT
    let res;
    try { res = await sink(envelope); }
    catch (e) { log.error('feedback', 'report.send.fail', { err: String(e?.name || 'Error') }); res = { ok: false, reason: 'error' }; }
    const ok = !!res?.ok;
    const text = ok ? S.sent_ok : (res?.reason === 'no-sink' ? S.no_sink : S.sent_fail);
    log.info('feedback', 'report.sent', { ok, reason: String(res?.reason || '') });   // PII-safe: outcome only
    emit({ chatId: String(threadId), kind: 'report-result', text });
    return res;
  };

  // "Secure your access" — the no-login participant's identity IS their owner-root recovery phrase (the
  // feedback pseudonym derives from it). These affordances REVEAL it (back up) + RESTORE it on a new device,
  // via the host skills `revealOwnerPhrase` / `restoreOwnerPhrase` (household agent) through the injected
  // `callSkill`. No mnemonic/crypto logic here (it lives in those skills); validation reuses the restore
  // wizard's helpers. Emitted DIRECTLY (surface affordances, not bot turns) so they never touch the verify
  // re-poll guard. Localised to the bot's language. Same code both shells (web ≡ mobile by construction).
  const awaitingRestore = new Set();   // threadIds awaiting a pasted recovery phrase
  const A = () => ACCESS_STRINGS[cfg.language?.preferred === 'nl' ? 'nl' : 'en'];

  // Offer the two access affordances as bubble-buttons (web idiom; the taps route back through handle()).
  // ── Property-layer charter consent (participant side) ──────────────────────────────────────────
  // When the project declared a charter (config.charter — the PM's request for a FEW coarse background
  // attributes), offer an OPT-IN consent step: pick share/withhold per attribute (coarse buckets only),
  // see an on-device "may make you recognisable" warning, and the released values + charterHash ride the
  // contribution (handed to the bot as a structured data turn). Default = WITHHOLD. Reuses charterConsent.js.
  const CHARTER_STRINGS = {
    nl: {
      intro: 'Dit project vraagt (optioneel) een paar grove achtergrondkenmerken, om antwoorden te kunnen groeperen. Je kiest zelf wat je deelt.',
      share_btn: '➕ Achtergrond delen', skip_btn: 'Overslaan',
      ask: (p) => `${p}\nKies wat je wilt delen (of sla over):`,
      place_prompt: (p) => `${p}\nTyp je gemeente (of typ /overslaan):`,
      place_invalid: 'Dat lijkt geen gemeente — typ een plaatsnaam, of /overslaan.',
      skip_attr: 'Sla over',
      confirm_none: 'Je deelt geen achtergrondkenmerken.',
      confirm_head: (l) => `Je deelt: ${l}.`,
      warn: (n) => `⚠ In een kleine groep (±${n}) kan deze combinatie je herkenbaar maken.`,
      send_btn: '✓ Zo delen', none_btn: 'Toch niets delen',
      sent: '✓ Bedankt — je achtergrondkeuze is opgeslagen.',
      skipped: 'Oké — je deelt geen achtergrondkenmerken.',
    },
    en: {
      intro: 'This project optionally asks for a few coarse background details, to group answers. You choose what to share.',
      share_btn: '➕ Share background', skip_btn: 'Skip',
      ask: (p) => `${p}\nPick what to share (or skip):`,
      place_prompt: (p) => `${p}\nType your municipality (or type /skip):`,
      place_invalid: "That doesn't look like a place — type a municipality, or /skip.",
      skip_attr: 'Skip',
      confirm_none: "You'll share no background details.",
      confirm_head: (l) => `You'll share: ${l}.`,
      warn: (n) => `⚠ In a small group (~${n}) this combination may make you recognisable.`,
      send_btn: '✓ Share these', none_btn: "Don't share any",
      sent: '✓ Thanks — your background choice is saved.',
      skipped: "Okay — you'll share no background details.",
    },
  };
  const C = () => CHARTER_STRINGS[cfg.language?.preferred === 'nl' ? 'nl' : 'en'];
  let projectCharter = null;
  try { projectCharter = charterFromConfig(cfg.projectId, cfg.charter); } catch { projectCharter = null; }
  const charterState = new Map();          // threadId -> { profile, idx }
  const awaitingCharterText = new Set();   // threadIds awaiting a typed place value

  const emitCharterIntro = (threadId) => {
    emit({ chatId: String(threadId), kind: 'charter', charter: true, text: C().intro, buttons: [
      { id: 'fp:charter:start', label: C().share_btn }, { id: 'fp:charter:skip', label: C().skip_btn },
    ] });
  };
  function emitCharterStep(threadId) {
    const st = charterState.get(String(threadId)); if (!st) return;
    const items = consentItems(projectCharter);
    if (st.idx >= items.length) { emitCharterConfirm(threadId); return; }
    const it = items[st.idx];
    if (Array.isArray(it.buckets) && it.buckets.length) {
      emit({ chatId: String(threadId), kind: 'charter', charter: true, text: C().ask(it.purpose), buttons: [
        ...it.buckets.map((b) => ({ id: `fp:charter:pick:${it.key}:${b}`, label: b })),
        { id: `fp:charter:none:${it.key}`, label: C().skip_attr },
      ] });
    } else {
      awaitingCharterText.add(String(threadId));
      emit({ chatId: String(threadId), kind: 'charter', charter: true, text: C().place_prompt(it.purpose) });
    }
  }
  const beginCharter = (threadId) => { charterState.set(String(threadId), { profile: emptyConsent(cfg.projectId), idx: 0 }); emitCharterStep(threadId); };
  const charterPick = (threadId, key, bucket) => {
    const st = charterState.get(String(threadId)); if (!st) return;
    try { st.profile = toggleConsent(setConsentValue(st.profile, key, bucket), key, true); } catch { /* invalid bucket → withhold */ }
    st.idx += 1; emitCharterStep(threadId);
  };
  const charterNone = (threadId) => { const st = charterState.get(String(threadId)); if (st) { st.idx += 1; emitCharterStep(threadId); } };
  const charterText = (threadId, value) => {
    const st = charterState.get(String(threadId)); if (!st) return;
    awaitingCharterText.delete(String(threadId));
    const it = consentItems(projectCharter)[st.idx];
    if (value != null) {
      try { st.profile = toggleConsent(setConsentValue(st.profile, it.key, value), it.key, true); }
      catch { awaitingCharterText.add(String(threadId)); emit({ chatId: String(threadId), kind: 'charter', charter: true, text: C().place_invalid }); return; }
    }
    st.idx += 1; emitCharterStep(threadId);
  };
  function emitCharterConfirm(threadId) {
    const st = charterState.get(String(threadId)); if (!st) return;
    const rel = consentRelease(st.profile, projectCharter);
    const shared = Object.keys(rel.attributes);
    const warn = consentWarning(st.profile, projectCharter, cfg.cohortHint);   // cohortHint (§10b) enables the identifiability warning
    const head = shared.length ? C().confirm_head(shared.join(', ')) : C().confirm_none;
    emit({ chatId: String(threadId), kind: 'charter', charter: true,
      text: warn.warn ? `${head}\n${C().warn(warn.n)}` : head,
      buttons: [
        ...(shared.length ? [{ id: 'fp:charter:send', label: C().send_btn }] : []),
        { id: 'fp:charter:none-all', label: C().none_btn },
      ] });
  }
  const sendCharter = async (threadId) => {
    const st = charterState.get(String(threadId)); if (!st) return;
    const rel = consentRelease(st.profile, projectCharter);
    doneConsent.set(String(threadId), st.profile);   // keep the final consent for the privacy indicator (§10c)
    charterState.delete(String(threadId)); awaitingCharterText.delete(String(threadId));
    log.info('feedback', 'charter.send', { shared: Object.keys(rel.attributes).length });   // PII-safe: count only
    // Hand the release to the bot as a STRUCTURED data turn (not text): it sets the dispatcher's disclosure so
    // the ensuing consent's contributions carry it. The coarse values never touch the log.
    await (await clientFor(threadId)).send('', { data: { charter: rel } });
    // Property layer (cross-app reuse) — curate the disclosed COARSE values ONCE on the participant's profile,
    // readable by any app via getProfileProperties. Best-effort: no profile registry wired (e.g. no-login
    // without an agent) → the callSkill degrades (ok:false), never blocks the contribution.
    if (typeof callSkill === 'function') {
      for (const [k, v] of Object.entries(rel.attributes)) {
        try { await callSkill('agents', 'setProfileProperty', { id: 'default', key: k, value: v }); } catch { /* best-effort */ }
      }
    }
    emit({ chatId: String(threadId), kind: 'charter-result', charter: true, text: C().sent });
    emitPrivacyStatus(threadId);
  };
  const skipCharter = (threadId) => {
    doneConsent.set(String(threadId), emptyConsent(cfg.projectId));   // shared nothing
    charterState.delete(String(threadId)); awaitingCharterText.delete(String(threadId));
    emit({ chatId: String(threadId), kind: 'charter-result', charter: true, text: C().skipped });
    emitPrivacyStatus(threadId);
  };

  // ── Per-circle privacy INDICATOR (§10c) ──────────────────────────────────────────────────────────
  // A DISCRETE, honest state (quiet · sharing · ⚠ risk) computed from the participant's disclosure + the
  // warning heuristic. Emitted as a `privacy` status the shell renders (icon + a ⓘ to see/change); the ⚠ is
  // EARNED (only a real risk), neutral-not-green, tap → why + change. Indicator ≠ protection (it only reports).
  const doneConsent = new Map();   // threadId -> the final consent profile (for the indicator after consent)
  // §10b — the user's warnings toggle. Default ON (protective); turning it OFF is a DELIBERATE, ACKNOWLEDGED
  // choice (a confirmation), never a silent switch. In-memory here; a shell may persist via setWarnings().
  let warningsMode = 'normal';   // §10b graduated: 'normal' | 'minimal' (strong only) | 'off'
  const PRIVACY_ICON = { quiet: '🛡', sharing: '🛡', risk: '⚠️' };
  const PRIVACY_STRINGS = {
    nl: { quiet: 'Privacy: je deelt geen achtergrondkenmerken.', sharing: (l) => `Privacy: je deelt ${l}.`,
      risk_combo: (l) => `⚠️ Privacy: je deelt ${l} — deze combinatie kan je herkenbaar maken.`,
      risk_off: '⚠️ Privacy: waarschuwingen staan uit terwijl je gegevens deelt.',
      info_btn: 'ⓘ Bekijk/wijzig', change_btn: 'Wijzig wat je deelt',
      warn_normal_btn: 'Normale waarschuwingen', warn_min_btn: 'Alleen sterke waarschuwingen', warn_off_btn: 'Waarschuwingen uit',
      warn_off_ack: '⚠️ Waarschuwingen staan nu UIT — je krijgt geen melding meer als een combinatie je herkenbaar maakt. Zet ze weer aan wanneer je wilt.',
      warn_modes: { normal: 'normaal', minimal: 'alleen sterke', off: 'uit' },
      warn_set_ack: (m) => `✓ Privacy-waarschuwingen: ${m}.` },
    en: { quiet: 'Privacy: you share no background details.', sharing: (l) => `Privacy: you share ${l}.`,
      risk_combo: (l) => `⚠️ Privacy: you share ${l} — this combination may make you recognisable.`,
      risk_off: '⚠️ Privacy: warnings are off while you are sharing details.',
      info_btn: 'ⓘ View / change', change_btn: 'Change what you share',
      warn_normal_btn: 'Normal warnings', warn_min_btn: 'Only strong warnings', warn_off_btn: 'Turn warnings off',
      warn_off_ack: "⚠️ Warnings are now OFF — you won't be told when a combination could make you recognisable. Turn them back on any time.",
      warn_modes: { normal: 'normal', minimal: 'strong only', off: 'off' },
      warn_set_ack: (m) => `✓ Privacy warnings: ${m}.` },
  };
  const P = () => PRIVACY_STRINGS[cfg.language?.preferred === 'nl' ? 'nl' : 'en'];
  const privacyStateFor = (threadId) => circlePrivacyState({
    consent: doneConsent.get(String(threadId)) ?? charterState.get(String(threadId))?.profile,
    charter: projectCharter, warningsMode, n: cfg.cohortHint,
  });
  const setWarningsMode = (threadId, mode) => {
    warningsMode = (mode === 'minimal' || mode === 'off') ? mode : 'normal';
    if (threadId == null) return;   // boot-time restore (no thread) → set silently
    emit({ chatId: String(threadId), kind: 'privacy', privacy: true,
      text: warningsMode === 'off' ? P().warn_off_ack : P().warn_set_ack(P().warn_modes[warningsMode]) });
    emitPrivacyStatus(threadId);   // reflect the new state (off while sharing → structural ⚠)
  };
  const privacyText = (st) => {
    const l = st.shared.join(', ');
    if (st.level === 'risk') return st.reason === 'warnings-off' ? P().risk_off : P().risk_combo(l);
    return st.level === 'sharing' ? P().sharing(l) : P().quiet;
  };
  const emitPrivacyStatus = (threadId) => {
    const st = privacyStateFor(threadId);
    if (!st.applicable) return;   // no charter → nothing to show
    emit({ chatId: String(threadId), kind: 'privacy', privacy: true, level: st.level, icon: PRIVACY_ICON[st.level],
      text: `${PRIVACY_ICON[st.level]} ${privacyText(st)}`, buttons: [{ id: 'fp:privacy:info', label: P().info_btn }] });
  };
  const emitPrivacyInfo = (threadId) => {
    const st = privacyStateFor(threadId);
    emit({ chatId: String(threadId), kind: 'privacy', privacy: true, level: st.level, text: privacyText(st),
      buttons: [
        { id: 'fp:charter:start', label: P().change_btn },   // change → re-run the charter consent
        // graduated warnings (§10b) — offer the modes NOT currently active
        ...(warningsMode !== 'normal'  ? [{ id: 'fp:privacy:warnings:normal',  label: P().warn_normal_btn }] : []),
        ...(warningsMode !== 'minimal' ? [{ id: 'fp:privacy:warnings:minimal', label: P().warn_min_btn }] : []),
        ...(warningsMode !== 'off'     ? [{ id: 'fp:privacy:warnings:off',     label: P().warn_off_btn }] : []),
      ] });
  };

  const emitAccessOptions = (threadId) => {
    emit({ chatId: String(threadId), kind: 'access', access: true, text: A().hint, buttons: [
      { id: 'fp:access:backup',  label: A().backup_button },
      { id: 'fp:access:restore', label: A().restore_button },
    ] });
  };
  // BACK UP: reveal the owner-root phrase via the host skill, then surface it in a selectable/copyable bubble.
  // The phrase never leaves the device and is NEVER logged (PII-safe: we log only whether a phrase came back).
  const emitBackup = async (threadId) => {
    if (typeof callSkill !== 'function') { emit({ chatId: String(threadId), kind: 'access-result', access: true, text: A().backup_fail }); return { ok: false, reason: 'no-callSkill' }; }
    let res = null;
    try { res = await callSkill('household', 'revealOwnerPhrase', {}); }
    catch (e) { log.error('feedback', 'access.backup.fail', { err: String(e?.name || 'Error') }); }
    const raw = res && !res.error && (res.mnemonic ?? res.phrase ?? res.words);
    const phrase = Array.isArray(raw) ? raw.join(' ') : (raw ? String(raw) : '');
    log.info('feedback', 'access.backup', { ok: !!phrase });   // PII-safe: never the phrase itself
    if (!phrase) { emit({ chatId: String(threadId), kind: 'access-result', access: true, text: A().backup_fail }); return { ok: false }; }
    emit({ chatId: String(threadId), kind: 'access-reveal', access: true, reveal: true, text: `${A().backup_header}\n\n${A().backup_intro}\n\n${phrase}`, copyText: phrase });
    return { ok: true };
  };
  // RESTORE: prompt for a phrase; the next pasted text (see handle) is validated + installed via the host skill.
  const beginRestore = (threadId) => {
    awaitingRestore.add(String(threadId));
    emit({ chatId: String(threadId), kind: 'access', access: true, text: A().restore_prompt });
  };
  const submitRestorePhrase = async (threadId, phrase) => {
    const mnemonic = String(phrase || '').trim();
    if (!isMnemonicValid(mnemonic)) {
      log.info('feedback', 'access.restore.invalid', { words: mnemonicWordCount(mnemonic) });   // PII-safe: count only
      emit({ chatId: String(threadId), kind: 'access-result', access: true, text: A().restore_invalid });
      return { ok: false, reason: 'invalid' };   // stay awaiting — let them paste again (or /stop)
    }
    awaitingRestore.delete(String(threadId));
    let res = null;
    try { res = await callSkill('household', 'restoreOwnerPhrase', { mnemonic }); }
    catch (e) { log.error('feedback', 'access.restore.fail', { err: String(e?.name || 'Error') }); res = { ok: false, error: e?.message }; }
    const ok = !!res && !res.error && res.ok !== false;
    log.info('feedback', 'access.restore', { ok });   // PII-safe: outcome only, never the phrase
    emit({ chatId: String(threadId), kind: 'access-result', access: true, text: ok ? A().restore_ok : A().restore_fail.replace('{msg}', String(res?.error || 'restore-failed')) });
    return ok ? { ok: true, reloadRequired: !!res?.reloadRequired } : { ok: false, reason: res?.error };
  };
  const cancelRestore = (threadId) => {
    if (!awaitingRestore.has(String(threadId))) return false;
    awaitingRestore.delete(String(threadId));
    emit({ chatId: String(threadId), kind: 'access', access: true, text: A().restore_cancel });
    return true;
  };

  // Consent-outcome probe (PII-safe): the own pod is the Stage-1 write target for the no-login flow, so its
  // record count before/after a consent turn tells us definitively whether the write LANDED — without touching
  // the read-only feedback-pipeline. Counts only; never contents. Returns -1 when the pod isn't syncly countable.
  const ownPodCount = async () => {
    try { const p = typeof pod === 'function' ? await pod() : await pod; return typeof p?.list === 'function' ? p.list().length : -1; }
    catch { return -1; }
  };

  const pollTimers = new Map();   // threadId -> interval handle
  // Seam 4 (F2): the signer is wired to the bot ONLY when the project requires signatures. For a
  // non-verify project (today's example) the signer stays INERT — behaviour is exactly as before F2
  // (unsigned writes, no signer object crosses into the bot). A verify-enabled project gets the
  // per-thread signer, which the dispatcher uses to sign consent contributions (never the raw key).
  // the no-login central-pod route requires SIGNED contributions (the companion collector /
  // aggregation only accept signed records). `verify:true` turns on the signature path so `idFor` is
  // wired and the dispatcher signs each consented contribution with the participant's agent identity.
  if (verify) cfg.privacy = { ...(cfg.privacy || {}), verify: true };
  const idFor = cfg.privacy?.verify
    ? (identityFor || (identity ? () => identity : undefined))
    : undefined;

  // one co-hosted bot multiplexes all threads (keyed by chatId); pod resolved lazily so a real
  // CssCentralPod (built from the browser session after activation) can be supplied async.
  let botPromise = null;
  const bot = () => (botPromise ||= (async () => {
    const resolved = (typeof pod === 'function' ? await pod() : await pod) || new InMemoryCentralPod();
    // verify-summary loop (docs in apps/feedback-pipeline): when a central pod + a round-control store
    // are supplied, `pod` is the participant's OWN pod and the verified summary goes to `centralPod`.
    const resolvedCentral = typeof centralPod === 'function' ? await centralPod() : await centralPod;
    const bridge = new InternalBusBridge({ bus: sharedBus, address: 'fp-bot' });
    // The participant pseudonym IS the agent public key — the signature is computed over it, so the
    // central pod files + verifies under the same value (never a webid / device id). Falls back to the
    // default cc:<chatId> when no signer is wired (unsigned/legacy example flow).
    const participantFor = idFor ? (chatId) => idFor(chatId)?.publicKey || `cc:${chatId}` : undefined;
    const b = new BasisBot({ bridge, pod: resolved, centralPod: resolvedCentral ?? null, controlStore: controlStore ?? null, config: cfg, identityFor: idFor, participantFor });
    await b.start();
    return b;
  })());

  const clients = new Map();   // threadId -> participant bus client
  const clientFor = async (threadId) => {
    await bot();   // ensure the bot is co-hosted before a participant connects
    const id = String(threadId);
    if (!clients.has(id)) clients.set(id, connectFeedbackParticipant(sharedBus, { botAddress: 'fp-bot', chatId: id, onReply: (r) => relay(r) }));
    return clients.get(id);
  };

  const active = new Set();
  return {
    /** Enter feedback mode for a thread and show the bot's guidance, then check for a lead-triggered
     *  verification round (the verify-summary loop polls on contact-open; no-op when not wired). */
    async start(threadId, { greet = true } = {}) {
      active.add(String(threadId));
      log.info('feedback', 'surface.start', { verify: !!controlStore, collector: !!centralPod, greet: !!greet });
      // The greeting (help text + the report/access affordance bubbles) is ONBOARDING chrome. It is emitted +
      // persisted on the FIRST open; on a restore-from-reload the shell passes greet:false so it is NOT re-emitted
      // (the affordance buttons come back WITH the restored transcript, still functional — handle() matches on id),
      // otherwise greetings would stack in the stored transcript on every reload. The verify-round poll below is
      // NOT part of the greeting — it always runs.
      if (greet) {
        await (await clientFor(threadId)).send('/help');
        // Web offers the "Report a problem" trigger as a bubble-button (its idiom for feedback affordances, cf.
        // emitFeedbackLangOptions); mobile uses a header button and passes no `reportButton`. Either way the
        // tap/typed `/report` routes to `emitReport` below — the LOGIC is shared, only the trigger placement differs.
        if (reportButton) {
          const S = REPORT_STRINGS[cfg.language?.preferred === 'nl' ? 'nl' : 'en'];
          emit({ chatId: String(threadId), text: S.hint, buttons: [{ id: 'fp:report', label: S.button }] });
        }
        // "Secure your access" — offer BACK UP + RESTORE of the owner-root recovery phrase right in onboarding,
        // so a no-login participant can secure their pseudonymous identity + recover it on a new device. Web idiom
        // (bubble-buttons, mirrors reportButton); requires a wired callSkill (the host reveal/restore skills).
        if (accessButton && typeof callSkill === 'function') emitAccessOptions(threadId);
        // Charter consent — when the project declared a requested-attributes charter, offer the opt-in step.
        if (projectCharter) emitCharterIntro(threadId);
      }
      // poll the lead's /control/ round → on-device summary for verify. No open round is the normal case
      // (stay silent); surface only a genuine error so the user isn't left wondering.
      try { await (await bot()).pollVerification(String(threadId)); }
      catch (e) { emit({ chatId: String(threadId), text: `⚠ verify poll: ${e?.message ?? e}` }); }
      // Background poll — a round the PM opens LATER (while the app is open) appears on its own. Only when
      // the verify-summary loop is wired (a control store); skip while a verify bubble is already pending.
      if (controlStore && !pollTimers.has(String(threadId))) {
        pollTimers.set(String(threadId), setInterval(async () => {
          if (awaitingVerify || !active.has(String(threadId))) return;
          try { await (await bot()).pollVerification(String(threadId)); } catch { /* transient */ }
        }, 15000));
      }
    },
    /** Leave feedback mode. */
    stop(threadId) {
      active.delete(String(threadId));
      const tmr = pollTimers.get(String(threadId)); if (tmr) { clearInterval(tmr); pollTimers.delete(String(threadId)); }
      clients.get(String(threadId))?.close(); clients.delete(String(threadId));
    },
    isActive(threadId) { return active.has(String(threadId)); },
    /** Route a free-text turn to the bot IF the thread is in feedback mode. */
    async handle(text, threadId) {
      if (!active.has(String(threadId))) return false;
      // "Secure your access" — SURFACE affordances (reveal/restore the owner-root recovery phrase), intercepted
      // here so they never reach the bot or clear the verify guard. Gated on a wired callSkill.
      if (typeof callSkill === 'function') {
        const s = String(text || '');
        if (/^\s*fp:access:backup\s*$/i.test(s))  { await emitBackup(threadId); return true; }
        if (/^\s*fp:access:restore\s*$/i.test(s)) { beginRestore(threadId); return true; }
        if (awaitingRestore.has(String(threadId))) {
          // Awaiting a pasted phrase: a /stop|/cancel cancels; any other command falls through (cancels the
          // wait first); anything else is treated as the phrase attempt (validated in submitRestorePhrase).
          if (/^\s*\/(stop|cancel|annuleer)\s*$/i.test(s)) { cancelRestore(threadId); return true; }
          if (!/^\s*(\/|fp:)/.test(s)) { await submitRestorePhrase(threadId, s); return true; }
          awaitingRestore.delete(String(threadId));
        }
      }
      // Charter consent — SURFACE affordance (collect the participant's opt-in coarse attributes). Intercept the
      // fp:charter:* controls + the typed place value here; the RELEASE is handed to the bot as a data turn, not
      // routed as text (so the coarse values never appear as a chat message / a bot turn).
      if (projectCharter) {
        const s = String(text || '');
        if (/^\s*fp:charter:start\s*$/i.test(s)) { beginCharter(threadId); return true; }
        if (/^\s*fp:charter:(skip|none-all)\s*$/i.test(s)) { skipCharter(threadId); return true; }
        if (/^\s*fp:charter:send\s*$/i.test(s)) { await sendCharter(threadId); return true; }
        if (/^\s*fp:privacy:info\s*$/i.test(s)) { emitPrivacyInfo(threadId); return true; }   // per-circle indicator tap
        { const mm = s.match(/^\s*fp:privacy:warnings:(normal|minimal|off)\s*$/i); if (mm) { setWarningsMode(threadId, mm[1].toLowerCase()); return true; } }
        let m;
        if ((m = s.match(/^\s*fp:charter:pick:([^:]+):(.+?)\s*$/i))) { charterPick(threadId, m[1], m[2]); return true; }
        if ((m = s.match(/^\s*fp:charter:none:([^:]+)\s*$/i))) { charterNone(threadId); return true; }
        if (awaitingCharterText.has(String(threadId))) {
          if (/^\s*\/(overslaan|skip|stop)\s*$/i.test(s)) { charterText(threadId, null); return true; }   // skip this attr
          if (!/^\s*(\/|fp:)/.test(s)) { charterText(threadId, s.trim()); return true; }
        }
      }
      // "Report a problem" is a SURFACE affordance, not a bot turn — intercept it here (typed `/report`/`/logs`/
      // `/problem`, or the `fp:report` button) so it never reaches the bot and never clears the verify guard.
      // The anonymous SEND trigger (`fp:report:send`, from the panel's Send button) — checked BEFORE the
      // open trigger below so `fp:report` doesn't shadow it. Routes to the injected sink, never the bot.
      if (/^\s*fp:report:send\s*$/i.test(String(text || ''))) { await emitReportSend(threadId); return true; }
      if (/^\s*(\/report|\/logs|\/problem|fp:report)\s*$/i.test(String(text || ''))) { emitReport(threadId); return true; }
      awaitingVerify = false;   // a user turn (incl. tapping a verify button) releases the re-poll guard
      // PII-safe: log whether the turn was a COMMAND (/… or fp:…) vs free text — never the text itself.
      log.info('feedback', 'turn', { cmd: /^(\/|fp:)/.test(String(text || '')) });
      // Consent-write probe: measure the own-pod record count around a consent turn so the log shows whether the
      // write landed (after > before), was a no-op re-review (after == before + a review emit), or errored.
      const isConsent = /^\s*fp:consent(:|$)/i.test(String(text || ''));
      const before = isConsent ? await ownPodCount() : 0;
      await (await clientFor(threadId)).send(text);
      if (isConsent) log.info('feedback', 'consent.turn', { before, after: await ownPodCount() });
      return true;
    },
    /** Show the "Report a problem" panel (PII-safe on-device log) — a shell can call this from a chrome button
     *  (mobile) instead of the typed `/report` / the `fp:report` bubble-button (web). */
    report(threadId) { if (active.has(String(threadId))) emitReport(threadId); },
    /** Anonymously SEND the PII-safe on-device log via the injected sink — a shell can call this from a chrome
     *  button, mirroring `report()`. Returns the sink result (`{ok, reason?}`) so the shell can react if it wants. */
    reportSend(threadId) { if (active.has(String(threadId))) return emitReportSend(threadId); return undefined; },
    /** "Secure your access" — reveal the owner-root recovery phrase (back up). A shell can call this from a
     *  chrome button (mobile) instead of the `fp:access:backup` bubble-button (web). No-op without a callSkill. */
    backup(threadId) { if (active.has(String(threadId)) && typeof callSkill === 'function') return emitBackup(threadId); return undefined; },
    /** "Secure your access" — begin the restore-from-phrase flow (the next pasted text turn is the phrase). */
    restore(threadId) { if (active.has(String(threadId)) && typeof callSkill === 'function') beginRestore(threadId); },
    /** Charter consent — offer the requested-attributes opt-in step. A shell can call this from chrome; no-op
     *  when the project declared no charter. */
    charter(threadId) { if (active.has(String(threadId)) && projectCharter) emitCharterIntro(threadId); },
    /** True when the project declared a requested-attributes charter (a shell may show a chrome affordance). */
    hasCharter: !!projectCharter,
    /** The per-circle privacy indicator state (§10c) for a shell to render a badge — {applicable, level, shared,
     *  warn, reason}. `level` ∈ quiet|sharing|risk. Reflects the participant's current disclosure in this thread. */
    privacyState(threadId) { return privacyStateFor(threadId); },
    /** Show the per-circle privacy status affordance (a shell can call this from chrome). */
    showPrivacy(threadId) { if (active.has(String(threadId)) && projectCharter) emitPrivacyStatus(threadId); },
    /** §10b — the user's graduated warnings setting ('normal'|'minimal'|'off', default normal). A shell may
     *  persist this + call setWarnings on boot (pass threadId=null to set silently). */
    setWarnings(mode, threadId = null) { setWarningsMode(threadId, mode); },
    get warningsMode() { return warningsMode; },
    /** A button tap (M2): send the control id (fp:*) as a turn — the bot's parseControl handles it. */
    async tapButton(buttonId, threadId) {
      if (!active.has(String(threadId))) return false;
      // "Secure your access" bubble-buttons are SURFACE affordances — intercept before routing to the bot
      // (parity with handle(), so the fp-bot contact-thread / mobile chrome path works too).
      if (typeof callSkill === 'function') {
        if (/^\s*fp:access:backup\s*$/i.test(String(buttonId)))  { await emitBackup(threadId); return true; }
        if (/^\s*fp:access:restore\s*$/i.test(String(buttonId))) { beginRestore(threadId); return true; }
      }
      // Charter consent bubble-buttons — intercept before routing to the bot (parity with handle()).
      if (projectCharter) {
        const b = String(buttonId);
        if (/^\s*fp:charter:start\s*$/i.test(b)) { beginCharter(threadId); return true; }
        if (/^\s*fp:charter:(skip|none-all)\s*$/i.test(b)) { skipCharter(threadId); return true; }
        if (/^\s*fp:charter:send\s*$/i.test(b)) { await sendCharter(threadId); return true; }
        if (/^\s*fp:privacy:info\s*$/i.test(b)) { emitPrivacyInfo(threadId); return true; }
        { const mm = String(b).match(/^\s*fp:privacy:warnings:(normal|minimal|off)\s*$/i); if (mm) { setWarningsMode(threadId, mm[1].toLowerCase()); return true; } }
        let m;
        if ((m = b.match(/^\s*fp:charter:pick:([^:]+):(.+?)\s*$/i))) { charterPick(threadId, m[1], m[2]); return true; }
        if ((m = b.match(/^\s*fp:charter:none:([^:]+)\s*$/i))) { charterNone(threadId); return true; }
      }
      awaitingVerify = false;
      await (await clientFor(threadId)).send(buttonId);
      return true;
    },
    /** Verify-summary push nudge — fire a local notification (`notify`) for any round this participant
     *  hasn't verified yet. Self-poll/self-notify; safe to call on app load/foreground. Returns the rounds
     *  nudged (for the caller to mark in `alreadyNudged`). No-op when the verify loop isn't wired. */
    async nudge(threadId, { notify, alreadyNudged } = {}) {
      try { return await (await bot()).nudge(String(threadId), { notify, alreadyNudged }); } catch { return []; }
    },
  };
}

/**
 * Parse a project-invite (M2). Accepts a full URL, a query string, or a URLSearchParams and
 * returns `{ projectId, code }` when both are present (the shape `inviteLink()` produces), else
 * null. Used to auto-run `/feedback <code>` when the app loads on an invite/QR link.
 */
export function parseFeedbackInvite(input) {
  let params;
  try {
    if (input instanceof URLSearchParams) params = input;
    else if (typeof input === 'string' && input.includes('?')) params = new URL(input, 'https://x.invalid').searchParams;
    else params = new URLSearchParams(input || '');
  } catch { return null; }
  const projectId = params.get('projectId');
  const code = params.get('code');
  return projectId && code ? { projectId, code } : null;
}

/**
 * Seam 4 (DECIDED 2026-07-08) — turn the host's core `AgentIdentity` into a SIGNER CLOSURE
 * `{ publicKey, sign(bytes) }` the feedback bot signs consent with. The private key stays
 * ENCAPSULATED in the identity: only `publicKey` + a `sign()` closure cross the seam, never the raw
 * key (the encapsulated-secret pattern, cf. `openerForIdentity` / `AgentIdentity.sharedCopyOpener`).
 * Feedback's `contributionMeta` accepts exactly this shape (`sign(bytes)` + `publicKey`). Returns null
 * when no identity is available (→ the surface wires no signer; a verify project then rejects, a
 * non-verify project is unaffected).
 *
 * @param {{pubKey?:string, sign?:(b:Uint8Array)=>Uint8Array}|null} identity  core AgentIdentity (e.g. `agent.sa.agent.identity`)
 * @returns {{publicKey:string, sign:(b:Uint8Array)=>Uint8Array}|null}
 */
export function signerForIdentity(identity) {
  if (!identity || typeof identity.sign !== 'function' || !identity.pubKey) return null;
  // Guard the sign call: a signing failure here (device crypto / key not available in the no-login path)
  // would otherwise throw from `contributionMeta` — which runs OUTSIDE the consent write's try/catch and is
  // then swallowed by the bus bridge's `try…finally` (no catch), so the write silently does nothing and no
  // reply is emitted. Log the error CLASS + short message (PII-safe: a crypto error carries no user data) so
  // the failure is visible in the report panel, then re-throw so the existing failure handling still runs.
  return {
    publicKey: identity.pubKey,
    sign: (bytes) => {
      try { return identity.sign(bytes); }
      catch (e) { log.error('feedback', 'sign.fail', { err: String(e?.name || 'Error'), msg: String(e?.message || '').slice(0, 40) }); throw e; }
    },
  };
}

/**
 * The feedback bot as a distinct **agent** contact item (M2). NOT a stoop mesh peer — a local
 * co-hosted assistant, surfaced in the contacts list with its own `kind:'agent'` + icon and an
 * action (`openFeedback`) that enters feedback mode rather than opening a peer DM. The chat shell
 * prepends this to the `/contacts` list and routes its button to feedback mode. Its `id` matches
 * the co-hosted bot address (`fp-bot`).
 *
 * @param {{label?:string, openLabel?:string}} [a]
 */
export function feedbackContactItem({ label = 'Feedback assistant', openLabel = 'Open chat' } = {}) {
  return {
    id:      'fp-bot',
    type:    'agent',
    kind:    'agent',
    icon:    '🤖',
    label,
    buttons: [{ label: openLabel, callbackData: 'openFeedback:fp-bot' }],
  };
}

/**
 * Split a long bubble into a preview HEAD + the REST at a natural boundary near `max`, so a big
 * verify-summary (or a long review point) can render with a "Show more" toggle instead of overflowing the
 * bubble. Shared web ≡ mobile so both shells chunk identically. `rest` is '' when the text fits within `max`
 * — the shells then render it as a plain bubble (no toggle).
 * @param {string} text
 * @param {number} [max=320]  soft length budget for the preview
 * @returns {{head:string, rest:string}}
 */
export function chunkBubble(text, max = 320) {
  const s = String(text ?? '');
  if (s.length <= max) return { head: s, rest: '' };
  const lo = Math.floor(max * 0.6);                 // don't cut earlier than 60% of the budget
  const slice = s.slice(0, max);
  // Prefer the latest natural boundary within [lo, max]: paragraph break > line break > sentence end > space.
  // Cut AFTER the delimiter (`+ len`) so the preview keeps the sentence/word intact and `rest` starts clean.
  const sentence = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
  const b = [
    { i: slice.lastIndexOf('\n\n'), len: 2 },
    { i: slice.lastIndexOf('\n'), len: 1 },
    { i: sentence, len: 2 },
    { i: slice.lastIndexOf(' '), len: 1 },
  ].find((x) => x.i >= lo);
  const at = b ? b.i + b.len : max;                 // no good boundary → hard cut at the budget
  return { head: s.slice(0, at).trimEnd(), rest: s.slice(at).trimStart() };
}

/** callbackData opId for a feedback action chip (M12). */
export const FEEDBACK_BUTTON_OP = 'fpTap';

/**
 * M12 — turn the bot's emitted buttons (`{id, label}`, the review/consent/escalate actions) into
 * INTERACTIVE chips instead of plain text bullets. Returns a one-row list payload (`{items}`) whose
 * buttons re-send the control id to the bot on tap. The control id (`fp:*`) contains colons, which the
 * shell's `opId:itemId` callbackData split would mangle — so it's URI-encoded here and decoded by
 * `decodeFeedbackButton` in the tap handler. Returns null when there are no buttons.
 */
export function feedbackButtonItems(buttons) {
  const list = (Array.isArray(buttons) ? buttons : []).filter((b) => b && b.id && b.label);
  if (list.length === 0) return null;
  return {
    items: [{
      id:      'fp-actions',
      label:   '',
      buttons: list.map((b) => ({ label: b.label, callbackData: `${FEEDBACK_BUTTON_OP}:${encodeURIComponent(b.id)}` })),
    }],
  };
}

/** Decode a feedback chip's `itemId` (URI-encoded control id) back to the bot control id. */
export function decodeFeedbackButton(itemId) {
  try { return decodeURIComponent(String(itemId ?? '')); } catch { return String(itemId ?? ''); }
}
