/**
 * basis-mobile — the recovery-phrase screen.
 *
 * Opened ONLY by Vandaag's key card ("Toon") — never by itself: the phrase is the owner root, and a phrase on screen in
 * a café is a key handed to whoever looks. Three CTAs: "Written down" / "Photo taken" end the key card; "Later" puts
 * it away for a while (the marks live in the shared onboardingFlags; the parent sets them).
 *
 * Pure presentation: the parent reads the phrase (`household.revealOwnerPhrase`) on the card's tap and owns the marks.
 */
import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';

import { theme } from './v2/theme.js';
import { t } from '../core/localisation.js';
import { partitionMnemonicGrid } from '../core/mnemonicCreate.js';

export default function MnemonicCreateScreen({
  mnemonic = '',
  onWritten,
  onPhoto,
  onLater,
} = {}) {
  const words = partitionMnemonicGrid(mnemonic);

  return (
    <ScrollView contentContainerStyle={styles.root} testID="mnemonic-create">
      <Text style={styles.kicker}>{t('mnemonic.create.kicker')}</Text>
      <Text style={styles.title}>{t('mnemonic.create.title')}</Text>
      <Text style={styles.lede}>{t('mnemonic.create.lede')}</Text>

      <View style={styles.wordBox} testID="mnemonic-create-words">
        {words.map(({ n, word }) => (
          <View key={n} style={styles.wordRow}>
            <Text style={styles.wordIndex}>{n}.</Text>
            <Text style={styles.wordText}>{word}</Text>
          </View>
        ))}
        {words.length === 0 ? (
          <Text style={styles.muted}>{t('mnemonic.create.unavailable')}</Text>
        ) : null}
      </View>

      <Pressable
        style={[styles.cta, styles.ctaPrimary]}
        onPress={onWritten}
        accessibilityRole="button"
        testID="mnemonic-create-written"
      >
        <Text style={styles.ctaPrimaryText}>{t('mnemonic.create.written')}</Text>
      </Pressable>

      <Pressable
        style={[styles.cta, styles.ctaSecondary]}
        onPress={onPhoto}
        accessibilityRole="button"
        testID="mnemonic-create-photo"
      >
        <Text style={styles.ctaSecondaryText}>{t('mnemonic.create.photo')}</Text>
      </Pressable>

      <Pressable
        style={[styles.cta, styles.ctaTertiary]}
        onPress={onLater}
        accessibilityRole="button"
        testID="mnemonic-create-later"
      >
        <Text style={styles.ctaTertiaryText}>{t('mnemonic.create.later')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    padding:         theme.space.lg,
    backgroundColor: theme.color.paper,
    minHeight:       '100%',
    gap:             theme.space.md,
  },
  kicker: {
    fontFamily:    theme.font.serif,
    fontSize:      11,
    letterSpacing: 1.2,
    color:         theme.color.accent,
    marginTop:     theme.space.xl,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: theme.font.serif,
    fontSize:   28,
    color:      theme.color.ink,
  },
  lede: {
    fontFamily: theme.font.serifBody,
    fontSize:   15,
    lineHeight: 21,
    color:      theme.color.ink,
    marginBottom: theme.space.sm,
  },
  wordBox: {
    padding:         theme.space.md,
    borderWidth:     1,
    borderColor:     theme.color.line,
    borderRadius:    theme.radius.md,
    backgroundColor: theme.color.white,
    flexDirection:   'row',
    flexWrap:        'wrap',
    gap:             theme.space.sm,
  },
  wordRow: {
    width:         '45%',
    flexDirection: 'row',
    gap:           6,
  },
  wordIndex: {
    fontFamily: 'Menlo',
    fontSize:   13,
    color:      theme.color.inkSoft,
    width:      22,
  },
  wordText: {
    fontFamily: 'Menlo',
    fontSize:   14,
    color:      theme.color.ink,
  },
  muted: { color: theme.color.inkSoft, fontStyle: 'italic' },
  cta: {
    paddingVertical:   theme.space.md,
    paddingHorizontal: theme.space.lg,
    borderRadius:      theme.radius.md,
    alignItems:        'center',
  },
  ctaPrimary:     { backgroundColor: theme.color.accent },
  ctaPrimaryText: { color: theme.color.paper, fontFamily: theme.font.serif, fontSize: 17 },
  ctaSecondary:   { borderWidth: 1, borderColor: theme.color.line, marginTop: theme.space.sm },
  ctaSecondaryText: { color: theme.color.ink, fontFamily: theme.font.serif, fontSize: 16 },
  ctaTertiary:    { marginTop: theme.space.sm },
  ctaTertiaryText: { color: theme.color.inkSoft, fontFamily: theme.font.serif, fontSize: 14 },
});
