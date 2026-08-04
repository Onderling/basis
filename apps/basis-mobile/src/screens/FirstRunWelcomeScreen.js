/**
 * basis-mobile — first-run welcome (5.9b).
 *
 * Shown ONCE on a clean install (no chat identity persisted, no welcome
 * marker set).  Two CTAs:
 *
 *   - "Start"                → caller routes to normal boot; vault
 *                              auto-generates an identity, the launcher
 *                              renders next render.
 *   - "I have a recovery phrase" → for now surfaces a deferred-feature
 *                              notice that points the user at the
 *                              existing /restore-from-mnemonic wizard
 *                              post-boot.  Boot-time restore needs
 *                              vault re-keying + `getMnemonicOnce`
 *                              skill on the basis agent (neither
 *                              exists yet) — tracked as 5.9b-followup.
 *
 * Pure presentation: parent owns the dismiss/restore callbacks so the
 * screen stays trivially testable + reusable in a future Detox flow.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';

import { theme } from './v2/theme.js';
// Invariant 8 (batch 6): the FIRST screen a new user sees speaks their language — every string via
// t(), en+nl (`circle.firstRun.*`). The no-pod line reuses `circle.mydata.pod_local_consequence`:
// the same fact My-data states, worded once (the C4b copy), so welcome and settings cannot drift.
import { t } from '../core/localisation.js';

export default function FirstRunWelcomeScreen({ onStart, onRestore } = {}) {
  // 5.9b-followup (2026-05-30): boot-time restore now has a real entry
  // path (MnemonicEntryScreen) gated through App.js — when the host
  // wires `onRestore`, we route there directly.  The deferred-feature
  // notice only renders if the host doesn't wire a handler (defensive
  // fallback; should never trigger now that App.js owns the route).
  const [showRestoreNotice, setShowRestoreNotice] = useState(false);

  const handleRestore = () => {
    if (typeof onRestore === 'function') { onRestore(); return; }
    setShowRestoreNotice(true);
  };

  return (
    <ScrollView contentContainerStyle={styles.root} testID="first-run-welcome">
      <Text style={styles.title}>{t('circle.firstRun.title')}</Text>
      <Text style={styles.lede}>{t('circle.firstRun.lede')}</Text>

      <View style={styles.bullets}>
        <Bullet>{t('circle.firstRun.bullet_circles')}</Bullet>
        <Bullet>{t('circle.firstRun.bullet_items')}</Bullet>
        <Bullet>{t('circle.firstRun.bullet_pod')}</Bullet>
      </View>

      {/* The no-pod truth, stated up front in the SAME words My-data uses (one key, two doors). */}
      <Text style={styles.lede}>{t('circle.mydata.pod_local_consequence')}</Text>

      <Pressable
        style={[styles.cta, styles.ctaPrimary]}
        onPress={onStart}
        testID="first-run-start"
        accessibilityRole="button"
      >
        <Text style={styles.ctaPrimaryText}>{t('circle.firstRun.start')}</Text>
      </Pressable>

      <Pressable
        style={[styles.cta, styles.ctaSecondary]}
        onPress={handleRestore}
        testID="first-run-restore"
        accessibilityRole="button"
      >
        <Text style={styles.ctaSecondaryText}>{t('circle.firstRun.restore')}</Text>
      </Pressable>

      {showRestoreNotice && (
        <View style={styles.notice} testID="first-run-restore-notice">
          <Text style={styles.noticeTitle}>{t('circle.firstRun.notice_title')}</Text>
          <Text style={styles.noticeBody}>{t('circle.firstRun.notice_body')}</Text>
        </View>
      )}
    </ScrollView>
  );
}

function Bullet({ children }) {
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    padding:        theme.space.lg,
    backgroundColor: theme.color.paper,
    minHeight:      '100%',
    gap:            theme.space.md,
  },
  title: {
    fontFamily: theme.font.serif,
    fontSize:   28,
    color:      theme.color.ink,
    marginTop:  theme.space.xl,
  },
  lede: {
    fontFamily: theme.font.serifBody,
    fontSize:   16,
    lineHeight: 22,
    color:      theme.color.ink,
  },
  bullets: { marginVertical: theme.space.md, gap: theme.space.sm },
  bulletRow: { flexDirection: 'row', gap: theme.space.sm },
  bulletDot: { color: theme.color.accent, fontSize: 16, lineHeight: 22 },
  bulletText: {
    flex:       1,
    fontFamily: theme.font.serifBody,
    fontSize:   15,
    lineHeight: 22,
    color:      theme.color.ink,
  },
  cta: {
    paddingVertical:   theme.space.md,
    paddingHorizontal: theme.space.lg,
    borderRadius:      theme.radius.md,
    alignItems:        'center',
  },
  ctaPrimary:    { backgroundColor: theme.color.accent },
  ctaPrimaryText: { color: theme.color.paper, fontFamily: theme.font.serif, fontSize: 17 },
  ctaSecondary:  { borderWidth: 1, borderColor: theme.color.line, marginTop: theme.space.sm },
  ctaSecondaryText: { color: theme.color.ink, fontFamily: theme.font.serif, fontSize: 16 },
  notice: {
    marginTop:    theme.space.md,
    padding:      theme.space.md,
    borderWidth:  1,
    borderColor:  theme.color.line,
    borderRadius: theme.radius.md,
    backgroundColor: '#f8f4e5',
  },
  noticeTitle: {
    fontFamily: theme.font.serif,
    fontSize:   15,
    color:      theme.color.ink,
    marginBottom: theme.space.xs,
  },
  noticeBody: {
    fontFamily: theme.font.serifBody,
    fontSize:   14,
    lineHeight: 20,
    color:      theme.color.ink,
  },
});
