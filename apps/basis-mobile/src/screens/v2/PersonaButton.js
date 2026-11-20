/**
 * basis-mobile v2 — the persona button (web twin: personaButton.js): top right on every tab, the persona's picture or
 * initials; a tap opens the persona panel over the tab. It is ringed in the colour of the person's availability (the
 * shared `availabilityRing`: the state to an existing theme token), and its label names that state
 * (`personaButtonLabel`), so the colour is never the only signal.
 */
import React from 'react';
import { View, Text, Pressable, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../../core/localisation.js';
import { useTheme } from './themeContext.js';
import { PERSONA_BUTTON } from './fab.js';
import { availabilityRing, personaButtonLabel } from '../../../../basis/src/v2/mijWords.js';

const RING = 2;

export default function PersonaButton({ avatar, availability = null, onPress }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const ring = availabilityRing(availability);
  const size = PERSONA_BUTTON.size;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={personaButtonLabel(availability, { t })} testID="persona-button"
      style={{ position: 'absolute', top: (insets?.top ?? 0) + PERSONA_BUTTON.top - RING, right: PERSONA_BUTTON.right - RING, width: size + 2 * RING, height: size + 2 * RING,
        borderRadius: size / 2 + RING, borderWidth: RING, borderColor: theme.color[ring.token], alignItems: 'center', justifyContent: 'center' }}>
      <View testID={`persona-button-ring-${ring.state}`} style={{ width: size - 2, height: size - 2, borderRadius: (size - 2) / 2, overflow: 'hidden', backgroundColor: theme.color.accent, alignItems: 'center', justifyContent: 'center' }}>
        {avatar.uri
          ? <Image source={{ uri: avatar.uri }} style={{ width: size - 2, height: size - 2 }} accessibilityLabel={avatar.name ?? ''} />
          : <Text style={{ color: theme.color.white, fontWeight: '700', fontSize: 13 }}>{avatar.initials ?? '?'}</Text>}
      </View>
    </Pressable>
  );
}
