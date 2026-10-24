/**
 * basis-mobile v2 — the person's settings behind the gear on Mij (RN; web: circleSettingsHome.js): the home lists the
 * declared groups and, last, the door to the circles' own settings; the chooser lists the person's circles, each
 * opening that circle's settings screen. What is listed and in which order is the manifest's (`settingsHomeFor`).
 */
import React, { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../../core/localisation.js';
import { settingsHomeFor } from '../../../../basis/src/v2/settingsHome.js';
import { basisManifest } from '../../../../basis/src/index.js';
import { useTheme } from './themeContext.js';
import { FAB_CLEARANCE } from './fab.js';

export default function SettingsHomeScreen({ onBack, onOpenGroup, onOpenPerCircle, onOpenDoor }) {
  const { groups, perCircle, doors } = settingsHomeFor(basisManifest);
  return (
    <Page title={t('circle.settings_home.title')} onBack={onBack} testID="settings-home">
      {groups.map((g) => <Door key={g.id} label={t(g.labelKey)} onPress={() => onOpenGroup?.(g.id)} testID={`settings-group-${g.id}`} />)}
      {perCircle && typeof onOpenPerCircle === 'function'
        ? <Door label={t(perCircle.labelKey)} onPress={onOpenPerCircle} testID="settings-per-circle" />
        : null}
      {/* the other doors at the foot (feedback): each its op, opened by the host (web parity) */}
      {typeof onOpenDoor === 'function'
        ? doors.map((d) => <Door key={d.id} label={t(d.labelKey)} onPress={() => onOpenDoor(d)} testID={`settings-door-${d.id}`} />)
        : null}
    </Page>
  );
}

/** "Per kring": the person's circles, each a door to that circle's own settings (never a copy of them). */
export function CircleSettingsChooserScreen({ circles = [], onBack, onOpenCircle }) {
  const styles = useStyles();
  return (
    <Page title={t('circle.settings_home.per_circle')} onBack={onBack} testID="settings-circles">
      {circles.length === 0 ? <Text style={styles.fact}>{t('circle.settings_home.no_circles')}</Text> : null}
      {circles.map((c) => <Door key={c.id} label={c.name || c.id} onPress={() => onOpenCircle?.(c)} testID={`settings-circle-${c.id}`} />)}
    </Page>
  );
}

function Page({ title, onBack, testID, children }) {
  const styles = useStyles();
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content} testID={testID}>
      <View style={styles.header}>
        {typeof onBack === 'function' && <Pressable onPress={onBack} testID="settings-back"><Text style={styles.back}>{t('circle.mydata.back')}</Text></Pressable>}
        <Text style={styles.title}>{title}</Text>
      </View>
      {children}
    </ScrollView>
  );
}

/** A door: text + →, nothing else (rows look like what they are). */
function Door({ label, onPress, testID }) {
  const styles = useStyles();
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button" testID={testID}>
      <Text style={styles.rowText}>{label}</Text>
      <Text style={styles.arrow}>→</Text>
    </Pressable>
  );
}

function useStyles() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return useMemo(() => StyleSheet.create({
    wrap: { flex: 1, backgroundColor: theme.color.paper },
    content: { padding: 16, paddingTop: 16 + (insets?.top ?? 0), paddingBottom: FAB_CLEARANCE },
    header: { marginBottom: 12, gap: 6 },
    back: { fontSize: 14, color: theme.color.inkSoft },
    title: { fontFamily: theme.font.serif, fontSize: 22, fontWeight: '600', color: theme.color.ink },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.color.line },
    rowText: { fontSize: 15, color: theme.color.ink },
    arrow: { fontSize: 15, color: theme.color.inkSoft, marginLeft: 12 },
    fact: { fontSize: 14, color: theme.color.inkSoft },
  }), [theme, insets]);
}
