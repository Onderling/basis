/**
 * PodProviderPicker — which pod provider to sign in to: the providers the sign-in package knows (the one list,
 * `KNOWN_ISSUERS`; the settings wizard offers the same) as a row to tap, and the address, free for a provider of your
 * own. Used by My data and by "Finishing your restore" (after a wipe the phone knows no provider, so the restore screen
 * starts empty: nothing is guessed). Paint only: the value is the host's.
 */
import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { KNOWN_ISSUERS } from '@onderling/oidc-session-rn';
import { useTheme } from './themeContext.js';
import ThemedTextInput from './ThemedTextInput.js';   // every text input's colours come from the theme (lint-themed-inputs)
import { t } from '../../core/localisation.js';

export default function PodProviderPicker({ value = '', onChange, testIDPrefix = 'pod' }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const issuer = String(value ?? '');
  return (
    <View>
      <View style={styles.providers} accessibilityRole="radiogroup">
        {KNOWN_ISSUERS.map((p) => (
          <Pressable key={p.id} onPress={() => onChange?.(p.url)} accessibilityRole="radio"
            accessibilityState={{ selected: issuer.trim() === p.url }}
            style={[styles.provider, issuer.trim() === p.url && styles.providerOn]} testID={`${testIDPrefix}-provider-${p.id}`}>
            <Text style={styles.providerText}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
      <ThemedTextInput
        style={styles.input}
        value={issuer}
        onChangeText={(v) => onChange?.(v)}
        placeholder={t('circle.mydata.pod_issuer')}
        placeholderTextColor={theme.color.inkSoft}
        autoCapitalize="none"
        autoCorrect={false}
        testID={`${testIDPrefix}-issuer`}
      />
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  providers: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  provider: { paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md },
  providerOn: { borderColor: theme.color.ink },
  providerText: { fontSize: 13, color: theme.color.ink },
  input: { fontSize: 14, paddingVertical: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, color: theme.color.ink, backgroundColor: theme.color.white, marginTop: 6 },
});
