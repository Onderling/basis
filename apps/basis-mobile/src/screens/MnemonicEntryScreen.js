/**
 * 5.9b-followup — boot-time BIP39 mnemonic entry screen.
 *
 * Reached from FirstRunWelcomeScreen's "I have a recovery phrase" CTA
 * (parent owns navigation; this screen is pure presentation + a single
 * callback `onSubmit(mnemonic)` that resolves with the helper's result).
 *
 * Live word-count below the input nudges the user toward 24 without
 * blocking partial entry.  Error messages map error codes from
 * `restoreFromMnemonic.js` to localized strings.
 */
import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';

import { theme } from './v2/theme.js';
import { t } from '../core/localisation.js';
import {
  countMnemonicWords, MNEMONIC_WORD_COUNT,
} from '../core/restoreFromMnemonic.js';
import ThemedTextInput from './v2/ThemedTextInput.js';   // every text input's colours come from the theme (lint-themed-inputs)

export default function MnemonicEntryScreen({ onSubmit, onCancel } = {}) {
  const [phrase, setPhrase]   = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);

  const wordCount = countMnemonicWords(phrase);
  const canSubmit = wordCount === MNEMONIC_WORD_COUNT && !busy;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const result = await Promise.resolve(onSubmit?.(phrase));
    if (result && result.ok === false) {
      setError(result.code ?? 'invalid');
      setBusy(false);
    }
    // ok === true: parent unmounts us (firstRun → 'dismissed').
  }, [canSubmit, onSubmit, phrase]);

  return (
    <ScrollView
      contentContainerStyle={styles.root}
      keyboardShouldPersistTaps="handled"
      testID="mnemonic-entry"
    >
      <Text style={styles.title}>{t('mnemonic.entry.title')}</Text>
      <Text style={styles.lede}>{t('mnemonic.entry.lede')}</Text>

      <ThemedTextInput
        style={styles.input}
        value={phrase}
        onChangeText={(v) => { setPhrase(v); setError(null); }}
        placeholder={t('mnemonic.entry.placeholder')}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        multiline
        numberOfLines={6}
        textAlignVertical="top"
        editable={!busy}
        testID="mnemonic-entry-input"
      />

      <View style={styles.statusRow}>
        <Text style={styles.statusText}>
          {t('mnemonic.entry.wordCount', {
            count: wordCount, total: MNEMONIC_WORD_COUNT,
          })}
        </Text>
      </View>

      {error ? (
        <View style={styles.errorBox} testID="mnemonic-entry-error">
          <Text style={styles.errorText}>
            {t(`mnemonic.entry.error.${error}`)}
          </Text>
        </View>
      ) : null}

      <Pressable
        style={[styles.cta, styles.ctaPrimary, !canSubmit && styles.ctaDisabled]}
        onPress={handleSubmit}
        disabled={!canSubmit}
        testID="mnemonic-entry-submit"
        accessibilityRole="button"
      >
        {busy ? (
          <ActivityIndicator color={theme.color.paper} />
        ) : (
          <Text style={styles.ctaPrimaryText}>{t('mnemonic.entry.submit')}</Text>
        )}
      </Pressable>

      <Pressable
        style={[styles.cta, styles.ctaSecondary]}
        onPress={onCancel}
        disabled={busy}
        testID="mnemonic-entry-cancel"
        accessibilityRole="button"
      >
        <Text style={styles.ctaSecondaryText}>{t('mnemonic.entry.cancel')}</Text>
      </Pressable>
    </ScrollView>
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
    fontSize:   24,
    color:      theme.color.ink,
    marginTop:  theme.space.xl,
  },
  lede: {
    fontFamily: theme.font.serifBody,
    fontSize:   15,
    lineHeight: 21,
    color:      theme.color.ink,
  },
  input: {
    minHeight:       140,
    borderWidth:     1,
    borderColor:     theme.color.line,
    backgroundColor: theme.color.white,
    borderRadius:    theme.radius.md,
    padding:         theme.space.md,
    fontSize:        16,
    fontFamily:      'Menlo',                  // monospace for word-count clarity
    color:           theme.color.ink,
  },
  statusRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  statusText: {
    fontSize:   13,
    color:      theme.color.inkSoft,
    fontStyle:  'italic',
  },
  errorBox: {
    padding:         theme.space.md,
    borderWidth:     1,
    borderColor:     theme.color.accent,
    borderRadius:    theme.radius.md,
    backgroundColor: '#fff0e8',
  },
  errorText: {
    fontFamily: theme.font.serifBody,
    fontSize:   14,
    color:      theme.color.ink,
  },
  cta: {
    paddingVertical:   theme.space.md,
    paddingHorizontal: theme.space.lg,
    borderRadius:      theme.radius.md,
    alignItems:        'center',
  },
  ctaPrimary:        { backgroundColor: theme.color.accent },
  ctaPrimaryText:    { color: theme.color.paper, fontFamily: theme.font.serif, fontSize: 17 },
  ctaDisabled:       { opacity: 0.5 },
  ctaSecondary:      { borderWidth: 1, borderColor: theme.color.line, marginTop: theme.space.sm },
  ctaSecondaryText:  { color: theme.color.ink, fontFamily: theme.font.serif, fontSize: 16 },
});
