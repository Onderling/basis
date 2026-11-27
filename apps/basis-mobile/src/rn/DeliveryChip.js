/**
 * DeliveryChip — how an OWN bubble says how far its message got, on mobile. ONE component for the circle bubble
 * and the contact thread's bubble (web: `buildDeliveryChip` in circleView.js, used by both renderers the same way).
 *
 * It paints nothing of its own: the glyph, tone, words and whether a tap can help all come from the SHARED
 * presentation table (`deliverySettings.js` → `deliveryPresentation`), the one web reads, so a DM and a circle
 * message can never shape or word the same fact differently. Null state, or a state that shows nothing → null.
 */
import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { deliveryPresentation } from '../../../basis/src/v2/deliverySettings.js';
import { t } from '../core/localisation.js';
import { useTheme } from '../screens/v2/themeContext.js';

export default function DeliveryChip({ state, reason = null, waiting = null, relayGaveUp = null, rowId, onRetry = null, testIDPrefix = 'circle-delivery' }) {
  const theme = useTheme();
  const p = deliveryPresentation(state, { reason, waiting, relayGaveUp });
  if (!p) return null;
  // the relay's give-up: its words BESIDE the rung's, and the chip a retry (the shared presentation decides; web the same)
  const label = p.hintKey ? `${t(p.labelKey, p.labelVars)} · ${t(p.hintKey)}` : t(p.labelKey, p.labelVars);
  const line = `${p.glyph} ${label}`;
  const styles = stylesFor(theme);
  return p.retryable ? (
    <Pressable
      style={p.tone === 'warn' ? styles.retryable : styles.retryableNeutral}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`${testIDPrefix}-${p.state}-${rowId}`}
      onPress={() => { if (onRetry) onRetry(rowId); }}
    >
      <Text style={p.tone === 'warn' ? styles.retryableText : styles.retryableNeutralText}>{line}</Text>
    </Pressable>
  ) : (
    <Text
      style={styles.quiet}
      accessibilityLabel={label}
      accessibilityRole="text"
      testID={`${testIDPrefix}-${p.state}-${rowId}`}
    >
      {line}
    </Text>
  );
}

const cache = new WeakMap();
function stylesFor(theme) {
  let s = cache.get(theme);
  if (!s) {
    s = StyleSheet.create({
      quiet:         { marginTop: 4, fontSize: 11, color: theme.color.inkSoft },
      retryable:     { marginTop: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1, borderColor: theme.color.danger, backgroundColor: theme.color.dangerBg },
      retryableText: { fontSize: 11, color: theme.color.danger },
      // a tap may help, but nothing went wrong ('maybe received': the shared tone is neutral): no warning colour
      retryableNeutral:     { marginTop: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1, borderColor: theme.color.line },
      retryableNeutralText: { fontSize: 11, color: theme.color.inkSoft },
    });
    cache.set(theme, s);
  }
  return s;
}
