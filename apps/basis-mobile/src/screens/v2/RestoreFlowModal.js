/**
 * RestoreFlowModal — the restore-settings FLOW painter on mobile (web parity: circleApp's
 * showRestoreSettingsFlow). The declaration lives on the params manifest; the runner executes
 * through the waist; this component only paints renderFlow's view model. The merge step gets a
 * bespoke form (the per-param mine/theirs rows); every other pause paints generically from the
 * declared params. Replaces the two #44 Alert chains — those closed over boot callbacks, this
 * re-probes through declared ops, so it can open any time after boot.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, ScrollView, Alert, StyleSheet } from 'react-native';
import { createFlowRunner, renderFlow } from '@onderling/app-manifest';
import { paramsManifest } from '@onderling-app/basis';
import { useTheme } from './themeContext.js';
import { t } from '../../core/localisation.js';

const FLOW = paramsManifest.flows.find((f) => f.id === 'restore-settings');
const OPS = new Map(paramsManifest.operations.map((o) => [o.id, o]));

export default function RestoreFlowModal({ visible, callSkill, onClose, onPhrase }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [inst, setInst] = useState(null);
  const [picks, setPicks] = useState({});
  const [drafts, setDrafts] = useState({});
  const runnerRef = useRef(null);

  useEffect(() => {
    if (!visible || typeof callSkill !== 'function') return;
    const runner = createFlowRunner({ ops: OPS, callSkill: (opId, args) => callSkill('params', opId, args) });
    runnerRef.current = runner;
    let alive = true;
    runner.start(FLOW, {})
      .then((r) => { if (alive) { setInst(r); setPicks({}); setDrafts({}); } })
      .catch(() => { if (alive) onClose?.(); });
    return () => { alive = false; runnerRef.current = null; };
  }, [visible, callSkill]); // eslint-disable-line react-hooks/exhaustive-deps

  const view = inst ? renderFlow(FLOW, inst, { ops: OPS }) : null;

  const finish = () => {
    const choice = inst?.produces?.choice;
    setInst(null);
    onClose?.();
    // The 'phrase' route: the flow ends and the shell launches the existing recovery wizard.
    if (choice === 'phrase') onPhrase?.();
  };

  // A finished/failed instance closes itself (web parity: paint() → finish()).
  const settled = !!view && view.status !== 'awaiting-input';
  useEffect(() => {
    if (settled) finish();
  }, [settled]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;

  const submit = (input) => {
    const runner = runnerRef.current;
    if (!runner || !inst) return;
    runner.resume(FLOW, inst, { input })
      .then((r) => setInst(r))
      .catch(() => { setInst(null); onClose?.(); });
  };

  const conflicts = inst?.steps?.probe?.out?.conflicts ?? [];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => { runnerRef.current?.cancel(inst); finish(); }}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{view ? t(view.labelKey) : t('circle.settings_restore.mismatch_title')}</Text>
          {view ? (
            <Text style={styles.progress}>
              {view.progress.filter((p) => p.state !== 'skipped')
                .map((p) => `${p.state === 'done' ? '✓' : p.state === 'current' ? '•' : '·'} ${t(p.labelKey, { defaultValue: p.id })}`)
                .join('   ')}
            </Text>
          ) : null}
          {view?.status === 'awaiting-input' && view.form ? (
            view.form.step === 'mismatch' ? (
              <View>
                <Text style={styles.body}>{t('circle.settings_restore.mismatch_body')}</Text>
                <View style={styles.buttonRow}>
                  {OPS.get('restore-resolve-mismatch').params[0].of.map((value) => (
                    <Pressable
                      key={value}
                      style={styles.button}
                      onPress={() => {
                        if (value === 'overwrite') {
                          Alert.alert(
                            t('circle.settings_restore.choice_overwrite'),
                            t('circle.settings_restore.overwrite_warning'),
                            [
                              { text: t('circle.settings_restore.choice_local'), style: 'cancel' },
                              { text: t('circle.settings_restore.choice_overwrite'), style: 'destructive', onPress: () => submit({ choice: value }) },
                            ],
                          );
                        } else submit({ choice: value });
                      }}
                    >
                      <Text style={styles.buttonText}>{t(`circle.settings_restore.choice_${value}`)}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : view.form.step === 'merge' ? (
              <ScrollView style={styles.mergeList}>
                <Text style={styles.body}>{t('circle.settings_restore.conflicts_body')}</Text>
                {conflicts.map((c) => (
                  <View key={c.key} style={styles.mergeRow}>
                    <Text style={styles.mergeKey}>{c.key}</Text>
                    <View style={styles.buttonRow}>
                      {[['mine', c.mine], ['theirs', c.theirs]].map(([side, val]) => (
                        <Pressable
                          key={side}
                          style={[styles.pill, (picks[c.key] ?? 'mine') === side && styles.pillActive]}
                          onPress={() => setPicks((p) => ({ ...p, [c.key]: side }))}
                        >
                          <Text style={styles.pillText}>{`${t(`circle.settings_restore.keep_${side}`)} (${JSON.stringify(val)})`}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ))}
                <Pressable
                  style={[styles.button, styles.primary]}
                  onPress={() => submit({ choices: Object.fromEntries(conflicts.map((c) => [c.key, picks[c.key] ?? 'mine'])) })}
                >
                  <Text style={styles.buttonText}>{t('circle.settings_restore.done')}</Text>
                </Pressable>
              </ScrollView>
            ) : (
              <View>
                {/* generic fallback: one text input per declared param (no bespoke form registered) */}
                {view.form.params.map((param) => (
                  <TextInput
                    key={param.name}
                    style={styles.input}
                    placeholder={t(param.labelKey, { defaultValue: param.name })}
                    placeholderTextColor={theme.color.inkSoft}
                    value={drafts[param.name] ?? ''}
                    onChangeText={(v) => setDrafts((d) => ({ ...d, [param.name]: v }))}
                  />
                ))}
                <Pressable style={[styles.button, styles.primary]} onPress={() => submit(drafts)}>
                  <Text style={styles.buttonText}>{t('circle.settings_restore.done')}</Text>
                </Pressable>
              </View>
            )
          ) : null}
          {view?.actions?.canCancel ? (
            <Pressable style={styles.cancel} onPress={() => { runnerRef.current?.cancel(inst); finish(); }}>
              <Text style={styles.cancelText}>{t('circle.settings_restore.choice_local')}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: theme.color.card, borderRadius: 10, padding: 18, maxHeight: '85%' },
  title: { fontSize: 17, fontWeight: '700', color: theme.color.ink, marginBottom: 6 },
  progress: { fontSize: 12, color: theme.color.inkSoft, marginBottom: 10 },
  body: { fontSize: 14, color: theme.color.ink, marginBottom: 10 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  button: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.color.line },
  primary: { marginTop: 12, alignSelf: 'flex-start' },
  buttonText: { color: theme.color.ink, fontSize: 14 },
  mergeList: { maxHeight: 380 },
  mergeRow: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.color.line },
  mergeKey: { fontFamily: 'monospace', fontSize: 13, color: theme.color.ink, marginBottom: 4 },
  pill: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: theme.color.line },
  pillActive: { backgroundColor: theme.color.accent, borderColor: theme.color.ink },
  pillText: { fontSize: 12, color: theme.color.ink },
  input: { borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, padding: 8, color: theme.color.ink, marginBottom: 8 },
  cancel: { marginTop: 14, alignSelf: 'center' },
  cancelText: { color: theme.color.inkSoft, fontSize: 14 },
});
