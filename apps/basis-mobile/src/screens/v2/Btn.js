/**
 * Btn — the button family on the phone, the twin of web's `.cc-btn` (web/v2/circle.css): one look per variant from
 * the shared list (`BUTTON_VARIANTS`), instead of a Pressable styled anew on every screen. Adopted as screens are
 * touched.
 */
import React from 'react';
import { Pressable, Text } from 'react-native';
import { BUTTON_VARIANTS } from '../../../../basis/src/v2/buttonVariants.js';
import { useTheme } from './themeContext.js';
import { btnStyles } from './btnStyles.js';

export default function Btn({ variant = 'quiet', label, onPress, disabled = false, testID, accessibilityLabel, style = null }) {
  const theme = useTheme();
  const v = BUTTON_VARIANTS.includes(variant) ? variant : 'quiet';
  const s = btnStyles(theme)[v];
  return (
    <Pressable style={[s.box, disabled && { opacity: 0.5 }, style]} disabled={disabled} onPress={onPress} accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label} testID={testID}>
      <Text style={s.text}>{label}</Text>
    </Pressable>
  );
}
