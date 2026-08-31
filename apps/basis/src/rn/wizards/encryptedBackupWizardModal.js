/**
 * **Platform: RN**.  Mobile parity for
 * src/web/wizards/encryptedBackupWizard.js.
 *
 * 2-step flow:
 *   1. Passphrase + confirm
 *   2. Show "backup ready" status + byte count
 *
 * Web step 2 triggers a Blob/URL.createObjectURL download.  Mobile
 * V1 stops at step 2 and shows "ready to save — saving deferred to
 * " (expo-sharing wiring lands in Bundle F). The blob
 * itself sits in state.blob, ready for that future step.
 *
 * Shares src/core/wizards/encryptedBackupState.js with web.
 */
import React, { useState, useCallback } from 'react';
import { Modal, View, ScrollView, StyleSheet, Pressable, Text } from 'react-native';
import {
  initialState, canCreateBackup, submitCreateBackup, suggestedFilename,
} from '../../core/wizards/encryptedBackupState.js';
import {
  Steps, Body, Field, Actions, ErrorBanner, Submitting, Warn,
} from './_kit.js';

export default function EncryptedBackupWizardModal({
  visible, callSkill, onClose, onDispatched, t,
}) {
  const [state, setState] = useState(() => initialState());

  const onCreate = useCallback(async () => {
    let next = { ...state, submitting: true, submitError: null };
    setState(next);
    const after = await submitCreateBackup({ state: next, callSkill });
    setState({ ...after });
    if (after.blob && typeof onDispatched === 'function') {
      try {
        onDispatched({
          ok: true,
          message: `✓ Encrypted backup created (${blobSize(after.blob)} bytes — saving wired in P4).`,
        });
      } catch {}
    }
  }, [state, callSkill, onDispatched]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={styles.sheet}
          onPress={(e) => e.stopPropagation()}
          testID="encrypted-backup-wizard"
        >
          <Steps labels={['Passphrase', 'Save']} current={state.step} />
          <ScrollView style={styles.scroll}>
            {state.step === 1 && (
              <Body
                title={t('circle.wizard.backup.title')}
                intro="Pick a passphrase to encrypt your local stoop data. Keep it safe — without it the backup is unrecoverable."
              >
                <Field
                  label="Passphrase"
                  value={state.passphrase}
                  onChangeText={(v) => setState((s) => ({ ...s, passphrase: v }))}
                  placeholder="(no length minimum, but use one you'll remember)"
                />
                <Field
                  label="Confirm passphrase"
                  value={state.confirm}
                  onChangeText={(v) => setState((s) => ({ ...s, confirm: v }))}
                  placeholder="re-enter"
                />
                <ErrorBanner message={state.submitError} />
                <Submitting visible={state.submitting} label="Building backup…" />
              </Body>
            )}
            {state.step === 2 && (
              <Body
                title={t('circle.wizard.backup.ready')}
                intro={`Your encrypted backup is ${blobSize(state.blob)} bytes. Suggested filename: ${suggestedFilename()}`}
              >
                <Warn>Saving / sharing the backup file is wired in Bundle F P4 (#260 — expo-sharing + expo-file-system). For now the bytes live in app memory only.</Warn>
              </Body>
            )}
          </ScrollView>
          <Actions buttons={(() => {
            if (state.step === 1) return [
              { label: t('common.cancel'), onPress: onClose, kind: 'secondary', disabled: state.submitting },
              { label: 'Create backup',    onPress: onCreate, kind: 'primary',
                disabled: !canCreateBackup(state) || state.submitting },
            ];
            return [{ label: t('common.done'), onPress: onClose, kind: 'primary' }];
          })()} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function blobSize(blob) {
  if (!blob) return 0;
  if (typeof blob === 'string') return blob.length;
  if (typeof blob === 'object' && typeof blob.size === 'number') return blob.size;
  return 0;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16,
    maxHeight: '88%', minHeight: '60%',
  },
  scroll: { flexGrow: 1 },
});
