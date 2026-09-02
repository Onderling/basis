/**
 * The "Blocked" list under Mij — web≡mobile (web: circleApp's showBlocked over the same projection).
 *
 * Blocking is one tap on a post; this is the way back, in a place a person can FIND. The set is
 * DEVICE-wide (the one `basis:muted` set the transport refuses on and the stream filters by), so it
 * belongs under Me — the copy in a circle's admin panel shows the same set, but a member who is in
 * no panel's circle could never reach it there (found 2026-09-02: mobile had ONLY the per-circle
 * door for a device-wide decision).
 *
 * Names come from whatever rosters this device can see: every circle's members are fetched
 * best-effort and the shared `buildBlockedList` resolves keys against them — a key nobody can name
 * still shows (shortened), because a block you cannot see is worse than one you cannot read.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { buildBlockedList } from '../../../../basis/src/v2/blockedList.js';
import { t } from '../../core/localisation.js';
import { useTheme } from './themeContext.js';

export default function CircleBlockedScreen({ callSkill, circles = [], onBack }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [rows, setRows] = useState(null);   // null = loading

  const load = useCallback(async () => {
    if (typeof callSkill !== 'function') { setRows([]); return; }
    let peers = [];
    try { peers = (await callSkill('basis', 'muted', {}))?.peers ?? []; } catch { peers = []; }
    // Best-effort naming across every circle's roster; a failed fetch names fewer, never blocks the list.
    const members = [];
    for (const c of Array.isArray(circles) ? circles : []) {
      const id = c?.id ?? c?.groupId;
      if (!id) continue;
      try {
        const r = await callSkill('stoop', 'listGroupMembers', { groupId: id });
        if (Array.isArray(r?.members)) members.push(...r.members);
      } catch { /* unnamed keys still render */ }
    }
    setRows(buildBlockedList({ peers, members }));
  }, [callSkill, circles]);
  useEffect(() => { load(); }, [load]);

  const unblock = useCallback(async (key) => {
    // The row's ORIGINAL key — unblocking by a display name removes nothing.
    try { await callSkill('basis', 'unmute', { peer: key.startsWith('webid:') ? key.slice(6) : key }); } catch { /* re-read tells the truth */ }
    load();
  }, [callSkill, load]);

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content} testID="circle-blocked-screen">
      <Pressable onPress={onBack} testID="blocked-back"><Text style={styles.back}>{t('circle.back')}</Text></Pressable>
      <Text style={styles.title}>{t('circle.blocked.title')}</Text>
      <Text style={styles.note}>{t('circle.blocked.note')}</Text>
      {rows === null ? (
        <Text style={styles.muted}>{t('circle.loading')}</Text>
      ) : rows.length === 0 ? (
        <Text style={styles.muted} testID="blocked-empty">{t('circle.blocked.empty')}</Text>
      ) : rows.map(({ key, label, resolved }) => (
        <View key={key} style={styles.row} testID={`blocked-row-${key.slice(0, 8)}`}>
          <Text style={[styles.name, !resolved && styles.rawKey]} numberOfLines={1}>{label}</Text>
          <Pressable style={styles.unblock} onPress={() => unblock(key)} testID={`blocked-unblock-${key.slice(0, 8)}`}>
            <Text style={styles.unblockText}>{t('circle.blocked.unblock')}</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  wrap:        { flex: 1, backgroundColor: theme.color.paper },
  content:     { padding: 16, paddingBottom: 48 },
  back:        { fontSize: 15, color: theme.color.accent, marginBottom: 10 },
  title:       { fontSize: 20, fontWeight: '700', color: theme.color.ink, marginBottom: 6 },
  note:        { fontSize: 13, color: theme.color.inkSoft, marginBottom: 16 },
  muted:       { fontSize: 14, color: theme.color.inkSoft },
  row:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.color.line },
  name:        { flex: 1, fontSize: 15, color: theme.color.ink, marginRight: 12 },
  rawKey:      { fontFamily: 'monospace', fontSize: 13, color: theme.color.inkSoft },
  unblock:     { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: theme.color.accent },
  unblockText: { fontSize: 13, color: theme.color.accent },
});
