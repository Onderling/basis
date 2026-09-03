/**
 * basis-mobile v2 — cross-circle SHARE screen (objective L · invariant #2 web≡mobile).
 *
 * The RN parity for web's admin-panel "Shared out of this circle" section + per-item share affordance. It is
 * a THIN renderer over the portable model in `../../core/circleShareScreen.js`, which in turn only calls the
 * composition-root wrappers (`shareItemIntoCircle` / `listSharedItems` / `unshareItemFromCircle`) — no
 * share/seal/revoke logic lives here (invariant #1). Two sections:
 *   • Share an item out — this circle's items, each with a "Share" affordance → enter a target circle →
 *     `shareItemIntoCircle` (canonical-vs-copy handled by the wrapper + enforcement, not the UI).
 *   • Shared into this circle — the deny-by-default resolved list (`listSharedItems`); a canonical (in-place)
 *     share gets a "Stop sharing" action (`unshareItemFromCircle`); a copy shows the `not_revocable` note.
 * Every string goes through `t()` and prefers the SHARED `circle.share.*` keys (invariants #3/#8).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { t } from '../../core/localisation.js';
import { useTheme } from './themeContext.js';
import { outOfCircleShareOffered } from '../../../../basis/src/v2/circleShare.js';
import { loadShareableItems, loadSharedRows, shareOut, shareToRecipient, stopSharing, pickableCircles, pickableRecipients, outOfCircleLinkWarning } from '../../core/circleShareScreen.js';

export default function CircleShareScreen({ circleId, policy, by, recipient, circles, contacts, onBack }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [items, setItems] = useState([]);       // this circle's own shareable items
  const [rows, setRows] = useState([]);          // shared INTO this circle (resolved rows)
  const [pendingShare, setPendingShare] = useState(null);   // itemId whose target-picker is open
  const [target, setTarget] = useState('');      // the picked target circle id (empty until one is selected)
  // The pickable targets: the user's circles minus THIS (source) circle. Reuses the launcher's loaded list.
  const targets = useMemo(() => pickableCircles({ circles, sourceCircleId: circleId }), [circles, circleId]);
  // objective L · Phase 2 — the pickable OUT-OF-CIRCLE recipients: the SAME shared selector web uses, over the
  // Contacten roster. A contact carries the published network key on `pubKey`/`peerAddr` → `recipientNetworkKey`.
  const recipients = useMemo(() => pickableRecipients(contacts), [contacts]);
  // D7 — whether picking here would create a visible out-of-circle link (shared rule; web parity).
  const linkWarning = useMemo(() => outOfCircleLinkWarning(recipients), [recipients]);
  const [status, setStatus] = useState(null);    // { statusKey, params }
  const policyOf = useCallback(async () => policy || {}, [policy]);

  const reloadShared = useCallback(async () => {
    setRows(await loadSharedRows({ circleId, recipient, policyOf }));
  }, [circleId, recipient, policyOf]);
  const reloadItems = useCallback(async () => {
    setItems(await loadShareableItems({ circleId, policy }));
  }, [circleId, policy]);

  useEffect(() => { reloadItems(); reloadShared(); }, [reloadItems, reloadShared]);

  const doShare = useCallback(async (itemId) => {
    const s = await shareOut({ itemId, fromCircleId: circleId, toCircleId: target, by, recipient, policyOf });
    setStatus({ statusKey: s.statusKey, params: s.params });
    setPendingShare(null); setTarget('');
    if (s.ok) reloadShared();
  }, [circleId, target, by, recipient, policyOf, reloadShared]);

  // objective L · Phase 2 — grant an out-of-circle CONTACT the canonical item in place (shareItemToPublishedKey),
  // reusing the picked target circle as the pointer sink. ALONGSIDE doShare (share to a circle's members).
  const doShareToRecipient = useCallback(async (itemId, r) => {
    const s = await shareToRecipient({
      itemId, fromCircleId: circleId, toCircleId: target,
      recipient: r.id, recipientNetworkKey: r.recipientNetworkKey, name: r.name, by, policyOf,
    });
    setStatus({ statusKey: s.statusKey, params: s.params });
    setPendingShare(null); setTarget('');
    if (s.ok) reloadShared();
  }, [circleId, target, by, policyOf, reloadShared]);

  const doStop = useCallback(async (row) => {
    const s = await stopSharing({ row, toCircleId: circleId, recipient, policyOf });
    setStatus({ statusKey: s.statusKey, params: s.params });
    if (s.ok) reloadShared();
  }, [circleId, recipient, policyOf, reloadShared]);

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content} testID="circle-share">
      <View style={styles.header}>
        {typeof onBack === 'function' && (
          <Pressable onPress={onBack} testID="share-back"><Text style={styles.back}>‹ {t('circle.share.screen_title')}</Text></Pressable>
        )}
        <Text style={styles.title}>{t('circle.share.screen_title')}</Text>
      </View>
      {status ? <Text style={styles.notice} testID="share-status">{t(status.statusKey, status.params)}</Text> : null}

      <Section title={t('circle.share.share_out_heading')}>
        {items.length === 0 ? <Text style={styles.muted}>{t('circle.detail_empty')}</Text> : items.map((it) => (
          <View key={it.id} style={styles.itemRow} testID={`share-item-${it.id}`}>
            <View style={styles.itemHead}>
              <Text style={styles.itemText} numberOfLines={2}>{it.text}</Text>
              <Pressable style={styles.chip} onPress={() => { setPendingShare(it.id); setTarget(''); }} testID={`share-open-${it.id}`}>
                <Text style={styles.chipText}>{t('circle.share.share_action')}</Text>
              </Pressable>
            </View>
            {pendingShare === it.id ? (
              <View style={styles.picker} testID={`share-picker-${it.id}`}>
                <Text style={styles.pickLabel}>{t('circle.share.pick_label')}</Text>
                {targets.length === 0 ? (
                  <Text style={styles.muted} testID={`share-picker-empty-${it.id}`}>{t('circle.share.pick_empty')}</Text>
                ) : (
                  <>
                    {targets.map((c) => {
                      const chosen = target === c.id;
                      return (
                        <Pressable
                          key={c.id}
                          style={[styles.pickOption, chosen && styles.pickOptionChosen]}
                          onPress={() => setTarget(c.id)}
                          testID={`share-target-option-${it.id}-${c.id}`}
                        >
                          <Text style={[styles.pickOptionText, chosen && styles.pickOptionTextChosen]} numberOfLines={1}>{c.name}</Text>
                          <Text style={styles.pickOptionId} numberOfLines={1}>{c.id}</Text>
                        </Pressable>
                      );
                    })}
                    <Pressable
                      style={[styles.primary, !target && styles.primaryDisabled]}
                      disabled={!target}
                      onPress={() => doShare(it.id)}
                      testID={`share-confirm-${it.id}`}
                    >
                      <Text style={styles.primaryText}>{t('circle.share.share_action')}</Text>
                    </Pressable>
                    {/* OUT-OF-CIRCLE person share, alongside the share-to-circle path — offered only when the
                        circle's `shareOutOfCircle` policy offers it (the SHARED predicate; the op refuses on the
                        same axis). Enabled once a target circle is picked (the pointer sink); selecting a contact
                        grants them the canonical item in place via shareItemToPublishedKey. */}
                    {outOfCircleShareOffered(policy) ? (<>
                    <Text style={styles.pickLabel}>{t('circle.share.to_person_heading')}</Text>
                    {/* D7 — the out-of-circle LINK warning, BEFORE the pick (web parity). Granting by
                        published network key is a deliberate 1:1 link both sides can see; the rule for when
                        to warn lives in the shared selector, this only draws it. Informed consent, no gate. */}
                    {linkWarning ? (
                      <Text style={styles.linkWarning} testID={`share-link-warning-${it.id}`}>{t(linkWarning.key)}</Text>
                    ) : null}
                    {recipients.length === 0 ? (
                      <Text style={styles.muted} testID={`share-people-empty-${it.id}`}>{t('circle.share.no_contacts')}</Text>
                    ) : recipients.map((r) => (
                      <Pressable
                        key={r.id}
                        style={[styles.pickOption, !target && styles.primaryDisabled]}
                        disabled={!target}
                        onPress={() => doShareToRecipient(it.id, r)}
                        testID={`share-recipient-option-${it.id}-${r.id}`}
                      >
                        <Text style={styles.pickOptionText} numberOfLines={1}>{r.name}</Text>
                        {r.trustLevel ? <Text style={styles.pickOptionId} numberOfLines={1}>{t(`circle.share.trust.${r.trustLevel}`)}</Text> : null}
                      </Pressable>
                    ))}
                    </>) : null}
                  </>
                )}
              </View>
            ) : null}
          </View>
        ))}
      </Section>

      <Section title={rows.length ? t('circle.share.list', { count: rows.length }) : t('circle.share.empty')}>
        {rows.map((row, i) => (
          <View key={`${row.ref?.sourceCircle ?? ''}:${row.ref?.sourceId ?? i}`} style={styles.itemRow} testID={`shared-row-${row.ref?.sourceId ?? i}`}>
            <View style={styles.itemHead}>
              <Text style={styles.itemText} numberOfLines={2}>{row.label}</Text>
              {row.canonical ? (
                <Pressable style={styles.secondary} onPress={() => doStop(row)} testID={`shared-stop-${row.ref?.sourceId ?? i}`}>
                  <Text style={styles.secondaryText}>{t('circle.share.stop')}</Text>
                </Pressable>
              ) : (
                <Text style={styles.muted} testID={`shared-note-${row.ref?.sourceId ?? i}`}>{t('circle.share.not_revocable')}</Text>
              )}
            </View>
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
  back: { fontSize: 13, color: theme.color.accent, fontWeight: '600' },
  title: { fontFamily: theme.font.serif, fontSize: 22, fontWeight: '600', color: theme.color.ink },
  notice: { fontSize: 13, color: theme.color.accent, paddingVertical: 4 },
  section: { borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, padding: 12, gap: 10, backgroundColor: theme.color.paper },
  sectionTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, color: theme.color.inkSoft },
  itemRow: { gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.color.line, paddingTop: 8 },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemText: { flex: 1, fontSize: 14, color: theme.color.ink },
  muted: { fontSize: 13, color: theme.color.inkSoft, fontStyle: 'italic' },
  chip: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: theme.color.accent },
  chipText: { fontSize: 12, fontWeight: '600', color: theme.color.accent },
  picker: { gap: 8 },
  pickLabel: { fontSize: 12, fontWeight: '600', color: theme.color.inkSoft },
  // D7 — the out-of-circle link warning: readable, not alarming (informed consent, not an error).
  linkWarning: { fontSize: 12, color: theme.color.inkSoft, lineHeight: 17, paddingVertical: 4 },
  pickOption: { paddingVertical: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, backgroundColor: theme.color.white },
  pickOptionChosen: { borderColor: theme.color.accent, backgroundColor: theme.color.paper },
  pickOptionText: { fontSize: 14, color: theme.color.ink },
  pickOptionTextChosen: { fontWeight: '700', color: theme.color.accent },
  pickOptionId: { fontSize: 11, color: theme.color.inkSoft },
  primary: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: theme.radius.md, backgroundColor: theme.color.accent, justifyContent: 'center', alignItems: 'center' },
  primaryDisabled: { opacity: 0.4 },
  primaryText: { fontSize: 14, fontWeight: '600', color: theme.color.white },
  secondary: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.line },
  secondaryText: { fontSize: 13, color: theme.color.inkSoft },
});
