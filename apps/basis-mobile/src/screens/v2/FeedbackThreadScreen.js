/**
 * basis-mobile v2 — dedicated FEEDBACK bot thread (cluster J, mobile parity).
 *
 * RN mirror of web's `showFeedbackThread` (circleApp.js). The feedback bot is an
 * added contact (via invite link/QR), NOT a PeerGraph peer — so it gets its own
 * thread that hosts the SHARED feedback surface: activate the verify-summary pods
 * (own/central/control) from the RN session, build the surface, and route input →
 * `surface.handle` / button taps → `surface.tapButton`.
 *
 * Stage-1 review renders as editable per-point CARDS: the curated text (tap to edit
 * in place), the original shown as a muted labelled chip (never mixed into the body
 * text), and per-card send + a footer (send all / nothing). Own-pod-first: the raw
 * + the edited text stay on the participant's own pod; only the verified summary
 * (Stage 2) reaches central. All curation logic is shared web≡mobile — this is the
 * RN shell.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { t, lang } from '../../core/localisation.js';
import { useTheme } from './themeContext.js';
import { createFeedbackSurface, signerForIdentity, chunkBubble } from '../../../../basis/src/feedback/feedbackSurface.js';
import { createBugReportSink } from '../../../../basis/src/log/bugReportSink.js';
import { FeedbackReviewCards, FeedbackReportPanel } from '../../rn/FeedbackBubbles.js';
import { makeNoLoginFeedbackPods } from '../../../../basis/src/feedback/noLoginPods.js';
import { createFeedbackHistoryStore } from '../../../../basis/src/feedback/feedbackHistory.js';
import { privacyBadge } from '../../../../basis/src/feedback/circlePrivacyState.js';   // shared privacy badge (§10c, invariant #3)
import { activateMobileFeedback } from '../../v2/feedbackActivation.js';

// Device-local transcript store — restore the feedback thread on reload (shared web ≡ mobile store; see
// feedbackHistory.js). Same local-only trust boundary as the persisted own-pod Stage-1 data / `fp.lang`:
// the participant's own content, never sent anywhere.
const feedbackHistoryStore = createFeedbackHistoryStore({ storage: AsyncStorage });

// Same EXPO_PUBLIC_* vars ChatScreen reads (model override included — the default qwen2.5 404s on Privatemode).
const FEEDBACK_LLM_BASEURL = process.env.EXPO_PUBLIC_FEEDBACK_LLM_BASEURL || undefined;
const FEEDBACK_LLM_MODEL = process.env.EXPO_PUBLIC_FEEDBACK_LLM_MODEL || undefined;
const FEEDBACK_ACTIVATION_URL = process.env.EXPO_PUBLIC_FEEDBACK_ACTIVATION_URL || null;
const FEEDBACK_COLLECTOR_URL = process.env.EXPO_PUBLIC_FEEDBACK_COLLECTOR_URL || null;
// Logging — the anonymous bug-report SEND TARGET (web parity, circleApp.js). The dev-pod "bug-report
// bot" address the panel's Send button routes the (already-anonymous) envelope to, over the SAME peer/relay
// transport (`agent.sendPeerMessage`, injected as `sendPeer`). The real dev address does NOT exist yet: this
// is a PLACEHOLDER that drops into open-source config later (EXPO_PUBLIC_BUGREPORT_ADDR, or by giving
// BUG_REPORT_DEV_ADDR the real value). Until then null → the sink returns `no-target` and the panel stays
// COPY-ONLY. A real value would look like `'fp-bugreport-dev@<relay-or-pubkey>'`. Follow-up: the bot RECEIVER
// + real dev-pod address; sharing a circle may later imply sharing this relay (a per-circle relay, not built).
const BUG_REPORT_DEV_ADDR = null;   // ← real dev-pod bug-report bot address lands here (open-source config)
const BUG_REPORT_TARGET = process.env.EXPO_PUBLIC_BUGREPORT_ADDR || BUG_REPORT_DEV_ADDR;
const APP_VERSION = process.env.EXPO_PUBLIC_APP_VERSION || undefined;   // non-identifying build tag for the report envelope

// Per-circle privacy INDICATOR (§10c) — the discrete state's label, localised. The feedback surface lives
// OUTSIDE the circle t() system (the bot owns its i18n via config.language), so we mirror the web shell's
// minimal nl/en map here (web ≡ mobile by construction — see circleApp.js FB_PRIVACY_STRINGS). The ⚠ is
// EARNED (level==='risk'); the calm states are neutral, never "green = safe".
// Colour AMPLIFIES the shape (never colour-alone): quiet → neutral slate outline (NOT green), sharing →
// soft-blue fill, risk → amber→red. Maps to the shared Onderling status tokens (theme.color.*).
function privacyChip(level, theme) {
  switch (level) {
    case 'risk':    return { bg: theme.color.amberBg, border: theme.color.danger, fg: theme.color.danger };
    case 'sharing': return { bg: theme.color.blueBg,  border: theme.color.blue,   fg: theme.color.blue };
    default:        return { bg: 'transparent',       border: theme.color.line,   fg: theme.color.inkSoft };
  }
}

export default function FeedbackThreadScreen({ session, bot, store, onBack, identity = null, sendPeer = null, callSkill = null }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();   // clear the status bar so the header (back + language toggle) is tappable
  const threadId = bot?.id;
  const name = bot?.name ?? bot?.label ?? threadId ?? 'Feedback';

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);   // { mid, id, text } — the review card being edited inline
  const [expanded, setExpanded] = useState(() => new Set());   // message ids whose long bubble is fully shown
  const [botLang, setBotLang] = useState(null);    // the participant's chosen bot language (null until loaded)
  const [podsReady, setPodsReady] = useState(false);
  const surfaceRef = useRef(null);
  const activatedLangRef = useRef(null);           // the lang the surface was last (re)built for
  const podsRef = useRef(null);                    // activated pods, cached so a language switch needn't re-activate
  const noLoginRef = useRef(false);                // true when this thread uses the no-login collector flow (signs)
  const sendPeerRef = useRef(sendPeer);            // latest peer/relay send — read LAZILY at report-send time
  sendPeerRef.current = sendPeer;                  // (agent may still be booting when the surface is built)
  const callSkillRef = useRef(callSkill);          // latest household callSkill — read LAZILY for reveal/restore
  callSkillRef.current = callSkill;                // (same lazy-boot reason as sendPeer)
  const identityRef = useRef(identity);            // latest agent identity — read LAZILY at sign time (web parity:
  identityRef.current = identity;                  // circleCoreAgent is read at call time, not captured, so a
                                                   // still-booting identity at surface-build time isn't frozen in.
  const scrollRef = useRef(null);
  const hydratedRef = useRef(false);   // true once the persisted transcript has been loaded (gates saving so
                                       // the initial empty state can't clobber stored history before hydration).
  const hadHistoryRef = useRef(undefined);   // captured once: was there a stored transcript at first build? (reload)
  const greetedRef = useRef(false);          // greet (help + affordances) happens at most once per mount

  // Per-circle privacy INDICATOR (§10c) — the discrete state read from the surface, plus a one-time flip-to-risk
  // emphasis. `privacy` is null until a charter applies (then the badge shows); refreshed after every turn/consent.
  const [privacy, setPrivacy] = useState(null);
  const [pvPulse, setPvPulse] = useState(false);
  const pvLevelRef = useRef(null);   // last level seen — so the pulse fires only on the flip INTO risk

  // chrome (header/composer) renders in the BOT's chosen language, not the device locale.
  const tBot = useCallback((key, params) => t(key, params, botLang || undefined), [botLang]);

  // Re-read the per-circle privacy state (from the shared surface). Called after the surface builds and on every
  // message change (a turn/consent can flip the state). Hidden unless a charter applies (state.applicable).
  const refreshPrivacy = useCallback(() => {
    const s = surfaceRef.current;
    let st = null;
    try { st = s?.privacyState ? s.privacyState(threadId) : null; } catch { st = null; }
    const applicable = !!(st && st.applicable);
    setPrivacy(applicable ? st : null);
    const lvl = applicable ? st.level : null;
    if (lvl === 'risk' && pvLevelRef.current !== 'risk') {   // flipped INTO risk → a subtle one-time pulse, then settle
      setPvPulse(true);
      setTimeout(() => setPvPulse(false), 1200);
    }
    pvLevelRef.current = lvl;
  }, [threadId]);

  // Load the per-bot language choice (persisted); default to the device locale.
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(`fp.lang.${threadId}`).then((v) => { if (live) setBotLang(v === 'nl' || v === 'en' ? v : lang()); }).catch(() => { if (live) setBotLang(lang()); });
    return () => { live = false; };
  }, [threadId]);

  // Restore the persisted transcript on mount (device-local) so a reload/reopen re-shows the conversation.
  // Prepend so it sits ABOVE any greeting the surface build may already have appended (order-safe vs the
  // async pod activation). Absent/malformed → []. Runs once per thread.
  useEffect(() => {
    let live = true;
    feedbackHistoryStore.load(threadId).then((restored) => {
      if (!live) return;
      if (Array.isArray(restored) && restored.length) setMessages((prev) => [...restored, ...prev]);
      hydratedRef.current = true;
    }).catch(() => { if (live) hydratedRef.current = true; });
    return () => { live = false; };
  }, [threadId]);

  // Persist on every message change (debounced) — device-local only. Gated on hydration so the initial empty
  // render can't overwrite stored history before `load` resolves.
  useEffect(() => {
    if (!hydratedRef.current) return undefined;
    const h = setTimeout(() => { feedbackHistoryStore.save(threadId, messages); }, 250);
    return () => clearTimeout(h);
  }, [messages, threadId]);

  // Refresh the privacy badge whenever the transcript changes (a turn/consent may have flipped the state) or the
  // surface is (re)built (podsReady/botLang). A plain re-read on each such change is enough — the state is cheap.
  useEffect(() => { refreshPrivacy(); }, [messages, podsReady, botLang, refreshPrivacy]);

  const changeLang = useCallback((lg) => {
    if (lg === botLang || (lg !== 'nl' && lg !== 'en')) return;
    setBotLang(lg);                                 // → the surface effect re-builds the bot in this language
    AsyncStorage.setItem(`fp.lang.${threadId}`, lg).catch(() => { /* best-effort */ });
  }, [botLang, threadId]);

  const pushBot = useCallback((text, buttons) => {
    setMessages((prev) => [...prev, { id: mkId(), origin: 'bot', text: String(text ?? ''), buttons: Array.isArray(buttons) && buttons.length ? buttons : null }]);
  }, []);
  const pushUser = useCallback((text) => {
    setMessages((prev) => [...prev, { id: mkId(), origin: 'user', text: String(text ?? '') }]);
  }, []);

  // (A) Activate ONCE (own/central/control pods) — independent of language, so switching language doesn't
  // re-activate. Caches the pods for the surface builder below.
  useEffect(() => {
    if (!threadId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        // NO-LOGIN collector flow (invite-circle parity, web ≡ mobile): raw stays in the OWN in-memory pod,
        // the round-approved SUMMARY goes to the companion collector, signed with this device's agent
        // identity. Used when the bot carries a collector URL and NO activation URL. No Solid login.
        const collectorUrl = bot?.collectorUrl || FEEDBACK_COLLECTOR_URL;
        const activationUrl = bot?.activationUrl || FEEDBACK_ACTIVATION_URL;
        if (collectorUrl && !activationUrl) {
          noLoginRef.current = true;
          // Persist the OWN pod (AsyncStorage) so consented Stage-1 survives a reload — consent + the
          // verify-round approval no longer need to happen in one session.
          podsRef.current = makeNoLoginFeedbackPods({ collectorUrl, participantKey: identity?.pubKey, storage: AsyncStorage, podKey: `fp.ownpod.${threadId}` });
          if (!cancelled) setPodsReady(true);
          return;
        }
        if (!activationUrl) { pushBot(tBot('circle.feedback.activation_failed', { error: 'no activation URL', defaultValue: 'Activatie mislukt: geen activation-URL ingesteld.' })); return; }
        const pods = await activateMobileFeedback({ session, activationUrl, projectId: bot.projectId, code: bot.code, podRef: bot.podRef });
        if (cancelled) return;
        if (pods.podRef && pods.podRef !== bot.podRef && store) { try { await store.add({ ...bot, podRef: pods.podRef }); } catch { /* persist best-effort */ } }
        podsRef.current = pods;
        setPodsReady(true);
      } catch (e) {
        if (!cancelled) pushBot(`⚠ ${e?.message ?? e}`);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- activation is one-shot per thread; tBot/pushBot are stable
  }, [session, bot, store, threadId, identity]);

  // (B) Build the surface in the chosen language, reusing the cached pods (NO re-activation), then poll the
  // lead's /control/ round. Re-runs when botLang changes → rebuild the bot + re-start the thread in the new
  // language (fresh /help). Gated so a spurious re-render with the SAME lang doesn't rebuild.
  useEffect(() => {
    if (!podsReady || !botLang || activatedLangRef.current === botLang) return undefined;
    activatedLangRef.current = botLang;
    const pods = podsRef.current;
    let cancelled = false;
    // KEEP the transcript across a (re)build — the restored history (hydration effect) and any prior turns
    // survive; the fresh /help greeting from surface.start() appends BELOW. A language switch is the same
    // participant/thread, so we don't discard their own feedback on toggle (web parity: circleApp
    // `_changeFbLang` also keeps history). Only the transient inline-edit state resets.
    setEditing(null);
    (async () => {
      setBusy(true);
      try {
        const surface = createFeedbackSurface({
          projectId: bot.projectId,   // bind the dispatcher to the activation project (verify-round match)
          lang: botLang,              // the participant's chosen bot language (drives text + cards + pipeline)
          llmBaseURL: FEEDBACK_LLM_BASEURL,
          llmModel: FEEDBACK_LLM_MODEL,
          pod: pods.ownPod,
          centralPod: pods.centralPod,
          controlStore: pods.controlStore,
          // No-login flow: sign consent/summaries with THIS device's agent identity (the collector +
          // aggregation only accept signed records). The activation flow signs via its session-authed pods.
          ...(noLoginRef.current ? { identityFor: () => signerForIdentity(identityRef.current), verify: true } : {}),
          // Anonymous bug-report SEND sink (web parity, circleApp.js) — forward the identity-free envelope over
          // the peer/relay transport to the config-driven dev bot. `sendPeer` read lazily (agent may boot late);
          // null target → the sink no-ops and the panel stays copy-only.
          app: 'basis', version: APP_VERSION,
          sendReport: createBugReportSink({ send: (a, p) => sendPeerRef.current?.(a, p), target: BUG_REPORT_TARGET, app: 'basis', version: APP_VERSION }),
          // "Secure your access" (web parity, circleApp.js): BACK UP + RESTORE the owner-root recovery phrase in
          // the no-login onboarding, via the household reveal/restore skills through callSkill (read lazily). The
          // access kinds fall through to pushBot as bubbles + buttons; the phrase never leaves the device.
          accessButton: true,
          callSkill: (o, op, a) => callSkillRef.current?.(o, op, a),
          // a review renders as editable per-point CARDS (kind:'review'+points); a report renders as a
          // selectable PII-safe log panel (kind:'report'); everything else as a bubble.
          emit: ({ text, buttons, kind, points, labels, logText }) => {
            if (kind === 'review' && Array.isArray(points)) {
              setEditing(null);
              setMessages((prev) => [...prev, { id: mkId(), origin: 'bot', kind: 'review', intro: String(text ?? ''), points, labels }]);
            } else if (kind === 'report') {
              // Keep the panel's Send button (fp:report:send) — tapping it routes back to the shared surface
              // (tapControl → surface.handle), which sends the ANONYMOUS envelope. 'report-result' bubbles
              // (the send outcome) carry no special kind → fall through to pushBot as a normal bubble.
              setMessages((prev) => [...prev, { id: mkId(), origin: 'bot', kind: 'report', intro: String(text ?? ''), logText: String(logText ?? ''), buttons: Array.isArray(buttons) ? buttons : null }]);
            } else { pushBot(text, buttons); }
          },
        });
        surfaceRef.current = surface;
        // Greet (help + affordance buttons) ONLY on a genuinely fresh thread. On a restore-from-reload the greeting
        // comes back WITH the transcript, so re-greeting would stack it in storage. Decide once from the stored
        // history (race-free vs the async hydrate + debounced save + botLang rebuilds); the verify poll always runs.
        if (hadHistoryRef.current === undefined) {
          const restored = await feedbackHistoryStore.load(threadId).catch(() => []);
          hadHistoryRef.current = Array.isArray(restored) && restored.length > 0;
        }
        const greet = !hadHistoryRef.current && !greetedRef.current;
        if (greet) greetedRef.current = true;
        await surface.start(threadId, { greet });   // greet chrome once; the /control/ verify-round poll always runs
      } catch (e) {
        if (!cancelled) pushBot(`⚠ ${e?.message ?? e}`);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [podsReady, botLang, threadId, bot, pushBot, identity]);

  // Run a control string (button callback / fp:edit / fp:consent) against the bot.
  const tapControl = useCallback(async (cb) => {
    const surface = surfaceRef.current;
    if (!surface) return;
    setBusy(true);
    try { await surface.handle(cb, threadId); }
    catch (e) { pushBot(`⚠ ${e?.message ?? e}`); }
    finally { setBusy(false); }
  }, [threadId, pushBot]);

  const onSend = useCallback(async () => {
    const text = input.trim();
    const surface = surfaceRef.current;
    if (!text || !surface) return;
    setInput('');
    pushUser(text);
    setBusy(true);
    try { await surface.handle(text, threadId); }
    catch (e) { pushBot(`⚠ ${e?.message ?? e}`); }
    finally { setBusy(false); }
  }, [input, threadId, pushUser, pushBot]);

  const onButton = useCallback((b) => tapControl(b.callbackData ?? b.action ?? b.id), [tapControl]);

  // "Report a problem" — surface the PII-safe on-device log (shared surface.report). Mobile's chrome trigger;
  // web offers the same as a bubble-button. Doubles as the on-device debugger (app console.warn doesn't reach Metro).
  const openReport = useCallback(() => { surfaceRef.current?.report(threadId); }, [threadId]);

  const toggleExpand = useCallback((id) => setExpanded((prev) => {
    const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n;
  }), []);

  const startEdit = useCallback((mid, p) => setEditing({ mid, id: p.id, text: p.text }), []);
  const saveEdit = useCallback(async () => {
    const e = editing; setEditing(null);
    if (e && String(e.text).trim()) await tapControl(`fp:edit:${e.id}:${String(e.text).trim()}`);
  }, [editing, tapControl]);

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 8 }]} testID="feedback-thread-screen">
      <View style={styles.header}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="feedback-thread-back">
          <Text style={styles.back}>{tBot('circle.contacts.back')}</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{tBot('circle.contacts.thread_title', { name })}</Text>
        <View style={styles.langToggle}>
          {['nl', 'en'].map((lg) => (
            <Pressable
              key={lg}
              onPress={() => changeLang(lg)}
              style={[styles.langBtn, botLang === lg && styles.langBtnActive]}
              accessibilityRole="button"
              testID={`feedback-lang-${lg}`}
            >
              <Text style={[styles.langBtnText, botLang === lg && styles.langBtnTextActive]}>{lg.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable onPress={openReport} style={styles.reportBtn} accessibilityRole="button" testID="feedback-report">
          <Text style={styles.reportBtnText}>🛠</Text>
        </Pressable>
      </View>

      {/* Per-circle privacy INDICATOR (§10c) — a persistent, icon-first chip under the header. Only shown when a
          charter applies; icon-first + colour AMPLIFIES (never colour-alone); tap → the surface's why/change
          affordance. The ⚠ is EARNED (risk only); a subtle one-time emphasis when the state flips into risk. */}
      {privacy && (() => {
        const c = privacyChip(privacy.level, theme);
        const badge = privacyBadge(privacy.level, botLang);   // shared icon+label (one source)
        return (
          <Pressable
            onPress={() => { try { surfaceRef.current?.showPrivacy?.(threadId); } catch { /* best-effort */ } }}
            accessibilityRole="button"
            accessibilityLabel={badge.label}
            testID="feedback-privacy"
            style={[styles.privacy, { backgroundColor: c.bg, borderColor: c.border }, pvPulse && styles.privacyPulse]}
          >
            <Text style={[styles.privacyText, { color: c.fg }]} testID={`feedback-privacy-${privacy.level}`}>
              {`${badge.icon} ${badge.label}`}
            </Text>
          </Pressable>
        );
      })()}

      <ScrollView
        ref={scrollRef}
        style={styles.log}
        contentContainerStyle={{ paddingVertical: 8, gap: 8 }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd?.({ animated: true })}
      >
        {messages.map((m) => {
          if (m.kind === 'report') {
            // The panel's Send button routes through the SAME shared path as web (surface.handle('fp:report:send')).
            const sendBtn = (m.buttons || []).find((b) => /report:send/.test(b?.id ?? b?.action ?? ''));
            return (
              <View key={m.id}>
                <FeedbackReportPanel
                  intro={m.intro}
                  logText={m.logText}
                  sendLabel={sendBtn?.label}
                  onSend={sendBtn ? () => tapControl(sendBtn.id ?? sendBtn.action) : undefined}
                />
              </View>
            );
          }
          if (m.kind === 'review') {
            // contact-thread uses INLINE card edit (editing state scoped by message id).
            return (
              <View key={m.id}>
                <FeedbackReviewCards
                  intro={m.intro} points={m.points} labels={m.labels} botLang={botLang}
                  editing={editing && editing.mid === m.id ? { id: editing.id, text: editing.text } : null}
                  onChangeEditText={(v) => setEditing((e) => ({ ...e, text: v }))}
                  onSaveEdit={saveEdit}
                  onCancelEdit={() => setEditing(null)}
                  onEditPoint={(p) => startEdit(m.id, p)}
                  onSend={(pid) => tapControl(`fp:consent:${pid}`)}
                  onSendAll={() => tapControl('fp:consent:all')}
                  onSendNone={() => tapControl('fp:cancel')}
                />
              </View>
            );
          }
          // Long bubbles (e.g. a big verify-summary) chunk to a preview + a "Show more" toggle so they don't
          // overflow; short ones (rest === '') render whole with no toggle. Shared chunkBubble → web ≡ mobile.
          const { head, rest } = chunkBubble(m.text);
          const showAll = rest === '' || expanded.has(m.id);
          return (
            <View key={m.id} style={[styles.msg, m.origin === 'user' ? styles.msgUser : styles.msgBot]}>
              <View style={[styles.bubble, m.origin === 'user' ? styles.bubbleUser : styles.bubbleBot]}>
                <Text style={m.origin === 'user' ? styles.bubbleUserText : styles.bubbleBotText} testID={`feedback-msg-${m.origin}`}>
                  {showAll ? m.text : `${head}…`}
                </Text>
                {rest !== '' && (
                  <Pressable onPress={() => toggleExpand(m.id)} testID={`feedback-more-${m.id}`} hitSlop={6}>
                    <Text style={styles.moreToggle}>
                      {showAll ? tBot('circle.feedback.show_less', { defaultValue: 'Minder' }) : tBot('circle.feedback.show_more', { defaultValue: 'Meer tonen' })}
                    </Text>
                  </Pressable>
                )}
              </View>
              {m.buttons && (
                <View style={styles.btnRow}>
                  {m.buttons.map((b, i) => (
                    <Pressable
                      key={`${m.id}-b${i}`}
                      style={styles.btn}
                      onPress={() => onButton(b)}
                      accessibilityRole="button"
                      testID={`feedback-btn-${b.callbackData ?? b.action ?? b.id ?? i}`}
                    >
                      <Text style={styles.btnText}>{b.label ?? String(b.callbackData ?? b.id ?? '')}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          );
        })}
        {busy && <Text style={styles.sending}>{tBot('circle.contacts.thinking', { defaultValue: 'Bezig…' })}</Text>}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={tBot('circle.contacts.composer', { name })}
          placeholderTextColor={theme.color.inkSoft}
          autoCapitalize="none"
          onSubmitEditing={onSend}
          testID="feedback-thread-input"
        />
        <Pressable style={styles.send} onPress={onSend} accessibilityRole="button" testID="feedback-thread-send">
          <Text style={styles.sendText}>{tBot('circle.contacts.send')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// Seed from the clock so a Fast-Refresh reload (which resets module state but KEEPS component state) can't
// re-issue an id already in `messages` → no "two children with the same key".
let _id = Date.now();
function mkId() { _id += 1; return `fbt-${_id}`; }

const makeStyles = (theme) => StyleSheet.create({
  wrap: { flex: 1, padding: 16, backgroundColor: theme.color.paper },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  back: { fontSize: 13, color: theme.color.inkSoft },
  title: { fontFamily: theme.font.serif, fontSize: 18, fontWeight: '600', color: theme.color.ink, flexShrink: 1 },
  langToggle: { flexDirection: 'row', marginLeft: 'auto', borderWidth: 1, borderColor: theme.color.line, borderRadius: 10, overflow: 'hidden' },
  langBtn: { paddingVertical: 4, paddingHorizontal: 10 },
  langBtnActive: { backgroundColor: theme.color.accent },
  langBtnText: { fontSize: 12, fontWeight: '700', color: theme.color.inkSoft },
  langBtnTextActive: { color: theme.color.white },
  reportBtn: { paddingVertical: 4, paddingHorizontal: 6, borderWidth: 1, borderColor: theme.color.line, borderRadius: 10 },
  reportBtnText: { fontSize: 14 },
  // Per-circle privacy badge (§10c): a slim pill chip; per-level colours are applied inline (privacyChip).
  privacy: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', paddingVertical: 3, paddingHorizontal: 10, borderWidth: 1, borderRadius: 999, marginBottom: 6 },
  privacyPulse: { borderWidth: 2 },   // the one-time flip-to-risk emphasis (a heavier edge, then settle)
  privacyText: { fontSize: 12, fontWeight: '600' },
  log: { flex: 1 },
  msg: { maxWidth: '88%' },
  msgUser: { alignSelf: 'flex-end' },
  msgBot: { alignSelf: 'flex-start' },
  bubble: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14 },
  bubbleUser: { backgroundColor: theme.color.accent },
  bubbleBot: { backgroundColor: theme.color.white, borderWidth: 1, borderColor: theme.color.line },
  bubbleUserText: { color: theme.color.white, fontSize: 14, lineHeight: 20 },
  bubbleBotText: { color: theme.color.ink, fontSize: 14, lineHeight: 20 },
  moreToggle: { marginTop: 6, fontSize: 12, fontWeight: '700', color: theme.color.accent },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  btn: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.color.accent, backgroundColor: theme.color.white },
  btnText: { fontSize: 13, fontWeight: '600', color: theme.color.accent },
  // Stage-1 review cards + the report panel now live in the shared `rn/FeedbackBubbles.js` component.
  sending: { fontSize: 12, color: theme.color.inkSoft, fontStyle: 'italic', paddingHorizontal: 4 },
  composer: { flexDirection: 'row', gap: 8, marginTop: 8 },
  input: { flex: 1, fontSize: 14, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, color: theme.color.ink, backgroundColor: theme.color.white },
  send: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: theme.radius.md, backgroundColor: theme.color.accent, justifyContent: 'center' },
  sendText: { fontSize: 14, fontWeight: '600', color: theme.color.white },
});
