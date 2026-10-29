/**
 * CircleAdvancedScreen — the ADVANCED surface on mobile (web parity: circleApp's
 * showAdvanced). The "default places for any new opId" rule made a screen: every op
 * without a bespoke projection is listed and reachable here — no-arg ops run through
 * the waist, arg-taking ops point at their chat form — plus the register's settable
 * values through the one kind-gated `set-param`. The rows come from the SHARED
 * projections (`advancedOpRows` / `settingsProjection`); this component only paints.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Switch, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { advancedOpRows, settingsProjection } from '@onderling-app/basis';
import { useTheme } from './themeContext.js';
import { FAB_CLEARANCE } from './fab.js';
import { t } from '../../core/localisation.js';
import OpPageModal from './OpPageModal.js';

export default function CircleAdvancedScreen({ manifestsByOrigin = {}, callSkill, onBack = null }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();   // clear the status bar: a back link under it cannot be tapped
  const styles = useMemo(() => makeStyles(theme, insets), [theme, insets]);
  const ops = useMemo(() => advancedOpRows({ manifests: Object.values(manifestsByOrigin) }), [manifestsByOrigin]);
  const [params, setParams] = useState([]);
  const [flash, setFlash] = useState({});
  // An argument-taking op opens as a FORM of its own (the shared page paint) — never only "in chat".
  const [openRow, setOpenRow] = useState(null);
  const opFor = (o) => {
    const manifest = manifestsByOrigin?.[o.app];
    return manifest?.operations?.find((x) => x.id === o.op) ?? { id: o.op, params: o.params, description: o.description };
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await callSkill?.('params', 'list-user-params', {});
        if (alive) setParams(Array.isArray(r?.params) ? r.params : []);
      } catch { /* register absent → ops only */ }
    })();
    return () => { alive = false; };
  }, [callSkill]);

  // projected from the register (labels, a control per kind, grouped by scope); a change is the one `set-param` op
  const settings = useMemo(() => settingsProjection(params), [params]);
  const setParam = async (row, input) => {
    const value = settings.valueFor(row, input);
    let said;
    if (value && typeof value === 'object' && !Array.isArray(value) && value.error) said = t(value.error);
    else {
      const r = await callSkill?.('params', 'set-param', { key: row.key, value }).catch(() => ({ ok: false }));
      said = r?.ok ? '✓' : t('circle.params.save_failed');
      if (r?.ok) setParams((ps) => ps.map((p) => (p.key === row.key ? { ...p, value } : p)));
    }
    setFlash((f) => ({ ...f, [row.key]: said }));
    setTimeout(() => setFlash((f) => ({ ...f, [row.key]: null })), 1500);
  };

  const runOp = async (o) => {
    const r = await callSkill?.(o.app, o.op, {}).catch(() => null);
    const key = `${o.app}:${o.op}`;
    setFlash((f) => ({ ...f, [key]: r && r.ok !== false ? t('circle.advanced.ran') : '✗' }));
    setTimeout(() => setFlash((f) => ({ ...f, [key]: null })), 1500);
  };

  return (
    <ScrollView testID="circle-advanced-screen" style={styles.screen} contentContainerStyle={[styles.wrap, { paddingBottom: FAB_CLEARANCE }]}>
      {onBack ? (
        <Pressable onPress={onBack} accessibilityRole="button" testID="circle-advanced-back">
          <Text style={styles.back}>{t('circle.back_me')}</Text>
        </Pressable>
      ) : null}
      <Text style={styles.title}>{t('circle.advanced.title')}</Text>

      <Text style={styles.section}>{t('circle.advanced.params_title')}</Text>
      <Text style={styles.hint}>{t('circle.advanced.params_hint')}</Text>
      {settings.groups.map((g) => (
        <View key={g.scope} testID={`settings-group-${g.scope}`}>
          <Text style={styles.group}>{t(g.labelKey)}</Text>
          {g.rows.map((row) => (
            <View key={row.key} style={styles.row} testID={`settings-row-${row.key}`}>
              <Text style={styles.label}>{t(row.labelKey)}</Text>
              <View style={styles.controls}>
                {row.control.kind === 'switch' ? (
                  <Switch /* sets: param:* — the row's key in the parameter register */ value={row.value === true} onValueChange={(v) => setParam(row, v)} testID={`settings-param-${row.key}`} />
                ) : row.control.kind === 'choice' ? (
                  <View style={styles.chips}>
                    {row.control.options.map((o) => (
                      <Pressable key={String(o.value)} onPress={() => setParam(row, o.value)} accessibilityRole="button"
                        style={[styles.chip, o.value === row.value ? styles.chipOn : null]} testID={`settings-param-${row.key}-${o.value}`}>
                        <Text style={styles.chipText}>{t(o.labelKey)}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <>
                    <TextInput
                      style={styles.input}
                      defaultValue={String(row.shown ?? '')}
                      keyboardType={row.control.kind === 'number' || row.control.kind === 'duration' ? 'numeric' : 'default'}
                      onEndEditing={(e) => setParam(row, e.nativeEvent.text)}
                      testID={`settings-param-${row.key}`}
                    />
                    {row.control.kind === 'duration' ? <Text style={styles.hint}>{t(`circle.params.unit_${row.control.unit}`)}</Text> : null}
                    {row.control.kind === 'list' ? <Text style={styles.hint}>{t('circle.params.list_hint')}</Text> : null}
                  </>
                )}
                {flash[row.key] ? <Text style={styles.hint}>{flash[row.key]}</Text> : null}
              </View>
              {/* the raw key, small: a value whose label is missing stays findable */}
              <Text style={styles.code}>{row.key}</Text>
            </View>
          ))}
        </View>
      ))}

      <Text style={styles.section}>{t('circle.advanced.ops_title')}</Text>
      {ops.length === 0 ? <Text style={styles.hint}>{t('circle.advanced.ops_empty')}</Text> : null}
      {/* Grouped, not flat — the shelf is declared on the op and projected by `advancedOpRows`, so web
          and mobile shelve identically rather than each deciding. A heading renders when the group
          changes, which is why the projector's order matters and is stable. */}
      {ops.map((o, i) => {
        const key = `${o.app}:${o.op}`;
        const newGroup = i === 0 || ops[i - 1].group !== o.group;
        return (
          <React.Fragment key={key}>
          {newGroup ? (
            <Text style={styles.group} testID={`advanced-group-${o.group}`}>
              {t(`circle.advanced.group.${o.group}`)}
            </Text>
          ) : null}
          <View style={styles.row}>
            <View style={styles.opLeft}>
              <Text style={styles.code}>{key}</Text>
              {o.description ? <Text style={styles.hint}>{o.description}</Text> : null}
            </View>
            {o.runnable ? (
              <Pressable style={styles.btn} onPress={() => runOp(o)} testID={`advanced-run-${o.op}`}>
                <Text style={styles.btnText}>{flash[key] ?? t('circle.advanced.run')}</Text>
              </Pressable>
            ) : (
              <View style={styles.opRight}>
                <Pressable style={styles.btn} onPress={() => setOpenRow(o)} testID={`advanced-open-${o.op}`}>
                  <Text style={styles.btnText}>{t('circle.advanced.open')}</Text>
                </Pressable>
                {o.slash ? <Text style={styles.hint}>{t('circle.advanced.via_chat', { slash: o.slash })}</Text> : null}
              </View>
            )}
          </View>
          </React.Fragment>
        );
      })}
      <OpPageModal
        visible={!!openRow}
        appOrigin={openRow?.app}
        op={openRow ? opFor(openRow) : null}
        callSkill={callSkill}
        onClose={() => setOpenRow(null)}
        onDispatched={() => {
          const key = openRow ? `${openRow.app}:${openRow.op}` : null;
          if (key) { setFlash((f) => ({ ...f, [key]: t('circle.advanced.ran') })); setTimeout(() => setFlash((f) => ({ ...f, [key]: null })), 1500); }
        }}
      />
    </ScrollView>
  );
}

const makeStyles = (theme, insets) => StyleSheet.create({
  // The screen paints its OWN ground. Every colour here came from the theme except this one, which was
  // simply absent — so on a dark device the themed (light) ink landed on the platform's default white
  // and the whole tab read as washed out beside an otherwise black app. A screen that themes its text
  // and not its background is not half-themed; it is unreadable in exactly one mode.
  screen:   { flex: 1, paddingTop: insets?.top ?? 0, backgroundColor: theme.color.paper },
  back:     { fontSize: 15, color: theme.color.accent, marginBottom: 10 },
  wrap:     { padding: 16, paddingBottom: 48, backgroundColor: theme.color.paper },
  title:    { fontSize: 20, fontWeight: '700', color: theme.color.ink, marginBottom: 12 },
  section:  { fontSize: 14, fontWeight: '700', color: theme.color.ink, marginTop: 18, marginBottom: 4 },
  hint:     { fontSize: 12, color: theme.color.inkSoft },
  group:    { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, color: theme.color.inkSoft, marginTop: 18, marginBottom: 4 },
  row:      { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.color.line },
  code:     { fontSize: 10, color: theme.color.inkSoft, fontFamily: 'monospace', marginTop: 2 },
  label:    { fontSize: 14, color: theme.color.ink, marginBottom: 4 },
  chips:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1 },
  chip:     { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: theme.color.line },
  chipOn:   { borderColor: theme.color.accent, backgroundColor: theme.color.paper2 },
  chipText: { fontSize: 13, color: theme.color.ink },
  controls: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 },
  input:    { flex: 1, borderWidth: 1, borderColor: theme.color.line, borderRadius: 6, padding: 6, color: theme.color.ink, fontSize: 13 },
  opRight: { alignItems: 'flex-end', gap: 4 },
  opLeft:   { marginBottom: 4 },
  btn:      { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: theme.color.line },
  btnText:  { fontSize: 13, color: theme.color.ink },
});
