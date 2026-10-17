/**
 * MnemonicView — render a 12/24-word recovery phrase.
 *
 * Plan (Phase 41.0 L5): grid layout, copy-to-clipboard button,
 * screenshot warning banner. Pinboard-mobile + Tasks-mobile both
 * consume.
 */

import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

/**
 * @param {object} args
 * @param {string[]} args.words           12 or 24 BIP-39 words
 * @param {string}   [args.copyLabel='Copy']
 * @param {string}   [args.warningLabel='Don’t screenshot this. Anyone with these words controls your account.']
 * @param {(text: string) => void} [args.onCopy]
 *   Called with the joined phrase when the Copy button is tapped. The
 *   caller wires `Clipboard.setStringAsync(text)` (substrate stays
 *   clipboard-agnostic — `expo-clipboard` doesn't ship with all apps).
 */
export function MnemonicView({
  words = [],
  copyLabel = 'Copy',
  warningLabel = 'Don’t screenshot this. Anyone with these words controls your account.',
  onCopy,
} = {}) {
  const grid = useMemo(() => {
    const cols = words.length > 12 ? 4 : 3;
    const rows = [];
    for (let i = 0; i < words.length; i += cols) {
      rows.push(words.slice(i, i + cols));
    }
    return { rows, cols };
  }, [words]);

  if (!Array.isArray(words) || words.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.warning}>{warningLabel}</Text>
      <View style={styles.grid}>
        {grid.rows.map((row, rIdx) => (
          <View key={rIdx} style={styles.row}>
            {row.map((word, cIdx) => {
              const num = rIdx * grid.cols + cIdx + 1;
              return (
                <View key={cIdx} style={styles.cell}>
                  <Text style={styles.num}>{num}</Text>
                  <Text style={styles.word}>{word}</Text>
                </View>
              );
            })}
          </View>
        ))}
      </View>
      {onCopy ? (
        <Pressable
          onPress={() => onCopy(words.join(' '))}
          style={styles.copyBtn}
        >
          <Text style={styles.copyText}>{copyLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  warning: {
    color: '#9b1c1c',
    fontSize: 14,
    marginBottom: 12,
    fontWeight: '600',
  },
  grid: { gap: 8 },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  cell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 6,
    backgroundColor: '#f9fafb',
  },
  num: {
    fontSize: 11,
    color: '#6b7280',
    minWidth: 18,
  },
  word: {
    fontSize: 14,
    color: '#111827',
    fontFamily: 'monospace',
  },
  copyBtn: {
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#2563eb',
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  copyText: {
    color: '#fff',
    fontWeight: '600',
  },
});
