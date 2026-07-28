/**
 * OfferingPicker — categorised chip multi-select for the user's offerings.
 *
 * Lifted from apps/stoop-mobile/src/components/OfferingPicker.js
 * 2026-05-09 (Phase 41.0.b B4).
 *
 * Pure-controlled. Tapping a chip calls the right callback:
 *   - chip not yet selected → `onAdd({categoryId})`
 *   - chip already selected → `onRemove(categoryId)`
 *
 * `categories` shape:
 *   `[{id: string, label: {nl, en} | string, hint?: {nl, en} | string}, ...]`
 *
 * Per-offering freeTags / availability / radius are out of scope.
 * Tokens via `useTheme()`.
 */

import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { localiseField } from '@onderling/identity-resolver/display';
import { useTheme } from '../theme/index.js';

/**
 * @param {object} props
 * @param {Array<{id: string, label: object|string, hint?: object|string}>} props.categories
 * @param {Array<{categoryId: string}>} props.selected
 * @param {string} [props.lang='nl']
 * @param {(entry: {categoryId: string}) => void} props.onAdd
 * @param {(categoryId: string) => void} props.onRemove
 */
export function OfferingPicker({
  categories = [], selected = [], lang = 'nl', onAdd, onRemove,
}) {
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();
  const selectedSet = new Set((selected ?? []).map((s) => s.categoryId));

  return (
    <ScrollView
      horizontal={false}
      contentContainerStyle={{
        flexDirection: 'row', flexWrap: 'wrap',
        paddingVertical: SPACING.sm,
      }}
    >
      {categories.map((cat) => {
        const id     = cat.id;
        const label  = localiseField(cat.label, lang);
        const hint   = localiseField(cat.hint,  lang);
        const active = selectedSet.has(id);
        return (
          <Pressable
            key={id}
            onPress={() => {
              if (active) onRemove?.(id);
              else        onAdd?.({ categoryId: id });
            }}
            style={[
              {
                width: '48%',
                margin: '1%',
                padding: SPACING.md,
                borderRadius: RADII.md,
                backgroundColor: COLORS.surface,
                borderWidth: 1,
                borderColor: COLORS.border,
              },
              active && { backgroundColor: COLORS.primaryLight, borderColor: COLORS.primary },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`skill-chip-${id}`}
          >
            <Text
              style={[
                { fontSize: FONT_SIZES.md, fontWeight: '600', color: COLORS.text },
                active && { color: COLORS.primaryDark },
              ]}
            >
              {label || id}
            </Text>
            {hint ? (
              <Text
                numberOfLines={2}
                style={[
                  { marginTop: 2, fontSize: FONT_SIZES.xs, color: COLORS.textMuted },
                  active && { color: COLORS.primaryDark },
                ]}
              >
                {hint}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
