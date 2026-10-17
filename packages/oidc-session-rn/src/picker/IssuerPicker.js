/**
 * `<IssuerPicker>` — React Native component for picking a Solid OIDC
 * issuer. Phase 52.15.5 (2026-05-14).
 *
 * Renders the curated `KNOWN_ISSUERS` list as selectable tiles + an
 * optional "Custom URL" tile that expands a text input. The selected
 * issuer URL is emitted via `onChange`.
 *
 * Adopted by `apps/{folio,pinboard,tasks}-mobile/src/screens/SignInScreen.js`.
 *
 * Lives at the `/picker` subpath because it pulls `react-native`
 * components — same bundler-hygiene pattern as `/hook`. Pure-JS
 * substrate consumers (tests, server code) don't need to satisfy the
 * RN dep at module-load time.
 *
 * Props:
 *   - `value` (string) — currently-selected issuer URL.
 *   - `onChange(url)`  — invoked with the new issuer URL (string).
 *   - `customAllowed`  — render the "Custom URL" tile (default: true).
 *   - `style`          — outer container style override.
 *   - `legendText`     — section heading text (default: 'Pod provider').
 *   - `customLabel`    — label for the custom tile (default: 'Custom URL').
 *   - `customPlaceholder` — placeholder for the custom URL input.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';

import { KNOWN_ISSUERS, resolveIssuer } from '../issuers.js';

const DEFAULT_PLACEHOLDER = 'https://my-pod.example/';

export function IssuerPicker({
  value,
  onChange,
  customAllowed = true,
  style,
  legendText = 'Pod provider',
  customLabel = 'Custom URL',
  customPlaceholder = DEFAULT_PLACEHOLDER,
}) {
  // The picker's mental model: select among `KNOWN_ISSUERS[id]` or
  // `'custom'`. The custom URL flows through to `onChange` only when
  // it's a valid-looking http(s) URL.
  const resolved = useMemo(() => resolveIssuer(value), [value]);
  const isCustom = resolved?.id === 'custom';
  const selectedId = resolved?.id ?? null;

  // Local state for the in-row custom-URL input. When the user picks
  // "Custom", we don't emit `onChange` until they type a valid URL.
  const [customDraft, setCustomDraft] = useState(isCustom ? value : '');

  // Keep the local draft in sync when `value` switches from outside.
  useEffect(() => {
    if (isCustom) setCustomDraft(value);
  }, [value, isCustom]);

  const pickKnown = (issuer) => {
    onChange?.(issuer.url);
  };
  const pickCustom = () => {
    // Switch to the custom row even if the draft is empty; the user
    // can then type. We only emit a valid URL.
    if (!isCustom) {
      // Initialise with whatever we had selected (informative) so the
      // text input isn't empty by surprise.
      const seed = resolved && resolved.id !== 'custom' ? resolved.url : '';
      setCustomDraft(seed);
      if (seed) onChange?.(seed);
    }
  };
  const onCustomChange = (text) => {
    setCustomDraft(text);
    const trimmed = text.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      onChange?.(trimmed);
    }
  };

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.legend}>{legendText}</Text>
      {KNOWN_ISSUERS.map((issuer) => {
        const checked = selectedId === issuer.id;
        return (
          <Pressable
            key={issuer.id}
            onPress={() => pickKnown(issuer)}
            accessibilityRole="radio"
            accessibilityState={{ selected: checked }}
            style={[styles.option, checked && styles.optionChecked]}
          >
            <View style={styles.radio}>
              <View style={[styles.radioOuter, checked && styles.radioOuterChecked]}>
                {checked ? <View style={styles.radioDot} /> : null}
              </View>
            </View>
            <View style={styles.optionTextWrap}>
              <Text style={styles.optionLabel}>{issuer.label}</Text>
              <Text style={styles.optionHint}>{stripScheme(issuer.url)}</Text>
            </View>
          </Pressable>
        );
      })}
      {customAllowed ? (
        <Pressable
          onPress={pickCustom}
          accessibilityRole="radio"
          accessibilityState={{ selected: isCustom }}
          style={[styles.option, isCustom && styles.optionChecked]}
        >
          <View style={styles.radio}>
            <View style={[styles.radioOuter, isCustom && styles.radioOuterChecked]}>
              {isCustom ? <View style={styles.radioDot} /> : null}
            </View>
          </View>
          <View style={styles.optionTextWrap}>
            <Text style={styles.optionLabel}>{customLabel}</Text>
            {isCustom ? (
              <TextInput
                value={customDraft}
                onChangeText={onCustomChange}
                placeholder={customPlaceholder}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                style={styles.customInput}
              />
            ) : null}
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

function stripScheme(url) {
  return url.replace(/^https?:\/\//, '');
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  legend: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
    gap: 12,
  },
  optionChecked: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  radio: {
    paddingTop: 2,
  },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#9ca3af',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterChecked: {
    borderColor: '#2563eb',
  },
  radioDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#2563eb',
  },
  optionTextWrap: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  optionHint: {
    fontSize: 12,
    color: '#6b7280',
  },
  customInput: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: '#fff',
  },
});
