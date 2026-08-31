/**
 * **Platform: RN**.  Mobile parity for
 * src/web/wizards/restoreFromMnemonicWizard.js.
 *
 * 3-step destructive flow:
 *   1. Mnemonic — paste / type 12 or 24 words
 *   2. Confirm — two checkboxes acknowledging data loss
 *   3. Restore — submit + result
 *
 * Shares src/core/wizards/restoreFromMnemonicState.js with web.
 */
import React, { useState, useCallback } from 'react';
import { Modal, View, ScrollView, StyleSheet, Pressable, Text } from 'react-native';
import {
  initialState, mnemonicWordCount, isMnemonicValid,
  canAdvanceFromConfirm, submitRestore,
} from '../../core/wizards/restoreFromMnemonicState.js';
import {
  Steps, Body, Textarea, Checkbox, Actions, ErrorBanner, Submitting,
} from './_kit.js';

export default function RestoreFromMnemonicWizardModal({
  visible, callSkill, onClose, onDispatched, t,
}) {
  const [state, setState] = useState(() => initialState());
  const setStep = useCallback((n) => setState((s) => ({ ...s, step: n })), []);

  const onRestore = useCallback(async () => {
    let next = { ...state, submitting: true, submitError: null };
    setState(next);
    const after = await submitRestore({ state: next, callSkill });
    setState({ ...after });
    if (after.successResult && typeof onDispatched === 'function') {
      try { onDispatched({ ok: true, message: 'Restored from mnemonic.', ...after.successResult }); } catch {}
    }
  }, [state, callSkill, onDispatched]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={styles.sheet}
          onPress={(e) => e.stopPropagation()}
          testID="restore-from-mnemonic-wizard"
        >
          {state.successResult ? (
            <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
              <Body title="✓ Restored" intro="Your identity was restored from the mnemonic." />
              <Actions buttons={[{ label: t('common.done'), onPress: onClose, kind: 'primary' }]} />
            </ScrollView>
          ) : (
            <>
              <Steps labels={['Mnemonic', 'Confirm', 'Restore']} current={state.step} />
              <ScrollView style={styles.scroll}>
                {state.step === 1 && (
                  <Body
                    title={t('circle.wizard.restore.title')}
                    intro="Paste your 12- or 24-word recovery phrase. This WILL replace your current identity — make sure you've backed up anything important first."
                  >
                    <Textarea
                      label="Recovery phrase"
                      value={state.mnemonic}
                      onChangeText={(v) => setState((s) => ({ ...s, mnemonic: v }))}
                      placeholder="word1 word2 word3 …"
                      rows={4}
                    />
                    <Text style={styles.count}>
                      {mnemonicWordCount(state.mnemonic)} word(s)
                    </Text>
                  </Body>
                )}
                {state.step === 2 && (
                  <Body title="Confirm" intro="This is destructive. Please confirm by ticking both boxes.">
                    <Checkbox
                      label="I understand my current identity + local data will be LOST."
                      checked={state.understandsLoss}
                      onToggle={(v) => setState((s) => ({ ...s, understandsLoss: v }))}
                    />
                    <Checkbox
                      label="I understand this CANNOT be undone."
                      checked={state.confirmedNoUndo}
                      onToggle={(v) => setState((s) => ({ ...s, confirmedNoUndo: v }))}
                    />
                  </Body>
                )}
                {state.step === 3 && (
                  <Body
                    title={t('circle.wizard.restore.confirm_title')}
                    intro="Tap Restore to overwrite your current identity with the phrase above."
                  >
                    <ErrorBanner message={state.submitError} />
                    <Submitting visible={state.submitting} label="Restoring…" />
                  </Body>
                )}
              </ScrollView>
              <Actions buttons={(() => {
                if (state.step === 1) return [
                  { label: t('common.cancel'), onPress: onClose, kind: 'secondary' },
                  { label: t('common.next'),   onPress: () => setStep(2), kind: 'primary',
                    disabled: !isMnemonicValid(state.mnemonic) },
                ];
                if (state.step === 2) return [
                  { label: t('common.back'),   onPress: () => setStep(1), kind: 'secondary' },
                  { label: t('common.cancel'), onPress: onClose, kind: 'secondary' },
                  { label: t('common.next'),   onPress: () => setStep(3), kind: 'primary',
                    disabled: !canAdvanceFromConfirm(state) },
                ];
                return [
                  { label: t('common.back'),   onPress: () => setStep(2), kind: 'secondary', disabled: state.submitting },
                  { label: t('common.cancel'), onPress: onClose, kind: 'secondary', disabled: state.submitting },
                  { label: 'Restore',          onPress: onRestore, kind: 'primary', disabled: state.submitting },
                ];
              })()} />
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16,
    maxHeight: '88%', minHeight: '60%',
  },
  scroll: { flexGrow: 1 },
  count: { fontSize: 12, color: '#666', marginTop: 4 },
});
