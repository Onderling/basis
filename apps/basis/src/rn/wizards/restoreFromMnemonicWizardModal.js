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
  Steps, Body, Textarea, Checkbox, Actions, ErrorBanner, Submitting, WizardTheme, wizardPalette, Warn,
} from './_kit.js';

export default function RestoreFromMnemonicWizardModal({
  visible, theme = null, callSkill, onClose, onDispatched, t,
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
    <WizardTheme theme={theme}>
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: wizardPalette(theme).card }]}
          onPress={(e) => e.stopPropagation()}
          testID="restore-from-mnemonic-wizard"
        >
          {state.successResult ? (
            <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
              <Body title={t('circle.wizard.restore.done_title')} intro={t('circle.wizard.restore.done_intro')}>
                <Text style={styles.count}>{t('circle.wizard.recovery.after_restore_hint')}</Text>
              </Body>
              <Actions buttons={[{ label: t('common.done'), onPress: onClose, kind: 'primary' }]} />
            </ScrollView>
          ) : (
            <>
              <Steps labels={[t('circle.wizard.restore.step_phrase'), t('circle.wizard.restore.step_confirm'), t('circle.wizard.restore.step_restore')]} current={state.step} />
              <ScrollView style={styles.scroll}>
                {state.step === 1 && (
                  <Body
                    title={t('circle.wizard.restore.title')}
                    intro={t('circle.wizard.restore.intro')}
                  >
                    <Textarea
                      label={t('circle.wizard.restore.phrase')}
                      value={state.mnemonic}
                      onChangeText={(v) => setState((s) => ({ ...s, mnemonic: v }))}
                      placeholder={t('circle.wizard.restore.phrase_placeholder')}
                      rows={4}
                    />
                    <Text style={styles.count}>
                      {mnemonicWordCount(state.mnemonic)} word(s)
                    </Text>
                  </Body>
                )}
                {state.step === 2 && (
                  <Body title={t('circle.wizard.restore.confirm_title')} intro={t('circle.wizard.restore.confirm_intro')}>
                    <Warn>{t('circle.wizard.restore.identity_warning')}</Warn>
                    {/* the person's CURRENT phrase, asked once before the two checks (copy, not a third check) — web parity */}
                    <Text style={styles.count}>{t('circle.wizard.restore.saved_question')}</Text>
                    <Checkbox
                      label={t('circle.wizard.restore.ack_lost')}
                      checked={state.understandsLoss}
                      onToggle={(v) => setState((s) => ({ ...s, understandsLoss: v }))}
                    />
                    <Checkbox
                      label={t('circle.wizard.restore.ack_undone')}
                      checked={state.confirmedNoUndo}
                      onToggle={(v) => setState((s) => ({ ...s, confirmedNoUndo: v }))}
                    />
                  </Body>
                )}
                {state.step === 3 && (
                  <Body
                    title={t('circle.wizard.restore.apply_title')}
                    intro={t('circle.wizard.restore.apply_intro')}
                  >
                    <ErrorBanner message={state.submitError} />
                    <Submitting visible={state.submitting} label={t('circle.wizard.restore.restoring')} />
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
                  { label: t('circle.wizard.restore.button'),          onPress: onRestore, kind: 'primary', disabled: state.submitting },
                ];
              })()} />
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
    </WizardTheme>
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
