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
import { barSlots } from '../../../../basis/src/v2/plusDial.js';
import { renderMobile } from '@onderling/app-manifest';
import { FAB } from './fab.js';
import { basisManifest } from '../../../../basis/src/index.js';
import { useTheme } from './themeContext.js';

// `badges` — a count per tab id (2026-09-21: Contacten's unread, summed; web parity with circleTabBar.js).
// `hasMesh` — this device discovers and is discovered nearby (the phone's mDNS): the Nearby tab is painted only then
// `plus` — THE "+" docked in the bar (shared plusDial.js): `{ dial, open, onPress }` from the host, or null on a screen
// without it. The bar only paints and reports a press — 'plus' (its own spot), a button id, or 'outside' — and the host
// asks the shared `plusPress` what that does (web twin: circleTabBar.js).
export default function CircleTabBar({ active, onSelect, badges = {}, hasMesh = false, plus = null }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const open = !!(plus && plus.open);
  const press = (what) => plus?.onPress?.(what);
  return (
    <View style={styles.bar} testID="circle-tabbar">
      {barSlots(basisManifest, { renderer: renderMobile, hasMesh, plus: !!plus }).map((slot) => {
        if (slot.kind === 'plus') {
          const middle = open ? plus.dial?.middle : null;
          const name = middle ? t(middle.labelKey) : (open ? t('circle.plus.close') : t('circle.vandaag.plus'));
          return (
            <Pressable key="plus" onPress={() => press('plus')} accessibilityRole="button" accessibilityLabel={name}
              accessibilityState={{ expanded: open }} testID={middle ? `plus-dial-${middle.id}` : 'vandaag-plus-open'}
              style={styles.plus}>
              <Text style={middle ? styles.plusWord : styles.plusSign}>{middle ? name : (open ? '×' : '+')}</Text>
            </Pressable>
          );
        }
        const tab = slot.tab;
        const on = active === tab.id;
        const n = Number(badges?.[tab.id]) || 0;
        return (
          <Pressable
            key={tab.id}
            style={[styles.tab, on && styles.tabActive, open && styles.tabDimmed]}
            // while the "+" is open the tabs are dimmed with the rest: a touch on one only closes
            onPress={() => (open ? press('outside') : onSelect?.(tab.id))}
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

/**
 * The round buttons around the open "+" (all but the middle one), a thumb-reach above the bar, each with its word.
 * Painted by the tab frame above the bar (a child outside the bar's bounds would not get its touch on Android).
 */
export function PlusDialButtons({ plus }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  if (!plus?.open) return null;
  return (
    <View style={styles.dialRow} pointerEvents="box-none" testID="plus-dial">
      {(plus.dial?.around ?? []).map((b) => (
        <Pressable key={b.id} onPress={() => plus.onPress?.(b.id)} accessibilityRole="button" accessibilityLabel={t(b.labelKey)}
          testID={`plus-dial-${b.id}`} style={styles.dialSpot}>
          <Text style={styles.dialWord}>{t(b.labelKey)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  bar: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4,
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
  tabDimmed: { opacity: 0.45 },
  // THE "+" in the bar: the one accent (web twin: .cc-fab.circle-tabbar__plus); not raised above the bar, since a part
  // outside the bar's bounds would not take a touch on Android
  plus: { width: 48, height: 48, borderRadius: 24, marginHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.accentInk, elevation: 4 },
  plusSign: { color: theme.color.accentContrast, fontSize: 26, lineHeight: 28 },
  plusWord: { color: theme.color.accentContrast, fontSize: 12, fontWeight: '700' },
  dialRow: { position: 'absolute', left: 0, right: 0, bottom: FAB.bottom, flexDirection: 'row', justifyContent: 'center', gap: 28 },
  dialSpot: { width: FAB.size, height: FAB.size, borderRadius: FAB.size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.paper, elevation: 6 },
  dialWord: { color: theme.color.ink, fontSize: 12, fontWeight: '700' },
  badge: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, textAlign: 'center', fontSize: 11, fontWeight: '700', lineHeight: 18, backgroundColor: theme.color.accent, color: theme.color.white, overflow: 'hidden' },
});
