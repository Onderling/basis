/**
 * AvatarCircle — round avatar for users.
 *
 * Lifted from apps/stoop-mobile/src/components/AvatarCircle.js
 * 2026-05-09 (Phase 41.0.b B1; Tasks-mobile is the second consumer).
 *
 * Renders the photo when `uri` is provided, otherwise a circle with
 * the user's initials over a deterministic background colour
 * (avatar palette from `@onderling/identity-resolver/display`).
 *
 * Tokens come from `useTheme()` so each app supplies its own palette
 * via `<ThemeProvider value={tokens}>`.
 */

import React from 'react';
import { View, Text, Image } from 'react-native';
import { initials as _initialsFn, paletteFor } from '@onderling/identity-resolver/display';
import { useTheme } from '../theme/index.js';

export function AvatarCircle({ uri, name = '', size = 48, style }) {
  const { COLORS, FONT_SIZES } = useTheme();
  const initials = _initialsFn(name);
  const bg       = paletteFor(name);
  const dim      = { width: size, height: size, borderRadius: size / 2 };

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[{ backgroundColor: COLORS.surfaceMuted }, dim, style]}
        accessibilityLabel={name || undefined}
      />
    );
  }

  return (
    <View
      style={[
        { alignItems: 'center', justifyContent: 'center' },
        dim,
        { backgroundColor: bg },
        style,
      ]}
      accessibilityLabel={name || undefined}
    >
      <Text
        style={{
          color:      COLORS.textInverse,
          fontWeight: '600',
          fontSize:   Math.round(size * 0.42) || FONT_SIZES.md,
        }}
      >
        {initials}
      </Text>
    </View>
  );
}
