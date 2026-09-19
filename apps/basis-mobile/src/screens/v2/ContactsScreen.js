/**
 * basis-mobile v2 — Contacten roster (feedback-extension, mobile parity).
 *
 * RN mirror of web's `renderContactsRoster` + add-a-bot. Reads the app-owned
 * PeerGraph (`bundle.peerGraph`) via the SHARED `listContacts`, and adds a bot via
 * the SHARED `addBotToGraph` (URL → reuse `discoverA2A`; raw address → upsert).
 * The roster + the conversation logic are shared web≡mobile; only this RN shell
 * (and the thread screen) is platform code.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet } from 'react-native';
import { t } from '../../core/localisation.js';
import { useTheme } from './themeContext.js';
import { listContacts, mergeContacts, stoopContactToRow, splitShownHidden } from '../../../../basis/src/v2/contactsSource.js';
import { addBotToGraph } from '../../../../basis/src/v2/addBot.js';

export default function ContactsScreen({ bundle, onOpen }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const peerGraph = bundle?.peerGraph ?? null;
  const callSkill = bundle?.callSkill ?? null;
  const [contacts, setContacts] = useState([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addText, setAddText] = useState('');
  const [error, setError] = useState(false);
  // Hidden contacts (L106, web parity with contactsRoster.js) fold away at the bottom: the row stays, out of
  // sight, until they write again or the person shows them. A list of only hidden contacts is not empty.
  const [foldOpen, setFoldOpen] = useState(false);
  const { shown, hidden } = useMemo(() => splitShownHidden(contacts), [contacts]);

  // S1 #2 — the unified directory: PeerGraph bots/peers merged with the stoop
  // ContactBook (people the user added, with trust/tags). Same shared helpers as web.
  const reload = useCallback(async () => {
    try {
      const [peerRows, stoopRes] = await Promise.all([
        // A member's per-circle address is where they are reached in one circle, never a second contact.
        listContacts(peerGraph, { identityOf: (a) => bundle?.agent?.identityOfAddress?.(a) ?? null }).catch(() => []),
        (typeof callSkill === 'function' ? callSkill('stoop', 'listContacts', {}) : Promise.resolve(null)).catch(() => null),
      ]);
      const stoopRows = (Array.isArray(stoopRes?.contacts) ? stoopRes.contacts : []).map(stoopContactToRow).filter(Boolean);
      setContacts(mergeContacts(peerRows, stoopRows));
    } catch { setContacts([]); }
  }, [peerGraph, callSkill]);

  // Load on mount + whenever the graph changes (a bot added/discovered/removed).
  useEffect(() => {
    reload();
    if (!peerGraph || typeof peerGraph.on !== 'function') return undefined;
    const h = () => { reload(); };
    for (const ev of ['added', 'removed', 'reachable', 'unreachable', 'cleared']) peerGraph.on(ev, h);
    return () => { for (const ev of ['added', 'removed', 'reachable', 'unreachable', 'cleared']) peerGraph.off?.(ev, h); };
  }, [peerGraph, reload]);

  const submitAdd = useCallback(async () => {
    const input = addText.trim();
    if (!input) return;
    setError(false);
    try {
      // A PeerGraph peer/bot (an agent-card URL or a peer address). Same precedence as web's addBotFromInput.
      await addBotToGraph({
        input, peerGraph, coreAgent: bundle?.coreAgent, discover: bundle?.discoverA2A,
        // C13 fast rung — a onderling-contact:// card routes to stoop's addContactFromQr (the one
        // decoder); the unified roster merges the ContactBook, so the person appears DM-ready.
        addContact: callSkill ? (payload) => callSkill('stoop', 'addContactFromQr', { payload }) : undefined,
      });
      setAddText(''); setAddOpen(false);
      reload();
    } catch (err) {
      // A circle invite pasted here is the VERIFIED rung — point at the join flow instead of failing mutely.
      setError(err?.code === 'circle-invite' ? 'invite' : true);
    }
  }, [addText, peerGraph, bundle, callSkill, reload]);

  const rowFor = (c, isHidden = false) => (
    <Pressable
      key={c.contactId}
      style={[styles.row, !c.reachable && styles.rowOffline, isHidden && styles.rowHidden]}
      onPress={() => onOpen?.(c)}
      accessibilityRole="button"
      testID={`contact-row-${c.contactId}`}
    >
      <Text style={styles.icon}>{c.isBot ? '🤖' : '👤'}</Text>
      <View style={styles.body}>
        <Text style={styles.name}>{c.name}</Text>
        <Text style={styles.meta}>{rosterMeta(c)}</Text>
      </View>
      <Text style={styles.open}>{t('circle.contacts.open')}</Text>
    </Pressable>
  );

  return (
    <View style={styles.wrap} testID="contacts-screen">
      <View style={styles.head}>
        <Text style={styles.title}>{t('circle.contacts.title')}</Text>
        <Pressable style={styles.add} onPress={() => setAddOpen((v) => !v)} accessibilityRole="button" testID="contacts-add">
          <Text style={styles.addText}>{t('circle.contacts.add')}</Text>
        </Pressable>
      </View>

      {addOpen && (
        <View style={styles.addRow}>
          <TextInput
            style={styles.addInput}
            value={addText}
            onChangeText={setAddText}
            placeholder={t('circle.contacts.add_prompt')}
            placeholderTextColor={theme.color.inkSoft}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={submitAdd}
            testID="contacts-add-input"
          />
          <Pressable style={styles.addSubmit} onPress={submitAdd} accessibilityRole="button" testID="contacts-add-submit">
            <Text style={styles.addSubmitText}>{t('circle.contacts.send')}</Text>
          </Pressable>
        </View>
      )}
      {error && <Text style={styles.error}>{t(error === 'invite' ? 'circle.contacts.invite_not_contact' : 'circle.contacts.add_failed')}</Text>}

      {contacts.length === 0 ? (
        <Text style={styles.empty}>{t('circle.contacts.empty')}</Text>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          {shown.map((c) => rowFor(c))}
          {hidden.length > 0 ? (
            <Pressable style={styles.fold} onPress={() => setFoldOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: foldOpen }} testID="contacts-hidden-fold">
              <Text style={styles.foldText}>{t('circle.contacts.hidden_fold', { count: hidden.length })}</Text>
            </Pressable>
          ) : null}
          {foldOpen ? hidden.map((c) => rowFor(c, true)) : null}
        </ScrollView>
      )}
    </View>
  );
}

function rosterMeta(c) {
  const bits = [];
  if (c.isBot) bits.push(t('circle.contacts.bot'));
  if (c.isBot && c.skillCount > 0) bits.push(t('circle.contacts.skills', { count: c.skillCount }));
  // S1 #2 — a ContactBook person's trust level + tags.
  if (!c.isBot && c.trustLevel) bits.push(t(`circle.contacts.trust.${c.trustLevel}`));
  if (c.pairCircleId) bits.push(t('circle.contacts.connected'));   // the pair roster exists (L105)
  if (!c.isBot && Array.isArray(c.tags) && c.tags.length) bits.push(c.tags.join(', '));
  if (!c.reachable) bits.push(t('circle.contacts.offline'));
  return bits.join(' · ');
}

const makeStyles = (theme) => StyleSheet.create({
  wrap: { flex: 1, padding: 16, backgroundColor: theme.color.paper },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontFamily: theme.font.serif, fontSize: 22, fontWeight: '600', color: theme.color.ink },
  add: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.accent },
  addText: { fontSize: 13, fontWeight: '600', color: theme.color.accent },
  addRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  addInput: { flex: 1, fontSize: 14, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, color: theme.color.ink, backgroundColor: theme.color.white },
  addSubmit: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: theme.radius.md, backgroundColor: theme.color.accent, justifyContent: 'center' },
  addSubmitText: { fontSize: 14, fontWeight: '600', color: theme.color.white },
  error: { fontSize: 13, color: '#b3261e', marginBottom: 8 },
  empty: { fontSize: 14, color: theme.color.inkSoft, paddingVertical: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md },
  rowOffline: { opacity: 0.6 },
  rowHidden: { opacity: 0.5 },
  fold: { paddingVertical: 10, alignItems: 'center' },
  foldText: { fontSize: 13, color: theme.color.inkSoft, textDecorationLine: 'underline' },
  icon: { fontSize: 22 },
  body: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: theme.color.ink },
  meta: { fontSize: 12, color: theme.color.inkSoft, marginTop: 2 },
  open: { fontSize: 13, fontWeight: '600', color: theme.color.accent },
});
