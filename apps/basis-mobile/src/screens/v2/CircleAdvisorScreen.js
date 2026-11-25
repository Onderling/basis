/**
 * basis-mobile v2 — circle Advisor (RN screen).
 *
 * RN counterpart of web's circleAdvisor over the SAME no-LLM rules engine
 * (`computeAdvice`): shows at most one advice card when a circle shows
 * strain (≥3 complaints / 14d AND rising activity), plus the member
 * "I'm too busy" button that logs a strain signal into the shared EventLog.
 * The monthly cooldown persists per-circle in AsyncStorage.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from './themeContext.js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { computeAdvice, makeTooBusyEvent, advisorShownKey } from '@onderling-app/basis';
import { t } from '../../core/localisation.js';


export default function CircleAdvisorScreen({ eventLog, circleId, onBack }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [advice, setAdvice] = useState(null);

  const recompute = useCallback(async () => {
    let lastShownAt = null;
    try { const s = await AsyncStorage.getItem(advisorShownKey(circleId)); if (s) lastShownAt = Number(s); }
    catch { /* fresh */ }
    const events = eventLog?.query ? eventLog.query({ excludeMuted: true }) : [];
    setAdvice(computeAdvice({ events, circleId, lastShownAt }));
  }, [eventLog, circleId]);

  useEffect(() => { recompute(); }, [recompute]);

  const onTooBusy = useCallback(() => {
    try { eventLog?.append?.(makeTooBusyEvent({ circleId })); } catch { /* defensive */ }
    recompute();
  }, [eventLog, circleId, recompute]);

  const onDismiss = useCallback(async () => {
    try { await AsyncStorage.setItem(advisorShownKey(circleId), String(Date.now())); } catch { /* ignore */ }
    recompute();
  }, [circleId, recompute]);

  return (
    <View style={styles.page} testID="circle-advisor">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="circle-advisor-back">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{t('circle.advisor.title')}</Text>

      {advice ? (
        <View style={styles.card} testID="circle-advisor-card">
          <Text style={styles.advice}>{t('circle.advisor.advice_too_busy', { count: advice.complaints })}</Text>
          <Pressable onPress={onDismiss} accessibilityRole="button" testID="circle-advisor-dismiss" style={styles.dismiss}>
            <Text style={styles.dismissText}>{t('circle.advisor.dismiss')}</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.muted}>{t('circle.advisor.none')}</Text>
      )}

      <Pressable onPress={onTooBusy} accessibilityRole="button" testID="circle-advisor-toobusy" style={styles.busy}>
        <Text style={styles.busyText}>{t('circle.advisor.too_busy_btn')}</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  page:       { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: theme.color.paper },
  bar:        { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  back:       { fontSize: 13, color: theme.color.inkSoft },
  title:      { fontSize: 24, fontWeight: '600', fontFamily: theme.font.serif, color: theme.color.ink, marginVertical: 10 },
  card:       { padding: 14, borderRadius: 10, borderWidth: 1, borderColor: theme.color.accent, backgroundColor: theme.color.card },
  advice:     { fontSize: 14, color: theme.color.ink, lineHeight: 20 },
  dismiss:    { alignSelf: 'flex-end', marginTop: 10, paddingHorizontal: 12, paddingVertical: 6 },
  dismissText:{ fontSize: 13, color: theme.color.inkSoft, fontWeight: '600' },
  muted:      { color: theme.color.inkSoft, fontStyle: 'italic', paddingVertical: 10 },
  busy:       { marginTop: 16, padding: 12, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.color.line, alignItems: 'center' },
  busyText:   { color: theme.color.inkSoft },
});
