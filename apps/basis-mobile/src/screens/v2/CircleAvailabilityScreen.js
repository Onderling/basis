/**
 * basis-mobile v2 — availability (RN screen).
 *
 * RN counterpart of web's circleAvailability renderer over the SAME shared
 * `memberAvailability` model: cross-circle holiday mode (away until a date)
 * + quiet hours (defer pushes in a daily window, optionally weekends all
 * day).  Loads/saves through the injected (keyless) availability store.
 *
 * Web uses native date/time inputs; RN has none, so the date (YYYY-MM-DD)
 * and times (HH:MM) are plain TextInputs.  Working state is held RAW while
 * editing — the store's mergeAvailability normalises on save (a malformed
 * time falls back to the model default rather than blocking each keystroke).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Switch, TextInput, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from './themeContext.js';
import { t } from '../../core/localisation.js';

export default function CircleAvailabilityScreen({ store, onBack }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();   // clear the status bar: a back link under it cannot be tapped
  const styles = useMemo(() => makeStyles(theme, insets), [theme, insets]);
  const [working, setWorking] = useState(null);

  useEffect(() => {
    let live = true;
    store.get().then((a) => { if (live) setWorking(a); });
    return () => { live = false; };
  }, [store]);

  const setHoliday = useCallback((p) => setWorking((w) => ({ ...w, holiday: { ...w.holiday, ...p } })), []);
  const setQuiet   = useCallback((p) => setWorking((w) => ({ ...w, quietHours: { ...w.quietHours, ...p } })), []);

  const onSave = useCallback(async () => {
    if (!working) return;
    // store.update → mergeAvailability normalises (rejects malformed times).
    await store.update(working);
    onBack?.();
  }, [working, store, onBack]);

  if (!working) {
    return (
      <View style={styles.page} testID="circle-availability">
        <Text style={styles.muted}>{t('circle.loading')}</Text>
      </View>
    );
  }

  const h = working.holiday || {};
  const q = working.quietHours || {};

  return (
    <View style={styles.page} testID="circle-availability">
      {onBack ? (
        <View style={styles.bar}>
          <Pressable onPress={onBack} accessibilityRole="button" testID="circle-availability-back">
            <Text style={styles.back}>{t('circle.back_me')}</Text>
          </Pressable>
        </View>
      ) : null}
      <Text style={styles.title}>{t('circle.availability.title')}</Text>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.section}>{t('circle.availability.holiday')}</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('circle.availability.holiday_on')}</Text>
          <Switch trackColor={{ true: theme.color.accent, false: theme.color.trackOff }} thumbColor={theme.color.white} value={!!h.active} onValueChange={(v) => setHoliday({ active: v })} testID="holiday-active" />
        </View>
        <View style={styles.fieldRow}>
          <Text style={styles.rowLabel}>{t('circle.availability.holiday_until')}</Text>
          <TextInput
            style={styles.input}
            value={h.until || ''}
            onChangeText={(v) => setHoliday({ until: v || null })}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.color.inkSoft}
            autoCapitalize="none"
            autoCorrect={false}
            testID="holiday-until"
          />
        </View>

        <Text style={styles.section}>{t('circle.availability.quietHours')}</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('circle.availability.quiet_on')}</Text>
          <Switch trackColor={{ true: theme.color.accent, false: theme.color.trackOff }} thumbColor={theme.color.white} value={!!q.enabled} onValueChange={(v) => setQuiet({ enabled: v })} testID="quiet-enabled" />
        </View>
        <View style={styles.fieldRow}>
          <Text style={styles.rowLabel}>{t('circle.availability.from')}</Text>
          <TextInput
            style={styles.input}
            value={q.from || ''}
            onChangeText={(v) => setQuiet({ from: v })}
            placeholder="HH:MM"
            placeholderTextColor={theme.color.inkSoft}
            autoCapitalize="none"
            autoCorrect={false}
            testID="quiet-from"
          />
        </View>
        <View style={styles.fieldRow}>
          <Text style={styles.rowLabel}>{t('circle.availability.to')}</Text>
          <TextInput
            style={styles.input}
            value={q.to || ''}
            onChangeText={(v) => setQuiet({ to: v })}
            placeholder="HH:MM"
            placeholderTextColor={theme.color.inkSoft}
            autoCapitalize="none"
            autoCorrect={false}
            testID="quiet-to"
          />
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('circle.availability.weekends')}</Text>
          <Switch trackColor={{ true: theme.color.accent, false: theme.color.trackOff }} thumbColor={theme.color.white} value={!!q.weekends} onValueChange={(v) => setQuiet({ weekends: v })} testID="quiet-weekends" />
        </View>
      </ScrollView>

      <Pressable style={styles.save} onPress={onSave} accessibilityRole="button" testID="circle-availability-save">
        <Text style={styles.saveText}>{t('circle.settings.save')}</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (theme, insets) => StyleSheet.create({
  page:     { flex: 1, paddingHorizontal: 16, paddingTop: 12 + (insets?.top ?? 0), backgroundColor: theme.color.paper },
  bar:      { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  back:     { fontSize: 13, color: theme.color.inkSoft },
  title:    { fontSize: 24, fontWeight: '600', fontFamily: theme.font.serif, color: theme.color.ink, marginVertical: 10 },
  body:     { paddingBottom: 24 },
  section:  { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: theme.color.inkSoft, marginTop: 16, marginBottom: 4 },
  row:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  rowLabel: { fontSize: 14, color: theme.color.ink, flexShrink: 1, paddingRight: 8 },
  input:    { width: 130, padding: 9, borderWidth: 1, borderColor: theme.color.accent, borderRadius: 8, backgroundColor: theme.color.white, color: theme.color.ink, fontSize: 14, textAlign: 'center' },
  muted:    { color: theme.color.inkSoft, fontStyle: 'italic', paddingVertical: 10 },
  save:     { marginTop: 8, marginBottom: 12, padding: 13, borderRadius: 8, backgroundColor: theme.color.accent, alignItems: 'center' },
  saveText: { color: theme.color.white, fontSize: 15, fontWeight: '700' },
});
