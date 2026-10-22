/**
 * **Platform: RN**.  Mobile parity for
 * src/web/wizards/postAudienceWizard.js.
 *
 * Single-step form: compose a post with audience targeting (trust +
 * tags + distance + recipients + group selection).  Shares
 * src/core/wizards/postAudienceState.js with web.
 */
import React, { useState, useCallback, useEffect } from 'react';
import { Modal, View, ScrollView, StyleSheet, Pressable, Text, TouchableOpacity } from 'react-native';

import {
  TRUST_OPTS, DISTANCE_OPTS,
  initialState, canSubmit, loadAvailableCircles, submitPost,
  postKindOptions,
} from '../../core/wizards/postAudienceState.js';

import {
  Body, Field, Textarea, RadioGroup, Actions, ErrorBanner, Submitting, WizardTheme, wizardPalette,
} from './_kit.js';


export default function PostAudienceWizardModal({
  visible, theme = null, args, callSkill, onClose, onDispatched, t,
}) {
  const [state, setState] = useState(() => initialState(args ?? {}));

  useEffect(() => {
    let active = true;
    (async () => {
      const next = { ...state };
      await loadAvailableCircles({ state: next, callSkill });
      if (active) setState(next);
    })();
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPost = useCallback(async () => {
    let next = { ...state, submitting: true, submitError: null };
    setState(next);
    const { result, state: after } = await submitPost({ state: next, callSkill });
    setState({ ...after });
    if (result && typeof onDispatched === 'function') {
      try { onDispatched({ ok: true, message: '✓ Posted.', ...result }); } catch {}
    }
    if (result) onClose?.();
  }, [state, callSkill, onDispatched, onClose]);

  return (
    <WizardTheme theme={theme}>
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: wizardPalette(theme).card }]}
          onPress={(e) => e.stopPropagation()}
          testID="post-audience-wizard"
        >
          <ScrollView style={styles.scroll}>
            <Body
              title={t('circle.wizard.audience.title')}
              intro="Compose a post; pick a trust filter, optional tags, distance, and recipients."
            >
              <Textarea
                label={t('circle.wizard.audience.what')}
                value={state.text}
                onChangeText={(v) => setState((s) => ({ ...s, text: v }))}
                placeholder={t('circle.wizard.audience.text_placeholder')}
                rows={4}
              />
              <RadioGroup
                label={t('circle.wizard.audience.kind')}
                value={state.kind}
                options={postKindOptions().map((o) => ({ id: o.id, label: t(o.labelKey) }))}
                onChange={(v) => setState((s) => ({ ...s, kind: v }))}
              />
              <RadioGroup
                label={t('circle.wizard.audience.trust')}
                value={state.minTrust}
                options={TRUST_OPTS}
                onChange={(v) => setState((s) => ({ ...s, minTrust: v }))}
              />
              <Field
                label={t('circle.wizard.audience.tags')}
                value={state.tags}
                onChangeText={(v) => setState((s) => ({ ...s, tags: v }))}
                placeholder={t('circle.wizard.audience.tags_placeholder')}
              />
              <Text style={styles.subLabel}>Distance</Text>
              <View style={styles.distanceGrid}>
                {DISTANCE_OPTS.map((opt) => {
                  const selected = state.distanceKm === opt.km;
                  return (
                    <TouchableOpacity
                      key={opt.km}
                      onPress={() => setState((s) => ({ ...s, distanceKm: opt.km }))}
                      style={[styles.distanceCell, selected && styles.distanceCellActive]}
                    >
                      <Text style={[styles.distanceText, selected && styles.distanceTextActive]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Field
                label={t('circle.wizard.audience.recipients')}
                hint={t('circle.wizard.audience.recipients_hint')}
                value={state.recipients}
                onChangeText={(v) => setState((s) => ({ ...s, recipients: v }))}
                placeholder={t('circle.wizard.audience.recipients_placeholder')}
              />
              {state.availableCircles && state.availableCircles.length > 1 && (
                <RadioGroup
                  label={t('circle.wizard.audience.target')}
                  value={state.selectedCircle ?? ''}
                  options={state.availableCircles.map((b) => ({ id: b.id, label: b.label }))}
                  onChange={(v) => setState((s) => ({ ...s, selectedCircle: v }))}
                />
              )}
              <ErrorBanner message={state.submitError} />
              <Submitting visible={state.submitting} label={t('circle.wizard.audience.posting')} />
            </Body>
          </ScrollView>
          <Actions
            buttons={[
              { label: t('common.cancel'), onPress: onClose, kind: 'secondary', disabled: state.submitting },
              { label: t('circle.noticeboard.post'), onPress: onPost, kind: 'primary', disabled: !canSubmit(state) },
            ]}
          />
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
  subLabel: { fontSize: 12, color: '#555', fontWeight: '600', marginTop: 8 },
  distanceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  distanceCell: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
    backgroundColor: '#f0f0f0',
  },
  distanceCellActive: { backgroundColor: '#1e88e5' },
  distanceText: { fontSize: 12, fontWeight: '600', color: '#333' },
  distanceTextActive: { color: '#fff' },
});
