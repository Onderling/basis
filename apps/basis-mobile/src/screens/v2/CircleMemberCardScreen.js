/**
 * basis-mobile v2 — member-persona card + self-view (RN screen, §2 of the
 * peer-connectivity Phase-4 design). RN twin of web's circleMemberCard over the
 * SAME shared projections (`memberPersonaView` / `selfViewSplit`) — the reveal
 * logic lives in `viewAsAttributes`/`circleViewAs`, this only draws the split:
 *
 *   • member-persona (self=false) — what THIS viewer (me) may see of THAT member.
 *   • self-view (self=true) — "how others see me": pick a viewer (a member / a
 *     stranger / an agent) and feel exactly what you expose.
 *
 * Pure render + local picked-viewer state; the host passes the tapped member, the
 * roster (for the self-view viewer chips), my webid + the circle's reveal policy.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from './themeContext.js';
import { memberPersonaView, selfViewSplit, VIEWER_KINDS } from '@onderling-app/basis';
import { t } from '../../core/localisation.js';

export default function CircleMemberCardScreen({
  member = {}, self = false, roster = [], myWebid = null, policy = 'pairwise', onBack, onReport,
}) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [viewer, setViewer] = useState({ kind: 'stranger' });

  // self-view: MY row (from the roster, or the tapped member); member-persona: the tapped member.
  const me = self ? (roster.find((m) => m.id === myWebid) || member) : member;
  const split = self
    ? selfViewSplit({ me, viewer, policy })
    : memberPersonaView({ member, viewerWebid: myWebid, policy });

  // Never leak the real name in the title when the split hid it from this viewer.
  const realNameVisible = (split.sees || []).some((a) => a.key === 'realName');
  const title = self
    ? t('circle.memberCard.self_title')
    : ((realNameVisible && member.realName) ? member.realName : (member.handle ? `@${member.handle}` : (member.id || '')));
  const lede = self ? t('circle.memberCard.self_lede') : t('circle.memberCard.persona_lede');

  const viewerChips = useMemo(() => ([
    ...roster
      .filter((m) => m && m.id && m.id !== myWebid)
      .map((m) => ({ id: m.id, kind: 'member', label: m.handle ? `@${m.handle}` : (m.realName || m.id) })),
    { kind: 'stranger', label: t('circle.viewAs.stranger') },
    { kind: 'agent',    label: t('circle.viewAs.agent') },
  ]), [roster, myWebid]);

  const renderCol = (kind, attrs) => (
    <View style={styles.col} testID={`membercard-col-${kind}`}>
      <Text style={styles.colTitle}>{t(kind === 'sees' ? 'circle.memberCard.sees' : 'circle.memberCard.hides')}</Text>
      {attrs.length === 0 ? (
        <Text style={styles.none}>{t('circle.memberCard.none')}</Text>
      ) : attrs.map((a) => (
        <View key={a.key} style={styles.attr} testID={`membercard-attr-${a.key}`}>
          <Text style={styles.attrLabel}>{a.labelKey ? t(a.labelKey) : (a.label || a.key)}</Text>
          <Text style={[styles.attrValue, kind === 'hides' && styles.attrValueHidden]}>
            {kind === 'sees'
              ? (a.value != null && a.value !== '' ? String(a.value) : '—')
              : t('circle.memberCard.hidden_marker')}
          </Text>
        </View>
      ))}
    </View>
  );

  return (
    <View style={styles.page} testID={self ? 'circle-selfview' : 'circle-memberpersona'}>
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="circle-membercard-back">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
        {!self && typeof onReport === 'function' ? (
          <Pressable onPress={() => onReport(member)} accessibilityRole="button" testID="circle-membercard-report">
            <Text style={styles.back}>{t('circle.governance.report_member')}</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.lede}>{lede}</Text>

      {self ? (
        <View style={styles.picker}>
          {viewerChips.map((c) => {
            const active = c.kind === viewer.kind && (c.kind !== 'member' || c.id === viewer.id);
            return (
              <Pressable
                key={`${c.kind}:${c.id ?? ''}`}
                onPress={() => setViewer({ id: c.id, kind: c.kind })}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                testID={`membercard-viewer-${c.id ?? c.kind}`}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.list}>
        {renderCol('sees', split.sees)}
        {renderCol('hides', split.hides)}
      </ScrollView>
    </View>
  );
}

// keep VIEWER_KINDS referenced so the import documents the shared vocabulary this screen honors.
export { VIEWER_KINDS };

const makeStyles = (theme) => StyleSheet.create({
  page:        { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: theme.color.paper },
  bar:         { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  back:        { fontSize: 13, color: theme.color.inkSoft },
  title:       { fontSize: 24, fontWeight: '600', fontFamily: theme.font.serif, color: theme.color.ink, marginVertical: 6 },
  lede:        { fontSize: 13, color: theme.color.inkSoft, marginBottom: 12 },
  picker:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip:        { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: theme.color.line, backgroundColor: theme.color.card },
  chipActive:  { borderColor: theme.color.accent, backgroundColor: theme.color.accent },
  chipText:    { fontSize: 12, color: theme.color.inkSoft },
  chipTextActive: { color: theme.color.white, fontWeight: '600' },
  list:        { paddingBottom: 32 },
  col:         { marginBottom: 16 },
  colTitle:    { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: theme.color.inkSoft, marginBottom: 6 },
  attr:        { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.color.line },
  attrLabel:   { fontSize: 14, color: theme.color.inkSoft },
  attrValue:   { fontSize: 14, color: theme.color.ink },
  attrValueHidden: { color: theme.color.inkSoft, fontStyle: 'italic' },
  none:        { color: theme.color.inkSoft, fontStyle: 'italic', paddingVertical: 4 },
});
