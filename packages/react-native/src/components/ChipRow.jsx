/**
 * ChipRow — horizontal scrollable row of selectable chips.
 *
 * Lifted from apps/pinboard-mobile/src/components/ChipRow.js 2026-05-09
 * (Phase 41.0.b B2). Pure-controlled: pass `items`, `selected`,
 * and `onToggle`. Tokens come from `useTheme()`.
 */

import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useTheme } from '../theme/index.js';

/**
 * @param {object} props
 * @param {Array<{id: string, label: string}>} props.items
 * @param {Set<string>|string[]} [props.selected]
 * @param {(id: string, opts?: {singleSelect: boolean}) => void} props.onToggle
 * @param {boolean} [props.singleSelect=false]
 */
export function ChipRow({ items = [], selected, onToggle, singleSelect = false }) {
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();
  const sel = _toSet(selected);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        flexDirection: 'row',
        paddingHorizontal: SPACING.md,
        paddingVertical:   SPACING.sm,
      }}
    >
      {items.map((it) => {
        const active = sel.has(it.id);
        return (
          <Pressable
            key={it.id}
            onPress={() => {
              if (typeof onToggle === 'function') onToggle(it.id, { singleSelect });
            }}
            style={[
              {
                paddingVertical:   Math.max(0, SPACING.sm - 2),
                paddingHorizontal: SPACING.md,
                borderRadius:      RADII.pill,
                borderWidth:       1,
                borderColor:       COLORS.border,
                backgroundColor:   COLORS.surface,
                marginRight:       SPACING.sm,
              },
              active && { backgroundColor: COLORS.primary, borderColor: COLORS.primaryDark },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text
              style={[
                { color: COLORS.text, fontSize: FONT_SIZES.sm },
                active && { color: COLORS.textInverse, fontWeight: '600' },
              ]}
            >
              {it.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function _toSet(v) {
  if (v instanceof Set) return v;
  if (Array.isArray(v)) return new Set(v);
  return new Set();
}
