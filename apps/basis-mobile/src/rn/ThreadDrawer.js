/**
 * ThreadDrawer — left-slide drawer that lists threads + lets the
 * user switch active OR create a new one (step 5).
 *
 * Pure RN component; business logic lives in
 * `src/core/threadState.js`.  Callers wire:
 *   - threads          listThreads(state)
 *   - activeThreadId   state.activeThreadId
 *   - visible          drawer open/closed
 *   - onClose          dismiss handler
 *   - onSwitchThread   (id: string) => void
 *   - onCreateThread   (name: string) => void
 *
 * No hardcoded strings ([[no-hardcoded-strings]]) — every label
 * via `t()`.
 */
import React, { useState, useCallback } from 'react';
import { Modal, Pressable, View, Text, FlatList, TouchableOpacity, StyleSheet, Platform } from 'react-native';

import { t } from '../core/localisation.js';
import { theme } from '../screens/v2/theme.js';
import ThemedTextInput from '../screens/v2/ThemedTextInput.js';   // every text input's colours come from the theme (lint-themed-inputs)

export default function ThreadDrawer({
  threads,
  activeThreadId,
  visible,
  onClose,
  onSwitchThread,
  onCreateThread,
}) {
  const [newName, setNewName] = useState('');

  const onCreate = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    onCreateThread?.(name);
    setNewName('');
  }, [newName, onCreateThread]);

  const renderRow = useCallback(({ item }) => {
    const isActive = item.id === activeThreadId;
    return (
      <TouchableOpacity
        onPress={() => onSwitchThread?.(item.id)}
        style={[styles.row, isActive && styles.rowActive]}
        accessibilityRole="button"
        accessibilityLabel={`thread-row-${item.id}`}
        testID={`thread-row-${item.id}`}
      >
        <Text style={[styles.rowName, isActive && styles.rowNameActive]}>
          {item.name}
        </Text>
        <Text style={styles.rowMeta}>
          {t('threads.message_count', { count: item.messages?.length ?? 0 })}
        </Text>
      </TouchableOpacity>
    );
  }, [activeThreadId, onSwitchThread]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={styles.drawer}
          onPress={(e) => e.stopPropagation()}
          testID="thread-drawer"
        >
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{t('threads.drawer_title')}</Text>
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="thread-drawer-close"
              testID="thread-drawer-close"
              style={styles.closeBtn}
            >
              <Text style={styles.closeBtnText}>×</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={threads}
            keyExtractor={(item) => item.id}
            renderItem={renderRow}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
          />

          <View style={styles.createRow}>
            <ThemedTextInput
              style={styles.createInput}
              value={newName}
              onChangeText={setNewName}
              placeholder={t('threads.new_placeholder')}
              autoCapitalize="sentences"
              autoCorrect
              onSubmitEditing={onCreate}
              returnKeyType="done"
              testID="thread-drawer-new-input"
            />
            <TouchableOpacity
              onPress={onCreate}
              disabled={!newName.trim()}
              style={[
                styles.createBtn,
                !newName.trim() && styles.createBtnDisabled,
              ]}
              accessibilityRole="button"
              testID="thread-drawer-new-submit"
            >
              <Text style={styles.createBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    flexDirection: 'row',
  },
  drawer: {
    width: '78%',
    maxWidth: 360,
    backgroundColor: theme.color.card,
    paddingTop: Platform.OS === 'ios' ? 56 : 28,
    paddingBottom: 16,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8,
    shadowOffset: { width: 2, height: 0 },
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.line,
  },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  closeBtn: { padding: 4, minWidth: 32, alignItems: 'center' },
  closeBtnText: { fontSize: 24, color: theme.color.inkSoft, lineHeight: 24 },

  list: { flex: 1 },
  row: {
    paddingVertical: 12, paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.line,
  },
  rowActive: { backgroundColor: theme.color.blueBg },
  rowName: { fontSize: 15, color: theme.color.ink, fontWeight: '500' },
  rowNameActive: { color: theme.color.blue, fontWeight: '700' },
  rowMeta: { fontSize: 12, color: theme.color.inkSoft, marginTop: 2 },

  createRow: {
    flexDirection: 'row',
    paddingHorizontal: 12, paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.line,
    gap: 8,
  },
  createInput: { color: theme.color.ink,
    flex: 1, borderWidth: 1, borderColor: theme.color.line,
    borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8,
    fontSize: 14,
  },
  createBtn: {
    backgroundColor: theme.color.accent,
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  createBtnDisabled: { backgroundColor: theme.color.trackOff },
  createBtnText: { color: theme.color.accentContrast, fontSize: 22, lineHeight: 24 },
});
