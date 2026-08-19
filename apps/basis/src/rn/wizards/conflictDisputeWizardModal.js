/**
 * **Platform: RN**.  Mobile parity for
 * `src/web/wizards/conflictDisputeWizard.js` (Bundle F,
 * 2026-05-26).  Consumes the SAME portable state machine
 * (`src/core/wizards/conflictDisputeState.js`) so behaviour stays
 * aligned across web + mobile.
 *
 * 3-step dispute flow:
 *   1. Raise — summary (≥10 chars) + escalation choice
 *   2. Propose — proposed resolution (≥5 chars)
 *   3. File — review + submit
 *
 * Substrate gap (inherited from web): stoop doesn't ship dedicated
 * raiseDispute / proposeResolution / acceptResolution skills yet,
 * so this files as a `kind:'dispute'` stoop.postRequest.  When
 * stoop ships them, `submitDispute` in the state machine swaps
 * call sites without the wizard layer noticing.
 *
 * No hardcoded strings — every label flows in via the `t` prop.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Modal, View, ScrollView, StyleSheet, Pressable } from 'react-native';

import {
  ESCALATION_PATHS,
  initialState, isSummaryValid, isProposalValid, labelOf,
  loadAboutPostText, submitDispute,
} from '../../core/wizards/conflictDisputeState.js';

import {
  Steps, Body, Field, Textarea, RadioGroup, ContextCard,
  Actions, ErrorBanner, Submitting, ReviewList, Warn,
} from './_kit.js';

export default function ConflictDisputeWizardModal({
  visible, args, callSkill, onClose, onDispatched, t,
}) {
  const [state, setState] = useState(() => initialState(args ?? {}));

  // Lazy-load the post text so the wizard can show "Disputing: <text>"
  // instead of the raw ulid.  Fires once on mount when postId present.
  useEffect(() => {
    let active = true;
    if (!state.aboutPostId) return;
    (async () => {
      const next = { ...state };
      await loadAboutPostText({ state: next, callSkill });
      if (active) setState(next);
    })();
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setStep = useCallback((n) => setState((s) => ({ ...s, step: n })), []);

  const validSummary  = useMemo(() => isSummaryValid(state.summary),  [state.summary]);
  const validProposal = useMemo(() => isProposalValid(state.proposal), [state.proposal]);

  const onFile = useCallback(async () => {
    let next = { ...state, submitting: true, submitError: null };
    setState(next);
    const { result, state: after } = await submitDispute({ state: next, callSkill });
    setState({ ...after });
    if (result && typeof onDispatched === 'function') {
      try {
        onDispatched({ ok: true, message: t('wizards.dispute.filed_message'), ...result });
      } catch { /* defensive */ }
    }
  }, [state, callSkill, onDispatched, t]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={styles.sheet}
          onPress={(e) => e.stopPropagation()}
          testID="conflict-dispute-wizard"
        >
          {state.successResult ? (
            <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
              <Body
                title={t('wizards.dispute.success_title')}
                intro={t('wizards.dispute.success_intro')}
              />
              <Actions
                buttons={[
                  { label: t('common.done'), onPress: onClose, kind: 'primary' },
                ]}
              />
            </ScrollView>
          ) : (
            <>
              <Steps
                labels={[
                  t('wizards.dispute.step_raise'),
                  t('wizards.dispute.step_propose'),
                  t('wizards.dispute.step_file'),
                ]}
                current={state.step}
              />
              <ScrollView style={styles.scroll}>
                {state.step === 1 && (
                  <Body
                    title={t('wizards.dispute.raise_title')}
                    intro={t('wizards.dispute.raise_intro')}
                  >
                    {state.aboutPostId ? (
                      <ContextCard
                        label={t('wizards.dispute.about_post_label')}
                        quoteText={state.aboutPostText}
                        placeholder={t('wizards.dispute.about_post_loading')}
                      />
                    ) : (
                      <Field
                        label={t('wizards.dispute.about_post_optional')}
                        value={state.aboutPostId}
                        onChangeText={(v) => setState((s) => ({ ...s, aboutPostId: v }))}
                        placeholder={t('wizards.dispute.about_post_placeholder')}
                        monospace
                      />
                    )}
                    <Textarea
                      label={t('wizards.dispute.summary_label')}
                      value={state.summary}
                      onChangeText={(v) => setState((s) => ({ ...s, summary: v }))}
                      placeholder={t('wizards.dispute.summary_placeholder')}
                      rows={5}
                    />
                    <RadioGroup
                      label={t('wizards.dispute.escalation_label')}
                      value={state.escalation}
                      options={ESCALATION_PATHS}
                      onChange={(v) => setState((s) => ({ ...s, escalation: v }))}
                    />
                  </Body>
                )}

                {state.step === 2 && (
                  <Body
                    title={t('wizards.dispute.propose_title')}
                    intro={t('wizards.dispute.propose_intro')}
                  >
                    <Textarea
                      label={t('wizards.dispute.proposal_label')}
                      value={state.proposal}
                      onChangeText={(v) => setState((s) => ({ ...s, proposal: v }))}
                      placeholder={t('wizards.dispute.proposal_placeholder')}
                      rows={4}
                    />
                  </Body>
                )}

                {state.step === 3 && (
                  <Body
                    title={t('wizards.dispute.file_title')}
                    intro={t('wizards.dispute.file_intro')}
                  >
                    <ReviewList
                      items={[
                        {
                          label:  t('wizards.dispute.review_summary'),
                          value:  state.summary,
                          pre:    true,
                        },
                        ...(state.aboutPostId ? [{
                          label:    t('wizards.dispute.review_about_post'),
                          value:    state.aboutPostId,
                          monospace:true,
                        }] : []),
                        {
                          label: t('wizards.dispute.review_escalation'),
                          value: labelOf(ESCALATION_PATHS, state.escalation),
                        },
                        {
                          label: t('wizards.dispute.review_proposal'),
                          value: state.proposal,
                          pre:   true,
                        },
                      ]}
                    />
                    <Warn>{t('wizards.dispute.substrate_warn')}</Warn>
                    <ErrorBanner message={state.submitError} />
                    <Submitting visible={state.submitting} label={t('wizards.dispute.filing')} />
                  </Body>
                )}
              </ScrollView>

              <Actions
                buttons={(() => {
                  if (state.step === 1) {
                    return [
                      { label: t('common.cancel'), onPress: onClose, kind: 'secondary' },
                      {
                        label: t('common.next'),
                        onPress: () => setStep(2),
                        kind: 'primary',
                        disabled: !validSummary,
                      },
                    ];
                  }
                  if (state.step === 2) {
                    return [
                      { label: t('common.back'),   onPress: () => setStep(1), kind: 'secondary' },
                      { label: t('common.cancel'), onPress: onClose,          kind: 'secondary' },
                      {
                        label: t('common.next'),
                        onPress: () => setStep(3),
                        kind: 'primary',
                        disabled: !validProposal,
                      },
                    ];
                  }
                  return [
                    { label: t('common.back'),   onPress: () => setStep(2), kind: 'secondary', disabled: state.submitting },
                    { label: t('common.cancel'), onPress: onClose,          kind: 'secondary', disabled: state.submitting },
                    { label: t('wizards.dispute.file_button'), onPress: onFile, kind: 'primary', disabled: state.submitting },
                  ];
                })()}
              />
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
    backgroundColor: '#fff',
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    maxHeight: '88%', minHeight: '60%',
  },
  scroll: { flexGrow: 1 },
});
