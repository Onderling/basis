/**
 * PERSONAS ON THIS DEVICE — the restore picker (and any time): the person's personas this device does not run yet
 * (`listReceivablePersonas`), ticked, then handed over with the phrase typed here (`receivePersonas`, the one moment
 * the root is in hand). A restart runs them. Web parity: `showReceivePersonas` in circleApp.js — the same two ops,
 * the same words; this file only paints.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { useTheme } from './themeContext.js';
import { t } from '../../core/localisation.js';

export default function ReceivePersonasModal({ visible, callSkill, onClose }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [listed, setListed] = useState(null);   // null = loading
  const [picked, setPicked] = useState(() => new Set());
  const [phrase, setPhrase] = useState('');
  const [result, setResult] = useState(null);   // null | 'done' | 'wrong' | 'failed'
  useEffect(() => {
    if (!visible || typeof callSkill !== 'function') return;
    let alive = true;
    setListed(null); setPicked(new Set()); setPhrase(''); setResult(null);
    callSkill('household', 'listReceivablePersonas', {})
      .then((r) => { if (alive) setListed(r?.personas ?? []); })
      .catch(() => { if (alive) setListed([]); });
    return () => { alive = false; };
  }, [visible, callSkill]);
  if (!visible) return null;

  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const submit = async () => {
    if (picked.size === 0) return;
    const r = await callSkill('household', 'receivePersonas', { mnemonic: phrase, personas: [...picked] }).catch(() => null);
    setPhrase('');
    setResult(r?.ok ? 'done' : (r?.outcome === 'wrong-phrase' || r?.outcome === 'invalid-phrase') ? 'wrong' : 'failed');
  };

  const message = result === 'done' ? t('circle.receive_personas.done_reload')
    : result === 'wrong' ? t('circle.receive_personas.wrong_phrase')
      : result === 'failed' ? t('circle.receive_personas.failed')
        : (listed && listed.length === 0) ? t('circle.receive_personas.none') : null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{t('circle.receive_personas.title')}</Text>
          {message ? (
            <View>
              <Text style={styles.body}>{message}</Text>
              <Pressable style={styles.cancel} onPress={onClose} testID="receive-personas-close">
                <Text style={styles.cancelText}>{t('circle.receive_personas.close')}</Text>
              </Pressable>
            </View>
          ) : listed ? (
            <View>
              <Text style={styles.body}>{t('circle.receive_personas.body')}</Text>
              {listed.map((p) => (
                <Pressable key={p.id} onPress={() => toggle(p.id)} accessibilityRole="checkbox" accessibilityState={{ checked: picked.has(p.id) }} testID={`receive-persona-${p.id}`}>
                  <Text style={styles.body}>{picked.has(p.id) ? '☑' : '☐'} {p.name ?? p.id}</Text>
                </Pressable>
              ))}
              <TextInput
                style={[styles.input, styles.secret]}
                placeholder={t('circle.receive_personas.phrase_placeholder')}
                placeholderTextColor={theme.color.inkSoft}
                multiline autoCapitalize="none" autoCorrect={false} autoComplete="off"
                value={phrase} onChangeText={setPhrase}
                testID="receive-personas-phrase"
              />
              <View style={styles.row}>
                <Pressable style={styles.button} onPress={submit} testID="receive-personas-submit">
                  <Text style={styles.buttonText}>{t('circle.receive_personas.submit')}</Text>
                </Pressable>
                <Pressable style={styles.cancel} onPress={onClose}>
                  <Text style={styles.cancelText}>{t('circle.receive_personas.close')}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
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
  secret: { minHeight: 72, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  button: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.color.line },
  buttonText: { color: theme.color.ink, fontSize: 14 },
  cancel: { paddingVertical: 8, paddingHorizontal: 6 },
  cancelText: { color: theme.color.inkSoft, fontSize: 14 },
});
