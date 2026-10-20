/**
 * basis-mobile v2 — circle rules consent (RN screen).
 *
 * The assembled rules document shown read-only with Agree / Decline; only non-blank fields render. A PREVIEW from the
 * rules editor (mobile only, and hidden on both shells by the alpha with the editor). The real join-flow consent is not
 * built on either shell.
 */
import React, { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from './themeContext.js';
import { RULES_FIELDS, normalizeRulesDoc, isRulesEmpty } from '@onderling-app/basis';
import { t } from '../../core/localisation.js';

export default function CircleRulesConsentScreen({ doc, onAgree, onDecline, onBack }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const d = normalizeRulesDoc(doc);
  const empty = isRulesEmpty(d);

  return (
    <View style={styles.page} testID="circle-rules-consent">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="circle-rules-consent-back">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{t('circle.rules.consent_title')}</Text>

      {empty ? (
        <Text style={styles.muted}>{t('circle.rules.consent_empty')}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {RULES_FIELDS.filter((k) => d[k].trim()).map((k) => (
            <View key={k} style={styles.field} testID={`consent-field-${k}`}>
              <Text style={styles.q}>{t(`circle.rules.q.${k}`)}</Text>
              <Text style={styles.a}>{d[k]}</Text>
            </View>
          ))}
        </ScrollView>
      )}

      <View style={styles.actions}>
        <Pressable onPress={onDecline} accessibilityRole="button" testID="circle-rules-decline" style={styles.decline}>
          <Text style={styles.declineText}>{t('circle.rules.decline')}</Text>
        </Pressable>
        <Pressable onPress={onAgree} accessibilityRole="button" testID="circle-rules-agree" style={styles.agree}>
          <Text style={styles.agreeText}>{t('circle.rules.agree')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  page:        { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: theme.color.paper },
  bar:         { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  back:        { fontSize: 13, color: theme.color.inkSoft },
  title:       { fontSize: 24, fontWeight: '600', fontFamily: theme.font.serif, color: theme.color.ink, marginVertical: 10 },
  body:        { paddingBottom: 16 },
  field:       { marginBottom: 14 },
  q:           { fontSize: 13, fontWeight: '700', color: theme.color.inkSoft },
  a:           { fontSize: 14, color: theme.color.ink, marginTop: 2, lineHeight: 20 },
  muted:       { color: theme.color.inkSoft, fontStyle: 'italic', paddingVertical: 10 },
  actions:     { flexDirection: 'row', gap: 10, marginBottom: 12 },
  decline:     { flex: 1, padding: 13, borderRadius: 8, borderWidth: 1, borderColor: theme.color.line, alignItems: 'center' },
  declineText: { color: theme.color.inkSoft, fontSize: 15 },
  agree:       { flex: 1, padding: 13, borderRadius: 8, backgroundColor: theme.color.accent, alignItems: 'center' },
  agreeText:   { color: theme.color.white, fontSize: 15, fontWeight: '700' },
});
