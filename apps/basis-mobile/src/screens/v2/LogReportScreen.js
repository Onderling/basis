/**
 * "Copy log / report a problem" under My data — web≡mobile (web: circleApp's showLogReport over the same
 * `logReportView`). The person sees exactly the text Copy hands on; the phone's share sheet carries Copy,
 * and nothing is sent from here.
 */
import React, { useMemo } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { logReportView } from '../../../../basis/src/log/logReport.js';
import { t } from '../../core/localisation.js';
import { useTheme } from './themeContext.js';

export default function LogReportScreen({ onBack }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();   // clear the status bar: a back link under it cannot be tapped
  const styles = makeStyles(theme, insets);
  const { text, n } = useMemo(
    () => logReportView({ version: Constants.expoConfig?.extra?.appVersion ?? null, at: Date.now() }), []);

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content} testID="log-report-screen">
      <Pressable onPress={onBack} testID="log-report-back"><Text style={styles.back}>{t('circle.back_mydata')}</Text></Pressable>
      <Text style={styles.title}>{t('circle.logReport.title')}</Text>
      <Text style={styles.note}>{t(n ? 'circle.logReport.intro' : 'circle.logReport.empty')}</Text>
      <Text style={styles.text} selectable testID="log-report-text">{text}</Text>
      <Pressable style={styles.copy} onPress={() => { Share.share({ message: text }).catch(() => {}); }} testID="log-report-copy">
        <Text style={styles.copyText}>{t('circle.logReport.share')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const makeStyles = (theme, insets) => StyleSheet.create({
  wrap:     { flex: 1, paddingTop: insets?.top ?? 0, backgroundColor: theme.color.paper },
  content:  { padding: 16, paddingBottom: 48 },
  back:     { fontSize: 15, color: theme.color.accent, marginBottom: 10 },
  title:    { fontSize: 20, fontWeight: '700', color: theme.color.ink, marginBottom: 6 },
  note:     { fontSize: 13, color: theme.color.inkSoft, marginBottom: 16 },
  text:     { fontFamily: 'monospace', fontSize: 11, color: theme.color.ink, marginBottom: 16 },
  copy:     { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: theme.color.accent },
  copyText: { fontSize: 14, color: theme.color.accent },
});
