/**
 * basis-mobile v2 — circle rules editor (RN screen).
 *
 * RN counterpart of web's circleRulesEditor: the six governance questions
 * over a rules document; required questions (purpose + agreements) gate
 * Save. "Preview" shows the assembled doc as a joiner consents to it. Holds
 * a working copy seeded from the passed `doc`; the host persists onSave.
 *
 * γ.4 — conflict resolution.  When `incomingRules` is non-null (the
 * source plumbing — peer broadcast / pod-sync — is deferred to a later
 * slice; today every existing call site passes none of these opts and
 * the screen behaves exactly as before), the screen runs a 3-way diff
 * against the last captured version (γ.2) and — if conflicts surface —
 * overlays the SAME modal (CircleRecipeConflictScreen) used by the
 * recipe editor with a rules-namespaced heading via its `title` prop.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet } from 'react-native';
import { useTheme } from './themeContext.js';
import {
  RULES_QUESTIONS, normalizeRulesDoc, isRulesComplete,
  detectRulesConflicts, applyRulesResolution, decisionsForMerges,
} from '@onderling-app/basis';
import { t } from '../../core/localisation.js';
import CircleRecipeConflictScreen from './CircleRecipeConflictScreen.js';

export default function CircleRulesScreen({
  doc, onSave, onBack, onPreview,
  // γ.4 — opt-in conflict resolver.  See file header for the deferred
  // source plumbing.  Existing callers pass none of these and get the
  // pre-γ.4 behaviour.
  incomingRules = null,
  rulesStore,
  circleId,
  onIncomingApplied,
  onIncomingDiscarded,
}) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [working, setWorking] = useState(() => normalizeRulesDoc(doc));
  const setField = useCallback((k, v) => setWorking((w) => ({ ...w, [k]: v })), []);
  const complete = isRulesComplete(working);

  // γ.4 — conflict resolver state.  `report === null` means "not detected
  // yet" or "no overlay needed".
  const [conflictReport, setConflictReport] = useState(null);
  const [localForCompare, setLocalForCompare] = useState(null);

  useEffect(() => {
    if (incomingRules == null) { setConflictReport(null); return; }
    let live = true;
    (async () => {
      let base = null;
      try {
        if (rulesStore && typeof rulesStore.listVersions === 'function' && circleId) {
          const versions = await rulesStore.listVersions(circleId);
          const head = Array.isArray(versions) && versions.length > 0 ? versions[0] : null;
          base = head && typeof head === 'object' && head.value != null ? head.value : null;
        }
      } catch { /* best-effort */ }

      const report = detectRulesConflicts(working, incomingRules, base);
      if (!live) return;
      setLocalForCompare(working);

      // Web parity (story 6.2): resolve each auto-merge to the side that ACTUALLY changed. `apply` defaults
      // unlisted paths to `theirs`, so `{}` here silently reverted a fresher LOCAL edit whenever the
      // divergence was ours — a stale second device coming back overwrote the newer doc with no prompt.
      if (report.identical
          || (report.blockConflicts.length === 0 && report.metaConflicts.length === 0)) {
        const merged = applyRulesResolution(working, incomingRules, decisionsForMerges(report.toMerge));
        try {
          if (rulesStore && typeof rulesStore.set === 'function' && circleId) {
            await rulesStore.set(circleId, merged);
          }
        } catch { /* best-effort */ }
        onIncomingApplied?.(merged);
        return;
      }
      setConflictReport(report);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingRules, rulesStore, circleId]);

  const handleResolve = async (decisions) => {
    if (!localForCompare || !incomingRules) { setConflictReport(null); return; }
    const merged = applyRulesResolution(localForCompare, incomingRules, decisions);
    try {
      if (rulesStore && typeof rulesStore.set === 'function' && circleId) {
        await rulesStore.set(circleId, merged);
      }
    } catch { /* best-effort */ }
    setConflictReport(null);
    onIncomingApplied?.(merged);
  };

  const conflictOverlay = conflictReport ? (
    <CircleRecipeConflictScreen
      visible
      conflicts={conflictReport}
      local={localForCompare}
      incoming={incomingRules}
      title="circle.rules.conflict.title"
      onResolve={handleResolve}
      onCancel={() => { setConflictReport(null); onIncomingDiscarded?.(); }}
    />
  ) : null;

  return (
    <>
      <View style={styles.page} testID="circle-rules">
        <View style={styles.bar}>
          <Pressable onPress={onBack} accessibilityRole="button" testID="circle-rules-back">
            <Text style={styles.back}>{t('circle.back')}</Text>
          </Pressable>
        </View>
        <Text style={styles.title}>{t('circle.rules.title')}</Text>

        <ScrollView contentContainerStyle={styles.body}>
          {RULES_QUESTIONS.map((q) => (
            <View key={q.key} style={styles.field}>
              <Text style={styles.q}>{t(`circle.rules.q.${q.key}`)}{q.required ? ' *' : ''}</Text>
              <TextInput
                style={styles.input}
                value={working[q.key]}
                onChangeText={(v) => setField(q.key, v)}
                multiline
                testID={`rules-input-${q.key}`}
              />
            </View>
          ))}
          {!complete ? <Text style={styles.note}>{t('circle.rules.required_note')}</Text> : null}
          <Pressable onPress={() => onPreview?.(working)} accessibilityRole="button" testID="circle-rules-preview" style={styles.preview}>
            <Text style={styles.previewText}>{t('circle.rules.preview')}</Text>
          </Pressable>
        </ScrollView>

        <Pressable
          onPress={() => { if (complete) onSave?.(working); }}
          accessibilityRole="button"
          testID="circle-rules-save"
          style={[styles.save, !complete && styles.saveDisabled]}
          disabled={!complete}
        >
          <Text style={styles.saveText}>{t('circle.rules.save')}</Text>
        </Pressable>
      </View>
      {conflictOverlay}
    </>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  page:        { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: theme.color.paper },
  bar:         { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  back:        { fontSize: 13, color: theme.color.inkSoft },
  title:       { fontSize: 24, fontWeight: '600', fontFamily: theme.font.serif, color: theme.color.ink, marginVertical: 10 },
  body:        { paddingBottom: 24 },
  field:       { marginBottom: 12 },
  q:           { fontSize: 13, fontWeight: '600', color: theme.color.ink, marginBottom: 4 },
  input:       { minHeight: 56, padding: 10, borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, backgroundColor: theme.color.white, fontSize: 14, textAlignVertical: 'top' },
  note:        { fontSize: 12, color: theme.color.inkSoft, fontStyle: 'italic', marginTop: 4 },
  preview:     { marginTop: 12, padding: 10, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.color.line, alignItems: 'center' },
  previewText: { color: theme.color.inkSoft, fontSize: 13 },
  save:        { marginTop: 8, marginBottom: 12, padding: 13, borderRadius: 8, backgroundColor: theme.color.accent, alignItems: 'center' },
  saveDisabled:{ backgroundColor: theme.color.line },
  saveText:    { color: theme.color.white, fontSize: 15, fontWeight: '700' },
});
