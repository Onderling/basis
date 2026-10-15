/**
 * Vandaag's "+" (RN; web twin: web/v2/vandaagPlus.js): pick an own note or an own appointment, fill it in, save.
 * Painted from the shared model (`PLUS_ACTS`); what a save does is the host's (`onSave(actId, values)` → null, or the
 * line to show). A moment is typed in words ("morgen om 14:00"), read by the shared bounded reader.
 */
import React, { useMemo, useState, useEffect } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { useTheme } from './themeContext.js';
import { t } from '../../core/localisation.js';
import { PLUS_ACTS } from '../../../../basis/src/v2/vandaagPlus.js';

export default function VandaagPlusModal({ visible, onSave, onClose }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [actId, setActId] = useState(null);
  const [values, setValues] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!visible) { setActId(null); setValues({}); setError(null); setBusy(false); } }, [visible]);
  if (!visible) return null;
  const act = PLUS_ACTS.find((a) => a.id === actId) ?? null;
  const save = async () => {
    setBusy(true);
    const line = await onSave?.(act.id, values);
    setBusy(false);
    if (line) setError(line);
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card} testID="vandaag-plus">
          <Text style={styles.title}>{t('circle.vandaag.plus')}</Text>
          {!act ? PLUS_ACTS.map((a) => (
            <Pressable key={a.id} style={styles.btn} onPress={() => setActId(a.id)} testID={`vandaag-plus-${a.id}`}>
              <Text style={styles.btnText}>{t(a.labelKey)}</Text>
            </Pressable>
          )) : (
            <View>
              {act.fields.map((f) => (
                <View key={f.name} style={styles.field}>
                  <Text style={styles.label}>{t(f.labelKey)}</Text>
                  <TextInput style={styles.input} value={values[f.name] ?? ''} testID={`vandaag-plus-${f.name}`}
                    onChangeText={(v) => setValues((cur) => ({ ...cur, [f.name]: v }))} />
                </View>
              ))}
              <Pressable style={[styles.btn, busy && styles.disabled]} disabled={busy} onPress={save} testID="vandaag-plus-save">
                <Text style={styles.btnText}>{t('circle.vandaag.plus_save')}</Text>
              </Pressable>
            </View>
          )}
          {error ? <Text style={styles.error} testID="vandaag-plus-error">{error}</Text> : null}
          <Pressable style={styles.btn} onPress={onClose} testID="vandaag-plus-close">
            <Text style={styles.btnText}>{t('circle.vandaag.done')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  card: { backgroundColor: theme.color.card, borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 16, gap: 8 },
  title: { fontSize: 17, fontWeight: '700', color: theme.color.ink, marginBottom: 4 },
  field: { gap: 4, marginBottom: 8 },
  label: { fontSize: 13, color: theme.color.inkSoft },
  input: { fontSize: 14, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, color: theme.color.ink },
  btn: { paddingVertical: 9, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.color.line, alignSelf: 'flex-start' },
  btnText: { color: theme.color.ink, fontSize: 14 },
  disabled: { opacity: 0.4 },
  error: { color: theme.color.accent, fontSize: 13 },
});
