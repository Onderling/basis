/**
 * NoteEditScreen — plain multiline TextInput editor.
 *
 * v0 explicitly: no markdown preview, no syntax highlighting (per the
 * C2 brief lock).  Save on blur or via the "Save" header button.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { useService } from '../ServiceContext.js';

export function NoteEditScreen() {
  const navigation = useNavigation();
  const route      = useRoute();
  const { engine } = useService();

  const relPath = route?.params?.relPath ?? null;
  const absPath = route?.params?.absPath ?? null;

  const [content, setContent] = useState('');
  const [orig, setOrig]       = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);

  // Load on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!engine || !absPath) {
        setLoading(false);
        return;
      }
      try {
        const text = await engine.fs.readFileText(absPath, 'utf8');
        if (cancelled) return;
        setContent(text);
        setOrig(text);
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [engine, absPath]);

  const isDirty = content !== orig;

  const save = useCallback(async () => {
    if (!engine || !absPath || saving) return;
    if (!isDirty) return;
    setSaving(true);
    setError(null);
    try {
      await engine.fs.writeFile(absPath, content, { encoding: 'utf8' });
      setOrig(content);
      // Schedule a sync.  We don't await so the UI stays responsive,
      // but errors are surfaced via console (logcat) and the screen's
      // error state — silently swallowing has been costly during the
      // RN bring-up.
      engine.runOnce?.().catch((err) => {
        console.error('[NoteEdit save → runOnce]', err?.message ?? err);
        if (err?.stack) console.error('[NoteEdit save → runOnce stack]', err.stack);
        setError(err);
      });
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }, [engine, absPath, saving, content, isDirty]);

  // Header right — Save button.
  useEffect(() => {
    if (!navigation?.setOptions) return;
    navigation.setOptions({
      title: relPath ?? 'Edit note',
      headerRight: () => (
        <Pressable
          onPress={save}
          disabled={!isDirty || saving}
          style={({ pressed }) => [
            s.saveBtn,
            (!isDirty || saving) && { opacity: 0.4 },
            pressed && { opacity: 0.7 },
          ]}
        >
          {saving
            ? <ActivityIndicator color="#9bcfff" size="small" />
            : <Text style={s.saveLabel}>Save</Text>}
        </Pressable>
      ),
    });
  }, [navigation, save, isDirty, saving, relPath]);

  if (loading) {
    return (
      <View style={s.center}><ActivityIndicator color="#9bcfff" /></View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={s.root}
      behaviour={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <TextInput
        value={content}
        onChangeText={setContent}
        onBlur={save}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        style={s.editor}
        placeholder="Write something…"
        placeholderTextColor="#5c6377"
        textAlignVertical="top"
      />
      {relPath && (
        <Pressable
          onPress={() => navigation.navigate('Versions', { relPath })}
          style={{ paddingVertical: 10, alignItems: 'center', borderTopWidth: 1, borderTopColor: '#1c2030' }}
          accessibilityRole="button"
          accessibilityLabel="open-version-history"
        >
          <Text style={{ color: '#9bcfff', fontSize: 13, fontWeight: '600' }}>Version history</Text>
        </Pressable>
      )}
      {error && (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error?.message ?? String(error)}</Text>
        </View>
      )}
      {isDirty && !saving && (
        <View style={s.dirtyBar}>
          <Text style={s.dirtyText}>Unsaved changes</Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#0f1117' },
  center:  { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f1117' },
  editor:  {
    flex:           1,
    color:          '#d4d8f0',
    backgroundColor: '#0f1117',
    fontFamily:     Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize:       14,
    lineHeight:     20,
    padding:        16,
  },
  saveBtn:    { paddingHorizontal: 12, paddingVertical: 6 },
  saveLabel:  { color: '#9bcfff', fontSize: 14, fontWeight: '600' },
  errorBox:   { backgroundColor: '#3a1f23', padding: 10 },
  errorText:  { color: '#f0a8a8', fontSize: 12, fontFamily: 'monospace' },
  dirtyBar:   { backgroundColor: '#1a2538', padding: 8, alignItems: 'center' },
  dirtyText:  { color: '#9bcfff', fontSize: 12 },
});
