/**
 * **Platform: RN**.  EmbedTime wizard for basis-mobile
 * (2026-05-26).
 *
 * Single-step form for /embed-time.  Title + when (free text, parsed
 * by chrono-node in localBuiltins.createTimeEmbed — handles ISO +
 * natural-language like "tomorrow 3pm") + optional duration,
 * location, attendees.
 *
 * Why no native DateTimePicker?  Per the basis unifier
 * principle: chrono-node is already in deps; text-input + chrono
 * works the same way on web + mobile, no platform-specific deps.
 * If a future UX pass adds @react-native-community/datetimepicker,
 * it'll go at the substrate level so all apps benefit, not just
 * basis.
 *
 * Shares src/core/wizards/embedTimeState.js with web (web wizard
 * portion lands later — today web uses slash flags).
 */
import React, { useState, useCallback } from 'react';
import { Modal, ScrollView, StyleSheet, Pressable } from 'react-native';

import {
  initialState, canSubmit, submitEmbedTime,
} from '../../core/wizards/embedTimeState.js';

import { Body, Field, Actions, ErrorBanner, Submitting } from './_kit.js';

export default function EmbedTimeWizardModal({
  visible, args, callSkill, onClose, onDispatched, t,
}) {
  const [state, setState] = useState(() => initialState(args ?? {}));

  const onCreate = useCallback(async () => {
    let next = { ...state, submitting: true, submitError: null };
    setState(next);
    const { result, state: after } = await submitEmbedTime({ state: next, callSkill });
    setState({ ...after });
    if (result && typeof onDispatched === 'function') {
      try {
        onDispatched({
          ok: true,
          message: result.message ?? `✓ Time embed created: ${after.title}`,
          ...result,
        });
      } catch { /* defensive */ }
    }
    if (result) onClose?.();
  }, [state, callSkill, onDispatched, onClose]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={styles.sheet}
          onPress={(e) => e.stopPropagation()}
          testID="embed-time-wizard"
        >
          <ScrollView style={styles.scroll}>
            <Body
              title={t('circle.wizard.embed_time.title')}
              intro="Drops a time card into the active thread. Date accepts ISO format (2026-05-30T15:00) OR natural language (tomorrow 3pm, next Friday)."
            >
              <Field
                label="Title"
                value={state.title}
                onChangeText={(v) => setState((s) => ({ ...s, title: v }))}
                placeholder="e.g. Circle BBQ"
              />
              <Field
                label="When"
                value={state.when}
                onChangeText={(v) => setState((s) => ({ ...s, when: v }))}
                placeholder="tomorrow 3pm  ·  2026-05-30T15:00"
              />
              <Field
                label="Duration (e.g. 1h, 90m, 2h30m)"
                value={state.duration}
                onChangeText={(v) => setState((s) => ({ ...s, duration: v }))}
                placeholder="1h"
              />
              <Field
                label="Location (optional)"
                value={state.location}
                onChangeText={(v) => setState((s) => ({ ...s, location: v }))}
                placeholder="e.g. Vondelpark"
              />
              <Field
                label="Share with (optional, WebID or peer address)"
                value={state.share}
                onChangeText={(v) => setState((s) => ({ ...s, share: v }))}
                placeholder="leave blank to keep local"
                monospace
              />
              <ErrorBanner message={state.submitError} />
              <Submitting visible={state.submitting} label="Creating time embed…" />
            </Body>
          </ScrollView>
          <Actions
            buttons={[
              { label: t('common.cancel'), onPress: onClose, kind: 'secondary',
                disabled: state.submitting },
              { label: 'Create',           onPress: onCreate, kind: 'primary',
                disabled: !canSubmit(state) },
            ]}
          />
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
});
