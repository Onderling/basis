/**
 * basis-mobile v2 — launcher bottom tab bar.
 *
 * Screens / Circles / Contacten / Mij — the four top-level surfaces. Rendered
 * by the launcher beneath the list, stream and Me screens; absent inside a
 * circle.
 *
 * D / Surface 1 — the tab roster (ids + locale keys) is NO LONGER hardcoded
 * here: it is projected from `manifest.tabs` via the shared `circleTabsMobile`
 * selector (invariants #1/#3 — the four ids + `circle.tab.*` keys live ONCE,
 * in the manifest; web ≡ mobile by construction, both consume the same
 * projection).
 */
import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { t } from '../../core/localisation.js';
import { circleTabsMobile } from '../../../../basis/src/v2/tabProjection.js';
import { basisManifest } from '../../../../basis/src/index.js';
import { useTheme } from './themeContext.js';

// `badges` — a count per tab id (2026-09-21: Contacten's unread, summed; web parity with circleTabBar.js).
export default function CircleTabBar({ active, onSelect, badges = {} }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={styles.bar} testID="circle-tabbar">
      {circleTabsMobile(basisManifest).map((tab) => {
        const on = active === tab.id;
        const n = Number(badges?.[tab.id]) || 0;
        return (
          <Pressable
            key={tab.id}
            style={[styles.tab, on && styles.tabActive]}
            onPress={() => onSelect?.(tab.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={n > 0 && tab.id === 'contacten' ? t('circle.contacts.unread_tab', { count: n }) : undefined}
            testID={`circle-tab-${tab.id}`}
          >
            <View style={styles.labelRow}>
              <Text style={[styles.label, on && styles.labelActive]}>{t(tab.labelKey)}</Text>
              {n > 0 ? <Text style={styles.badge} testID={`circle-tab-${tab.id}-badge`}>{String(n)}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  bar: {
    flexDirection: 'row', justifyContent: 'center', gap: 4,
    paddingHorizontal: 8, paddingTop: 6, paddingBottom: 10,
    backgroundColor: theme.color.paper,
    borderTopWidth: 1, borderTopColor: theme.color.line,
  },
  tab: {
    flex: 1, maxWidth: 200, alignItems: 'center',
    paddingVertical: 9, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: 'transparent',
  },
  tabActive: { backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: theme.color.inkSoft },
  labelActive: { color: theme.color.white },
  badge: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, textAlign: 'center', fontSize: 11, fontWeight: '700', lineHeight: 18, backgroundColor: theme.color.accent, color: theme.color.white, overflow: 'hidden' },
});
