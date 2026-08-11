/**
 * CircleAdvancedScreen — the ADVANCED surface on mobile (web parity: circleApp's
 * showAdvanced). The "default places for any new opId" rule made a screen: every op
 * without a bespoke projection is listed and reachable here — no-arg ops run through
 * the waist, arg-taking ops point at their chat form — plus the register's settable
 * values through the one kind-gated `set-param`. The rows come from the SHARED
 * projections (`advancedOpRows` / `advancedParamRows`); this component only paints.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { advancedOpRows, advancedParamRows } from '@onderling-app/basis';
import { useTheme } from './themeContext.js';
import { t } from '../../core/localisation.js';

export default function CircleAdvancedScreen({ manifestsByOrigin = {}, callSkill }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const ops = useMemo(() => advancedOpRows({ manifests: Object.values(manifestsByOrigin) }), [manifestsByOrigin]);
  const [params, setParams] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [flash, setFlash] = useState({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await callSkill?.('params', 'list-user-params', {});
        if (alive) setParams(advancedParamRows(r));
      } catch { /* register absent → ops only */ }
    })();
    return () => { alive = false; };
  }, [callSkill]);

  const saveParam = async (p) => {
    const raw = drafts[p.key] ?? JSON.stringify(p.value ?? p.default);
    let value; try { value = JSON.parse(raw); } catch { value = raw; }
    const r = await callSkill?.('params', 'set-param', { key: p.key, value }).catch(() => ({ ok: false }));
    setFlash((f) => ({ ...f, [p.key]: r?.ok ? '✓' : '✗' }));
    setTimeout(() => setFlash((f) => ({ ...f, [p.key]: null })), 1200);
  };

  const runOp = async (o) => {
    const r = await callSkill?.(o.app, o.op, {}).catch(() => null);
    const key = `${o.app}:${o.op}`;
    setFlash((f) => ({ ...f, [key]: r && r.ok !== false ? t('circle.advanced.ran') : '✗' }));
    setTimeout(() => setFlash((f) => ({ ...f, [key]: null })), 1500);
  };

  return (
    <ScrollView testID="circle-advanced-screen" contentContainerStyle={styles.wrap}>
      <Text style={styles.title}>{t('circle.advanced.title')}</Text>

      <Text style={styles.section}>{t('circle.advanced.params_title')}</Text>
      <Text style={styles.hint}>{t('circle.advanced.params_hint')}</Text>
      {params.map((p) => (
        <View key={p.key} style={styles.row}>
          <Text style={styles.code}>{p.key} ({p.scope})</Text>
          <View style={styles.controls}>
            <TextInput
              style={styles.input}
              defaultValue={JSON.stringify(p.value ?? p.default)}
              onChangeText={(v) => setDrafts((d) => ({ ...d, [p.key]: v }))}
              testID={`advanced-param-${p.key}`}
            />
            <Pressable style={styles.btn} onPress={() => saveParam(p)}>
              <Text style={styles.btnText}>{flash[p.key] ?? t('circle.advanced.save')}</Text>
            </Pressable>
          </View>
        </View>
      ))}

      <Text style={styles.section}>{t('circle.advanced.ops_title')}</Text>
      {ops.length === 0 ? <Text style={styles.hint}>{t('circle.advanced.ops_empty')}</Text> : null}
      {ops.map((o) => {
        const key = `${o.app}:${o.op}`;
        return (
          <View key={key} style={styles.row}>
            <View style={styles.opLeft}>
              <Text style={styles.code}>{key}</Text>
              {o.description ? <Text style={styles.hint}>{o.description}</Text> : null}
            </View>
            {o.runnable ? (
              <Pressable style={styles.btn} onPress={() => runOp(o)} testID={`advanced-run-${o.op}`}>
                <Text style={styles.btnText}>{flash[key] ?? t('circle.advanced.run')}</Text>
              </Pressable>
            ) : (
              <Text style={styles.hint}>
                {o.slash ? t('circle.advanced.via_chat', { slash: o.slash }) : t('circle.advanced.via_chat_generic')}
              </Text>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  wrap:     { padding: 16, paddingBottom: 48 },
  title:    { fontSize: 20, fontWeight: '700', color: theme.color.ink, marginBottom: 12 },
  section:  { fontSize: 14, fontWeight: '700', color: theme.color.ink, marginTop: 18, marginBottom: 4 },
  hint:     { fontSize: 12, color: theme.color.inkSoft },
  row:      { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.color.line },
  code:     { fontSize: 13, color: theme.color.ink, fontFamily: 'monospace' },
  controls: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 },
  input:    { flex: 1, borderWidth: 1, borderColor: theme.color.line, borderRadius: 6, padding: 6, color: theme.color.ink, fontSize: 13 },
  opLeft:   { marginBottom: 4 },
  btn:      { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: theme.color.line },
  btnText:  { fontSize: 13, color: theme.color.ink },
});
