/**
 * basis-mobile v2 — the ENTRUST (toevertrouwen) picker: the RN twin of web's
 * `apps/basis/web/v2/mandatePicker.js`.
 *
 * A mandate is bounded authority the task owner entrusts to one member for one
 * task — TEMPORARY (lifts when the task closes) and BROKERED (keys stay with you;
 * only answers travel). This is a THIN RN projection (invariant #1): every pure
 * decision — the roster-minus-self, the WAARVOOR grant-kind taxonomy (incl. the
 * resource kind's honest "nog niet actief" state), the confirm gate/payload — comes
 * from the SHARED `apps/basis/src/v2/mandate.js`, the exact module the web picker
 * consumes. web ≡ mobile by construction; no grant logic lives here.
 *
 * onConfirm receives `{ taskId, member, grant }` and the launcher dispatches the
 * ALREADY-registered `attachTaskGrant` op through the mobile confirm/gate waist
 * (which shows the shared "weet je het zeker?" before any grant issues).
 *
 * @param {object} props
 * @param {boolean} props.visible
 * @param {Array}  [props.members=[]]        the circle roster ({webid,name,…})
 * @param {Array}  [props.offerings=[]]      MY offerings ({key,text}); [] → single "namens jou"
 * @param {string} [props.taskId]
 * @param {string} [props.myWebid]
 * @param {Array}  [props.existingGrants=[]] the task's source.taskGrants ({member,skill})
 * @param {boolean} [props.busy=false]
 * @param {string|null} [props.notice=null]
 * @param {(g:{taskId,member,grant})=>void} props.onConfirm
 * @param {()=>void} props.onCancel
 */
import React, { useMemo, useState, useEffect } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from './themeContext.js';
import { t } from '../../core/localisation.js';
import { useSheetCap, SHEET_SCROLL } from './sheetCap.js';
import {
  grantKindOptions,
  memberLabel,
  memberWebid,
  mandateRoster,
  mandateConfirmEnabled,
  mandateConfirmPayload,
  mandateLegibilityRows,
  RESOURCE_BROKERS,
  DEFAULT_RESOURCE_BROKER,
  RESOURCE_USE_MODES,
  DEFAULT_RESOURCE_USE,
  resourceUseRequiresConsent,
} from '../../../../basis/src/v2/mandate.js';

export default function CircleMandatePicker({
  visible,
  members = [],
  offerings = [],
  resources = [],
  taskId = null,
  myWebid = null,
  existingGrants = [],
  busy = false,
  notice = null,
  onConfirm,
  onCancel,
}) {
  const sheetCap = useSheetCap(0.85);   // the card's cap in window pixels (sheetCap.js)
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  // Selectable roster + the grouped WAARVOOR options — the SHARED pure projections.
  const roster = useMemo(() => mandateRoster({ members, myWebid }), [members, myWebid]);
  const whatGroups = useMemo(() => grantKindOptions({ offerings, resources, t }), [offerings, resources]);
  const legibility = useMemo(
    () => mandateLegibilityRows(existingGrants, { members, offerings, t }),
    [existingGrants, members, offerings],
  );
  const firstActive = useMemo(() => {
    for (const g of whatGroups) for (const o of g.rows) if (o.active) return o;
    return null;
  }, [whatGroups]);

  const [pickedMember, setPickedMember] = useState(null);
  const [pickedWhat, setPickedWhat] = useState(null);
  const [pickedBroker, setPickedBroker] = useState(DEFAULT_RESOURCE_BROKER);   // resource kind — broker posture (#29)
  const [pickedUse, setPickedUse] = useState(DEFAULT_RESOURCE_USE);            // resource kind — use-consent

  // Default the WAARVOOR to the first issuable option ("namens jou"), and reset the
  // selection each time the picker (re)opens for a task — parity with the web paint.
  useEffect(() => {
    if (visible) {
      setPickedMember(null); setPickedWhat(firstActive);
      setPickedBroker(DEFAULT_RESOURCE_BROKER); setPickedUse(DEFAULT_RESOURCE_USE);
    }
  }, [visible, taskId, firstActive]);

  const enabled = mandateConfirmEnabled({ busy, pickedMember, pickedWhat });
  // Broker/use settings show only for an issuable resource selection — keeps the
  // actAs/offering projection byte-identical.
  const showResourceSettings = pickedWhat?.kind === 'resource' && pickedWhat?.active;

  const confirm = () => {
    if (busy || typeof onConfirm !== 'function') return;
    const payload = mandateConfirmPayload({ taskId, myWebid, pickedMember, pickedWhat, pickedBroker, pickedUse });
    if (payload) onConfirm(payload);
  };

  return (
    <Modal transparent visible={!!visible} animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} testID="mandate-backdrop">
        {/* Inner Pressable swallows taps so the sheet doesn't dismiss. */}
        <Pressable style={[styles.sheet, sheetCap]} onPress={() => {}} testID="mandate-sheet">
          <View style={styles.header}>
            <Text style={styles.title}>{t('circle.mandate.heading')}</Text>
            <Pressable onPress={onCancel} hitSlop={8} testID="mandate-cancel">
              <Text style={styles.cancel}>{t('circle.mandate.cancel')}</Text>
            </Pressable>
          </View>
          <Text style={styles.sub}>{t('circle.mandate.intro')}</Text>

          {notice ? <Text style={styles.notice} testID="mandate-notice">{notice}</Text> : null}

          <ScrollView style={[styles.body, SHEET_SCROLL]} contentContainerStyle={styles.bodyContent}>
            {/* Existing mandates (legibility). */}
            {legibility.length > 0 ? (
              <View style={styles.legibility} testID="mandate-legibility">
                <Text style={styles.sectionLabel}>{t('circle.mandate.existing_heading')}</Text>
                {legibility.map((r) => (
                  <Text key={r.member} style={styles.legibilityRow} testID="mandate-legibility-item">
                    {t('circle.mandate.existing_row', { who: r.who, what: r.what })}
                  </Text>
                ))}
                <Text style={styles.legibilityNote}>{t('circle.mandate.existing_note')}</Text>
              </View>
            ) : null}

            {/* WHO — the roster minus myself. */}
            <Text style={styles.sectionLabel}>{t('circle.mandate.who_label')}</Text>
            {roster.length === 0 ? (
              <Text style={styles.empty}>{t('circle.mandate.who_empty')}</Text>
            ) : (
              roster.map((m) => {
                const w = memberWebid(m);
                const on = pickedMember === w;
                return (
                  <Pressable
                    key={w}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    testID={`mandate-who-${w}`}
                    style={[styles.option, on && styles.optionOn]}
                    onPress={() => setPickedMember(w)}
                  >
                    <Text style={styles.optionText}>{memberLabel(m)}</Text>
                  </Pressable>
                );
              })
            )}

            {/* WAARVOOR — the data-driven grant-kind taxonomy. */}
            <Text style={styles.sectionLabel}>{t('circle.mandate.what_label')}</Text>
            {whatGroups.map((group, gi) => (
              <View key={group.groupLabelKey ?? `g${gi}`}>
                {group.groupLabelKey ? <Text style={styles.groupLabel}>{t(group.groupLabelKey)}</Text> : null}
                {group.rows.map((opt) => {
                  const on = pickedWhat?.id === opt.id;
                  return (
                    <Pressable
                      key={opt.id}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      testID={`mandate-what-${opt.id}`}
                      style={[styles.option, on && styles.optionOn]}
                      onPress={() => setPickedWhat(opt)}
                    >
                      <Text style={styles.optionText}>{opt.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
            {/* Honest "nog niet actief" note for an inactive selected kind (resource). */}
            {pickedWhat && !pickedWhat.active && pickedWhat.note ? (
              <Text style={styles.whatNote} testID="mandate-what-note">{pickedWhat.note}</Text>
            ) : null}

            {/* Resource settings — broker posture (#29) + use-consent. Resource kind only. */}
            {showResourceSettings ? (
              <View testID="mandate-resource-settings">
                <Text style={styles.sectionLabel}>{t('circle.mandate.resource.broker_label')}</Text>
                <View style={styles.toggleRow}>
                  {RESOURCE_BROKERS.map((value) => {
                    const on = pickedBroker === value;
                    return (
                      <Pressable
                        key={value}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: on }}
                        testID={`mandate-broker-${value}`}
                        style={[styles.toggle, on && styles.optionOn]}
                        onPress={() => setPickedBroker(value)}
                      >
                        <Text style={styles.toggleText}>{t(`circle.mandate.resource.broker_${value}`)}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.sectionLabel}>{t('circle.mandate.resource.use_label')}</Text>
                <View style={styles.toggleRow}>
                  {RESOURCE_USE_MODES.map((value) => {
                    const on = pickedUse === value;
                    return (
                      <Pressable
                        key={value}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: on }}
                        testID={`mandate-use-${value}`}
                        style={[styles.toggle, on && styles.optionOn]}
                        onPress={() => setPickedUse(value)}
                      >
                        <Text style={styles.toggleText}>{t(`circle.mandate.resource.use_${value}`)}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.whatNote} testID="mandate-resource-hint">
                  {t(resourceUseRequiresConsent(pickedUse)
                    ? 'circle.mandate.resource.use_hint_requestable'
                    : 'circle.mandate.resource.use_hint_standing')}
                </Text>
              </View>
            ) : null}

            {/* The promise — temporary + brokered. */}
            <View style={styles.promise}>
              <Text style={styles.promiseLine}>{t('circle.mandate.temporary')}</Text>
              <Text style={styles.promiseLine}>{t('circle.mandate.brokered')}</Text>
            </View>
          </ScrollView>

          <Pressable
            testID="mandate-confirm"
            accessibilityRole="button"
            accessibilityState={{ disabled: !enabled }}
            disabled={!enabled}
            style={[styles.confirm, !enabled && styles.confirmDisabled]}
            onPress={confirm}
          >
            <Text style={styles.confirmText}>{t('circle.mandate.confirm')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  sheet:     { backgroundColor: theme.color.card, borderRadius: theme.radius?.lg ?? 12, padding: 18, width: '100%', maxWidth: 440 },
  header:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title:     { fontSize: 18, fontWeight: '600', color: theme.color.ink, flexShrink: 1 },
  cancel:    { color: theme.color.inkSoft, fontSize: 15 },
  sub:       { color: theme.color.inkSoft, fontSize: 13, marginTop: 4, marginBottom: 10 },
  notice:    { backgroundColor: theme.color.paper2, color: theme.color.ink, fontSize: 13, padding: 8, borderRadius: theme.radius?.sm ?? 8, marginBottom: 10 },
  body:      { flexGrow: 0 },
  bodyContent: { paddingBottom: 4 },
  sectionLabel: { fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: theme.color.inkSoft, marginTop: 12, marginBottom: 6 },
  groupLabel: { fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: theme.color.inkSoft, marginTop: 8, marginBottom: 6 },
  empty:     { color: theme.color.inkSoft, fontSize: 13, marginBottom: 8 },
  option:    { paddingVertical: 10, paddingHorizontal: 12, marginBottom: 6, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius?.sm ?? 8, backgroundColor: theme.color.paper },
  optionOn:  { borderColor: theme.color.accent, backgroundColor: theme.color.paper2 },
  optionText: { color: theme.color.ink, fontSize: 15 },
  whatNote:  { backgroundColor: theme.color.paper2, color: theme.color.inkSoft, fontSize: 13, lineHeight: 18, padding: 8, borderRadius: theme.radius?.sm ?? 8, marginTop: 2, marginBottom: 4 },
  toggleRow: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  toggle:    { flex: 1, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius?.sm ?? 8, backgroundColor: theme.color.paper, alignItems: 'center' },
  toggleText: { color: theme.color.ink, fontSize: 13 },
  legibility: { borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius?.sm ?? 8, padding: 10, marginBottom: 4, backgroundColor: theme.color.paper },
  legibilityRow: { color: theme.color.ink, fontSize: 14, marginBottom: 2 },
  legibilityNote: { color: theme.color.inkSoft, fontSize: 12, marginTop: 4 },
  promise:   { backgroundColor: theme.color.greenBg, borderRadius: theme.radius?.sm ?? 8, padding: 10, marginTop: 12 },
  promiseLine: { color: theme.color.ink, fontSize: 13, lineHeight: 18 },
  confirm:   { marginTop: 14, paddingVertical: 12, borderRadius: theme.radius?.md ?? 10, backgroundColor: theme.color.accent, alignItems: 'center' },
  confirmDisabled: { opacity: 0.5 },
  confirmText: { color: theme.color.accentContrast, fontWeight: '600', fontSize: 15 },
});
