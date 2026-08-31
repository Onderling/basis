/**
 * **Platform: RN**.  Mobile parity for
 * src/web/wizards/createGroupWizard.js.
 *
 * 5-step flow:
 *   1. Identity — name, groupId, purpose, tags
 *   2. Governance — additionalAdmins, accessPolicy, leavePolicy
 *   3. Rules — rulesText, conflictPolicy
 *   4. Tech — keyRotationMode, rotationDays, inviteExpiresInHours,
 *             storagePolicy, optional groupPodUri
 *   5. Review — read-only summary + create button
 *
 * Shares src/core/wizards/createGroupState.js with web.
 */
import React, { useState, useCallback, useMemo } from 'react';
import { Modal, View, ScrollView, StyleSheet, Pressable, Text } from 'react-native';

import {
  ACCESS_POLICIES, LEAVE_POLICIES, CONFLICT_POLICIES, STORAGE_POLICIES,
  KEY_ROTATION_MODES, STEP_NAMES,
  initialState, slugify, isValidSlug, labelOf,
  buildRulesObjectFromState, finalSubmit, encodeMembershipCodeUrl,
  newOfferingRow, OFFERING_AXES,
  // N1+E8 — kind picker + neighbourhood size/chat advice + policy patch.
  CIRCLE_KINDS, setKind, setSize, setStoragePolicy, setChatEnabled, chatAdvice, policyPatchFromState,
  // N3 — extra role templates (admin opt-in).
  ROLE_TEMPLATE_IDS, toggleRole,
} from '../../core/wizards/createGroupState.js';
import { RULES_QUESTIONS } from '../../v2/circleRules.js';
import { attachConsequences } from '../../v2/optionConsequences.js';
import { ROLE_TEMPLATES } from '../../v2/roleTemplates.js';
// B5 — web ≡ mobile: the same two imports the web wizard uses for the same field.
import { markAxisTouched } from '../../v2/circleTemplates.js';
import { INVITE_REDEMPTION_SYSTEM_CAP } from '@onderling-app/stoop/lib/inviteCeiling';

import {
  Steps, Body, Field, Textarea, RadioGroup, Checkbox,
  Actions, ErrorBanner, Submitting, ReviewList, Warn,
} from './_kit.js';
import { wizardPalette } from './_palette.js';

export default function CreateGroupWizardModal({
  visible, callSkill, onClose, onDispatched, t,
  // Optional: () => string|null — caller's peer address.  Embedded in
  // the invite URL so the joiner can peer-redeem when their substrate
  // has no local copy of the code (cross-device).
  getMyPeerAddr,
  // N1+E8 — optional (groupId, patch) => Promise persister; writes the
  // wizard's chosen policy (incl. neighbourhood chat-off) onto the new circle.
  persistPolicy,
  // The host's theme (optional) — the sheet and its kit follow it; absent ⇒ the previous light values.
  theme,
}) {
  const styles = useMemo(() => sheetStyles(theme), [theme]);
  const [state, setState] = useState(() => initialState());
  const setStep = useCallback((n) => setState((s) => ({ ...s, step: n })), []);
  const updateName = useCallback((name) => {
    setState((s) => ({
      ...s,
      name,
      // auto-slugify if the user hasn't manually edited groupId yet
      groupId: s.groupId === '' || s.groupId === slugify(s.name) ? slugify(name) : s.groupId,
    }));
  }, []);

  const onCreate = useCallback(async () => {
    let next = { ...state, submitting: true, submitError: null };
    setState(next);
    const { result, state: after } = await finalSubmit({ state: next, callSkill });
    setState({ ...after, successResult: result ?? null });
    // N1+E8 — persist the chosen policy (features incl. neighbourhood chat-off,
    // reveal/pod/llm/agents/consensus) so the new circle opens with the
    // right surfaces.  Best-effort; creation already succeeded.
    if (result && typeof persistPolicy === 'function') {
      try { await persistPolicy(result.groupId, policyPatchFromState(after)); }
      catch { /* policy write is best-effort */ }
    }
    if (result && typeof onDispatched === 'function') {
      // 2026-05-27 (Bundle I).  Surface the invite URL + a scannable QR
      // so the admin can share the circle right away — the web wizard's
      // success-screen path, ported to mobile.  Build the same
      // onderling-invite:// URL the web emits + send it back as a
      // `record`-shape reply; ChatScreen's record-bubble auto-renders
      // a QR for QR-prefixed field values.
      const adminPeerAddr = (typeof getMyPeerAddr === 'function') ? (getMyPeerAddr() ?? null) : null;
      const rules    = buildRulesObjectFromState(after);
      const enriched = { ...result, adminPeerAddr, rules };
      const inviteUrl = encodeMembershipCodeUrl(enriched);

      try {
        onDispatched({
          ok: true,
          kind: 'record',
          title: (typeof t === 'function')
            ? t('chat.circle_created', { name: after.name })
            : `✓ Circle "${after.name}" created.`,
          payload: {
            inviteUrl,
            groupId:   enriched.groupId,
            code:      enriched.code,
            expiresAt: enriched.expiresAt,
          },
          followUps: [
            '/share-my-contact',
            `/post "Welkom in ${after.name}!"`,
            '/group-members',
          ],
          // Keep the legacy `message` + raw result for backwards-compat
          // (web wizard's onDispatched still consumes the text path).
          message: (typeof t === 'function')
            ? t('chat.circle_created', { name: after.name })
            : `✓ Circle "${after.name}" created.`,
          ...enriched,
        });
      } catch {}
    }
    if (result) onClose?.();
  }, [state, callSkill, onDispatched, onClose, persistPolicy]);

  const canAdvance1 = state.name.trim().length > 0 && isValidSlug(state.groupId);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={styles.sheet}
          onPress={(e) => e.stopPropagation()}
          testID="create-group-wizard"
        >
          <Steps labels={STEP_NAMES} current={state.step} />
          <ScrollView style={styles.scroll}>
            {state.step === 1 && (
              <Body title={t('circle.wizard.create.step_identity')} intro="A circle is a self-governing circle group.">
                {/* N1+E8 — kind picker.  Applies the matching template
                    (β.4) in place; for a neighbourhood it also surfaces the size
                    question + chat advice (noticeboard-first, chat off). */}
                <RadioGroup
                  label={t('circle.kindPicker')}
                  value={state.kind ?? null}
                  options={attachConsequences('kind',
                    CIRCLE_KINDS.map((k) => ({ id: k, label: t(`circle.kind.${k}`) })), t)}
                  onChange={(k) => setState((s) => setKind(s, k))}
                  consequenceLabel={t('common.consequences')}
                />
                {state.kind === 'neighbourhood' && (
                  <>
                    <RadioGroup
                      label={t('circle.size.label')}
                      value={state.size ?? null}
                      options={attachConsequences('size', [
                        { id: 'small', label: t('circle.size.small') },
                        { id: 'large', label: t('circle.size.large') },
                      ], t)}
                      onChange={(sz) => setState((s) => setSize(s, sz))}
                      consequenceLabel={t('common.consequences')}
                    />
                    {chatAdvice(state).reasonKey ? (
                      <Warn>{t(chatAdvice(state).reasonKey)}</Warn>
                    ) : null}
                    <Checkbox
                      label={t('circle.chatToggle')}
                      checked={!!state.features?.chat}
                      onToggle={() => setState((s) => setChatEnabled(s, !s.features?.chat))}
                      testID="create-group-chat-toggle"
                    />
                  </>
                )}
                <Field
                  label="Name"
                  value={state.name}
                  onChangeText={updateName}
                  placeholder="e.g. Onze Circle"
                />
                <Field
                  label="Circle id (lowercase, digits, _ or -; 3-30 chars)"
                  value={state.groupId}
                  onChangeText={(v) => setState((s) => ({ ...s, groupId: v }))}
                  placeholder="auto-derived from name"
                  monospace
                />
                <Field
                  label="Purpose (optional)"
                  value={state.purpose}
                  onChangeText={(v) => setState((s) => ({ ...s, purpose: v }))}
                  placeholder="one-line description"
                />
                <Field
                  label="Tags (optional, comma-separated)"
                  value={state.tags}
                  onChangeText={(v) => setState((s) => ({ ...s, tags: v }))}
                  placeholder="quiet, sustainable, tools"
                />
              </Body>
            )}
            {state.step === 2 && (
              <Body title={t('circle.wizard.create.step_members')} intro="Who can join, who can leave, and how.">
                <Field
                  label="Additional admin WebIDs (optional, comma-separated)"
                  value={state.additionalAdmins}
                  onChangeText={(v) => setState((s) => ({ ...s, additionalAdmins: v }))}
                  placeholder="https://alice.example/profile/card#me"
                />
                <RadioGroup
                  label="Access policy"
                  value={state.accessPolicy}
                  options={attachConsequences('accessPolicy', ACCESS_POLICIES, t)}
                  onChange={(v) => setState((s) => ({ ...s, accessPolicy: v }))}
                  consequenceLabel={t('common.consequences')}
                />
                <RadioGroup
                  label="Leave policy"
                  value={state.leavePolicy}
                  options={attachConsequences('leavePolicy', LEAVE_POLICIES, t)}
                  onChange={(v) => setState((s) => ({ ...s, leavePolicy: v }))}
                  consequenceLabel={t('common.consequences')}
                />
                {/* N3 — extra role templates (admin opt-in). */}
                <Text style={styles.roleHeading}>{t('role.extraRolesLabel')}</Text>
                <Text style={styles.roleHint}>{t('role.extraRolesHint')}</Text>
                {ROLE_TEMPLATE_IDS.map((tid) => {
                  const tpl = ROLE_TEMPLATES[tid];
                  const checked = Array.isArray(state.extraRoles) && state.extraRoles.includes(tid);
                  return (
                    <View key={tid}>
                      <Checkbox
                        label={t(tpl.labelKey)}
                        checked={checked}
                        onToggle={() => setState((s) => toggleRole(s, tid))}
                        testID={`create-group-role-${tid}`}
                      />
                      <Text style={styles.roleDesc}>{t(tpl.descKey)}</Text>
                    </View>
                  );
                })}
              </Body>
            )}
            {state.step === 3 && (
              <Body title={t('circle.wizard.create.step_rules')} intro="House rules and how to resolve conflicts.">
                {/* 5.5a — structured v2 rules doc.  Step 1 captured `purpose`
                    already, so we ask the other five questions here.  Question
                    text comes from the same locale block the consent screen uses. */}
                {RULES_QUESTIONS.filter((q) => q.key !== 'purpose').map((q) => (
                  <Textarea
                    key={q.key}
                    label={(typeof t === 'function'
                      ? t(`circle.rules.q.${q.key}`)
                      : q.key) + (q.required ? ' *' : '')}
                    value={state.rulesDoc[q.key] ?? ''}
                    onChangeText={(v) => setState((s) => ({
                      ...s,
                      rulesDoc: { ...s.rulesDoc, [q.key]: v },
                    }))}
                    rows={3}
                  />
                ))}
                <RadioGroup
                  label="Conflict policy"
                  value={state.conflictPolicy}
                  options={attachConsequences('conflictPolicy', CONFLICT_POLICIES, t)}
                  onChange={(v) => setState((s) => ({ ...s, conflictPolicy: v }))}
                  consequenceLabel={t('common.consequences')}
                />
              </Body>
            )}
            {/* 5.5c — Offerings step (slotted between Rules and Tech). */}
            {state.step === 4 && (
              <Body title={t('circle.wizard.create.step_offerings')} intro="What members can do / offer in this circle.  Each offering is named + has four axes.">
                {state.offerings.map((row, i) => (
                  <View key={i} style={{ borderWidth: 1, borderColor: '#d8d1bc', borderRadius: 6, padding: 10, marginBottom: 10 }}>
                    <Field
                      label="Offering name"
                      value={row.name}
                      onChangeText={(v) => setState((s) => {
                        const offerings = s.offerings.slice();
                        offerings[i] = { ...offerings[i], name: v };
                        return { ...s, offerings };
                      })}
                      placeholder="e.g. plumbing"
                    />
                    {Object.keys(OFFERING_AXES).map((axis) => (
                      <RadioGroup
                        key={axis}
                        label={axis}
                        value={row[axis]}
                        options={attachConsequences(axis,
                          OFFERING_AXES[axis].map((id) => ({ id, label: id })), t)}
                        onChange={(v) => setState((s) => {
                          const offerings = s.offerings.slice();
                          offerings[i] = { ...offerings[i], [axis]: v };
                          return { ...s, offerings };
                        })}
                        consequenceLabel={t('common.consequences')}
                      />
                    ))}
                    <Pressable
                      onPress={() => setState((s) => ({ ...s, offerings: s.offerings.filter((_, j) => j !== i) }))}
                    >
                      <Text style={{ color: '#b04a30', marginTop: 4 }}>{t('circle.wizard.create.offering_remove_row')}</Text>
                    </Pressable>
                  </View>
                ))}
                <Pressable
                  onPress={() => setState((s) => ({ ...s, offerings: [...s.offerings, newOfferingRow()] }))}
                >
                  <Text style={{ color: '#b04a30' }}>+ Add offering</Text>
                </Pressable>
              </Body>
            )}
            {state.step === 5 && (
              <Body title={t('circle.wizard.create.step_tech')} intro="Cryptography + storage knobs. Defaults are sane.">
                <RadioGroup
                  label="Key rotation mode"
                  value={state.keyRotationMode}
                  options={KEY_ROTATION_MODES}
                  onChange={(v) => setState((s) => ({ ...s, keyRotationMode: v }))}
                />
                <Field
                  label="Rotation interval (days)"
                  value={String(state.rotationDays)}
                  onChangeText={(v) => setState((s) => ({ ...s, rotationDays: Number(v) || 30 }))}
                  placeholder="30"
                />
                <Field
                  label="Invite expiry (hours)"
                  value={String(state.inviteExpiresInHours)}
                  onChangeText={(v) => setState((s) => ({ ...s, inviteExpiresInHours: Number(v) || 1 }))}
                  placeholder="1"
                />
                {/* B5 — the invite CEILING (web ≡ mobile). Same clamp, same locale keys, same
                    `touchedAxes` bookkeeping, so a kind switch respects an explicit choice here
                    exactly as it does on web. */}
                <Field
                  label={t('circle.invite.ceiling_label')}
                  value={String(state.inviteMaxRedemptions)}
                  onChangeText={(v) => setState((s) => markAxisTouched({
                    ...s,
                    inviteMaxRedemptions: Math.max(1, Math.min(INVITE_REDEMPTION_SYSTEM_CAP, Number(v) || 1)),
                  }, 'inviteMaxRedemptions'))}
                  placeholder="1"
                  hint={t('circle.invite.ceiling_hint')}
                />
                <RadioGroup
                  label="Storage policy"
                  value={state.storagePolicy}
                  options={attachConsequences('storagePolicy', STORAGE_POLICIES, t)}
                  onChange={(v) => setState((s) => setStoragePolicy(s, v))}
                  consequenceLabel={t('common.consequences')}
                />
                {(state.storagePolicy === 'shared' || state.storagePolicy === 'hybrid') && (
                  <>
                    <Field
                      label="Group pod URI"
                      value={state.groupPodUri}
                      onChangeText={(v) => setState((s) => ({ ...s, groupPodUri: v }))}
                      placeholder="https://group.example/pod/"
                      monospace
                    />
                    {/* J-NP3, the CREATE half — web had this and mobile did not (found 2026-07-30).
                        Choosing a shared pod means its host can see the membership, and the fact belongs
                        next to the choice that causes it: a creator deciding here should not meet it
                        later in a settings screen, and they are deciding on behalf of everyone who
                        joins. The join side already says it; parity matters most for a disclosure. */}
                    <Text style={styles.podDisclosure} testID="create-pod-host-disclosure">
                      {t('circle.nearbyScreen.point_pod_host_sees')}
                    </Text>
                  </>
                )}
              </Body>
            )}
            {state.step === 6 && (() => {
              const rules = buildRulesObjectFromState(state);
              return (
                <Body title="Review" intro="Confirm the settings, then create the circle.">
                  <ReviewList items={[
                    { label: 'Name',        value: state.name },
                    { label: 'Circle id',    value: state.groupId, monospace: true },
                    ...(rules.purpose      ? [{ label: 'Purpose',    value: rules.purpose }]      : []),
                    ...(rules.tags         ? [{ label: 'Tags',       value: rules.tags.join(', ') }] : []),
                    ...(rules.additionalAdmins ? [{ label: 'Extra admins', value: rules.additionalAdmins.join(', ') }] : []),
                    { label: 'Access',      value: labelOf(ACCESS_POLICIES, state.accessPolicy) },
                    { label: 'Leave',       value: labelOf(LEAVE_POLICIES,  state.leavePolicy)  },
                    // 5.5a — surface each non-empty rules-doc field.
                    ...RULES_QUESTIONS.filter((q) => q.key !== 'purpose').flatMap((q) => {
                      const v = rules[q.key];
                      if (!v) return [];
                      const label = (typeof t === 'function')
                        ? t(`circle.rules.q.${q.key}`) : q.key;
                      return [{ label, value: v, pre: true }];
                    }),
                    { label: 'Conflict',    value: labelOf(CONFLICT_POLICIES, state.conflictPolicy) },
                    // 5.5c — surface named offerings (axes inline). Read-accept
                    // the legacy `rules.skills` field on an un-migrated rules blob.
                    ...((rules.offerings ?? rules.skills ?? []).length > 0
                      ? [{ label: 'Offerings',
                          value: (rules.offerings ?? rules.skills).map((s) => `${s.name} — ${s.openness}/${s.posture}/${s.status}/${s.radius}`).join('\n'),
                          pre: true }]
                      : []),
                    { label: 'Key rotation',value: labelOf(KEY_ROTATION_MODES, state.keyRotationMode) },
                    { label: 'Rotation interval (days)', value: String(state.rotationDays) },
                    { label: 'Invite expiry (hours)',    value: String(state.inviteExpiresInHours) },
                    { label: t('circle.invite.ceiling_review'), value: String(state.inviteMaxRedemptions) },
                    { label: 'Storage',     value: labelOf(STORAGE_POLICIES, state.storagePolicy) },
                    ...(state.groupPodUri  ? [{ label: 'Group pod', value: state.groupPodUri, monospace: true }] : []),
                  ]} />
                  <ErrorBanner message={state.submitError} />
                  <Submitting visible={state.submitting} label="Creating circle…" />
                </Body>
              );
            })()}
          </ScrollView>
          <Actions buttons={(() => {
            if (state.step === 1) return [
              { label: t('common.cancel'), onPress: onClose, kind: 'secondary' },
              { label: t('common.next'),   onPress: () => setStep(2), kind: 'primary', disabled: !canAdvance1 },
            ];
            // 5.5c — six-step wizard.  Steps 2-5 share Back/Next; step 6 is Review.
            if (state.step < STEP_NAMES.length) return [
              { label: t('common.back'),   onPress: () => setStep(state.step - 1), kind: 'secondary' },
              { label: t('common.cancel'), onPress: onClose, kind: 'secondary' },
              { label: t('common.next'),   onPress: () => setStep(state.step + 1), kind: 'primary' },
            ];
            return [
              { label: t('common.back'),   onPress: () => setStep(STEP_NAMES.length - 1), kind: 'secondary', disabled: state.submitting },
              { label: t('common.cancel'), onPress: onClose, kind: 'secondary', disabled: state.submitting },
              { label: 'Create circle',     onPress: onCreate, kind: 'primary', disabled: state.submitting },
            ];
          })()} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * The sheet follows the host's theme the way the join wizard's does (one palette, `wizardPalette`): a
 * module-level light StyleSheet here painted the create sheet WHITE on a dark app (W26, 2026-08-29).
 * Absent theme ⇒ the previous light values.
 */
function sheetStyles(theme) {
  const p = wizardPalette(theme);
  return StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: p.card ?? '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16,
    maxHeight: '92%', minHeight: '60%',
  },
  scroll: { flexGrow: 1 },
  // N3 — extra-roles section.
  roleHeading: { fontSize: 13, fontWeight: '700', color: '#444', marginTop: 14, marginBottom: 2 },
  roleHint:    { fontSize: 12, lineHeight: 17, color: '#777', marginBottom: 6 },
  roleDesc:    { fontSize: 12, lineHeight: 17, color: '#666', marginLeft: 28, marginBottom: 8 },
  // J-NP3 — the pod-host disclosure sits under the pod field. Same weight as the other hints: a
  // disclosure that shouts reads as a warning against a normal choice, and one that whispers is not a
  // disclosure. It matches `roleHint` deliberately.
  podDisclosure: { fontSize: 12, lineHeight: 17, color: '#777', marginTop: 6, marginBottom: 6 },
});
}
