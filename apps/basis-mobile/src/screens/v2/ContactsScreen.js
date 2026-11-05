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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { t } from '../../core/localisation.js';
import { useTheme } from './themeContext.js';
import { FAB_CLEARANCE } from './fab.js';
import FaceView from './FaceView.js';
import { splitShownHidden, loadContactRoster, makeContactNameStore, contactRowMeta } from '../../../../basis/src/v2/contactsSource.js';
import { addBotToGraph } from '../../../../basis/src/v2/addBot.js';
import { DEFAULT_PERSONA } from '../../../../basis/src/v2/contactPersona.js';
import { withHelpContact } from '../../../../basis/src/v2/helpContact.js';
// L125 — the add sheet: what the new contact sees of you, asked before the card is added (web parity)
import { useContactLensSheet } from '../../../../basis/src/rn/ContactLensSheet.js';

// `unread` — per contact `{unread, lastTs}` from the shared `buildContactUnread` (the launcher computes it, web parity).
export default function ContactsScreen({ bundle, onOpen, unread = {}, resolvePictureFor = null, onAddPerson = null,
  // the people this device blocks, and the one place a block is undone (web: contactsRoster.js); absent = no door
  onBlocked = null,
  // the help circle is on this device: Contacten shows the help bot as one synthetic row (shared `withHelpContact`)
  helpAvailable = false,
  // the contacts of the selves ticked in the header (shared `contactsInSet`); absent = all
  keep = null }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();   // clear the status bar, as the launcher does
  const styles = useMemo(() => makeStyles(theme, insets), [theme, insets]);
  const peerGraph = bundle?.peerGraph ?? null;
  const callSkill = bundle?.callSkill ?? null;
  const [contacts, setContacts] = useState([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addText, setAddText] = useState('');
  const [error, setError] = useState(false);
  const lens = useContactLensSheet({
    callSkill, pairCircleIdOf: bundle?.pairRoster?.pairCircleIdFor, shareRelease: bundle?.shareCircleRelease, t, theme,
  });
  // Hidden contacts (L106, web parity with contactsRoster.js) fold away at the bottom: the row stays, out of
  // sight, until they write again or the person shows them. A list of only hidden contacts is not empty.
  const [foldOpen, setFoldOpen] = useState(false);
  const { shown, hidden } = useMemo(() => splitShownHidden(contacts), [contacts]);
  // What each row last read HERE — the rename marker's left-hand side. The launcher owns the same store;
  // this screen is the other door onto the same list, so it reads through the same one.
  const contactNames = useMemo(() => makeContactNameStore(AsyncStorage), []);

  // S1 #2 — the unified directory: PeerGraph bots/peers merged with the pinboard
  // ContactBook (people the user added, with trust/tags). Same shared helpers as web.
  const reload = useCallback(async () => {
    // The one Contacten read (web parity): the graph less aliases and my own addresses, the book, merged, and every
    // contact with a pair roster here named by what they said on it.
    try { const all = await loadContactRoster({ peerGraph, agent: bundle?.agent ?? null, callSkill, names: contactNames }); const kept = typeof keep === 'function' ? keep(all) : all; setContacts(withHelpContact(kept, { t, available: helpAvailable })); }
    catch { setContacts([]); }
  }, [peerGraph, callSkill, contactNames, helpAvailable]);

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
        // C13 fast rung — a onderling-contact:// card routes to pinboard's addContactFromQr (the one
        // decoder); the unified roster merges the ContactBook, so the person appears DM-ready.
        // …asking first what they will see of you (L125); closing the sheet adds nothing
        addContact: callSkill ? async (payload) => {
          const r = await lens.addWithSheet(payload);
          if (r === null) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
          return r;
        } : undefined,
      });
      setAddText(''); setAddOpen(false);
      reload();
    } catch (err) {
      if (err?.code === 'cancelled') return;   // the person closed the sheet: nothing added, the text stays
      // A circle invite pasted here is the VERIFIED rung — point at the join flow instead of failing mutely.
      setError(err?.code === 'circle-invite' ? 'invite' : true);
    }
  }, [addText, peerGraph, bundle, callSkill, reload, lens]);

  const rowFor = (c, isHidden = false) => {
    const n = Number(unread?.[c.contactId]?.unread) || 0;   // what is NEW here (2026-09-21), web parity
    return (
      <Pressable
        key={c.contactId}
        style={[styles.row, !c.reachable && styles.rowOffline, isHidden && styles.rowHidden]}
        onPress={() => onOpen?.(c)}
        accessibilityRole="button"
        testID={`contact-row-${c.contactId}`}
      >
        {/* THE FACE, or this person's own first letter (web parity: contactsRoster's icon slot). A bot keeps
            its glyph — it is not a person and has no face. */}
        <FaceView row={c} size={32} fallbackGlyph={c.isBot ? '🤖' : null} resolvePicture={typeof resolvePictureFor === 'function' && !c.synthetic ? resolvePictureFor(c) : null} />
        <View style={styles.body}>
          <Text style={[styles.name, n > 0 && styles.nameUnread]}>
            {c.name}
            {/* two contacts, one name (web parity): every row of the set says which one it is */}
            {c.lookalike ? <Text style={styles.lookalike} accessibilityLabel={t('circle.contacts.lookalike_hint')}>{`  ${c.lookalike}`}</Text> : null}
          </Text>
          {/* …and one who renamed themselves says what they were, until the thread is opened */}
          {c.wasName ? <Text style={styles.wasName}>{t('circle.contacts.was_named', { name: c.wasName })}</Text> : null}
          <Text style={styles.meta}>{contactRowMeta(c, t)}</Text>
        </View>
        {n > 0 ? <Text style={styles.unread} accessibilityLabel={t('circle.contacts.unread', { count: n })} testID={`contact-unread-${c.contactId}`}>{String(n)}</Text> : null}
        <Text style={styles.open}>{t('circle.contacts.open')}</Text>
      </Pressable>
    );
  };

  // at the foot of Contacten: the blocked list (someone blocked is not a contact, so an empty roster has it too)
  const blockedDoor = typeof onBlocked === 'function' ? (
    <Pressable style={styles.blockedDoor} onPress={onBlocked} accessibilityRole="button" testID="contacts-blocked">
      <Text style={styles.blockedText}>{t('circle.contacts.blocked')}</Text>
      <Text style={styles.blockedArrow}>→</Text>
    </Pressable>
  ) : null;

  return (
    <View style={styles.wrap} testID="contacts-screen">
      {lens.sheet}
      <View style={styles.head}>
        <Text style={styles.title}>{t('circle.contacts.title')}</Text>
        {/* the two ways in: a PERSON (the scanner — Me's Scan, the same door) and a bot (its address) */}
        <View style={styles.acts}>
          {typeof onAddPerson === 'function' ? (
            <Pressable style={styles.add} onPress={onAddPerson} accessibilityRole="button" testID="contacts-add-person">
              <Text style={styles.addText}>{t('circle.contacts.add_person')}</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.add} onPress={() => setAddOpen((v) => !v)} accessibilityRole="button" testID="contacts-add">
            <Text style={styles.addText}>{t('circle.contacts.add')}</Text>
          </Pressable>
        </View>
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
        <>
          <Text style={styles.empty}>{t('circle.contacts.empty')}</Text>
          {blockedDoor}
        </>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: FAB_CLEARANCE }}>
          {shown.map((c) => rowFor(c))}
          {hidden.length > 0 ? (
            <Pressable style={styles.fold} onPress={() => setFoldOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: foldOpen }} testID="contacts-hidden-fold">
              <Text style={styles.foldText}>{t('circle.contacts.hidden_fold', { count: hidden.length })}</Text>
            </Pressable>
          ) : null}
          {foldOpen ? hidden.map((c) => rowFor(c, true)) : null}
          {blockedDoor}
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (theme, insets) => StyleSheet.create({
  blockedDoor: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: theme.color.line },
  blockedText: { fontSize: 15, color: theme.color.ink },
  blockedArrow: { fontSize: 15, color: theme.color.inkSoft },
  wrap: { flex: 1, padding: 16, paddingTop: 16 + (insets?.top ?? 0), backgroundColor: theme.color.paper },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontFamily: theme.font.serif, fontSize: 22, fontWeight: '600', color: theme.color.ink },
  acts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', flexShrink: 1 },
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
  nameUnread: { fontWeight: '800' },
  unread: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, textAlign: 'center', lineHeight: 20, fontSize: 12, fontWeight: '700', backgroundColor: theme.color.accent, color: theme.color.white, overflow: 'hidden', marginRight: 8 },
  fold: { paddingVertical: 10, alignItems: 'center' },
  foldText: { fontSize: 13, color: theme.color.inkSoft, textDecorationLine: 'underline' },
  icon: { fontSize: 22 },
  body: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: theme.color.ink },
  lookalike: { fontSize: 12, fontWeight: '400', color: theme.color.inkSoft },
  wasName: { fontSize: 12, fontStyle: 'italic', color: theme.color.inkSoft },
  meta: { fontSize: 12, color: theme.color.inkSoft, marginTop: 2 },
  open: { fontSize: 13, fontWeight: '600', color: theme.color.accent },
});
