/**
 * EnrollDeviceModal — the add-a-device ceremony on mobile, painted as its declared flow (web
 * parity: circleApp's showEnrollDeviceFlow). The phrase is typed on THIS — the NEW — device; one
 * pause (the secret-kind phrase + an optional device label), then the ceremony op restores the
 * owner root and writes this install's delegation. The runner never persists the phrase. After
 * success the app must restart — boot then finishes the ceremony (derivation cutover, registry
 * record, reopen, re-announce).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet, Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QrCodeView } from '@onderling/react-native/qr/view';
import { createFlowRunner, renderFlow } from '@onderling/app-manifest';
import { householdManifest } from '../../../../household/manifest.js';
import { stashEnrollOffer } from '../../../../basis/src/v2/enrollOffer.js';
import { useTheme } from './themeContext.js';
import { t } from '../../core/localisation.js';

const FLOW = householdManifest.flows.find((f) => f.id === 'enroll-device');
const OPS = new Map(householdManifest.operations.map((o) => [o.id, o]));

export default function EnrollDeviceModal({ visible, callSkill, onClose }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [inst, setInst] = useState(null);
  const [drafts, setDrafts] = useState({});
  // The add-device offer (`onderling-enroll://`): the paste half (this = the NEW device) + the
  // show half (this = the EXISTING device). Public data — relay hint + per-circle addresses;
  // the phrase never rides it.
  const [offerDraft, setOfferDraft] = useState('');
  const [offerInvalid, setOfferInvalid] = useState(false);
  const [offerView, setOfferView] = useState(null);   // null | {uri} | {error}
  const runnerRef = useRef(null);

  useEffect(() => {
    if (!visible || typeof callSkill !== 'function') return;
    const runner = createFlowRunner({ ops: OPS, callSkill: (opId, args) => callSkill('household', opId, args) });
    runnerRef.current = runner;
    let alive = true;
    runner.start(FLOW, {})
      .then((r) => { if (alive) { setInst(r); setDrafts({}); } })
      .catch(() => { if (alive) onClose?.(); });
    return () => { alive = false; runnerRef.current = null; };
  }, [visible, callSkill]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;
  const view = inst ? renderFlow(FLOW, inst, { ops: OPS }) : null;
  const outcome = inst?.steps?.ceremony?.outcome;

  const submit = async () => {
    const runner = runnerRef.current;
    if (!runner || !inst) return;
    // A pasted offer must parse before the ceremony proceeds — a person who pasted one MEANT to
    // use it, and a silent drop would strand the new device unreachable. Empty = fine.
    setOfferInvalid(false);
    const pasted = offerDraft.trim();
    if (pasted) {
      const stashed = await stashEnrollOffer(AsyncStorage, pasted).catch(() => ({ ok: false }));
      if (!stashed.ok) { setOfferInvalid(true); return; }
    }
    runner.resume(FLOW, inst, { input: drafts })
      .then((r) => setInst(r))
      .catch(() => { setInst(null); onClose?.(); });
  };
  const showOffer = () => {
    Promise.resolve(callSkill('household', 'buildEnrollOffer', {}))
      .then((r) => setOfferView(r?.ok && r.uri ? { uri: r.uri } : { error: true }))
      .catch(() => setOfferView({ error: true }));
  };
  const finish = () => { setInst(null); setOfferView(null); setOfferDraft(''); onClose?.(); };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={finish}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{offerView ? t('circle.enroll.offer_title') : t('circle.enroll.title')}</Text>
          {offerView ? (
            <View>
              {offerView.error ? (
                <Text style={styles.body}>{t('circle.enroll.offer_error')}</Text>
              ) : (
                <View>
                  <Text style={styles.body}>{t('circle.enroll.offer_hint')}</Text>
                  <View style={styles.qrBox} testID="enroll-offer-qr">
                    <QrCodeView value={offerView.uri} size={220} />
                  </View>
                  <Text style={styles.offerUri} selectable numberOfLines={3}>{offerView.uri}</Text>
                </View>
              )}
              <View style={styles.row}>
                {!offerView.error ? (
                  <Pressable
                    style={styles.button}
                    onPress={() => { Share.share({ message: offerView.uri }).catch(() => {}); }}
                    testID="enroll-offer-share"
                  >
                    <Text style={styles.buttonText}>{t('circle.enroll.offer_share')}</Text>
                  </Pressable>
                ) : null}
                <Pressable style={styles.cancel} onPress={() => setOfferView(null)} testID="enroll-offer-back">
                  <Text style={styles.cancelText}>{t('circle.enroll.offer_back')}</Text>
                </Pressable>
              </View>
            </View>
          ) : view?.status === 'awaiting-input' && view.form ? (
            <View>
              <Text style={styles.body}>{t('circle.enroll.body')}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('circle.enroll.offer_paste_label')}
                placeholderTextColor={theme.color.inkSoft}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                value={offerDraft}
                onChangeText={(v) => { setOfferDraft(v); setOfferInvalid(false); }}
                testID="enroll-offer-paste"
              />
              {offerInvalid ? <Text style={styles.offerErr}>{t('circle.enroll.offer_paste_invalid')}</Text> : null}
              {view.form.params.map((param) => (
                <TextInput
                  key={param.name}
                  style={[styles.input, param.kind === 'secret' && styles.secret]}
                  placeholder={t(`circle.enroll.${param.name}_placeholder`, { defaultValue: param.name })}
                  placeholderTextColor={theme.color.inkSoft}
                  multiline={param.kind === 'secret'}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  value={drafts[param.name] ?? ''}
                  onChangeText={(v) => setDrafts((d) => ({ ...d, [param.name]: v }))}
                  testID={`enroll-${param.name}`}
                />
              ))}
              <View style={styles.row}>
                <Pressable style={styles.button} onPress={submit} testID="enroll-submit">
                  <Text style={styles.buttonText}>{t('circle.enroll.submit')}</Text>
                </Pressable>
                <Pressable style={styles.cancel} onPress={() => { runnerRef.current?.cancel(inst); finish(); }}>
                  <Text style={styles.cancelText}>{t('circle.confirm.cancel', { defaultValue: 'Annuleren' })}</Text>
                </Pressable>
              </View>
              <Pressable style={styles.offerToggle} onPress={showOffer} testID="enroll-offer-show">
                <Text style={styles.cancelText}>{t('circle.enroll.offer_toggle')}</Text>
              </Pressable>
            </View>
          ) : view ? (
            <View>
              <Text style={styles.body}>
                {outcome === 'ok' && inst?.produces?.reloadRequired
                  ? t('circle.enroll.done_reload')
                  : outcome === 'invalid-phrase'
                    ? t('circle.enroll.invalid_phrase')
                    : (inst?.steps?.ceremony?.out?.error ?? t('circle.enroll.failed'))}
              </Text>
              <View style={styles.row}>
                {outcome !== 'ok' ? (
                  <Pressable
                    style={styles.button}
                    onPress={() => {
                      const runner = runnerRef.current;
                      if (!runner) return finish();
                      setDrafts({});
                      runner.start(FLOW, {}).then((r) => setInst(r)).catch(() => finish());
                    }}
                  >
                    <Text style={styles.buttonText}>{t('circle.enroll.retry')}</Text>
                  </Pressable>
                ) : null}
                <Pressable style={styles.cancel} onPress={finish} testID="enroll-close">
                  <Text style={styles.cancelText}>{t('common.close', { defaultValue: 'Sluiten' })}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: theme.color.card, borderRadius: 10, padding: 18 },
  title: { fontSize: 17, fontWeight: '700', color: theme.color.ink, marginBottom: 6 },
  body: { fontSize: 14, color: theme.color.ink, marginBottom: 10 },
  input: { borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, padding: 8, color: theme.color.ink, marginBottom: 8 },
  secret: { minHeight: 72, textAlignVertical: 'top' },
  offerErr: { fontSize: 13, color: theme.color.danger ?? theme.color.ink, marginBottom: 8 },
  offerToggle: { marginTop: 10, paddingVertical: 6 },
  qrBox: { alignSelf: 'center', padding: 8, backgroundColor: '#fff', borderRadius: 8, marginVertical: 8 }, // hex-ok: QR scanner contrast
  offerUri: { fontSize: 11, color: theme.color.inkSoft, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  button: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.color.line },
  buttonText: { color: theme.color.ink, fontSize: 14 },
  cancel: { paddingVertical: 8, paddingHorizontal: 6 },
  cancelText: { color: theme.color.inkSoft, fontSize: 14 },
});
