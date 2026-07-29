/**
 * **Platform: RN**.  Mobile parity for
 * src/web/wizards/joinGroupWizard.js.
 *
 * 3-step flow:
 *   1. Rules — fetched from the invite or via stoop.getGroupRules
 *   2. Privacy — acknowledge + mesh-consent toggle
 *   3. Handle — pick a buurt handle with suggestions
 *
 * Shares src/core/wizards/joinGroupState.js with web.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Modal, View, ScrollView, StyleSheet, Pressable, Text } from 'react-native';

import {
  initialState, decodeInvite, fetchGroupRules,
  handleSuggestions, isValidHandle,
  finalSubmit, loadPersonas, setPersona,
  prepareJoinIdentity, setLinkChoice,
  setJoinReveal, REVEAL_PRESETS,
} from '../../core/wizards/joinGroupState.js';
import { RULES_FIELDS } from '../../v2/circleRules.js';

import {
  Steps, Body, Field, Checkbox, Chips, RadioGroup, Actions, ErrorBanner, Submitting,
} from './_kit.js';

export default function JoinGroupWizardModal({
  visible, args, callSkill, onClose, onDispatched, t, sendPeerRedeem,
  circles, circleAddressFor, signCircleLink,
  // J-CP1 — the host's seam for connecting to the endpoint the invite names, before the redeem.
  dialEndpoint, activeEndpointUrl,
}) {
  const [state, setState] = useState(() => {
    const s = initialState();
    decodeInvite(args?.invite ?? args?.id ?? args, s);
    return s;
  });

  useEffect(() => {
    let active = true;
    if (state.inviteParseError || !state.invite) return;
    (async () => {
      const next = { ...state };
      await fetchGroupRules({ state: next, callSkill });
      // Property layer — populate the join-with-persona options for the step-3
      // picker. Failure is silent (empty → picker offers only "join minimally").
      next.personas = await loadPersonas({ callSkill });
      // #4 — load the existing-selves list for the "continue as an existing self" key choice.
      try { await prepareJoinIdentity({ state: next, callSkill, circles }); } catch { /* safe defaults */ }
      if (active) setState(next);
    })();
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setStep = useCallback((n) => setState((s) => ({ ...s, step: n })), []);

  const onJoin = useCallback(async () => {
    let next = { ...state, submitting: true, submitError: null };
    setState(next);
    const { result, state: after } = await finalSubmit({
      state: next, callSkill, sendPeerRedeem, circleAddressFor, signCircleLink, dialEndpoint, activeEndpointUrl,
    });
    setState({ ...after });
    if (result && typeof onDispatched === 'function') {
      // `invite` = the DECODED invite alongside the redeem result, so the host can apply rule 1
      // (record the circle's pod/relay connection points from what the invite carried) — web's wizard
      // host reads its own decoded closure; the RN host gets it here. Additive to the reply shape.
      try { onDispatched({ ok: true, ...result, invite: state.invite }); } catch {}
    }
    if (result) onClose?.();
  }, [state, callSkill, onDispatched, onClose, sendPeerRedeem]);

  if (state.inviteParseError) {
    return (
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}
                     testID="join-group-wizard">
            <ScrollView style={styles.scroll}>
              <Body title={t('circle.join.wizard.invite_error')} intro={state.inviteParseError} />
            </ScrollView>
            <Actions buttons={[{ label: t('circle.join.wizard.close'), onPress: onClose, kind: 'primary' }]} />
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  const suggestions = handleSuggestions(/* TODO: pull from agent.profile if available */ '');

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={styles.sheet}
          onPress={(e) => e.stopPropagation()}
          testID="join-group-wizard"
        >
          <Steps labels={[t('circle.join.wizard.steps.rules'), t('circle.join.wizard.steps.privacy'), t('circle.join.wizard.steps.handle')]} current={state.step} />
          <ScrollView style={styles.scroll}>
            {state.step === 1 && (
              <Body
                title={t('circle.join.wizard.rules.title', { circle: state.invite?.groupId ?? '' })}
                intro={t('circle.join.wizard.rules.intro')}
              >
                {/* NKN+pod circle (J-NP3) — the pod-host disclosure BEFORE redeeming, mirroring web:
                    the creator accepting it on the joiner's behalf is the pattern the disclosure model
                    exists to prevent. Absent on older / non-pod invites. */}
                {state.invite?.podBacked === true ? (
                  <Text style={styles.loading}>{t('circle.nearbyScreen.point_pod_host_sees')}</Text>
                ) : null}
                {/* 5.5b — structured v2 doc when the invite carries it, with the
                    question/answer shape the create-wizard authored.  Older
                    invites (rulesText only) and the loading / error states fall
                    back to the legacy single-blob rendering. */}
                {state.rulesDoc ? (
                  <View style={styles.rulesBlock}>
                    {RULES_FIELDS.map((key) => {
                      const v = state.rulesDoc[key];
                      if (!v || !String(v).trim()) return null;
                      const label = (typeof t === 'function')
                        ? t(`circle.rules.q.${key}.text`) : key;
                      return (
                        <View key={key} style={{ marginBottom: 8 }}>
                          <Text style={{ fontWeight: '600', marginBottom: 2 }}>{label}</Text>
                          <Text style={styles.rulesText}>{v}</Text>
                        </View>
                      );
                    })}
                  </View>
                ) : state.rulesText ? (
                  <View style={styles.rulesBlock}>
                    <Text style={styles.rulesText}>{state.rulesText}</Text>
                  </View>
                ) : state.rulesError ? (
                  <ErrorBanner message={t('circle.join.wizard.rules.load_error', { error: state.rulesError })} />
                ) : (
                  <Text style={styles.loading}>{t('circle.join.wizard.rules.loading')}</Text>
                )}
                <Checkbox
                  label={t('circle.join.wizard.rules.accept')}
                  checked={state.rulesAccepted}
                  onToggle={(v) => setState((s) => ({ ...s, rulesAccepted: v }))}
                />
              </Body>
            )}
            {state.step === 2 && (
              <Body title={t('circle.join.wizard.privacy.title')} intro={t('circle.join.wizard.privacy.notice')}>
                <Checkbox
                  label={t('circle.join.wizard.privacy.accept')}
                  checked={state.privacyAccepted}
                  onToggle={(v) => setState((s) => ({ ...s, privacyAccepted: v }))}
                />
                <Checkbox
                  label={t('circle.join.wizard.privacy.mesh')}
                  checked={state.shareAddress}
                  onToggle={(v) => setState((s) => ({ ...s, shareAddress: v }))}
                />
              </Body>
            )}
            {state.step === 3 && (
              <Body
                title={t('circle.join.wizard.handle.title')}
                intro={t('circle.join.wizard.handle.intro')}
              >
                <Field
                  label={t('circle.join.wizard.handle.label')}
                  value={state.handle}
                  onChangeText={(v) => setState((s) => ({ ...s, handle: v }))}
                  placeholder={t('circle.join.wizard.handle.placeholder')}
                  monospace
                />
                <Text style={styles.subLabel}>{t('circle.join.wizard.handle.suggestions')}</Text>
                <Chips
                  items={suggestions}
                  onPress={(v) => setState((s) => ({ ...s, handle: v }))}
                />
                {/* Property layer — join-with-persona. Pick a persona whose
                    per-circle disclosure applies here, or join minimally (the
                    protective default: share no background). Nothing is shared
                    on a first join regardless — this is the identity you enter
                    the circle as; adjust its sharing later in "About me". */}
                {Array.isArray(state.personas) && state.personas.length ? (
                  <RadioGroup
                    label={t('circle.join.wizard.persona.label')}
                    value={state.persona ?? ''}
                    onChange={(id) => setState((s) => setPersona({ ...s }, id))}
                    options={[
                      { id: '', label: t('circle.join.wizard.persona.minimal') },
                      ...state.personas.map((p) => ({
                        id: p.id,
                        label: p.id === 'default' ? t('circle.join.wizard.persona.default_suffix', { name: p.name }) : p.name,
                      })),
                    ]}
                  />
                ) : null}
                {/* Reveal level (§1.6) — how much of your persona this circle sees. You pick it
                    (default = your resolved usual level, else the fallback); adjustable down to
                    handle. Makes the join release VISIBLE + yours to set, not a silent default. */}
                <RadioGroup
                  label={t('circle.join.wizard.reveal.label')}
                  value={state.revealPreset || 'profile'}
                  onChange={(lvl) => setState((s) => setJoinReveal({ ...s }, lvl))}
                  options={REVEAL_PRESETS.map((lvl) => ({ id: lvl, label: t(`circle.reveal.preset.${lvl}`) }))}
                />
                {/* #4 — continue as an existing self? Default FRESH (unlinkable); choosing an
                    existing self presents that circle's key + a signing proof (provably the
                    same person to anyone in both circles). Shown only when you're in others. */}
                {Array.isArray(state.existingSelves) && state.existingSelves.length ? (
                  <RadioGroup
                    label={t('circle.join.wizard.link.label')}
                    value={state.linkChoice || 'fresh'}
                    onChange={(cid) => setState((s) => setLinkChoice({ ...s }, cid))}
                    options={[
                      { id: 'fresh', label: t('circle.join.wizard.link.fresh') },
                      ...state.existingSelves.map((self) => ({
                        id: self.circleId,
                        label: t('circle.join.wizard.link.same_person', { name: self.name }),
                      })),
                    ]}
                  />
                ) : null}
                {/* A typed failure carries a locale KEY; an untyped one a raw substrate string. Rendering
                    only the second meant the two failures that bothered to type themselves — the admin
                    being offline, and a handle already taken — showed nothing at all (J-NP2, 2026-07-30). */}
                <ErrorBanner message={state.submitErrorKey ? t(state.submitErrorKey) : state.submitError} />
                <Submitting visible={state.submitting} label={t('circle.join.wizard.submitting')} />
              </Body>
            )}
          </ScrollView>
          <Actions buttons={(() => {
            if (state.step === 1) return [
              { label: t('circle.join.wizard.cancel'), onPress: onClose, kind: 'secondary' },
              { label: t('circle.join.wizard.next'),   onPress: () => setStep(2), kind: 'primary',
                disabled: !state.rulesAccepted || !state.rulesText },
            ];
            if (state.step === 2) return [
              { label: t('circle.join.wizard.back'),   onPress: () => setStep(1), kind: 'secondary' },
              { label: t('circle.join.wizard.cancel'), onPress: onClose, kind: 'secondary' },
              { label: t('circle.join.wizard.next'),   onPress: () => setStep(3), kind: 'primary',
                disabled: !state.privacyAccepted },
            ];
            return [
              { label: t('circle.join.wizard.back'),   onPress: () => setStep(2), kind: 'secondary', disabled: state.submitting },
              { label: t('circle.join.wizard.cancel'), onPress: onClose, kind: 'secondary', disabled: state.submitting },
              { label: t('circle.join.wizard.join'),   onPress: onJoin, kind: 'primary',
                disabled: !isValidHandle(state.handle) || state.submitting },
            ];
          })()} />
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
  rulesBlock: { padding: 10, backgroundColor: '#f7f7f7', borderRadius: 8 },
  rulesText: { fontSize: 13, color: '#222', lineHeight: 18 },
  loading: { fontSize: 13, color: '#666', fontStyle: 'italic' },
  subLabel: { fontSize: 12, color: '#555', fontWeight: '600', marginTop: 8 },
});
