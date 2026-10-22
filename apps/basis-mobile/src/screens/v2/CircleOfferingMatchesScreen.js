/**
 * basis-mobile v2 — skill match list (RN screen).
 *
 * RN counterpart of web's circleOfferingMatches over the SAME shared projection
 * (`buildOfferingMatches`): one row per INJECTED match, each carrying a label +
 * a source badge (human / agent / via-hop). The host supplies the matches;
 * no fetching or local discovery happens here. Mirrors CircleStreamScreen.
 *
 * Two places paint it (web parity): a page of its own (with `onBack`), and inline under the asker's own ask on the
 * noticeboard (with `onAsk` / `onSkip` — one pair of buttons per match; no back bar, no scroll of its own).
 */
import React, { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from './themeContext.js';
import Btn from './Btn.js';
import { buildOfferingMatches } from '@onderling-app/basis';
import { t } from '../../core/localisation.js';

export default function CircleOfferingMatchesScreen({ matches = [], onBack, onAsk, onSkip }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const rows = useMemo(() => buildOfferingMatches({ matches }), [matches]);

  if (typeof onAsk === 'function') {
    return (
      <View style={styles.inline} testID="circle-offering-matches-inline">
        <Text style={styles.inlineTitle}>{t('circle.offerings.matches_for_ask')}</Text>
        {rows.map((row) => (
          <View key={row.id} style={styles.inlineRow} testID={`ask-match-${row.id}`}>
            <Text style={styles.label}>{row.label}</Text>
            {row.offering ? <Text style={styles.offering}>{row.offering}</Text> : null}
            <View style={styles.inlineActions}>
              <Btn variant="primary" label={t('circle.offerings.match_ask')} onPress={() => onAsk(row)} testID={`ask-match-ask-${row.id}`} />
              {typeof onSkip === 'function'
                ? <Btn label={t('circle.offerings.match_skip')} onPress={() => onSkip(row)} testID={`ask-match-skip-${row.id}`} /> : null}
            </View>
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.page} testID="circle-offering-matches">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="circle-offering-matches-back">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{t('circle.offerings.matches_title')}</Text>

      {rows.length === 0 ? (
        <Text style={styles.muted}>{t('circle.offerings.no_matches')}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {rows.map((row) => (
            <View key={row.id} style={styles.row} testID={`skill-match-${row.id}`}>
              <Text style={styles.label}>{row.label}</Text>
              <Text style={styles.badge}>{t(`circle.offerings.source.${row.source}`)}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  page:   { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: theme.color.paper },
  bar:    { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  back:   { fontSize: 13, color: theme.color.inkSoft },
  title:  { fontSize: 24, fontWeight: '600', fontFamily: theme.font.serif, color: theme.color.ink, marginVertical: 10 },
  list:   { gap: 6, paddingBottom: 32 },
  row:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, backgroundColor: theme.color.card },
  label:  { fontSize: 14, color: theme.color.ink, flexShrink: 1, paddingRight: 8 },
  badge:  { fontSize: 11, fontWeight: '700', color: theme.color.inkSoft },
  muted:  { color: theme.color.inkSoft, fontStyle: 'italic', paddingVertical: 10 },
  inline:        { marginTop: 8, gap: 6 },
  inlineTitle:   { fontSize: 13, fontWeight: '600', color: theme.color.inkSoft },
  inlineRow:     { padding: 10, gap: 6, borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, backgroundColor: theme.color.card },
  offering:      { fontSize: 13, color: theme.color.inkSoft },
  inlineActions: { flexDirection: 'row', gap: 8 },
});
