/**
 * **Platform: RN.** Mobile parity for src/web/wizards/recoveryFileWizard.js — the two recovery-file
 * doors in one modal, `mode: 'export' | 'import'`. Picking and saving the file are handed in
 * by the screen (`onPickFile`, `onSaveFile`) so this module stays free of expo modules.
 * Shares src/core/wizards/recoveryFileState.js with web.
 */
import React, { useState, useCallback } from 'react';
import { Modal, ScrollView, StyleSheet, Pressable, Text } from 'react-native';
import {
  initialExportState, initialImportState, submitExport, submitImport, canImport, importErrorKey,
} from '../../core/wizards/recoveryFileState.js';
import { Body, Actions, ErrorBanner, Submitting } from './_kit.js';

export default function RecoveryFileWizardModal({ visible, mode = 'export', callSkill, onClose, onDispatched, onPickFile, onSaveFile, t }) {
  const [state, setState] = useState(() => (mode === 'import' ? initialImportState() : initialExportState()));

  const doExport = useCallback(async () => {
    const next = { ...state, submitting: true, submitError: null }; setState(next);
    const after = await submitExport({ state: next, callSkill }); setState({ ...after });
    if (after.file && typeof onDispatched === 'function') { try { onDispatched({ ok: true }); } catch {} }
  }, [state, callSkill, onDispatched]);

  const doSave = useCallback(async () => {
    try { await onSaveFile?.(state.file, state.filename); }
    catch (err) { setState((s) => ({ ...s, submitError: err?.message ?? String(err) })); }
  }, [state, onSaveFile]);

  const doPick = useCallback(async () => {
    try {
      const picked = await onPickFile?.();
      if (picked && typeof picked.text === 'string') setState((s) => ({ ...s, fileText: picked.text, filename: picked.name ?? null, submitError: null }));
    } catch (err) { setState((s) => ({ ...s, submitError: err?.message ?? String(err) })); }
  }, [onPickFile]);

  const doImport = useCallback(async () => {
    const next = { ...state, submitting: true, submitError: null }; setState(next);
    const after = await submitImport({ state: next, callSkill }); setState({ ...after });
    if (after.result && typeof onDispatched === 'function') { try { onDispatched({ ok: true, ...after.result }); } catch {} }
  }, [state, callSkill, onDispatched]);

  const buttons = (() => {
    if (mode === 'export') {
      return state.file
        ? [{ label: t('circle.wizard.recovery.download'), onPress: doSave, kind: 'primary' }, { label: t('common.done'), onPress: onClose, kind: 'secondary' }]
        : [{ label: t('common.cancel'), onPress: onClose, kind: 'secondary', disabled: state.submitting },
           { label: t('circle.wizard.recovery.make'), onPress: doExport, kind: 'primary', disabled: state.submitting }];
    }
    if (state.result) return [{ label: t('common.done'), onPress: onClose, kind: 'primary' }];
    return [
      { label: t('common.cancel'), onPress: onClose, kind: 'secondary', disabled: state.submitting },
      { label: t('circle.wizard.recovery.pick'), onPress: doPick, kind: 'secondary', disabled: state.submitting },
      { label: t('circle.wizard.recovery.load'), onPress: doImport, kind: 'primary', disabled: !canImport(state) },
    ];
  })();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()} testID={`recovery-file-wizard-${mode}`}>
          <ScrollView style={styles.scroll}>
            {mode === 'export' && (
              <Body title={t('circle.wizard.recovery.export_title')} intro={t('circle.wizard.recovery.export_intro')}>
                {state.file && <Text style={styles.note}>{t('circle.wizard.recovery.export_ready')} {state.circles} · {state.filename}</Text>}
                <ErrorBanner message={state.submitError} />
                <Submitting visible={state.submitting} label={t('circle.wizard.recovery.sealing')} />
              </Body>
            )}
            {mode === 'import' && !state.result && (
              <Body title={t('circle.wizard.recovery.import_title')} intro={t('circle.wizard.recovery.import_intro')}>
                {state.filename && <Text style={styles.note}>{state.filename}</Text>}
                <ErrorBanner message={state.submitError ? t(importErrorKey(state.submitError)) : null} />
                <Submitting visible={state.submitting} label={t('circle.wizard.recovery.loading')} />
              </Body>
            )}
            {mode === 'import' && state.result && (
              <Body title={t('circle.wizard.recovery.import_done_title')} intro={`${t('circle.wizard.recovery.import_done')} ${state.result.circles.length}`}>
                {state.result.circles.map((c) => <Text key={c} style={styles.note}>{c}</Text>)}
              </Body>
            )}
          </ScrollView>
          <Actions buttons={buttons} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '88%', minHeight: '45%' },
  scroll: { flexGrow: 1 },
  note: { fontSize: 13, color: '#444', marginTop: 6 },
});
