/**
 * basis-mobile v2 — circle admin panel (RN, S3 parity).
 *
 * RN mirror of web's circleAdminPanel: member roster (+ remove), announcements,
 * and muted peers (+ unmute). Self-contained: loads listGroupMembers/listMutedPeers
 * + dispatches the admin-gated stoop ops via the injected `callSkill` (a refusal
 * surfaces a notice).
 *
 * Reports are NOT here: moderation reports live on the ONE §8 surface — the
 * governance "Decisions" panel's Reports section (file · dismiss · act→remove),
 * which supersedes the old read-only `listReports` view this screen used to carry.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet } from 'react-native';
import { t } from '../../core/localisation.js';
import { removeCircleMember } from '../../../../basis/src/v2/circleMembershipHygiene.js';
import { useTheme } from './themeContext.js';

export default function CircleAdminPanelScreen({ callSkill, agent = null, groupId, onBack }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [members, setMembers] = useState([]);
  const [muted, setMuted] = useState([]);
  const [announce, setAnnounce] = useState('');
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    if (typeof callSkill !== 'function') return;
    const [mem, mut] = await Promise.all([
      callSkill('stoop', 'listGroupMembers', { groupId }).catch(() => null),
      callSkill('stoop', 'listMutedPeers', {}).catch(() => null),
    ]);
    setMembers(Array.isArray(mem?.members) ? mem.members : []);
    setMuted(Array.isArray(mut?.peers) ? mut.peers : []);   // reports moved to §8 governance Reports
  }, [callSkill, groupId]);

  useEffect(() => { load(); }, [load]);

  // B4 — the SAME shared op web uses (`removeCircleMember`): remove from THIS circle only, unbind
  // that member's per-circle address, then re-record the authorize snapshot from a fresh roster read.
  // Mobile previously called the raw skill and did neither of the last two, so a member removed on a
  // phone could still speak into the circle — the drift invariant 2 exists to catch.
  const remove = useCallback(async (m) => {
    setNotice(null);
    try {
      const r = await removeCircleMember({
        agent, callSkill,
        circleId: groupId,
        memberWebid: m.webid,
        memberStableId: m.stableId,
      });
      setNotice(r?.ok
        ? t('circle.admin.removed', { name: m.displayName || m.handle || m.webid })
        : t('circle.admin.refused'));
    } catch { setNotice(t('circle.admin.refused')); }
    load();
  }, [agent, callSkill, groupId, load]);
  const postAnnounce = useCallback(async () => {
    const text = announce.trim(); if (!text) return;
    setAnnounce(''); setNotice(null);
    try { const r = await callSkill('stoop', 'postAnnouncement', { groupId, text }); setNotice(r?.error ? t('circle.admin.refused') : t('circle.admin.announced')); }
    catch { setNotice(t('circle.admin.refused')); }
  }, [announce, callSkill, groupId]);
  const unmute = useCallback(async (key) => {
    try { await callSkill('stoop', 'unmutePeer', key.startsWith('webid:') ? { peerWebid: key.slice(6) } : { peerStableId: key }); } catch { /* */ }
    load();
  }, [callSkill, load]);

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content} testID="circle-admin">
      <View style={styles.header}>
        {typeof onBack === 'function' && <Pressable onPress={onBack} testID="admin-back"><Text style={styles.back}>{t('circle.admin.back')}</Text></Pressable>}
        <Text style={styles.title}>{t('circle.admin.title')}</Text>
      </View>
      {notice && <Text style={styles.notice}>{notice}</Text>}

      <Section title={t('circle.admin.members')}>
        {members.length === 0 ? <Text style={styles.muted}>{t('circle.admin.no_members')}</Text> : members.map((m) => (
          <View key={m.webid || m.handle} style={styles.row} testID={`admin-member-${m.webid}`}>
            <Text style={styles.name}>{m.displayName || m.handle || m.webid}</Text>
            {m.role && m.role !== 'member' && <Text style={styles.role}>{t(`circle.admin.role.${m.role}`)}</Text>}
            <Pressable style={styles.secondary} onPress={() => remove(m)}><Text style={styles.secondaryText}>{t('circle.admin.remove')}</Text></Pressable>
          </View>
        ))}
      </Section>

      <Section title={t('circle.admin.announce')}>
        <TextInput style={styles.area} value={announce} onChangeText={setAnnounce} placeholder={t('circle.admin.announce_placeholder')} placeholderTextColor={theme.color.inkSoft} multiline testID="admin-announce" />
        <Pressable style={styles.primary} onPress={postAnnounce} testID="admin-announce-post"><Text style={styles.primaryText}>{t('circle.admin.announce_post')}</Text></Pressable>
      </Section>

      {/* reports moved to the §8 governance "Decisions" Reports section — see the header note */}

      <Section title={t('circle.admin.muted')}>
        {muted.length === 0 ? <Text style={styles.muted}>{t('circle.admin.no_muted')}</Text> : muted.map((key) => (
          <View key={key} style={styles.row}>
            <Text style={styles.name}>{String(key).replace(/^webid:/, '')}</Text>
            <Pressable style={styles.secondary} onPress={() => unmute(key)}><Text style={styles.secondaryText}>{t('circle.admin.unmute')}</Text></Pressable>
          </View>
        ))}
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.paper },
  content: { padding: 16, gap: 16, paddingBottom: 80 },
  header: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  back: { fontSize: 13, color: theme.color.inkSoft },
  title: { fontFamily: theme.font.serif, fontSize: 22, fontWeight: '600', color: theme.color.ink },
  notice: { fontSize: 13, color: theme.color.accent, paddingVertical: 4 },
  section: { borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, padding: 12, gap: 10, backgroundColor: theme.color.paper },
  sectionTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, color: theme.color.inkSoft },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { flex: 1, fontSize: 14, color: theme.color.ink },
  role: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', color: theme.color.accent },
  muted: { fontSize: 13, color: theme.color.inkSoft },
  area: { fontSize: 14, paddingVertical: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, color: theme.color.ink, backgroundColor: theme.color.white, minHeight: 56, textAlignVertical: 'top' },
  primary: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: theme.radius.md, backgroundColor: theme.color.accent, alignSelf: 'flex-start' },
  primaryText: { fontSize: 14, fontWeight: '600', color: theme.color.white },
  secondary: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.line },
  secondaryText: { fontSize: 13, color: theme.color.inkSoft },
});
