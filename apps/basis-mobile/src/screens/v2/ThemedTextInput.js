/**
 * ThemedTextInput — the ONE text input of the phone app: a React Native TextInput whose text, placeholder and cursor
 * colours come from the app's theme (light or dark, the person's choice or the system's), never from Android.
 *
 * Why: the Android app theme (android/app/src/main/res/values/styles.xml) sets every EditText's text to black and its
 * hint to light grey. An input that set no colour of its own therefore showed black text and grey hints on the app's
 * dark screens: "virtually every text input box" under the system dark theme (Frits, 2026-11-16). The native default
 * is NOT switched to follow the system, because the app has its own light/dark setting: a native colour following the
 * system would invert the fault when the two differ. Every input takes its colours here instead, and
 * `scripts/lint-themed-inputs.mjs` fails a raw TextInput anywhere else.
 *
 * A screen may still pass its own `style` (size, border, its own themed colour), `placeholderTextColor` or
 * `selectionColor`: those win. What it may not do is leave them to Android.
 */
import React, { forwardRef } from 'react';
import { TextInput } from 'react-native';
import { useTheme } from './themeContext.js';

const ThemedTextInput = forwardRef(function ThemedTextInput(props, ref) {
  const theme = useTheme();
  const { style, placeholderTextColor, selectionColor, ...rest } = props;
  return (
    <TextInput
      ref={ref}
      {...rest}
      placeholderTextColor={placeholderTextColor ?? theme.color.inkSoft}
      selectionColor={selectionColor ?? theme.color.accent}
      style={[{ color: theme.color.ink }, style]}
    />
  );
});

export default ThemedTextInput;
