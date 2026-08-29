/**
 * basis-mobile v2 — personal circle override (RN screen).
 *
 * RN counterpart of web's circleOverride renderer over the SAME shared
 * `memberOverride` model: the calling member's deviations from a circle's
 * defaults — chat off / reveal-open / agents-may-contact-me + flow-through
 * (claimed tasks / calendar → "My things").  Loads/saves through the
 * injected override store (AsyncStorage-backed).
 */
import { noticeOverrideRows } from '../../../../basis/src/v2/noticeSettings.js';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Switch, StyleSheet } from 'react-native';
import { useTheme } from './themeContext.js';
import { mergeMemberOverride } from '@onderling-app/basis';
// the member capability opt-out section (web≡mobile via the shared projector).
import { buildCapabilityMatrix } from '@onderling/app-manifest';
import { buildManifestsByOrigin } from '../../core/composeManifests.js';
import { t } from '../../core/localisation.js';

const TOP_TOGGLES = ['chatOff', 'revealOpen', 'agentsMayContactMe'];
const FLOW_TOGGLES = ['tasksToPersonal', 'calendarToPersonal'];
// per-circle push toggles (audit). Mirrors web's
// PUSH_TOGGLES row pattern; locale namespace is
// `circle.member.notifications.*`.
const PUSH_TOGGLES = [
  { key: 'onMention',      i18n: 'on_mention' },
  { key: 'onEveryMessage', i18n: 'on_message' },
  { key: 'onNewItem',      i18n: 'on_new_item' },
  { key: 'onProposal',     i18n: 'on_proposal' },
];

export default function CircleOverrideScreen({ store, circleId, onBack, policyStore }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [working, setWorking] = useState(null);
  const [policy, setPolicy] = useState({});

  useEffect(() => {
    let live = true;
    store.get(circleId).then((o) => { if (live) setWorking(o); });
    if (policyStore?.get) policyStore.get(circleId).then((p) => { if (live) setPolicy(p || {}); }).catch(() => {});
    return () => { live = false; };
  }, [store, circleId, policyStore]);

  const patch = useCallback((p) => setWorking((cur) => mergeMemberOverride(cur, p)), []);

  // the member's opt-outable capabilities (admin freedom 'optional' or a privacy floor).
  const sources = useMemo(() => [...new Set(Object.values(buildManifestsByOrigin()))].map((m) => ({ manifest: m })), []);
  const optOutable = useMemo(() => (working ? buildCapabilityMatrix(sources, {
    enabledApps: Array.isArray(policy?.apps) && policy.apps.length ? policy.apps : null,
    template: policy?.capabilities || {},
    optOuts: working.capabilityOptOuts || [],
  }).filter((r) => r.enabled && r.optOutable) : []), [sources, policy, working]);

  const onSave = useCallback(async () => {
    if (!working) return;
    await store.update(circleId, working);
    onBack?.();
  }, [working, store, circleId, onBack]);

  if (!working) {
    return (
      <View style={styles.page} testID="circle-override">
        <Text style={styles.muted}>{t('circle.loading')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.page} testID="circle-override">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="circle-override-back">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{t('circle.override.title')}</Text>

      <ScrollView contentContainerStyle={styles.body}>
        {TOP_TOGGLES.map((key) => (
          <View key={key} style={styles.row}>
            <Text style={styles.rowLabel}>{t(`circle.override.${key}`)}</Text>
            <Switch trackColor={{ true: theme.color.accent, false: theme.color.trackOff }} thumbColor={theme.color.white}
              value={!!working[key]}
              onValueChange={(v) => patch({ [key]: v })}
              testID={`override-${key}`}
            />
          </View>
        ))}

        <Text style={styles.section}>{t('circle.member.notifications.section_title')}</Text>
        {PUSH_TOGGLES.map(({ key, i18n }) => (
          <View key={key} style={styles.row}>
            <Text style={styles.rowLabel}>{t(`circle.member.notifications.${i18n}`)}</Text>
            <Switch trackColor={{ true: theme.color.accent, false: theme.color.trackOff }} thumbColor={theme.color.white}
              value={!!working.push?.[key]}
              onValueChange={(v) => patch({ push: { [key]: v } })}
              testID={`override-push-${key}`}
            />
          </View>
        ))}

        {/* Decision 4 — the lines the conversation renders, per kind: the circle's default and my private choice. */}
        <Text style={styles.section}>{t('circle.override.notices')}</Text>
        {noticeOverrideRows({ policy, override: working }).map((r) => (
          <View key={r.kind} style={styles.row}>
            <Text style={styles.rowLabel}>{t(r.labelKey)}</Text>
            <Switch trackColor={{ true: theme.color.accent, false: theme.color.trackOff }} thumbColor={theme.color.white}
              value={r.on}
              onValueChange={() => patch({ notices: r.next })}
              testID={`override-notice-${r.kind}`}
            />
          </View>
        ))}
        <Text style={styles.section}>{t('circle.override.flowThrough')}</Text>
        {FLOW_TOGGLES.map((key) => (
          <View key={key} style={styles.row}>
            <Text style={styles.rowLabel}>{t(`circle.override.${key}`)}</Text>
            <Switch trackColor={{ true: theme.color.accent, false: theme.color.trackOff }} thumbColor={theme.color.white}
              value={!!working.flowThrough?.[key]}
              onValueChange={(v) => patch({ flowThrough: { [key]: v } })}
              testID={`override-${key}`}
            />
          </View>
        ))}

        {/* the member's capability opt-outs (checked = participate; unchecking opts out) */}
        {optOutable.length ? (
          <>
            <Text style={styles.section}>{t('circle.override.capabilities')}</Text>
            {optOutable.map((r) => {
              const floorTag = r.privacyFloor ? ` (${t('circle.settings.privacyFloor')})` : '';
              const current = new Set(working.capabilityOptOuts || []);
              return (
                <View key={r.key} style={styles.row} testID={`override-cap-${r.key}`}>
                  <Text style={styles.rowLabel}>{`${verbLabel(r.atom)} · ${r.noun}${floorTag}`}</Text>
                  <Switch trackColor={{ true: theme.color.accent, false: theme.color.trackOff }} thumbColor={theme.color.white}
                    value={!r.optedOut}
                    onValueChange={(participate) => {
                      const next = new Set(current);
                      if (participate) next.delete(r.key); else next.add(r.key);
                      patch({ capabilityOptOuts: [...next] });
                    }}
                  />
                </View>
              );
            })}
          </>
        ) : null}
      </ScrollView>

      <Pressable style={styles.save} onPress={onSave} accessibilityRole="button" testID="circle-override-save">
        <Text style={styles.saveText}>{t('circle.settings.save')}</Text>
      </Pressable>
    </View>
  );
}

/** Localised atom verb label, falling back to the atom when no key is translated. */
function verbLabel(atom) {
  const k = `circle.settings.verb.${atom}`;
  const v = t(k);
  return v && v !== k ? v : atom;
}

const makeStyles = (theme) => StyleSheet.create({
  page:     { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: theme.color.paper },
  bar:      { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  back:     { fontSize: 13, color: theme.color.inkSoft },
  title:    { fontSize: 24, fontWeight: '600', fontFamily: theme.font.serif, color: theme.color.ink, marginVertical: 10 },
  body:     { paddingBottom: 24 },
  section:  { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: theme.color.inkSoft, marginTop: 16, marginBottom: 4 },
  row:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  rowLabel: { fontSize: 14, color: theme.color.ink, flexShrink: 1, paddingRight: 8 },
  muted:    { color: theme.color.inkSoft, fontStyle: 'italic', paddingVertical: 10 },
  save:     { marginTop: 8, marginBottom: 12, padding: 13, borderRadius: 8, backgroundColor: theme.color.accent, alignItems: 'center' },
  saveText: { color: theme.color.white, fontSize: 15, fontWeight: '700' },
});
