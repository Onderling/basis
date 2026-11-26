/**
 * basis-mobile v2 — circle rules editor (RN screen).
 *
 * RN counterpart of web's circleRulesEditor: the six governance questions
 * over a rules document; required questions (purpose + agreements) gate
 * Save. "Preview" shows the assembled doc as a joiner consents to it. Holds
 * a working copy seeded from the passed `doc`; the host saves through the circle's rule for changing the rules
 * (`changeRulesDoor`), and an approved change reaches the other members on the rules-update lane.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from './themeContext.js';
import {
  RULES_QUESTIONS, normalizeRulesDoc, isRulesComplete,
} from '@onderling-app/basis';
import { t } from '../../core/localisation.js';
import ThemedTextInput from './ThemedTextInput.js';   // every text input's colours come from the theme (lint-themed-inputs)

export default function CircleRulesScreen({
  doc, onSave, onBack, onPreview,
  notice = null,   // what the last save came to, in words (a proposal opened · refused)
}) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [working, setWorking] = useState(() => normalizeRulesDoc(doc));
  const setField = useCallback((k, v) => setWorking((w) => ({ ...w, [k]: v })), []);
  const complete = isRulesComplete(working);

  return (
    <>
      <View style={styles.page} testID="circle-rules">
        <View style={styles.bar}>
          <Pressable onPress={onBack} accessibilityRole="button" testID="circle-rules-back">
            <Text style={styles.back}>{t('circle.back')}</Text>
          </Pressable>
        </View>
        <Text style={styles.title}>{t('circle.rules.title')}</Text>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
          {RULES_QUESTIONS.map((q) => (
            <View key={q.key} style={styles.field}>
              <Text style={styles.q}>{t(`circle.rules.q.${q.key}`)}{q.required ? ' *' : ''}</Text>
              <ThemedTextInput
                style={styles.input}
                value={working[q.key]}
                onChangeText={(v) => setField(q.key, v)}
                multiline
                testID={`rules-input-${q.key}`}
              />
            </View>
          ))}
          {!complete ? <Text style={styles.note}>{t('circle.rules.required_note')}</Text> : null}
          {notice ? <Text style={styles.note} accessibilityLiveRegion="polite" testID="circle-rules-notice">{notice}</Text> : null}
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
