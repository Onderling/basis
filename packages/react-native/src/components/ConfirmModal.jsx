/**
 * ConfirmModal — yes/no overlay used for destructive confirmations.
 *
 * Lifted from apps/pinboard-mobile/src/components/ConfirmModal.js
 * 2026-05-09 (Phase 41.0.b B3). Pure controlled — caller manages
 * `visible` + provides `onConfirm` / `onCancel`. Tokens via
 * `useTheme()`. The default labels are English; apps with localised
 * UIs should pass `confirmLabel` / `cancelLabel` (translated).
 */

import React from 'react';
import { Modal, View, Text, Pressable } from 'react-native';
import { useTheme } from '../theme/index.js';

/**
 * @param {object} props
 * @param {boolean} props.visible
 * @param {string}  props.title
 * @param {string}  [props.body]
 * @param {string}  [props.confirmLabel='Confirm']
 * @param {string}  [props.cancelLabel='Cancel']
 * @param {boolean} [props.destructive=false]
 * @param {() => void} props.onConfirm
 * @param {() => void} props.onCancel
 */
export function ConfirmModal({
  visible,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel  = 'Cancel',
  destructive  = false,
  onConfirm,
  onCancel,
}) {
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();
  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onCancel}>
      <View
        style={{
          flex: 1, alignItems: 'center', justifyContent: 'center',
          backgroundColor: COLORS.overlay, padding: SPACING.lg,
        }}
      >
        <View
          style={{
            width: '100%', maxWidth: 400,
            backgroundColor: COLORS.surface,
            borderRadius: RADII.md, padding: SPACING.xl,
          }}
        >
          <Text
            style={{
              fontSize: FONT_SIZES.lg, color: COLORS.text, fontWeight: '600',
            }}
          >
            {title}
          </Text>
          {body ? (
            <Text
              style={{
                marginTop: SPACING.md, fontSize: FONT_SIZES.md,
                color: COLORS.textMuted, lineHeight: 22,
              }}
            >
              {body}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: SPACING.lg }}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [
                {
                  paddingVertical:   SPACING.sm,
                  paddingHorizontal: SPACING.lg,
                  borderRadius:      RADII.sm,
                  marginLeft:        SPACING.sm,
                  backgroundColor:   COLORS.surfaceMuted,
                },
                pressed && { opacity: 0.8 },
              ]}
              accessibilityRole="button"
            >
              <Text style={{ fontSize: FONT_SIZES.md, color: COLORS.text, fontWeight: '500' }}>
                {cancelLabel}
              </Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              style={({ pressed }) => [
                {
                  paddingVertical:   SPACING.sm,
                  paddingHorizontal: SPACING.lg,
                  borderRadius:      RADII.sm,
                  marginLeft:        SPACING.sm,
                  backgroundColor:   destructive ? COLORS.danger : COLORS.primary,
                },
                pressed && { opacity: 0.8 },
              ]}
              accessibilityRole="button"
            >
              <Text style={{ fontSize: FONT_SIZES.md, color: COLORS.textInverse, fontWeight: '500' }}>
                {confirmLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
