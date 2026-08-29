/**
 * OpPageModal — the mobile paint of an op's PAGE: a form built from the op's declared params.
 *
 * The sibling of web's `openPagePanel` simple mode (`apps/basis/src/web/pagePanel.js`), over the SAME
 * shared pieces: `buildFormSpec` turns the manifest params into fields, `validateAndCoerce` turns what
 * was typed into args, and the waist (`callSkill`) runs the op. The shell only paints: no gate, no
 * projection, no verb here. Until this existed an argument-taking op on mobile pointed at "In chat:
 * /slash" — and a device with no circle has no chat, so such an op could not be run at all.
 */
import React, { useMemo, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { buildFormSpec, validateAndCoerce } from '../../../../basis/src/forms/buildFormSpec.js';
import { useTheme } from './themeContext.js';
import { t } from '../../core/localisation.js';

export default function OpPageModal({ visible, appOrigin, op, callSkill, onClose, onDispatched }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const spec = useMemo(() => (op ? buildFormSpec({
    opParams: Array.isArray(op.params) ? op.params : [], missing: [], prefilledArgs: {}, opId: op.id, appOrigin,
  }) : null), [op, appOrigin]);
  const [values, setValues] = useState({});
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  if (!visible || !op || !spec) return null;

  const submit = async () => {
    const v = validateAndCoerce(spec, values);
    if (v.errors?.length) { setStatus(v.errors.map((e) => `${e.field}: ${e.message}`).join(' · ')); return; }
    setBusy(true); setStatus('');
    try {
      const reply = await callSkill?.(appOrigin, op.id, v.args);
      if (reply?.ok === false) { setStatus(String(reply.error ?? reply.reason ?? '✗')); return; }
      onDispatched?.(reply);
      setValues({}); onClose?.();
    } catch (err) {
      setStatus(String(err?.message ?? err));
    } finally { setBusy(false); }
  };

  const title = op.surfaces?.page?.title ?? `${appOrigin}:${op.id}`;
  const hint = op.surfaces?.chat?.hint ?? op.description ?? null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card} testID="op-page-modal">
          <Text style={styles.title}>{title}</Text>
          {hint ? <Text style={styles.hint}>{hint}</Text> : null}
          <ScrollView style={styles.fields} keyboardShouldPersistTaps="handled">
            {spec.fields.map((f) => (
              <View key={f.name} style={styles.field}>
                <Text style={styles.label}>{f.name}{f.required ? ' *' : ''}{f.choices ? ` (${f.choices.join(' | ')})` : ''}</Text>
                <TextInput
                  style={styles.input}
                  value={values[f.name] ?? ''}
                  placeholder={f.placeholder ?? (f.kind === 'boolean' ? 'true / false' : f.kind)}
                  placeholderTextColor={theme.color.inkSoft}
                  autoCapitalize="none"
                  keyboardType={f.kind === 'number' ? 'numeric' : 'default'}
                  onChangeText={(text) => setValues((cur) => ({ ...cur, [f.name]: text }))}
                  testID={`op-page-field-${f.name}`}
                />
                {f.hint ? <Text style={styles.hint}>{f.hint}</Text> : null}
              </View>
            ))}
          </ScrollView>
          {status ? <Text style={styles.status}>{status}</Text> : null}
          <View style={styles.actions}>
            <Pressable style={styles.btnGhost} onPress={onClose} disabled={busy}>
              <Text style={styles.btnGhostText}>{t('circle.advanced.cancel')}</Text>
            </Pressable>
            <Pressable style={styles.btn} onPress={submit} disabled={busy} testID="op-page-submit">
              <Text style={styles.btnText}>{t('circle.advanced.submit')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 18 },
  card: { backgroundColor: theme.color.card, borderRadius: 10, padding: 18, maxHeight: '85%' },
  title: { color: theme.color.ink, fontSize: 17, fontWeight: '600', marginBottom: 6 },
  hint: { color: theme.color.inkSoft, fontSize: 13, marginBottom: 8 },
  fields: { flexGrow: 0 },
  field: { marginBottom: 10 },
  label: { color: theme.color.ink, fontSize: 13, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, padding: 10, color: theme.color.ink },
  status: { color: theme.color.ink, fontSize: 13, marginTop: 6 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
  btn: { backgroundColor: theme.color.accent, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 },
  btnText: { color: theme.color.accentContrast, fontWeight: '600' },
  btnGhost: { borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 },
  btnGhostText: { color: theme.color.inkSoft, fontWeight: '600' },
});
