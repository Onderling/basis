/**
 * ActStateBar — paints the shared act state (actState.js) on mobile: one line at the top of the screen while the act
 * the person just took runs, when it ended, or when it failed. Web: the `cc-act-state` strip in circleApp.js. The bar
 * decides nothing: words, timing and which acts count are the store's. Nothing shows when `store.current` is null.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { actStateLine } from '../../../basis/src/v2/actState.js';
import { t } from '../core/localisation.js';
import { useTheme } from '../screens/v2/themeContext.js';

export default function ActStateBar({ store = null, topInset = 0 }) {
  const theme = useTheme();
  const [current, setCurrent] = useState(() => store?.current ?? null);
  useEffect(() => {
    if (typeof store?.subscribe !== 'function') { setCurrent(null); return undefined; }
    setCurrent(store.current ?? null);
    return store.subscribe((c) => setCurrent(c));
  }, [store]);
  const line = actStateLine(current, { t });
  if (!line) return null;
  const styles = stylesFor(theme);
  return (
    <Pressable
      style={[styles.bar, { top: topInset + 6 }, line.state === 'failed' ? styles.failed : line.state === 'done' ? styles.done : styles.pending]}
      // Android knows no "status" role and throws when the view paints (test/accessibilityRolesAndroid.test.js): a
      // running or ended act is announced through the live region as text; a failed one as an alert
      accessibilityRole={line.state === 'failed' ? 'alert' : 'text'}
      accessibilityLiveRegion="polite"
      testID={`act-state-${line.state}`}
      onPress={() => store?.dismiss?.()}
    >
      <Text style={[styles.text, line.state === 'failed' ? styles.failedText : null]} numberOfLines={2}>{line.text}</Text>
    </Pressable>
  );
}

const cache = new WeakMap();
function stylesFor(theme) {
  let s = cache.get(theme);
  if (!s) {
    s = StyleSheet.create({
      bar:        { position: 'absolute', left: 12, right: 12, zIndex: 30, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
      pending:    { backgroundColor: theme.color.white, borderColor: theme.color.line },
      done:       { backgroundColor: theme.color.white, borderColor: theme.color.accent },
      failed:     { backgroundColor: theme.color.dangerBg, borderColor: theme.color.danger },
      text:       { fontSize: 13, color: theme.color.ink, textAlign: 'center' },
      failedText: { color: theme.color.danger },
    });
    cache.set(theme, s);
  }
  return s;
}
