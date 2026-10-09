/**
 * The relay question (mobile presenter + the hook a screen composes) — web parity: relayQuestionDialog.js.
 *
 * There is no default relay. When this device knows none, the first action that needs one (an invite, an
 * add-device offer) asks. The shared `createRelayQuestion` decides WHEN; this asks, checks the value with the
 * shared `normalizeRelayUrl`, and hands it to the screen's own relay-setting path (`apply`), so nothing here stores
 * it. One question per app session: "Later" on any screen holds for all of them.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createRelayQuestion, knownRelayUrl, createConnectionPoints, asyncStorageConnectionPointsIo } from '../../../../basis/src/v2/connectionPoints.js';
import { asyncStorageRelayIo, normalizeRelayUrl } from '../../../../basis/src/v2/relayPref.js';
import { useTheme } from './themeContext.js';
import { t } from '../../core/localisation.js';

// What this device knows about relays right now: the saved setting, the build argument, the circles' points.
const readKnown = async () => ({
  saved: await asyncStorageRelayIo(AsyncStorage).load(),
  arg: process.env.EXPO_PUBLIC_CIRCLE_RELAY_URL ?? null,
  list: createConnectionPoints({ initial: await asyncStorageConnectionPointsIo(AsyncStorage).load(), save: () => {} }).list(),
});

// One per app session, shared by every screen that asks.
const relayQuestion = createRelayQuestion({ read: readKnown });

/** The relay this device knows (an add-device offer names it), or null. */
export async function currentRelayUrl() {
  try { return knownRelayUrl(await readKnown()); } catch { return null; }
}

/**
 * @param {(url: string) => Promise<any>} apply  the screen's relay-setting path (saves + reconnects)
 * @returns {{ askRelayIfNone: () => Promise<void>, relayQuestionModal: React.ReactNode }}
 */
export function useRelayQuestion(apply) {
  const [open, setOpen] = useState(false);
  const resolveRef = useRef(null);
  const askRelayIfNone = useCallback(async () => {
    if (!(await relayQuestion.check()).ask) return;
    const url = await new Promise((resolve) => { resolveRef.current = resolve; setOpen(true); });
    setOpen(false);
    if (!url) { relayQuestion.later(); return; }
    try { await apply?.(url); } catch { /* the setting path reports its own failure */ }
  }, [apply]);
  const onResolve = useCallback((url) => { const r = resolveRef.current; resolveRef.current = null; r?.(url); }, []);
  const relayQuestionModal = open ? <RelayQuestionModal onResolve={onResolve} /> : null;
  return { askRelayIfNone, relayQuestionModal };
}

export default function RelayQuestionModal({ onResolve }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);
  const save = () => {
    const url = normalizeRelayUrl(value);
    if (!url) { setInvalid(true); return; }
    onResolve?.(url);
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => onResolve?.(null)}>
      <View style={styles.backdrop}>
        <View style={styles.card} testID="relay-question">
          <Text style={styles.title}>{t('circle.settings.relayAsk_title')}</Text>
          <Text style={styles.body}>{t('circle.settings.relayAsk_body')}</Text>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={(v) => { setValue(v); setInvalid(false); }}
            placeholder={t('circle.settings.relayEndpoint_placeholder')}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onSubmitEditing={save}
            testID="relay-question-input"
          />
          {invalid ? <Text style={styles.error}>{t('circle.settings.relayAsk_invalid')}</Text> : null}
          <View style={styles.row}>
            <Pressable style={styles.cancel} onPress={() => onResolve?.(null)} testID="relay-question-later">
              <Text style={styles.cancelText}>{t('circle.settings.relayAsk_later')}</Text>
            </Pressable>
            <Pressable style={styles.button} onPress={save} testID="relay-question-save">
              <Text style={styles.buttonText}>{t('circle.settings.relayAsk_save')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: theme.color.card, borderRadius: 10, padding: 18 },
  title: { fontSize: 17, fontWeight: '700', color: theme.color.ink, marginBottom: 6 },
  body: { fontSize: 14, color: theme.color.ink, marginBottom: 10 },
  input: { borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, padding: 8, color: theme.color.ink, marginBottom: 8 },
  error: { fontSize: 13, color: theme.color.danger ?? theme.color.ink, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginTop: 8 },
  button: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.color.line },
  buttonText: { color: theme.color.ink, fontSize: 14 },
  cancel: { paddingVertical: 8, paddingHorizontal: 6 },
  cancelText: { color: theme.color.inkSoft, fontSize: 14 },
});
