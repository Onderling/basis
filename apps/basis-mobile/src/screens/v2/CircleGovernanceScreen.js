/**
 * basis-mobile v2 — governance surface (RN, Wave C §5 L4).
 *
 * RN mirror of web's circleGovernancePanel over the SAME shared model
 * (buildGovernanceView via the shared bindCircleGovernance host; web ≡ mobile by
 * construction). Renders the circle's open decisions with the live tally + deadline and —
 * for this viewer — vote buttons (member-vote), the admin override (past deadline), or a
 * read-only status; settled proposals fall to a compact history; and, admin-only, the
 * "who decides" decision-class settings per governed action.
 *
 * Thin shell: all logic (fold, resolver, enact-gate, roster assembly) lives in shared src;
 * this file resolves my webid, binds the host, renders the model, and re-reads after each
 * action (persisted state, not the tap). RN screens are excluded from vitest — see
 * REMAINING-WORK.md for the on-device verification checklist.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { t } from '../../core/localisation.js';
import { useTheme } from './themeContext.js';
import { bindCircleGovernance } from '../../../../basis/src/v2/governanceAppWiring.js';
import { governanceEntryId } from '../../../../basis/src/v2/governanceLog.js';
import { reportEntryId } from '../../../../basis/src/v2/reportModel.js';
import { buildSubjectLabeler } from '../../../../basis/src/v2/governanceView.js';
import { mergeCirclePolicy, GOVERNANCE_ACTIONS, GOVERNANCE_CLASSES, decisionClassFor } from '../../../../basis/src/v2/circlePolicy.js';

const CLASS_KEY = { 'any-admin': 'any_admin', 'admin-quorum': 'admin_quorum', 'member-vote': 'member_vote' };
const trOr = (key, fallback, params) => { const v = t(key, params); return v === key ? fallback : v; };

export default function CircleGovernanceScreen({ callSkill, eventLog, getPolicy, updatePolicy, circleId, onBack, circleIdentityFor = null }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [model, setModel] = useState({ view: { open: [], closed: [] }, isAdmin: false, policy: null });
  const ctxRef = useRef({ gov: null, myWebid: '' });

  const load = useCallback(async () => {
    let myWebid = '';
    try { const r = await callSkill('stoop', 'whoAmI', {}); myWebid = r?.webid ?? r?.webId ?? ''; } catch { /* */ }
    const broadcast = (channel, circleId, event, opts) => {
      const op = channel === 'report' ? 'broadcastCircleReport' : 'broadcastCircleGovernance';
      const msgId = channel === 'report' ? reportEntryId(event) : (event?.body?.hash ? `gov:${event.body.hash}` : governanceEntryId(event));
      // `opts.to` narrows the fan to the circle's admins on the report channel (story 3.6) — web parity.
      const to = Array.isArray(opts?.to) ? opts.to : undefined;
      callSkill('stoop', op, { groupId: circleId, event, msgId, ts: Date.now(), ...(to ? { to } : {}) }).catch(() => {});
    };
    const gov = bindCircleGovernance({
      eventLog, callSkill, getPolicy, myRef: myWebid, genId: () => `gov-${Math.random().toString(36).slice(2, 10)}`, broadcast,
      circleIdentityFor,
    });
    ctxRef.current = { gov, myWebid };
    let ctx = { policy: {}, members: [] };
    try { ctx = await gov.getContext(circleId); } catch { /* */ }
    const me = (ctx.members || []).find((m) => m.ref === myWebid) || null;
    // Resolve subject refs to member NAMES from the real roster — the governance
    // context carries only {ref, role} (no names), so read handle/displayName from
    // listGroupMembers; unresolved falls back to the raw ref.
    let roster = [];
    try { roster = (await callSkill('stoop', 'listGroupMembers', { groupId: circleId }))?.members ?? []; } catch { /* */ }
    const nameOf = buildSubjectLabeler(roster);
    const labelForSubject = (s) => nameOf(s) ?? (s == null ? '' : String(s));
    let view = { open: [], closed: [] };
    try { view = await gov.view(circleId, { labelForSubject }); } catch { /* */ }
    const isAdmin = me?.role === 'admin';
    let reports = [];
    if (isAdmin) { try { reports = (await gov.reports.list(circleId)).open; } catch { /* */ } }
    setModel({ view, isAdmin, policy: ctx.policy, reports });
  }, [callSkill, eventLog, getPolicy, circleId]);

  useEffect(() => { load(); }, [load]);

  const onVote = useCallback(async (proposalId, choice) => {
    const { gov, myWebid } = ctxRef.current;
    try { await gov?.vote({ circleId, proposalId, voter: myWebid, choice }); } catch { /* */ }
    await load();
  }, [circleId, load]);

  const onOverride = useCallback(async (proposalId) => {
    const { gov, myWebid } = ctxRef.current;
    try { await gov?.override({ circleId, proposalId, actor: { ref: myWebid } }); } catch { /* */ }
    await load();
  }, [circleId, load]);

  const onSetClass = useCallback(async (action, cls) => {
    try {
      const cur = (await getPolicy(circleId)) ?? {};
      await updatePolicy?.(circleId, mergeCirclePolicy(cur, { governance: { [action]: cls } }));
    } catch { /* */ }
    await load();
  }, [getPolicy, updatePolicy, circleId, load]);

  const onReviewDisputed = useCallback(async (ref) => {
    const { gov, myWebid } = ctxRef.current;
    try { await gov?.propose({ circleId, action: 'removeMember', subject: ref, actor: { ref: myWebid } }); } catch { /* */ }
    await load();
  }, [circleId, load]);

  const onDismissReport = useCallback(async (reportId) => {
    try { await ctxRef.current.gov?.reports.dismiss({ circleId, reportId }); } catch { /* */ }
    await load();
  }, [circleId, load]);
  const onActReport = useCallback(async (reportId) => {
    try { await ctxRef.current.gov?.reports.act({ circleId, reportId }); } catch { /* */ }
    await load();
  }, [circleId, load]);

  const statusKey = (row) => (row.approved ? 'approved' : row.rejected ? 'rejected' : 'pending');

  return (
    <ScrollView contentContainerStyle={styles.root} testID="circle-governance">
      <Pressable onPress={onBack} accessibilityRole="button" style={styles.back} testID="circle-governance-back">
        <Text style={styles.backText}>{`← ${t('circle.back')}`}</Text>
      </Pressable>
      <Text style={styles.title}>{t('circle.governance.title')}</Text>

      {(model.view.disputed ?? []).map((d) => (
        <View key={d.ref} style={styles.disputed} testID={`gov-disputed-${d.ref}`}>
          <Text style={styles.disputedLine}>{t('circle.governance.disputed_line', { who: d.label || d.ref })}</Text>
          <Pressable onPress={() => onReviewDisputed(d.ref)} accessibilityRole="button" style={styles.disputedBtn}>
            <Text style={styles.disputedBtnText}>{t('circle.governance.review_remove')}</Text>
          </Pressable>
        </View>
      ))}

      {!model.view.open.length ? (
        <Text style={styles.empty}>{t('circle.governance.none')}</Text>
      ) : null}

      {model.view.open.map((row) => (
        <View key={row.proposalId} style={styles.card} testID={`gov-proposal-${row.proposalId}`}>
          <View style={styles.head}>
            <Text style={styles.action}>
              {t(`circle.governance.action.${row.action}`)}{row.subjectLabel ? `: ${row.subjectLabel}` : ''}
            </Text>
            <Text style={styles.klass}>{t(`circle.governance.class.${CLASS_KEY[row.decisionClass] ?? 'any_admin'}`)}</Text>
          </View>
          <View style={styles.meta}>
            <Text style={[styles.status, styles[`status_${statusKey(row)}`]]}>{t(`circle.governance.status.${statusKey(row)}`)}</Text>
            {row.tally ? (
              <Text style={styles.tally}>{t('circle.governance.tally', { yes: row.tally.yes, need: row.tally.need, of: row.tally.of })}</Text>
            ) : null}
            {row.approved && row.awaitingEnactment ? (
              <Text style={styles.awaiting}>{t('circle.governance.awaiting_enactment')}</Text>
            ) : null}
          </View>
          {row.canVote ? (
            <View style={styles.actions}>
              {['yes', 'no'].map((choice) => (
                <Pressable
                  key={choice}
                  onPress={() => onVote(row.proposalId, choice)}
                  accessibilityRole="button"
                  style={[styles.voteBtn, row.myVote === choice && styles.voteBtnMine]}
                  testID={`gov-vote-${row.proposalId}-${choice}`}
                >
                  <Text style={[styles.voteText, row.myVote === choice && styles.voteTextMine]}>{t(`circle.governance.vote_${choice}`)}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {row.canOverride ? (
            <Pressable onPress={() => onOverride(row.proposalId)} accessibilityRole="button" style={styles.override} testID={`gov-override-${row.proposalId}`}>
              <Text style={styles.overrideText}>{t('circle.governance.override')}</Text>
            </Pressable>
          ) : null}
        </View>
      ))}

      {model.view.closed.length ? (
        <View style={styles.history}>
          <Text style={styles.historyTitle}>{t('circle.governance.history')}</Text>
          {model.view.closed.map((row) => (
            <View key={row.proposalId} style={styles.closed}>
              <Text style={styles.closedWhat}>
                {t(`circle.governance.action.${row.action}`)}{row.subjectLabel ? `: ${row.subjectLabel}` : ''}
              </Text>
              <Text style={[styles.status, styles[`status_${statusKey(row)}`]]}>{t(`circle.governance.status.${statusKey(row)}`)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {model.isAdmin && (model.reports ?? []).length ? (
        <View style={styles.settings}>
          <Text style={styles.settingsTitle}>{t('circle.governance.reports_title')}</Text>
          {model.reports.map((r) => (
            <View key={r.reportId} style={styles.card} testID={`gov-report-${r.reportId}`}>
              <Text style={styles.action}>
                {t(`circle.governance.report_target.${r.targetType}`)}{(r.targetLabel || r.targetRef) ? `: ${r.targetLabel || r.targetRef}` : ''}
              </Text>
              {r.reason ? <Text style={styles.tally}>{r.reason}</Text> : null}
              <View style={styles.actions}>
                <Pressable onPress={() => onDismissReport(r.reportId)} accessibilityRole="button" style={styles.voteBtn}>
                  <Text style={styles.voteText}>{t('circle.governance.report_dismiss')}</Text>
                </Pressable>
                <Pressable onPress={() => onActReport(r.reportId)} accessibilityRole="button" style={styles.override}>
                  <Text style={styles.overrideText}>{t('circle.governance.report_act')}</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {model.isAdmin ? (
        <View style={styles.settings}>
          <Text style={styles.settingsTitle}>{t('circle.governance.settings_title')}</Text>
          {GOVERNANCE_ACTIONS.map((action) => {
            const current = decisionClassFor(model.policy, action);
            return (
              <View key={action} style={styles.setting} testID={`gov-setting-${action}`}>
                <Text style={styles.settingAction}>{t(`circle.governance.action.${action}`)}</Text>
                <View style={styles.classRow}>
                  {GOVERNANCE_CLASSES.map((cls) => (
                    <Pressable
                      key={cls}
                      onPress={() => onSetClass(action, cls)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: cls === current }}
                      style={[styles.classBtn, cls === current && styles.classBtnActive]}
                    >
                      <Text style={[styles.classText, cls === current && styles.classTextActive]}>{t(`circle.governance.class.${CLASS_KEY[cls]}`)}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </ScrollView>
  );
}

const makeStyles = (theme) => {
  const c = theme.color;
  return StyleSheet.create({
    root: { gap: theme.space.md, padding: theme.space.md, paddingBottom: theme.space.xl * 2 },
    back: { alignSelf: 'flex-start', paddingVertical: 4 },
    backText: { fontSize: 13, color: c.inkSoft },
    title: { fontFamily: theme.font.mono, fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.2, color: c.accentInk, borderTopWidth: 3, borderTopColor: c.ink, paddingTop: 6 },
    empty: { fontSize: 13, color: c.inkSoft, fontStyle: 'italic' },

    disputed: { borderWidth: 2, borderColor: c.accentInk, backgroundColor: c.paper, padding: theme.space.sm + 2, gap: 6 },
    disputedLine: { fontSize: 12.5, fontWeight: '700', color: c.accentInk },
    disputedBtn: { alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: theme.space.md, borderWidth: 1, borderColor: c.accentInk },
    disputedBtnText: { fontSize: 12, fontWeight: '700', color: c.accentInk },

    card: { backgroundColor: c.card, borderWidth: 2, borderColor: c.ink, padding: theme.space.md, gap: 6 },
    head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.space.sm, flexWrap: 'wrap' },
    action: { fontSize: 14, fontWeight: '800', color: c.ink, flexShrink: 1 },
    klass: { fontFamily: theme.font.mono, fontSize: 10, color: c.inkSoft, textTransform: 'uppercase', letterSpacing: 0.6 },
    meta: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, flexWrap: 'wrap' },
    status: { fontFamily: theme.font.mono, fontSize: 10.5, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, paddingVertical: 2, paddingHorizontal: 6, overflow: 'hidden' },
    status_approved: { color: c.accentContrast, backgroundColor: c.accentInk },
    status_rejected: { color: c.card, backgroundColor: c.inkSoft },
    status_pending: { color: c.accentInk, borderWidth: 1, borderColor: c.accentInk },
    tally: { fontSize: 12, color: c.ink },
    awaiting: { fontSize: 11, fontStyle: 'italic', color: c.inkSoft },

    actions: { flexDirection: 'row', gap: 6 },
    voteBtn: { paddingVertical: 6, paddingHorizontal: theme.space.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.paper },
    voteBtnMine: { borderColor: c.accent, backgroundColor: c.accent },
    voteText: { fontSize: 13, fontWeight: '700', color: c.ink },
    voteTextMine: { color: c.accentContrast },
    override: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: theme.space.md, borderWidth: 1, borderColor: c.accentInk },
    overrideText: { fontSize: 12, fontWeight: '700', color: c.accentInk },

    history: { gap: 4, marginTop: theme.space.sm },
    historyTitle: { fontFamily: theme.font.mono, fontSize: 10.5, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, color: c.inkSoft },
    closed: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.sm, paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: c.line },
    closedWhat: { fontSize: 12.5, color: c.ink, flexShrink: 1 },

    settings: { gap: 8, marginTop: theme.space.md, borderTopWidth: 1, borderTopColor: c.line, paddingTop: theme.space.md },
    settingsTitle: { fontFamily: theme.font.mono, fontSize: 10.5, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, color: c.accentInk },
    setting: { gap: 4 },
    settingAction: { fontSize: 12.5, fontWeight: '700', color: c.ink },
    classRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
    classBtn: { paddingVertical: 4, paddingHorizontal: 8, borderWidth: 1, borderColor: c.line, backgroundColor: c.paper },
    classBtnActive: { borderColor: c.accent, backgroundColor: c.accent },
    classText: { fontSize: 11, color: c.ink },
    classTextActive: { color: c.accentContrast, fontWeight: '700' },
  });
};
