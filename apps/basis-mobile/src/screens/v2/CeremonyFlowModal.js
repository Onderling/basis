/**
 * CeremonyFlowModal — the ONE painter for the declared device ceremonies on mobile (web twin: circleApp's
 * `showCeremonyFlow`): revoke-device, replace-device, claim-companion — each a flow whose one step waits on one typed
 * thing (the phrase, the claim line), and whose submit tap is the person's consent. A pick a step declares
 * (`pickerSource`) offers its choices (`ceremonyChoices`) — never filled for them, not even with one choice.
 * Enroll keeps its own painter: its persona picker is ceremony-specific UI, not a flow form.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { createFlowRunner, renderFlow } from '@onderling/app-manifest';
import { householdManifest } from '../../../../household/manifest.js';
import { useTheme } from './themeContext.js';
import { t } from '../../core/localisation.js';
import { ceremonyOutcomeText, ceremonyFinished } from '../../../../basis/src/v2/ceremonyOutcome.js';
import { ceremonyChoices, makePickerFetcher } from '../../../../basis/src/forms/pickerChoices.js';

const OPS = new Map(householdManifest.operations.map((o) => [o.id, o]));

/**
 * One modal for the one-step device ceremonies (they share a shape — one thing typed, one step, one outcome):
 * `flowId: 'revoke-device'` retires ONE device named by `deviceId`; `flowId: 'replace-device'` retires every other
 * device (the restore wizard's "this is my phone now"); `flowId: 'claim-companion'` makes the person the owner of a
 * companion node (`inputName: 'claim'`, the line the node prints). `keyPrefix` picks the copy.
 */
export default function CeremonyFlowModal({ visible, deviceId, callSkill, onClose, flowId = 'revoke-device', keyPrefix = 'revoke', inputName = 'mnemonic', placeholderKey = 'circle.enroll.mnemonic_placeholder', needs = null }) {
  const FLOW = householdManifest.flows.find((f) => f.id === flowId);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [inst, setInst] = useState(null);
  const [phrase, setPhrase] = useState('');
  const [choices, setChoices] = useState({});   // a pick's choices (offered, never filled)
  const [picked, setPicked] = useState({});
  const runnerRef = useRef(null);

  useEffect(() => {
    if (!visible || typeof callSkill !== 'function') return;
    const runner = createFlowRunner({ ops: OPS, callSkill: (opId, args) => callSkill('household', opId, args) });
    runnerRef.current = runner;
    let alive = true;
    runner.start(FLOW, { needs: needs ?? {} })
      .then((r) => { if (alive) { setInst(r); setPhrase(''); } })
      .catch(() => { if (alive) onClose?.(); });
    return () => { alive = false; runnerRef.current = null; };
  }, [visible, callSkill, deviceId, flowId]); // eslint-disable-line react-hooks/exhaustive-deps

  const view = visible && inst ? renderFlow(FLOW, inst, { ops: OPS }) : null;
  useEffect(() => {
    let alive = true;
    ceremonyChoices(view?.form ?? null, makePickerFetcher(callSkill, 'household'))
      .then((c) => { if (alive) { setChoices(c); setPicked({}); } });
    return () => { alive = false; };
  }, [inst]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!visible) return null;
  const outcome = inst?.steps?.ceremony?.outcome;
  const finish = () => { setInst(null); onClose?.(); };

  const submit = () => {
    const runner = runnerRef.current;
    if (!runner || !inst) return;
    runner.resume(FLOW, inst, { input: { [inputName]: phrase, ...picked, ...(deviceId ? { deviceId } : {}) } })
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
                placeholder={t(placeholderKey)}
                placeholderTextColor={theme.color.inkSoft}
                multiline autoCapitalize="none" autoCorrect={false} autoComplete="off"
                value={phrase} onChangeText={setPhrase}
                testID="revoke-mnemonic"
              />
              {Object.entries(choices).map(([name, list]) => (
                <View key={name} style={styles.row}>
                  {list.map((c) => (
                    <Pressable key={c.id} style={[styles.button, picked[name] === c.id && styles.picked]} onPress={() => setPicked((p) => ({ ...p, [name]: c.id }))} testID={`ceremony-pick-${name}-${c.id}`}>
                      <Text style={styles.buttonText}>{c.label}</Text>
                    </Pressable>
                  ))}
                </View>
              ))}
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
                {ceremonyOutcomeText({ keyPrefix, outcome, out: inst?.steps?.ceremony?.out, t })}
              </Text>
              <View style={styles.row}>
                {!ceremonyFinished(outcome) ? (
                  <Pressable
                    style={styles.button}
                    onPress={() => {
                      const runner = runnerRef.current;
                      if (!runner) return finish();
                      setPhrase('');
                      runner.start(FLOW, { needs: needs ?? {} }).then((r) => setInst(r)).catch(() => finish());
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
  picked: { borderColor: theme.color.ink },
  cancelText: { color: theme.color.inkSoft, fontSize: 14 },
});
