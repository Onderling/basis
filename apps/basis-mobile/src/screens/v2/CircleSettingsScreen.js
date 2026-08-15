/**
 * basis-mobile v2 — circle settings (RN screen).
 *
 * RN counterpart of web's circleSettings renderer over the SAME shared
 * model (`@onderling-app/basis`): 5 policy axes (feature toggles + 4
 * enum radio groups) + the co-admin consensus toggle + per-option
 * consequence panels (1.2b).  Loads/saves through the injected policy
 * store (AsyncStorage-backed).  When consensus is active (consensusRequired
 * + ≥2 admins) Save records a pending proposal instead of applying.
 *
 * γ.4 — conflict resolution for the circle policy.  When `incomingPolicy`
 * is non-null (the source plumbing — peer broadcast / pod-sync — is
 * deferred to a later slice; today every existing call site passes none
 * of these opts and the screen behaves exactly as before), the screen
 * runs a 3-way diff against the last captured version (γ.2) and — if
 * conflicts surface — overlays the SAME modal (CircleRecipeConflictScreen)
 * used by the recipe editor with a settings-namespaced heading.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, Switch, TextInput, StyleSheet } from 'react-native';
import { useTheme } from './themeContext.js';
import {
  CIRCLE_FEATURES, CIRCLE_POLICY_ENUMS, SETTINGS_ENUM_AXES, mergeCirclePolicy, DEFAULT_CIRCLE_ORIGINS,
  detectPolicyConflicts, applyPolicyResolution,
} from '@onderling-app/basis';
// the shared manifest-driven settings form + per-skill freedom matrix (web≡mobile).
import { buildSettingsForm, buildCapabilityMatrix, FREEDOM_LEVELS, OPT_OUT_CONSEQUENCES } from '@onderling/app-manifest';
import { buildManifestsByOrigin } from '../../core/composeManifests.js';
import { t } from '../../core/localisation.js';
import CircleRecipeConflictScreen from './CircleRecipeConflictScreen.js';
import GuidedSetupPanel from './GuidedSetupPanel.js';
import PairedDevices from './PairedDevices.js';
import RecipeConsentCard from './RecipeConsentCard.js';
// B · consent-card — the REVIEWED apply-recipe seam. The load/review/apply LOGIC is the SHARED
// basis model (web wires the identical pair); this screen only injects fetch/sources/policyStore/
// recordOptOuts + presents the native consent card. No recipe/consent logic is reimplemented here.
import { loadRecipeForReview, applyReviewedRecipe } from '../../core/recipeConsentWiring.js';
// §4 storage-policy bridge — the circle `pod` axis drives stoop's authoritative
// four-tier circle storage policy (shared with web; pure mapping + call).
import { pushCircleStoragePolicy } from '../../../../basis/src/v2/circleStoragePolicy.js';
import { conversationKindsRows } from '../../../../basis/src/v2/conversationKinds.js';
// D / consumer-switch (MOBILE parity) — the screen header is sourced from
// the manifest PAGE projection: the `settings` op declares `surfaces.page` with
// a `labelKey`, renderMobile projects it into NavModel.pages[], and the label
// flows `page.labelKey → t()` via the SAME shared selectors web uses (invariant
// #1/#2: ONE pure module, no per-shell logic). Mirrors web circleSettings.js.
import { pageForOpMobile, pageLabel } from '../../../../basis/src/v2/pageProjection.js';
import { basisManifest } from '../../../../basis/src/index.js';
// Phase 4 §9 — the manifest-declared settings controls + the `enabledWhen` fold (route × capability).
// Same shared source the web renderer uses (invariants #1/#2).
import { resolveControlEnablement, settingsControlsFromManifest } from '../../../../basis/src/v2/circleSettingsControls.js';
import { settingsChangeNeedsProposal } from '../../../../basis/src/v2/circlePolicy.js';

// Phase 4 §9 — the Connection & transport controls, read once from the static basisManifest.
const SETTINGS_CONTROLS = settingsControlsFromManifest(basisManifest);

// Theme B — the guided-setup chatbot template can be HQ-updated remotely; unset
// → the bundled DEFAULT_SETTINGS_TEMPLATE fallback (web's SETTINGS_TEMPLATE_URL).
const SETTINGS_TEMPLATE_URL = process.env.EXPO_PUBLIC_SETTINGS_TEMPLATE_URL || undefined;

// 5.9a — `view` is the per-circle default-pane axis ('chat' / 'screen' —
// 'cross-stream' retired with the Stream view, batch 5); an admin picks which surface
// a member lands on when they open the circle.  Listed first so it stays
// the most prominent setting.
// Was a LOCAL copy that had drifted from web's — it omitted `storagePosture` and `sharePosture`, so a
// mobile admin could not set either (invariants 1/2/3). Now the ONE shared list; guarded by
// apps/basis/test/v2/settingsAxesParity.test.js.
const ENUM_AXES = SETTINGS_ENUM_AXES;

// D / consumer-switch (MOBILE) — the projected PAGE surface for the
// `settings` op, selected once from the static basisManifest via the shared
// mobile selector (renderMobile → pages[]). The header label resolves from its
// `labelKey` through t() (see the header render below); a null page/absent
// labelKey falls back to the pre-existing t('circle.settings.title') bit-for-bit.
const SETTINGS_PAGE = pageForOpMobile(basisManifest, 'settings');

export default function CircleSettingsScreen({
  store, onProposePolicy, circleId, onBack,
  // §4 storage-policy bridge — the host injects the agent's raw callSkill so a
  // pod-tier change drives stoop.setCircleStoragePolicy (web parity).
  callSkill,
  // B · consent-card — the member-override store (records the declined optional caps as
  // `capabilityOptOuts`, the exact seam the gate honours) + the pod session's authed fetch (loads a
  // remote recipe URL from the user's own pod). Mirror of web `circleApp.js`'s overrideStore +
  // circleAuthedFetch injections. Absent → the recipe apply affordance falls back gracefully.
  overrideStore,
  podFetch,
  // γ.4 — opt-in conflict resolver.  See file header for the deferred
  // source plumbing; existing call sites pass none of these opts.
  incomingPolicy = null,
  onIncomingApplied,
  onIncomingDiscarded,
  // OBJ-2 — paired devices (no-pod sync). Host wires these from the agent bundle when
  // household sync is available; add/remove persist + return the updated roster.
  householdSelfAddr = null,
  householdPeers = [],
  onAddHouseholdPeer,
  onRemoveHouseholdPeer,
  // Phase 4 §9 — the device transport state the `enabledWhen` fold reads (relay availability greys
  // the private-DM toggle under pod-only) + the built-in dispatcher for device-scoped controls
  // (transport-mode · relay endpoint). Absent (older callers) ⇒ the fold seams to ENABLED + logs.
  transport = null,
  onControl,
}) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [working, setWorking] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [guidedOpen, setGuidedOpen] = useState(false);   // Theme B — guided-setup chatbot modal
  const [storageNote, setStorageNote] = useState(null);  // §4 — stoop storage-policy rejection note
  const baselinePodRef = useRef(undefined);              // §4 — pod tier at load (push only on change)

  // B · consent-card — REVIEWED apply-recipe state (source input → review model → native consent card).
  const [recipeSource, setRecipeSource] = useState('');
  const [recipeStatus, setRecipeStatus] = useState(null);   // status line under the input (localised)
  const [recipeBusy, setRecipeBusy] = useState(false);
  const [reviewRecipe, setReviewRecipe] = useState(null);   // the loaded recipe (Agree reuses it — no re-load)
  const [reviewModel, setReviewModel] = useState(null);     // buildRecipeConsentModel result → drives the card

  // γ.4 — conflict resolver state (parallel to recipe-editor pattern).
  const [conflictReport, setConflictReport] = useState(null);
  const [localForCompare, setLocalForCompare] = useState(null);

  // Phase 4 §9 — relay endpoint input buffer (seeded from the current transport state).
  const [relayInput, setRelayInput] = useState(typeof transport?.relayUrl === 'string' ? transport.relayUrl : '');
  const controlEnable = useMemo(
    () => resolveControlEnablement(SETTINGS_CONTROLS, { policy: working, transport }),
    [working, transport],
  );
  const runControl = useCallback((opId, args) => { if (typeof onControl === 'function') onControl(opId, args); }, [onControl]);

  useEffect(() => {
    let live = true;
    store.get(circleId).then((p) => {
      if (!live) return;
      setWorking(p);
      baselinePodRef.current = p?.pod;   // baseline for this editing session
    });
    return () => { live = false; };
  }, [store, circleId]);

  // γ.4 — when `incomingPolicy` is present, fetch base + detect + maybe
  // open the modal.  Triggered separately from the initial load so the
  // editor can render its regular form underneath while detection runs.
  useEffect(() => {
    if (incomingPolicy == null || working == null) { return; }
    let live = true;
    (async () => {
      let base = null;
      try {
        if (store && typeof store.listVersions === 'function' && circleId) {
          const versions = await store.listVersions(circleId);
          const head = Array.isArray(versions) && versions.length > 0 ? versions[0] : null;
          base = head && typeof head === 'object' && head.value != null ? head.value : null;
        }
      } catch { /* best-effort */ }

      const report = detectPolicyConflicts(working, incomingPolicy, base);
      if (!live) return;
      setLocalForCompare(working);

      if (report.identical
          || (report.blockConflicts.length === 0 && report.metaConflicts.length === 0)) {
        const merged = applyPolicyResolution(working, incomingPolicy, {});
        try {
          if (store && typeof store.update === 'function' && circleId) {
            await store.update(circleId, merged);
          }
        } catch { /* best-effort */ }
        onIncomingApplied?.(merged);
        return;
      }
      setConflictReport(report);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingPolicy, working, store, circleId]);

  const handleConflictResolve = async (decisions) => {
    if (!localForCompare || !incomingPolicy) { setConflictReport(null); return; }
    const merged = applyPolicyResolution(localForCompare, incomingPolicy, decisions);
    try {
      if (store && typeof store.update === 'function' && circleId) {
        await store.update(circleId, merged);
      }
    } catch { /* best-effort */ }
    setConflictReport(null);
    onIncomingApplied?.(merged);
  };

  const patch = useCallback((p) => {
    setStorageNote(null);   // §4 — any edit dismisses a stale storage-policy note
    setWorking((cur) => mergeCirclePolicy(cur, p));
  }, []);

  // the manifest sources drive the settings form + freedom matrix (web≡mobile via the
  // shared @onderling/app-manifest projectors + the shared circlePolicy store).
  const sources = useMemo(() => [...new Set(Object.values(buildManifestsByOrigin()))].map((m) => ({ manifest: m })), []);
  const settingsForms = useMemo(() => (working ? sources
    .map((s) => ({ app: s.manifest?.app, fields: buildSettingsForm(s.manifest, { scope: 'circle', values: settingValuesForApp(working, s.manifest?.app) }) }))
    .filter((f) => f.app && f.fields.length) : []), [sources, working]);
  const capMatrix = useMemo(() => (working ? buildCapabilityMatrix(sources, {
    enabledApps: Array.isArray(working.apps) && working.apps.length ? working.apps : null,
    template: working.capabilities || {},
  }) : []), [sources, working]);

  const consensusActive = settingsChangeNeedsProposal(working);   // the ONE decision-table gate (the unification)

  // B · consent-card — LOAD + REVIEW: load the pasted recipe (URL/JSON) via the SHARED loadRecipeForReview,
  // build the review model, then open the native consent card. Nothing is persisted here (mirror of web's
  // onReviewRecipe). The pod session's authed fetch resolves a recipe URL on the user's own pod; falls back
  // to the RN global fetch (web parity: circleAuthedFetch || globalThis.fetch).
  const loadForReview = useCallback(async () => {
    const src = (recipeSource || '').trim();
    if (!src || recipeBusy) return;
    setRecipeBusy(true);
    setRecipeStatus(null);
    try {
      const res = await loadRecipeForReview({
        source: src, sources, policy: working,
        fetch: podFetch || (typeof globalThis.fetch === 'function' ? globalThis.fetch : undefined),
      });
      if (!res.ok || !res.model) {
        setRecipeStatus(t('circle.recipeApply.error'));
      } else {
        setReviewRecipe(res.recipe);
        setReviewModel(res.model);   // opens the consent card
      }
    } catch {
      setRecipeStatus(t('circle.recipeApply.error'));
    } finally {
      setRecipeBusy(false);
    }
  }, [recipeSource, recipeBusy, sources, working, podFetch]);

  // B · consent-card — AGREE: apply the REVIEWED recipe with the user's declined optional caps. All-or-
  // nothing through the SAME store + gate (applyReviewedRecipe → applyRecipeToCircle → policyStore.update);
  // the declined caps become this member's `capabilityOptOuts` via the injected override store, so the gate's
  // effective set = the recipe allowlist MINUS the declined optional caps. No bypass, no fork (web parity).
  const onAgreeRecipe = useCallback(async ({ declinedKeys = [] } = {}) => {
    setReviewModel(null);
    if (!reviewRecipe || !reviewModel) { setRecipeStatus(t('circle.recipeApply.error')); return; }
    try {
      const res = await applyReviewedRecipe({
        circleId, recipe: reviewRecipe, model: reviewModel, declinedKeys,
        sources, policyStore: store,
        recordOptOuts: overrideStore
          ? (optOuts) => overrideStore.update(circleId, { capabilityOptOuts: optOuts })
          : undefined,
      });
      if (!res.ok) { setRecipeStatus(t('circle.recipeApply.error')); return; }
      setWorking(res.policy);   // the recipe is persisted; reflect it in the edit buffer + toggles
      setRecipeStatus(t('circle.recipeApply.applied'));
      setReviewRecipe(null);
      setRecipeSource('');
    } catch {
      setRecipeStatus(t('circle.recipeApply.error'));
    }
  }, [circleId, reviewRecipe, reviewModel, sources, store, overrideStore]);

  // B · consent-card — DECLINE: nothing is applied (mirror of web onDecline).
  const onDeclineRecipe = useCallback(() => {
    setReviewModel(null);
    setReviewRecipe(null);
    setRecipeStatus(t('circle.recipeConsent.declined'));
  }, []);

  const onSave = useCallback(async () => {
    if (!working) return;
    if (consensusActive) {
      // Multi-admin consensus → a GOVERNANCE proposal (changePolicy) on the log, raised by the parent's
      // governance handle: it fans to the other admins, they vote in the governance panel, and on
      // approval the wired setPolicy enactor applies the patch. The side-store is retired.
      await onProposePolicy?.(circleId, working);
    } else {
      await store.update(circleId, working);
      // §4 storage-policy bridge — when the pod tier changed, drive stoop's
      // authoritative circle storage policy (web parity). The skill owns
      // admin-gating + the one-way guard; a rejection surfaces as a note and
      // never blocks the local save.
      if (working?.pod !== baselinePodRef.current && typeof callSkill === 'function') {
        const res = await pushCircleStoragePolicy({
          callSkill, circleId, pod: working.pod, groupPodUri: working.groupPodUri,
        });
        if (!res.ok) {
          const key = `circle.settings.storage_err.${res.error}`;
          const msg = t(key);
          setStorageNote((msg && msg !== key) ? msg : t('circle.settings.storage_err.generic'));
          return;   // stay on settings so the admin sees why the tier didn't take
        }
      }
    }
    onBack?.();
  }, [working, consensusActive, store, onProposePolicy, circleId, onBack, callSkill]);

  // γ.4 — overlay rendered on top of the regular screen when a conflict
  // is detected.  Mirrors CircleRecipeEditorScreen's pattern (β.5).
  const conflictOverlay = conflictReport ? (
    <CircleRecipeConflictScreen
      visible
      conflicts={conflictReport}
      local={localForCompare}
      incoming={incomingPolicy}
      title="circle.settings.conflict.title"
      onResolve={handleConflictResolve}
      onCancel={() => { setConflictReport(null); onIncomingDiscarded?.(); }}
    />
  ) : null;

  if (!working) {
    return (
      <>
        <View style={styles.page} testID="circle-settings">
          <Text style={styles.muted}>{t('circle.loading')}</Text>
        </View>
        {conflictOverlay}
      </>
    );
  }

  return (
    <>
    <View style={styles.page} testID="circle-settings">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="circle-settings-back">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      {/* D / consumer-switch (MOBILE) — header label FROM the manifest
          projection: `settings` op's surfaces.page.labelKey → renderMobile →
          pageLabel → t(). Falls back to t('circle.settings.title') when no page. */}
      <Text style={styles.title}>{pageLabel(SETTINGS_PAGE, t, t('circle.settings.title'))}</Text>

      <ScrollView contentContainerStyle={styles.body}>
        {/* Theme B — walk the basics in chat, then pre-fill the form below (the GUI hand-off). */}
        <Pressable
          style={styles.guided}
          onPress={() => setGuidedOpen(true)}
          accessibilityRole="button"
          testID="circle-settings-guided"
        >
          <Text style={styles.guidedText}>{t('circle.guided.button')}</Text>
        </Pressable>

        {/* B · consent-card — apply an authored recipe (URL/JSON) as REVIEWED action: load → native consent
            card (what it enables + opt-out switches) → Agree applies, Decline nothing. Same shared model as web. */}
        <Text style={styles.section}>{t('circle.recipeApply.heading')}</Text>
        <TextInput
          style={styles.recipeInput}
          value={recipeSource}
          onChangeText={setRecipeSource}
          placeholder={t('circle.recipeApply.placeholder')}
          placeholderTextColor={theme.color.inkSoft}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          testID="recipe-source"
        />
        <Pressable
          style={[styles.recipeApply, recipeBusy && styles.recipeApplyBusy]}
          onPress={loadForReview}
          disabled={recipeBusy}
          accessibilityRole="button"
          testID="recipe-apply"
        >
          <Text style={styles.recipeApplyText}>{t('circle.recipeApply.apply')}</Text>
        </Pressable>
        {recipeStatus ? <Text style={styles.note} testID="recipe-status">{recipeStatus}</Text> : null}

        <Text style={styles.section}>{t('circle.settings.features')}</Text>
        {CIRCLE_FEATURES.map((f) => (
          <View key={f} style={styles.row}>
            <Text style={styles.rowLabel}>{t(`circle.settings.feat.${f}`)}</Text>
            <Switch trackColor={{ true: theme.color.accent, false: theme.color.trackOff }} thumbColor={theme.color.white}
              value={!!working.features?.[f]}
              onValueChange={(v) => patch({ features: { [f]: v } })}
              testID={`feat-${f}`}
            />
          </View>
        ))}

        {/* S6.C deep — which whole apps this circle composes (catalog scope). */}
        <Text style={styles.section}>{t('circle.settings.apps')}</Text>
        {DEFAULT_CIRCLE_ORIGINS.map((app) => {
          const current = Array.isArray(working.apps) ? working.apps : DEFAULT_CIRCLE_ORIGINS;
          return (
            <View key={app} style={styles.row}>
              <Text style={styles.rowLabel}>{t(`circle.settings.app.${app}`)}</Text>
              <Switch trackColor={{ true: theme.color.accent, false: theme.color.trackOff }} thumbColor={theme.color.white}
                value={current.includes(app)}
                onValueChange={(on) => {
                  const set = new Set(current);
                  if (on) set.add(app); else set.delete(app);
                  patch({ apps: DEFAULT_CIRCLE_ORIGINS.filter((a) => set.has(a)) });
                }}
                testID={`app-${app}`}
              />
            </View>
          );
        })}

        {ENUM_AXES.map((axis) => (
          <View key={axis}>
            <Text style={styles.section}>{t(`circle.settings.${axis}`)}</Text>
            {CIRCLE_POLICY_ENUMS[axis].map((opt) => {
              const consKey = `circle.settings.consequence.${opt}`;
              const consText = t(consKey);
              const hasCons = consText && consText !== consKey;
              const selected = working[axis] === opt;
              return (
                <View key={opt} style={[styles.optBox, selected && styles.optBoxSelected]}>
                  <View style={styles.optRow}>
                    <Pressable
                      style={styles.optTap}
                      onPress={() => patch({ [axis]: opt })}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      testID={`opt-${opt}`}
                    >
                      <View style={[styles.radio, selected && styles.radioOn]}>
                        {selected ? <View style={styles.radioDot} /> : null}
                      </View>
                      <Text style={styles.rowLabel}>{t(`circle.settings.opt.${opt}`)}</Text>
                    </Pressable>
                    {hasCons ? (
                      <Pressable
                        onPress={() => setExpanded((e) => ({ ...e, [opt]: !e[opt] }))}
                        accessibilityRole="button"
                        accessibilityLabel={t('circle.settings.consequence_aria')}
                        testID={`info-${opt}`}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={styles.info}>ⓘ</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {hasCons && expanded[opt] ? (
                    <Text style={styles.consequence} testID={`consequence-${opt}`}>{consText}</Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}

        <Text style={styles.section}>{t('circle.settings.consensus')}</Text>
        {/* WHO DECIDES a settings change (the decision-kind unification): writes the ONE decision
            table (governance.changePolicy); the old consensus boolean asked exactly this question
            and is retired from the policy shape. Web parity: circleSettings.js. */}
        <View style={styles.controlRow} testID="whoDecides">
          <Text style={styles.rowLabel}>{t('circle.settings.whoDecides')}</Text>
          <View style={styles.chipRow}>
            {['any-admin', 'admin-quorum', 'member-vote'].map((cls) => {
              const on = (working.governance?.changePolicy ?? 'any-admin') === cls;
              return (
                <Pressable key={cls} onPress={() => patch({ governance: { ...(working.governance ?? {}), changePolicy: cls } })}
                  style={[styles.chip, on && styles.chipOn]} testID={`whoDecides-${cls}${on ? '-on' : ''}`}>
                  <Text style={styles.chipText}>{t(`circle.settings.whoDecides_opt.${cls}`)}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        {consensusActive ? <Text style={styles.note}>{t('circle.settings.pending')}</Text> : null}
        {storageNote ? <Text style={styles.note} testID="circle-settings-storage-note">{storageNote}</Text> : null}

        {/* Phase 4 §9 — Connection & transport controls (manifest-declared). The enabledWhen fold
            greys out incompatible options (route × capability); web parity with circleSettings.js. */}
        {SETTINGS_CONTROLS.length ? (
          <View testID="circle-settings-connection">
            <Text style={styles.section}>{t('circle.settings.connection')}</Text>
            {SETTINGS_CONTROLS.map((ctl) => {
              const cs = controlEnable[ctl.id] || { enabled: true };
              if (ctl.kind === 'choice') {
                const current = transport?.mode || (ctl.of && ctl.of[0]);
                return (
                  <View key={ctl.id} style={styles.controlRow} testID={`control-${ctl.id}`}>
                    <Text style={styles.rowLabel}>{t(ctl.labelKey)}</Text>
                    <View style={styles.chipRow}>
                      {(ctl.of || []).map((opt) => {
                        const os = (cs.options && cs.options[opt]) || { enabled: true };
                        const off = !cs.enabled || !os.enabled;
                        return (
                          <Pressable key={opt} disabled={off} onPress={() => runControl(ctl.opId, { [ctl.arg]: opt })}
                            style={[styles.chip, current === opt && styles.chipOn, off && styles.chipDisabled]}
                            testID={`control-${ctl.id}-${opt}${off ? '-disabled' : ''}`}>
                            <Text style={styles.chipText}>{ctl.optLabelPrefix ? t(`${ctl.optLabelPrefix}.${opt}`) : opt}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {ctl.hintKey ? <Text style={styles.hintText}>{t(ctl.hintKey)}</Text> : null}
                  </View>
                );
              }
              if (ctl.kind === 'multi') {
                // Decision 3's admin control — same shared row model as web, so neither shell can offer a
                // different set of kinds or compute a different next list (invariants #1/#2).
                return (
                  <View key={ctl.id} style={styles.controlRow} testID={`control-${ctl.id}`}>
                    <Text style={styles.rowLabel}>{t(ctl.labelKey)}</Text>
                    <View style={styles.chipRow}>
                      {conversationKindsRows({
                        circleSetting: working?.conversationKinds ?? null,
                        templateKind:  working?.kind ?? null,
                      }).map((r) => (
                        <Pressable key={r.kind} disabled={!cs.enabled}
                          onPress={() => patch({ [ctl.policyField]: r.next })}
                          style={[styles.chip, r.on && styles.chipOn, !cs.enabled && styles.chipDisabled]}
                          testID={`control-${ctl.id}-${r.kind}${r.on ? '-on' : '-off'}`}>
                          <Text style={styles.chipText}>{t(r.labelKey)}</Text>
                        </Pressable>
                      ))}
                    </View>
                    {/* Says that turning a kind off hides rather than deletes — J-CW4's property, and not
                        something anyone assumes unless told. */}
                    {ctl.hintKey ? <Text style={styles.hintText}>{t(ctl.hintKey)}</Text> : null}
                  </View>
                );
              }
              if (ctl.kind === 'text') {
                return (
                  <View key={ctl.id} style={styles.controlRow} testID={`control-${ctl.id}`}>
                    <Text style={styles.rowLabel}>{t(ctl.labelKey)}</Text>
                    <TextInput style={styles.input} value={relayInput} editable={cs.enabled}
                      placeholder={t('circle.settings.relayEndpoint_placeholder')} autoCapitalize="none"
                      onChangeText={setRelayInput} testID={`control-${ctl.id}-input`} />
                    <View style={styles.chipRow}>
                      <Pressable disabled={!cs.enabled} onPress={() => runControl(ctl.opId, { [ctl.arg]: relayInput.trim() })}
                        style={[styles.chip, !cs.enabled && styles.chipDisabled]} testID={`control-${ctl.id}-apply`}>
                        <Text style={styles.chipText}>{t('circle.settings.relayEndpoint_apply')}</Text>
                      </Pressable>
                      <Pressable disabled={!cs.enabled} onPress={() => { setRelayInput(''); runControl(ctl.opId, { clear: true }); }}
                        style={[styles.chip, !cs.enabled && styles.chipDisabled]} testID={`control-${ctl.id}-clear`}>
                        <Text style={styles.chipText}>{t('circle.settings.relayEndpoint_clear')}</Text>
                      </Pressable>
                    </View>
                    {ctl.hintKey ? <Text style={styles.hintText}>{t(ctl.hintKey)}</Text> : null}
                  </View>
                );
              }
              if (ctl.kind === 'toggle' && ctl.scope === 'device') {
                // Device-scoped toggle (wake-nudges): state lives on the DEVICE (`transport`),
                // dispatches its op via runControl — never a circle-policy patch (web parity).
                return (
                  <View key={ctl.id} style={styles.controlRow} testID={`control-${ctl.id}${cs.enabled ? '' : '-disabled'}`}>
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>{t(ctl.labelKey)}</Text>
                      <Switch trackColor={{ true: theme.color.accent, false: theme.color.trackOff }} thumbColor={theme.color.white}
                        disabled={!cs.enabled} value={!!(transport && ctl.stateKey && transport[ctl.stateKey])}
                        onValueChange={(v) => runControl(ctl.opId, { [ctl.arg]: v })} testID={`control-${ctl.id}-switch`} />
                    </View>
                    {ctl.hintKey ? <Text style={styles.hintText}>{t(ctl.hintKey)}</Text> : null}
                    {!cs.enabled && ctl.disabledHintKey ? <Text style={styles.note}>{t(ctl.disabledHintKey)}</Text> : null}
                  </View>
                );
              }
              // toggle → circle-policy field (patch), route-gated by enabledWhen.
              return (
                <View key={ctl.id} style={styles.controlRow} testID={`control-${ctl.id}${cs.enabled ? '' : '-disabled'}`}>
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>{t(ctl.labelKey)}</Text>
                    <Switch trackColor={{ true: theme.color.accent, false: theme.color.trackOff }} thumbColor={theme.color.white}
                      disabled={!cs.enabled} value={!!working[ctl.policyField]}
                      onValueChange={(v) => patch({ [ctl.policyField]: v })} testID={`control-${ctl.id}-switch`} />
                  </View>
                  {ctl.hintKey ? <Text style={styles.hintText}>{t(ctl.hintKey)}</Text> : null}
                  {!cs.enabled && ctl.disabledHintKey ? <Text style={styles.note}>{t(ctl.disabledHintKey)}</Text> : null}
                </View>
              );
            })}
          </View>
        ) : null}

        {/* manifest-driven per-app settings form */}
        {settingsForms.length ? (
          <>
            <Text style={styles.section}>{t('circle.settings.appSettings')}</Text>
            {settingsForms.map(({ app, fields }) => (
              <View key={app}>
                <Text style={styles.subhead}>{t(`circle.settings.app.${app}`)}</Text>
                {fields.map((f) => {
                  const key = `${app}.${f.key}`;
                  return (
                    <View key={key} style={styles.row}>
                      <Text style={styles.rowLabel}>{f.label}{f.required ? ' *' : ''}</Text>
                      {f.control === 'toggle' ? (
                        <Switch trackColor={{ true: theme.color.accent, false: theme.color.trackOff }} thumbColor={theme.color.white}
                          value={!!f.value} onValueChange={(v) => patch({ settings: { [key]: v } })} testID={`setting-${key}`} />
                      ) : f.control === 'choice' ? (
                        <View style={styles.chipRow}>
                          {(f.choices || []).map((c) => (
                            <Pressable key={c} onPress={() => patch({ settings: { [key]: c } })}
                              style={[styles.chip, f.value === c && styles.chipOn]} testID={`setting-${key}-${c}`}>
                              <Text style={styles.chipText}>{c}</Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : (
                        <TextInput style={styles.input} value={f.value == null ? '' : String(f.value)}
                          keyboardType={f.control === 'number' ? 'numeric' : 'default'}
                          onChangeText={(txt) => patch({ settings: { [key]: f.control === 'number' ? (txt === '' ? undefined : Number(txt)) : txt } })}
                          testID={`setting-${key}`} />
                      )}
                    </View>
                  );
                })}
              </View>
            ))}
          </>
        ) : null}

        {/* the per-skill freedom matrix (what the gate enforces) */}
        {capMatrix.length ? (
          <>
            <Text style={styles.section}>{t('circle.settings.capabilities')}</Text>
            {groupByApp(capMatrix).map(([app, rows]) => (
              <View key={app}>
                <Text style={styles.subhead}>{t(`circle.settings.app.${app}`)}</Text>
                {rows.map((row) => {
                  const base = { enabled: row.enabled, freedom: row.freedom, consequence: row.consequence, privacyFloor: row.privacyFloor };
                  return (
                    <View key={row.key} style={styles.capRow} testID={`cap-${row.key}`}>
                      <View style={styles.row}>
                        <Text style={styles.rowLabel}>{`${verbLabel(row.atom)} · ${row.noun}`}</Text>
                        <Switch trackColor={{ true: theme.color.accent, false: theme.color.trackOff }} thumbColor={theme.color.white}
                          value={row.enabled} onValueChange={(v) => patch({ capabilities: { [row.key]: { ...base, enabled: v } } })}
                          testID={`cap-${row.key}-enabled`} />
                      </View>
                      {row.enabled ? (
                        <View style={styles.chipRow}>
                          {FREEDOM_LEVELS.map((lvl) => (
                            <Pressable key={lvl} disabled={row.privacyFloor} onPress={() => patch({ capabilities: { [row.key]: { ...base, freedom: lvl } } })}
                              style={[styles.chip, row.freedom === lvl && styles.chipOn, row.privacyFloor && styles.chipDisabled]}
                              testID={`cap-${row.key}-freedom-${lvl}`}>
                              <Text style={styles.chipText}>{t(`circle.settings.freedom.${lvl}`)}</Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : null}
                      {row.enabled && row.freedom === 'optional' ? (
                        <View style={styles.chipRow}>
                          {OPT_OUT_CONSEQUENCES.map((c) => (
                            <Pressable key={c} onPress={() => patch({ capabilities: { [row.key]: { ...base, consequence: c } } })}
                              style={[styles.chip, row.consequence === c && styles.chipOn]} testID={`cap-${row.key}-cons-${c}`}>
                              <Text style={styles.chipText}>{t(`circle.settings.consequence_opt.${c}`)}</Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : null}
                      {row.privacyFloor ? <Text style={styles.note}>{t('circle.settings.privacyFloor')}</Text> : null}
                    </View>
                  );
                })}
              </View>
            ))}
          </>
        ) : null}

        {householdSelfAddr && typeof onAddHouseholdPeer === 'function' ? (
          <>
            <Text style={styles.section}>{t('circle.pairedDevices.title')}</Text>
            <PairedDevices
              selfAddr={householdSelfAddr}
              peers={householdPeers}
              t={t}
              onAdd={onAddHouseholdPeer}
              onRemove={onRemoveHouseholdPeer}
            />
          </>
        ) : null}
      </ScrollView>

      <Pressable style={styles.save} onPress={onSave} accessibilityRole="button" testID="circle-settings-save">
        <Text style={styles.saveText}>
          {consensusActive ? t('circle.settings.send_proposal') : t('circle.settings.save')}
        </Text>
      </Pressable>
    </View>
    {conflictOverlay}
    <GuidedSetupPanel
      visible={guidedOpen}
      templateUrl={SETTINGS_TEMPLATE_URL}
      t={t}
      onDone={(p) => patch(p)}
      onClose={() => setGuidedOpen(false)}
    />
    <RecipeConsentCard
      visible={!!reviewModel}
      model={reviewModel}
      onAgree={onAgreeRecipe}
      onDecline={onDeclineRecipe}
    />
    </>
  );
}

/** the `policy.settings` values for one app: "<app>.<key>" → `{ key: value }`. */
function settingValuesForApp(policy, app) {
  const out = {};
  const all = (policy && typeof policy.settings === 'object' && policy.settings) || {};
  const prefix = `${app}.`;
  for (const [k, v] of Object.entries(all)) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  return out;
}

/** Group freedom-matrix rows by app (preserving order). */
function groupByApp(matrix) {
  const byApp = new Map();
  for (const row of matrix) { if (!byApp.has(row.app)) byApp.set(row.app, []); byApp.get(row.app).push(row); }
  return [...byApp.entries()];
}

/** Localised atom verb label, falling back to the atom when no key is translated (t() echoes the key on a miss). */
function verbLabel(atom) {
  const k = `circle.settings.verb.${atom}`;
  const v = t(k);
  return v && v !== k ? v : atom;
}

const makeStyles = (theme) => StyleSheet.create({
  page:        { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: theme.color.paper },
  bar:         { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  back:        { fontSize: 13, color: theme.color.inkSoft },
  title:       { fontSize: 24, fontWeight: '600', fontFamily: theme.font.serif, color: theme.color.ink, marginVertical: 10 },
  body:        { paddingBottom: 24 },
  section:     { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: theme.color.inkSoft, marginTop: 16, marginBottom: 4 },
  row:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7 },
  rowLabel:    { fontSize: 14, color: theme.color.ink, flexShrink: 1, paddingRight: 8 },
  // radio-as-box — selected option boxed with a terracotta ring.
  optBox:        { borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, backgroundColor: theme.color.paper, paddingHorizontal: 12, marginBottom: 8 },
  optBoxSelected:{ borderColor: theme.color.accent, backgroundColor: theme.color.card },
  optRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9 },
  optTap:      { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  radio:       { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: theme.color.line, marginRight: 10, alignItems: 'center', justifyContent: 'center' },
  radioOn:     { borderColor: theme.color.accent },
  radioDot:    { width: 9, height: 9, borderRadius: 5, backgroundColor: theme.color.accent },
  info:        { fontSize: 16, color: theme.color.accent, paddingHorizontal: 6 },
  consequence: { fontSize: 12, color: theme.color.inkSoft, backgroundColor: theme.color.paper2, borderLeftWidth: 3, borderLeftColor: theme.color.accent, borderRadius: 6, padding: 8, marginBottom: 10 },
  note:        { fontSize: 12, color: theme.color.inkSoft, fontStyle: 'italic', marginTop: 8 },
  // Phase 4 §9 — Connection & transport controls.
  controlRow:  { marginBottom: 12 },
  hintText:    { fontSize: 11, color: theme.color.inkSoft, marginTop: 2 },
  muted:       { color: theme.color.inkSoft, fontStyle: 'italic', paddingVertical: 10 },
  save:        { marginTop: 8, marginBottom: 12, padding: 13, borderRadius: 8, backgroundColor: theme.color.accent, alignItems: 'center' },
  saveText:    { color: theme.color.white, fontSize: 15, fontWeight: '700' },
  guided:      { marginTop: 4, marginBottom: 4, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.color.accent, backgroundColor: theme.color.card, alignItems: 'center' },
  guidedText:  { color: theme.color.accent, fontSize: 14, fontWeight: '600' },
  // B · consent-card — apply-recipe source input + button
  recipeInput:  { borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, minHeight: 52, color: theme.color.ink, backgroundColor: theme.color.paper, textAlignVertical: 'top' },
  recipeApply:  { marginTop: 8, padding: 11, borderRadius: 8, backgroundColor: theme.color.accent, alignItems: 'center' },
  recipeApplyBusy: { opacity: 0.5 },
  recipeApplyText: { color: theme.color.white, fontSize: 14, fontWeight: '700' },
  // settings form + freedom matrix
  subhead:     { fontSize: 13, fontWeight: '600', color: theme.color.ink, marginTop: 10, marginBottom: 2 },
  input:       { borderWidth: 1, borderColor: theme.color.line, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, minWidth: 90, color: theme.color.ink, textAlign: 'right' },
  chipRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 4 },
  chip:        { borderWidth: 1, borderColor: theme.color.line, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: theme.color.paper },
  chipOn:      { borderColor: theme.color.accent, backgroundColor: theme.color.card },
  chipDisabled:{ opacity: 0.4 },
  chipText:    { fontSize: 12, color: theme.color.ink },
  capRow:      { borderBottomWidth: 1, borderBottomColor: theme.color.line, paddingBottom: 6, marginBottom: 2 },
});
