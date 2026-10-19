/**
 * Vandaag's "+" (RN; web twin: web/v2/vandaagPlus.js): the person's own acts (the own-scope attach entries), a free
 * line at the top that fills them ("notitie: melk", "afspraak morgen 14:00 tandarts"), the fields, Save — and, opened on
 * an own row (`edit`), Remove. Painted from the shared model (`PLUS_ACTS`); what a save, a read or a removal does is the
 * host's (`onSave(actId, values, asSelf)` / `onRead(line)` / `onRemove(actId)` → null, or the line to show). A moment
 * is typed in words ("morgen om 14:00"), read by the shared bounded reader.
 */
import React, { useMemo, useState, useEffect } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { useTheme } from './themeContext.js';
import { t } from '../../core/localisation.js';
import { PLUS_ACTS, plusLabel } from '../../../../basis/src/v2/vandaagPlus.js';

export default function VandaagPlusModal({ visible, onSave, onClose, onRead = null, onRemove = null,
  // opened on an own row: `{ act, id, values }` (the shared `plusEditFor`)
  edit = null,
  // several selves ticked in the header: the sheet asks which one this is written as; one ticked: `writeAsSelf`
  selves = [], writeAsSelf = null }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [actId, setActId] = useState(null);
  const [values, setValues] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [asSelf, setAsSelf] = useState(writeAsSelf);
  const [line, setLine] = useState('');
  useEffect(() => {
    if (!visible) { setActId(null); setValues({}); setError(null); setBusy(false); setAsSelf(writeAsSelf); setLine(''); return; }
    if (edit?.act) { setActId(edit.act.id); setValues(edit.values ?? {}); setAsSelf('default'); }
  }, [visible, writeAsSelf, edit]);
  if (!visible) return null;
  const act = PLUS_ACTS.find((a) => a.id === actId) ?? null;
  const save = async () => {
    setBusy(true);
    const said = await onSave?.(act.id, values, asSelf);
    setBusy(false);
    if (said) setError(said);
  };
  const remove = async () => {
    setBusy(true);
    const said = await onRemove?.(act.id);
    setBusy(false);
    if (said) setError(said);
  };
  // the free line: what it understood picks the act and fills the fields below (editable before Save), never a circle
  const read = () => {
    const r = onRead?.(line);
    if (r?.actId) { setActId(r.actId); setValues((cur) => ({ ...cur, ...r.values })); setError(null); }
    else if (r?.error) setError(r.error);
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card} testID="vandaag-plus">
          <Text style={styles.title}>{t(edit ? 'circle.vandaag.plus_edit' : 'circle.vandaag.plus')}</Text>
          {!edit && onRead && !(selves.length > 1 && !asSelf) ? (
            <TextInput style={styles.input} value={line} onChangeText={setLine} onSubmitEditing={read} returnKeyType="go"
              placeholder={t('circle.vandaag.plus_line_ph')} accessibilityLabel={t('circle.vandaag.plus_line_ph')} testID="vandaag-plus-line" />
          ) : null}
          {selves.length > 1 && !asSelf ? (
            <View>
              <Text style={styles.label}>{t('circle.vandaag.plus_as')}</Text>
              {selves.map((p) => (
                <Pressable key={p.id} style={styles.btn} onPress={() => setAsSelf(p.id)} testID={`vandaag-plus-self-${p.id}`}>
                  <Text style={styles.btnText}>{p.id === 'default' ? t('circle.switcher.you') : (p.name || p.id)}</Text>
                </Pressable>
              ))}
            </View>
          ) : !act ? PLUS_ACTS.map((a) => (
            <Pressable key={a.id} style={styles.btn} onPress={() => setActId(a.id)} testID={`vandaag-plus-${a.id}`}>
              <Text style={styles.btnText}>{plusLabel(t, a)}</Text>
            </Pressable>
          )) : (
            <View>
              {act.fields.map((f) => (
                <View key={f.name} style={styles.field}>
                  <Text style={styles.label}>{f.labelKey ? t(f.labelKey) : f.name}</Text>
                  <TextInput style={styles.input} value={values[f.name] ?? ''} testID={`vandaag-plus-${f.name}`}
                    onChangeText={(v) => setValues((cur) => ({ ...cur, [f.name]: v }))} />
                </View>
              ))}
              <Pressable style={[styles.btn, busy && styles.disabled]} disabled={busy} onPress={save} testID="vandaag-plus-save">
                <Text style={styles.btnText}>{t('circle.vandaag.plus_save')}</Text>
              </Pressable>
              {edit && onRemove ? (
                <Pressable style={[styles.btn, busy && styles.disabled]} disabled={busy} onPress={remove} testID="vandaag-plus-remove">
                  <Text style={styles.btnText}>{t('circle.vandaag.plus_remove')}</Text>
                </Pressable>
              ) : null}
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
