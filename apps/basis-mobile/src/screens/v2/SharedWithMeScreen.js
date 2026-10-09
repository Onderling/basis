/**
 * basis-mobile v2 — "Shared with me" list (RN screen, SILENT out-of-circle delivery).
 *
 * RN counterpart of web's `renderSharedWithMe` over the SAME shared selector (`buildSharedWithMe` /
 * `openSharedCopy` from the basis barrel) — web ≡ mobile by construction (invariant #2). The screen only
 * projects + renders: it takes the raw received store entries, projects them newest-first through the shared
 * selector, and on tap opens the sealed copy with the recipient's OWN network-derived sealing opener (injected
 * by the shell). No dispatch/crypto logic lives here (invariant #1).
 */
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from './themeContext.js';
import { buildSharedWithMe, openSharedCopy } from '@onderling-app/basis';
import { t } from '../../core/localisation.js';

export default function SharedWithMeScreen({
  received = [],
  opener = null,   // (text) => plaintext — the recipient's own per-text sealing opener
  onBack,
  onOpened,
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();   // clear the status bar: a back link under it cannot be tapped
  const styles = useMemo(() => makeStyles(theme, insets), [theme, insets]);
  const [openedId, setOpenedId] = useState(null);

  // The ONE shared selector — identical projection web uses.
  const rows = useMemo(() => buildSharedWithMe(received), [received]);

  const onOpen = async (entry) => {
    if (typeof opener !== 'function') return;
    try {
      const item = await openSharedCopy(entry, opener);
      setOpenedId(entry.id);
      if (typeof onOpened === 'function') onOpened(entry, item);
    } catch { /* wrong key / not a recipient — deny-safe, no leak */ }
  };

  return (
    <View style={styles.page} testID="shared-with-me">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="shared-with-me-back">
          <Text style={styles.back}>{t('circle.back_me')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{t('circle.sharedWithMe.title')}</Text>

      {rows.length === 0 ? (
        <Text style={styles.empty} testID="shared-with-me-empty">{t('circle.sharedWithMe.empty')}</Text>
      ) : (
        <ScrollView>
          {rows.map((entry) => (
            <Pressable
              key={entry.id}
              accessibilityRole="button"
              testID={`shared-with-me-row-${entry.id}`}
              onPress={() => onOpen(entry)}
              style={[styles.row, openedId === entry.id && styles.rowOpen]}
            >
              <Text style={styles.rowText}>
                {entry.sourceType
                  ? t('circle.sharedWithMe.row', { type: entry.sourceType, from: entry.from ?? '?' })
                  : (entry.from ?? entry.id)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (theme, insets) => StyleSheet.create({
  page:    { flex: 1, backgroundColor: theme.color.paper, padding: 12, paddingTop: 12 + (insets?.top ?? 0) },
  bar:     { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  back:    { color: theme.color.accent, fontSize: 16 },
  title:   { color: theme.color.ink, fontSize: 20, fontWeight: '600', marginBottom: 12 },
  empty:   { color: theme.color.inkSoft, fontSize: 14, marginTop: 24, textAlign: 'center' },
  row:     { paddingVertical: 12, paddingHorizontal: 10, borderRadius: theme.radius?.md ?? 8, backgroundColor: theme.color.card, marginBottom: 8 },
  rowOpen: { borderWidth: 1, borderColor: theme.color.accent },
  rowText: { color: theme.color.ink, fontSize: 15 },
});
