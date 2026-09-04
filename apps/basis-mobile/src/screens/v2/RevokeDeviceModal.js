/**
 * RevokeDeviceModal — the device-revocation ceremony on mobile, painted as its declared flow
 * (web parity: circleApp's showRevokeDeviceFlow). Runs on THIS — a surviving — device; the
 * phrase is the extra proof; the deviceId rides in prefilled from the My-data device row. The
 * fold does the enforcement everywhere; the revoked device becomes an island.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { createFlowRunner, renderFlow } from '@onderling/app-manifest';
import { householdManifest } from '../../../../household/manifest.js';
import { useTheme } from './themeContext.js';
import { t } from '../../core/localisation.js';

const OPS = new Map(householdManifest.operations.map((o) => [o.id, o]));

/**
 * One modal for both device ceremonies (they share a shape — the phrase is the proof, one step, one
 * outcome): `flowId: 'revoke-device'` retires ONE device named by `deviceId`; `flowId: 'replace-device'`
 * retires every other device (the restore wizard's "this is my phone now"). `keyPrefix` picks the copy.
 */
export default function RevokeDeviceModal({ visible, deviceId, callSkill, onClose, flowId = 'revoke-device', keyPrefix = 'revoke' }) {
  const FLOW = householdManifest.flows.find((f) => f.id === flowId);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [inst, setInst] = useState(null);
  const [phrase, setPhrase] = useState('');
  const runnerRef = useRef(null);

  useEffect(() => {
    if (!visible || typeof callSkill !== 'function') return;
    const runner = createFlowRunner({ ops: OPS, callSkill: (opId, args) => callSkill('household', opId, args) });
    runnerRef.current = runner;
    let alive = true;
    runner.start(FLOW, {})
      .then((r) => { if (alive) { setInst(r); setPhrase(''); } })
      .catch(() => { if (alive) onClose?.(); });
    return () => { alive = false; runnerRef.current = null; };
  }, [visible, callSkill, deviceId, flowId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;
  const view = inst ? renderFlow(FLOW, inst, { ops: OPS }) : null;
  const outcome = inst?.steps?.ceremony?.outcome;
  const finish = () => { setInst(null); onClose?.(); };

  const submit = () => {
    const runner = runnerRef.current;
    if (!runner || !inst) return;
    runner.resume(FLOW, inst, { input: { mnemonic: phrase, ...(deviceId ? { deviceId } : {}) } })
      .then((r) => setInst(r))
      .catch(() => finish());
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={finish}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{t(`circle.${keyPrefix}.title`)}</Text>
          {view?.status === 'awaiting-input' ? (
            <View>
              <Text style={styles.body}>{t(`circle.${keyPrefix}.body`)}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('circle.enroll.mnemonic_placeholder')}
                placeholderTextColor={theme.color.inkSoft}
                multiline autoCapitalize="none" autoCorrect={false} autoComplete="off"
                value={phrase} onChangeText={setPhrase}
                testID="revoke-mnemonic"
              />
              <View style={styles.row}>
                <Pressable style={styles.button} onPress={submit} testID="revoke-submit">
                  <Text style={styles.buttonText}>{t(`circle.${keyPrefix}.submit`)}</Text>
                </Pressable>
                <Pressable style={styles.cancel} onPress={() => { runnerRef.current?.cancel(inst); finish(); }}>
                  <Text style={styles.cancelText}>{t('circle.confirm.cancel', { defaultValue: 'Annuleren' })}</Text>
                </Pressable>
              </View>
            </View>
          ) : view ? (
            <View>
              <Text style={styles.body}>
                {outcome === 'ok'
                  ? t(`circle.${keyPrefix}.done`)
                  : (outcome === 'wrong-phrase' || outcome === 'invalid-phrase')
                    ? t('circle.enroll.invalid_phrase')
                    : (inst?.steps?.ceremony?.out?.error ?? t(`circle.${keyPrefix}.failed`))}
              </Text>
              <View style={styles.row}>
                {outcome !== 'ok' ? (
                  <Pressable
                    style={styles.button}
                    onPress={() => {
                      const runner = runnerRef.current;
                      if (!runner) return finish();
                      setPhrase('');
                      runner.start(FLOW, {}).then((r) => setInst(r)).catch(() => finish());
                    }}
                  >
                    <Text style={styles.buttonText}>{t('circle.enroll.retry')}</Text>
                  </Pressable>
                ) : null}
                <Pressable style={styles.cancel} onPress={finish} testID="revoke-close">
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
  input: { borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, padding: 8, color: theme.color.ink, marginBottom: 8, minHeight: 72, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  button: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.color.line },
  buttonText: { color: theme.color.ink, fontSize: 14 },
  cancel: { paddingVertical: 8, paddingHorizontal: 6 },
  cancelText: { color: theme.color.inkSoft, fontSize: 14 },
});
