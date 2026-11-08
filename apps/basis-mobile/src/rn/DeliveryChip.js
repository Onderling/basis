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

export default function DeliveryChip({ state, reason = null, rowId, onRetry = null, testIDPrefix = 'circle-delivery' }) {
  const theme = useTheme();
  const p = deliveryPresentation(state, { reason });
  if (!p) return null;
  const label = t(p.labelKey);
  const line = `${p.glyph} ${label}`;
  const styles = stylesFor(theme);
  return p.retryable ? (
    <Pressable
      style={styles.retryable}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`${testIDPrefix}-${p.state}-${rowId}`}
      onPress={() => { if (onRetry) onRetry(rowId); }}
    >
      <Text style={styles.retryableText}>{line}</Text>
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
    });
    cache.set(theme, s);
  }
  return s;
}
