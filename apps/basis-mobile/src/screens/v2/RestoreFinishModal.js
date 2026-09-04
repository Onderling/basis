/**
 * RestoreFinishModal — the restore-finish FLOW's painter on mobile (web parity: circleApp's
 * showRestoreFinishFlow). After the reload a phrase ceremony asks for, the flow says what came back,
 * offers a recovery file when nothing did, asks whether anyone else could still use the old phone, and
 * runs the replace ceremony for a broken or lost one. The declaration lives on the household manifest;
 * the runner executes through the waist; this component paints renderFlow's view model with a bespoke
 * form per pause. Every branch ends on a screen that says what happened.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { createFlowRunner, renderFlow } from '@onderling/app-manifest';
import { householdManifest } from '../../../../household/manifest.js';
import { forgetCircleSealStrategies } from '../../core/circlePods.js';
import { useTheme } from './themeContext.js';
import { t } from '../../core/localisation.js';

const FLOW = householdManifest.flows.find((f) => f.id === 'restore-finish');
const OPS = new Map(householdManifest.operations.map((o) => [o.id, o]));

export default function RestoreFinishModal({ visible, callSkill, onClose }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [inst, setInst] = useState(null);
  const [phrase, setPhrase] = useState('');
  const [fileText, setFileText] = useState(null);
  const [fileName, setFileName] = useState(null);
  const runnerRef = useRef(null);

  useEffect(() => {
    if (!visible || typeof callSkill !== 'function') return;
    const runner = createFlowRunner({ ops: OPS, callSkill: (opId, args) => callSkill('household', opId, args) });
    runnerRef.current = runner;
    let alive = true;
    runner.start(FLOW, {})
      .then((r) => { if (alive) { setInst(r); setPhrase(''); setFileText(null); setFileName(null); } })
      .catch(() => { if (alive) onClose?.(); });
    return () => { alive = false; runnerRef.current = null; };
  }, [visible, callSkill]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;
  const view = inst ? renderFlow(FLOW, inst, { ops: OPS }) : null;
  const finish = () => { setInst(null); forgetCircleSealStrategies(); onClose?.(); };
  const submit = (input) => {
    const runner = runnerRef.current;
    if (!runner || !inst) return;
    runner.resume(FLOW, inst, { input }).then((r) => setInst(r)).catch(() => finish());
  };
  const pickFile = async () => {
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
      const asset = r?.assets?.[0];
      if (r?.canceled || !asset?.uri) return;
      setFileText(await FileSystem.readAsStringAsync(asset.uri));
      setFileName(asset.name ?? null);
    } catch { setFileText(null); setFileName(null); }
  };
  const status = inst?.steps?.status?.out ?? {};
  const produces = inst?.produces ?? {};
  const retireOutcome = inst?.steps?.retire?.outcome;
  const sourceOutcome = inst?.steps?.source?.outcome;
  const Btn = ({ label, onPress, primary, testID }) => (
    <Pressable style={[styles.button, primary && styles.primary]} onPress={onPress} testID={testID}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );

  let body = null;
  if (view?.status === 'awaiting-input' && view.form?.step === 'source') {
    body = (
      <View>
        <Text style={styles.body}>{t('circle.restore_finish.empty_title')}</Text>
        <Text style={styles.muted}>{t('circle.restore_finish.empty_body')}</Text>
        {fileName ? <Text style={styles.muted}>{fileName}</Text> : null}
        <View style={styles.row}>
          <Btn label={t('circle.wizard.recovery.pick')} onPress={pickFile} testID="restore-finish-pick" />
          {fileText ? <Btn label={t('circle.restore_finish.source_file')} primary onPress={() => submit({ source: 'file', file: fileText })} testID="restore-finish-load" /> : null}
          <Btn label={t('circle.restore_finish.source_later')} onPress={() => submit({ source: 'later' })} testID="restore-finish-later" />
        </View>
      </View>
    );
  } else if (view?.status === 'awaiting-input' && view.form?.step === 'intent') {
    body = (
      <View>
        <Text style={styles.body}>{t('circle.restore_finish.status_ready')}</Text>
        <Text style={styles.muted}>{t(status.carrier === 'pod' ? 'circle.restore_finish.status_pod' : 'circle.restore_finish.status_local')}</Text>
        <Text style={styles.body}>{t('circle.restore_finish.intent_question')}</Text>
        {['broken', 'lost', 'adding'].map((intent) => (
          <Btn key={intent} label={t(`circle.restore_finish.intent_${intent}`)} onPress={() => submit({ intent })} testID={`restore-finish-${intent}`} />
        ))}
        <Text style={styles.muted}>{t('circle.restore_finish.intent_hint')}</Text>
      </View>
    );
  } else if (view?.status === 'awaiting-input' && view.form?.step === 'retire') {
    body = (
      <View>
        <Text style={styles.body}>{t('circle.restore_finish.phrase_body')}</Text>
        <TextInput
          style={styles.input} placeholder={t('circle.enroll.mnemonic_placeholder')} placeholderTextColor={theme.color.inkSoft}
          multiline autoCapitalize="none" autoCorrect={false} autoComplete="off" value={phrase} onChangeText={setPhrase}
          testID="restore-finish-mnemonic"
        />
        <View style={styles.row}>
          <Btn label={t('circle.replace.submit')} primary onPress={() => submit({ mnemonic: phrase })} testID="restore-finish-retire" />
          <Btn label={t('circle.confirm.cancel', { defaultValue: 'Annuleren' })} onPress={() => { runnerRef.current?.cancel(inst); finish(); }} />
        </View>
      </View>
    );
  } else if (view) {
    let msg;
    if (sourceOutcome === 'later') msg = t('circle.restore_finish.later_title');
    else if (sourceOutcome === 'not-your-file') msg = t('circle.restore_finish.err_not_yours');
    else if (sourceOutcome === 'unreadable-file') msg = t('circle.restore_finish.err_unreadable');
    else if (produces.intent === 'adding') msg = t('circle.restore_finish.done_adding');
    else if (retireOutcome === 'ok') msg = produces.intent === 'lost' ? t('circle.restore_finish.done_loud') : t('circle.restore_finish.done_quiet');
    else if (retireOutcome === 'wrong-phrase' || retireOutcome === 'invalid-phrase') msg = t('circle.enroll.invalid_phrase');
    else msg = t('circle.restore_finish.err_failed');
    const retired = inst?.steps?.retire?.out?.retiredDevices;
    const retry = retireOutcome && retireOutcome !== 'ok';
    body = (
      <View>
        <Text style={styles.body}>{msg}</Text>
        {retireOutcome === 'ok' && produces.intent === 'lost' && Array.isArray(retired) && retired.length
          ? <Text style={styles.muted}>{t('circle.restore_finish.done_devices')} {retired.length}</Text> : null}
        <View style={styles.row}>
          <Btn label={retry ? t('circle.enroll.retry') : t('common.close', { defaultValue: 'Sluiten' })} primary testID="restore-finish-close"
            onPress={() => {
              if (!retry) return finish();
              const runner = runnerRef.current; if (!runner) return finish();
              setPhrase(''); runner.start(FLOW, {}).then((r) => setInst(r)).catch(() => finish());
            }} />
          {retry ? <Btn label={t('circle.confirm.cancel', { defaultValue: 'Annuleren' })} onPress={finish} /> : null}
        </View>
      </View>
    );
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => { runnerRef.current?.cancel(inst); finish(); }}>
      <View style={styles.backdrop}>
        <View style={styles.card} testID="restore-finish-modal">
          <Text style={styles.title}>{t('circle.restore_finish.title')}</Text>
          <ScrollView>{body}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: theme.color.card, borderRadius: 10, padding: 18, maxHeight: '85%' },
  title: { fontSize: 17, fontWeight: '700', color: theme.color.ink, marginBottom: 6 },
  body: { fontSize: 14, color: theme.color.ink, marginBottom: 8 },
  muted: { fontSize: 13, color: theme.color.inkSoft, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, padding: 8, color: theme.color.ink, marginBottom: 8, minHeight: 72, textAlignVertical: 'top' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 6 },
  button: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.color.line, marginBottom: 6 },
  primary: { borderColor: theme.color.ink },
  buttonText: { color: theme.color.ink, fontSize: 14 },
});
