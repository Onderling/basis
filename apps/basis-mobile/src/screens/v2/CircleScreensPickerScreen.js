/**
 * basis-mobile v2 — Screens picker (α.3.3a).
 *
 * RN counterpart of web's circleScreensPicker.  The Schermen tab's
 * list view: the user's screens (with active badge), plus add /
 * rename / delete / setActive / open affordances.
 *
 * Controlled-render: host owns the ScreenBook and persists via the
 * user-screens store.  Each handler just emits — host applies.
 *
 * Mirrors the BOOK mode of CircleRecipeEditorScreen in shape + styles
 * (recipeRow / recipeName / actionLink), but with screen-specific
 * additions:
 *   - circle-filter summary text next to the name
 *     ("all circles" / "1 circle" / "N circles")
 *   - no `onBack`: the picker IS the primary tab; back means switching
 *     to another tab via CircleTabBar.
 *
 * Rename / delete use the same Alert.prompt-with-Android-fallback
 * pattern as the recipe editor (promptForName helper copied verbatim).
 */
import React, { useMemo, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, TextInput, StyleSheet, Alert, Platform,
} from 'react-native';
import { useTheme } from './themeContext.js';
import { t } from '../../core/localisation.js';
import { isAllCircles } from '@onderling-app/basis';

export default function CircleScreensPickerScreen({
  book = { screens: [], activeId: null },
  onOpenScreen,
  onAddScreen,
  onRenameScreen,
  onRemoveScreen,
  onSetActive,
}) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [newName, setNewName] = useState('');
  const handleAdd = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    onAddScreen?.(trimmed);
    setNewName('');
  };

  return (
    <View style={styles.page} testID="screens-picker">
      <Text style={styles.title}>{t('circle.screens.picker_title')}</Text>

      <ScrollView contentContainerStyle={styles.body}>
        {book.screens.length === 0 ? (
          <Text style={styles.muted}>{t('circle.screens.no_screens')}</Text>
        ) : (
          book.screens.map((screen) => (
            <ScreenRow
              key={screen.id}
              screen={screen}
              isActive={screen.id === book.activeId}
              onOpenScreen={onOpenScreen}
              onRenameScreen={onRenameScreen}
              onRemoveScreen={onRemoveScreen}
              onSetActive={onSetActive}
            />
          ))
        )}
      </ScrollView>

      <View style={styles.addRow}>
        <TextInput
          style={styles.addInput}
          value={newName}
          onChangeText={setNewName}
          placeholder={t('circle.screens.add_placeholder')}
          returnKeyType="done"
          onSubmitEditing={handleAdd}
          testID="screens-picker-add-input"
        />
        <Pressable
          style={styles.addBtn}
          accessibilityRole="button"
          onPress={handleAdd}
          testID="screens-picker-add-btn"
        >
          <Text style={styles.addBtnText}>{t('circle.screens.add')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */

function ScreenRow({ screen, isActive, onOpenScreen, onRenameScreen, onRemoveScreen, onSetActive }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const handleRename = () => {
    promptForName(
      t('circle.screens.rename_prompt'), screen.name,
      (value) => {
        const trimmed = value?.trim?.() ?? '';
        if (trimmed && trimmed !== screen.name) onRenameScreen?.(screen.id, trimmed);
      },
    );
  };
  const handleDelete = () => {
    Alert.alert(
      t('circle.screens.delete'),
      t('circle.screens.delete_confirm', { name: screen.name || '' }),
      [
        { text: 'Cancel', style: 'cancel' },
        { text: t('circle.screens.delete'), style: 'destructive', onPress: () => onRemoveScreen?.(screen.id) },
      ],
    );
  };
  return (
    <View
      style={[styles.screenRow, isActive && styles.screenRowActive]}
      testID={`screen-row-${screen.id}`}
    >
      <Pressable
        style={styles.screenName}
        accessibilityRole="button"
        onPress={() => onOpenScreen?.(screen.id)}
        testID={`screen-name-${screen.id}`}
      >
        <Text style={styles.screenNameText}>{screen.name || t('circle.screens.untitled')}</Text>
        <Text style={styles.summary}>{circleFilterSummary(screen)}</Text>
        {isActive ? <Text style={styles.activeBadge}>{t('circle.screens.active')}</Text> : null}
      </Pressable>
      <View style={styles.screenActions}>
        <Pressable onPress={handleRename} testID={`screen-rename-${screen.id}`}>
          <Text style={styles.actionLink}>{t('circle.screens.rename')}</Text>
        </Pressable>
        {!isActive ? (
          <Pressable onPress={() => onSetActive?.(screen.id)} testID={`screen-activate-${screen.id}`}>
            <Text style={styles.actionLink}>{t('circle.screens.set_active')}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={handleDelete} testID={`screen-remove-${screen.id}`}>
          <Text style={[styles.actionLink, styles.actionDestructive]}>{t('circle.screens.delete')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function circleFilterSummary(screen) {
  if (isAllCircles(screen)) return t('circle.screens.filter_all');
  const f = screen?.circleFilter;
  if (Array.isArray(f) && f.length === 1) return t('circle.screens.filter_one');
  return t('circle.screens.filter_n', { count: Array.isArray(f) ? f.length : 0 });
}

/* ─────────────────────────────────────────────────────────────────────── */

function promptForName(title, defaultValue, onValue) {
  if (Platform.OS === 'ios' && typeof Alert.prompt === 'function') {
    Alert.prompt(title, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'OK', onPress: (value) => onValue?.(value ?? '') },
    ], 'plain-text', defaultValue ?? '');
    return;
  }
  // Android (or test env): submit the existing value as a placeholder for now.
  // A proper inline input row would be a follow-up.  For V0, just preserve
  // the original name — better than blocking the action entirely.
  Alert.alert(title, '', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'OK', onPress: () => onValue?.(defaultValue ?? '') },
  ]);
}

const makeStyles = (theme) => StyleSheet.create({
  page:         { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: theme.color.paper },
  title:        { fontSize: 24, fontWeight: '600', fontFamily: theme.font.serif, color: theme.color.ink, marginVertical: 10 },
  body:         { paddingBottom: 24, gap: 6 },
  muted:        { color: theme.color.inkSoft, fontStyle: 'italic', paddingVertical: 10 },

  screenRow:        { padding: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: 10, backgroundColor: theme.color.card, marginBottom: 6 },
  screenRowActive:  { borderColor: theme.color.accent },
  screenName:       { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 6, flexWrap: 'wrap' },
  screenNameText:   { fontSize: 16, fontWeight: '600', color: theme.color.ink, fontFamily: theme.font.serif },
  summary:          { fontSize: 12, color: theme.color.inkSoft, fontStyle: 'italic' },
  activeBadge:      { fontSize: 10, fontWeight: '700', color: theme.color.accentInk, textTransform: 'uppercase', letterSpacing: 0.8 },
  screenActions:    { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
  actionLink:       { fontSize: 13, color: theme.color.accentInk },
  actionDestructive:{ color: theme.color.accent },

  addRow:           { flexDirection: 'row', gap: 8, paddingVertical: 10 },
  addInput:         { flex: 1, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, backgroundColor: theme.color.white, fontSize: 14, color: theme.color.ink },
  addBtn:           { paddingHorizontal: 14, justifyContent: 'center', backgroundColor: theme.color.accent, borderRadius: 8 },
  addBtnText:       { color: theme.color.white, fontWeight: '600' },
});
