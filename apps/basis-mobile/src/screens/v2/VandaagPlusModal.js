/**
 * Vandaag's "+" (RN; web twin: web/v2/vandaagPlus.js): the person's own acts (the own-scope attach entries), a free
 * line at the top that fills them ("notitie: melk", "afspraak morgen 14:00 tandarts"), the fields, Save — and, opened on
 * an own row (`edit`), Remove (and, for an act that shares, the contacts to share it with). Painted from the shared model (`PLUS_ACTS`); what a save, a read or a removal does is the
 * host's (`onSave(actId, values, asSelf)` / `onRead(line, asSelf)` / `onRemove(actId)` → null, or the line to show). A moment
 * is typed in words ("morgen om 14:00"), read by the shared bounded reader.
 */
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet, Keyboard, useWindowDimensions } from 'react-native';
import { useTheme } from './themeContext.js';
import Btn from './Btn.js';
import { conversationSelf } from '../../../../basis/src/assistant/plusDoor.js';
import { sectionsOf } from '../../../../basis/src/v2/screenSections.js';
import { ASSISTANT_TABS, assistantTabFor, assistantSectionsOf, assistantAsksSelf, assistantLineAfterRead } from '../../../../basis/src/v2/assistantTabs.js';   // the two tabs, shared (web twin)
import { t, lang } from '../../core/localisation.js';
import { PLUS_ACTS, plusLabel, actRunsAtOnce, plusCardWords, plusMomentNeedsTime, plusAskTime, plusAnswerLineShown } from '../../../../basis/src/v2/vandaagPlus.js';
import { useSheetCap, SHEET_SCROLL } from './sheetCap.js';   // the card's cap in window pixels, the scroll may shrink to it
import ThemedTextInput from './ThemedTextInput.js';   // every text input's colours come from the theme (lint-themed-inputs)

export default function VandaagPlusModal({ visible, onSave, onClose, onRead = null, onRemove = null,
  // opened on an own row whose act shares ("Delen met…"): the contacts it can go to, and what a pick does → null, or the line
  shareTargets = null, onShare = null,
  // opened on an own row: `{ act, id, values, asSelf }` (the shared `plusEditFor`)
  edit = null,
  // several selves ticked in the header: the sheet asks which one this is written as; one ticked: `writeAsSelf`
  selves = [], writeAsSelf = null,
  // the line read to an act more than one circle holds: the card asks which; a pick → `onCircleRun(card, circleId)`, which
  // runs it as the person and answers `{done}` (what it did) or `{error}`; nothing runs before a pick
  onCircleRun = null,
  // the card's no (Cancel): `onCircleCancel(card, asSelf)`, so the conversation says the line was not done
  onCircleCancel = null,
  // the own acts in the order to offer them (most used first: `orderedPlusActs`); absent, the declared order
  acts = PLUS_ACTS,
  // an act that makes nothing (feedback): the host runs it at once — the sheet only hands it over
  onRunAct = null,
  // Vastgezet: the pins to paint (each with `label` and `key`); `onOpenPin(pin)` → `{actId}` (an own act), a line (why
  // nothing opened), or null (it opened a circle); × → `onUnpin(key)`; ☆/★ beside an own act → `onTogglePin(actId)`
  pinned = [], onOpenPin = null, onUnpin = null, pinnedActIds = [], onTogglePin = null,
  // the kept conversation with the assistant (`createPlusThread(...).turns()`: `{who, text}`, oldest first) and how to
  // empty it — web twin: vandaagPlus.js `plus-thread`
  turns = [], onForget = null,
  // what the "+" says as it opens (the shared door's `opening`), asked once per open: `openingFor(asSelf)` →
  // `{intro: {lines, tryLabel, examples}}` the first time, `{news}` once for circles joined since — web twin: `opening`
  openingFor = null,
  // the line naming the route that answers (`plusRouteLine`, shared): painted above the conversation
  routeLine = null,
  // what can be typed here: `suggestFor(line)` → the lines to offer (shared `plusSuggest` over the sheet's pool)
  suggestFor = null,
  // the assistant panel's two tabs (`assistantTabs.js`): the one the person last chose, and what a tap on a tab does
  tab = null, onTab = null }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const sheetCap = useSheetCap(0.92);
  // THE ASSISTANT PANEL is a floating card (web twin: .cc-assistant-panel): inset, tall, ending above the tab bar so the
  // bar stays in sight; while the keyboard is open it takes the full height (the line and its answers need the room)
  const { height: winH } = useWindowDimensions();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const on = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const off = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => { on.remove(); off.remove(); };
  }, []);
  const aboveBar = keyboardOpen ? 8 : 76;   // the tab bar (6 + 48 + 10) and a gap
  const panelHeight = Math.min(sheetCap.maxHeight, winH - aboveBar - 24);
  const [actId, setActId] = useState(null);
  // the sheet scrolls (a long thread, the "/" list): the line is brought into view whenever its place changes, so on
  // open and after each turn the person sees the line, not old turns (web twin: scrollIntoView on the line)
  const scrollRef = useRef(null);
  const lineInView = (e) => {
    const y = e?.nativeEvent?.layout?.y;
    if (typeof y === 'number') scrollRef.current?.scrollTo({ y: Math.max(0, y - 160), animated: false });
  };
  const [values, setValues] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [asSelf, setAsSelf] = useState(writeAsSelf);
  // the conversation of the self this is written as (`turns(asSelf)`, the shared door's). With one self or none ticked it
  // is the general self's (as the door reads it); with several, none until the sheet's question is answered
  const turnsSelf = conversationSelf(asSelf, Array.isArray(selves) ? selves.length : 0);
  const shownTurns = typeof turns === 'function' ? (turnsSelf ? turns(turnsSelf) : []) : turns;
  const [line, setLine] = useState('');
  const [card, setCard] = useState(null);
  const [done, setDone] = useState(null);
  const [opening, setOpening] = useState(null);
  // asked once per open, for the conversation's self; an edit of an own row is no conversation opening
  useEffect(() => {
    if (!visible || edit?.act || typeof openingFor !== 'function' || !turnsSelf) { if (!visible) setOpening(null); return; }
    let live = true;
    Promise.resolve(openingFor(turnsSelf)).then((o) => { if (live) setOpening(o ?? null); }).catch(() => {});
    return () => { live = false; };
  }, [visible]);   // eslint-disable-line react-hooks/exhaustive-deps -- once per open, as on web
  useEffect(() => {
    if (!visible) { setActId(null); setValues({}); setError(null); setBusy(false); setAsSelf(writeAsSelf); setLine(''); setCard(null); setDone(null); return; }
    if (edit?.act) { setActId(edit.act.id); setValues(edit.values ?? {}); setAsSelf(edit.asSelf ?? 'default'); }  // changed as the self that made it
  }, [visible, writeAsSelf, edit]);
  if (!visible) return null;
  const act = PLUS_ACTS.find((a) => a.id === actId) ?? null;
  // which tab shows: the chosen one; an open form shows on Maken, where it is painted (web twin: the same call)
  const shown = assistantTabFor({ chosen: tab, actId, editing: !!edit });
  const inShown = new Set(assistantSectionsOf(shown));
  // several selves ticked and none chosen: "As whom?" comes first, above the tabs, on either tab (shared rule, web twin)
  const asking = assistantAsksSelf({ selves, asSelf });
  // closing tells the host which self and which form were open: a form the "+" opened from a line, closed unsaved, is
  // refused, and the host has the conversation say so (the shared door's `settled`)
  const closeSheet = () => onClose?.({ asSelf, actId, editing: Boolean(edit?.act) });
  const save = async () => {
    setBusy(true);
    const said = await onSave?.(act.id, values, asSelf);
    setBusy(false);
    if (said) setError(said);
  };
  const remove = async () => {
    setBusy(true);
    const said = await onRemove?.(act.id);
    setBusy(false);
    if (said) setError(said);
  };
  const share = async (contact) => {
    setBusy(true);
    const said = await onShare?.(act.id, contact);
    setBusy(false);
    if (said) setError(said);
  };
  // the free line: an own act picks the act and fills the fields below (editable before Save); a circle's act ran at
  // once (`done`) or asks which circle (`card`)
  const read = async () => {
    setDone(null);
    // the ticked self goes with the line: the person's own lists are read and written as that self
    // a slow model is said while the person waits ("even geduld"); its answer replaces it (web twin: circleApp.js)
    const r = await onRead?.(line, asSelf, { onSlow: () => { setDone(t('circle.bot.slow')); setError(null); } });
    setCard(r?.card && Array.isArray(r.card.to) && r.card.to.length ? r.card : null);
    // the question gives way once the thread holds its answer (shared rule; the web repaints its line empty)
    setLine((cur) => assistantLineAfterRead(cur, r));
    if (r?.card) setError(null);
    else if (r && 'done' in r) { setDone(r.done ?? null); setError(null); }
    else if (r?.actId) { setActId(r.actId); setValues((cur) => ({ ...cur, ...r.values })); setError(null); }
    else if (r?.error) setError(r.error);
  };
  const runIn = async (circleId) => {
    const c = card;
    setCard(null);
    setBusy(true);
    const r = await onCircleRun?.(c, circleId, asSelf);
    setBusy(false);
    if (r?.error) setError(r.error); else { setDone(r?.done ?? null); setError(null); }
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={closeSheet}>
      {/* a touch outside the card leaves as "Klaar" does (closeSheet: an unsaved form the line opened is settled) */}
      <Pressable style={[styles.backdrop, { paddingBottom: aboveBar }]} onPress={closeSheet} testID="vandaag-plus-backdrop" accessible={false}>
        <Pressable style={[styles.card, { height: panelHeight, maxHeight: panelHeight }]} onPress={() => {}} testID="vandaag-plus" accessible={false}>
          {/* the sheet scrolls: a long thread or the "/" list must never push the line and the first lines off the screen */}
          <ScrollView ref={scrollRef} style={SHEET_SCROLL} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.cardBody} testID="vandaag-plus-scroll">
          <Text style={styles.title}>{t(edit ? 'circle.vandaag.plus_edit' : 'circle.vandaag.plus')}</Text>
          {/* the two tabs under the title (web twin: circle-vandaag-plus__tabs); none when opened on an own row */}
          {!edit ? (
            <View style={styles.tabs} accessibilityRole="tablist">
              {ASSISTANT_TABS.map((x) => (
                <Pressable key={x.id} onPress={() => onTab?.(x.id)} accessibilityRole="tab" accessibilityState={{ selected: x.id === shown }}
                  testID={`vandaag-plus-tab-${x.id}`} style={[styles.tab, x.id === shown ? styles.tabOn : null]}>
                  <Text style={[styles.tabText, x.id === shown ? styles.tabTextOn : null]}>{t(x.labelKey)}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {/* which route answers this conversation, and whether it is confidential (web twin: circle-vandaag-plus__route) */}
          {!edit && routeLine && shown === 'gesprek' && !asking ? <Text style={styles.route} testID="vandaag-plus-route">{routeLine}</Text> : null}
          {/* "As whom?": nothing below can be used before it is answered, so it is asked here, on either tab (web twin) */}
          {asking ? (
            <View testID="vandaag-plus-ask-self">
              <Text style={styles.label}>{t('circle.vandaag.plus_as')}</Text>
              {selves.map((p) => (
                <Btn key={p.id} style={styles.btnAt} onPress={() => setAsSelf(p.id)} testID={`vandaag-plus-self-${p.id}`}
                  label={p.id === 'default' ? t('circle.switcher.you') : (p.name || p.id)} />
              ))}
            </View>
          ) : null}
          {/* the sheet's DECLARED sections (`screenSections.js` plusSheet), in order, each by its id (= the web data-section) */}
          {sectionsOf('plusSheet').map((d) => {
            if (!inShown.has(d.id)) return null;   // a section of the other tab
            const piece = {
              'plus-thread': () => (!edit && !asking && (opening?.intro || opening?.news || (Array.isArray(shownTurns) && shownTurns.length)) ? (
            <View testID="vandaag-plus-thread" accessibilityLabel={t('circle.vandaag.plus_thread')}>
              {/* what the "+" says as it opens: what it is, with examples from what the person has; or, once, what is new */}
              {opening?.news ? <Text style={styles.turn} testID="vandaag-plus-news">{opening.news}</Text> : null}
              {opening?.intro ? (
                <View testID="vandaag-plus-intro">
                  {(opening.intro.lines ?? []).map((l, i) => <Text key={`intro-${i}`} style={styles.turn}>{l}</Text>)}
                  <Text style={styles.turn}>{opening.intro.tryLabel}</Text>
                  {(opening.intro.examples ?? []).map((ex) => (
                    // a tap puts the example in the line; it does not send (web twin: circle-vandaag-plus__example)
                    <Btn key={ex} variant="ghost" style={styles.btnAt} onPress={() => setLine(ex)} testID="vandaag-plus-example" label={ex} />
                  ))}
                </View>
              ) : null}
              {shownTurns.map((turn, i) => (
                <Text key={`${turn.ts ?? i}-${i}`} testID={`vandaag-plus-turn-${turn.who === 'you' ? 'you' : 'assistant'}`}
                  style={[styles.turn, turn.who === 'you' ? styles.turnYou : null]}>{turn.text}</Text>
              ))}
              {onForget ? <Btn variant="ghost" style={styles.btnAt} onPress={() => onForget(turnsSelf)} testID="vandaag-plus-forget" label={t('circle.vandaag.plus_forget')} /> : null}
            </View>
          ) : null),
              'plus-line': () => (!edit && onRead && !asking ? (<>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {/* with a form open the line shows what was said but takes no typing or focus: the form below has them */}
              <ThemedTextInput style={[styles.input, { flex: 1 }]} value={line} onChangeText={setLine} onSubmitEditing={read} returnKeyType="go" numberOfLines={1} editable={!act}
                placeholder={t('circle.vandaag.plus_line_ph')} accessibilityLabel={t('circle.vandaag.plus_line_ph')} autoCapitalize="none" testID="vandaag-plus-line" />
              {/* Enter reads it, and so does this (a phone keyboard's Enter is not where a person looks) */}
              <Btn variant="primary" onPress={read} testID="vandaag-plus-read" label={t('circle.vandaag.plus_line_read')} />
            </View>
            {/* as the person types: the lines the "+" reads here that start with it; a tap puts one in the line (web twin) */}
            {!act && typeof suggestFor === 'function' ? (suggestFor(line) ?? []).map((s) => (
              <Btn key={s} variant="ghost" style={styles.btnAt} onPress={() => setLine(s)} testID="vandaag-plus-suggestion" label={s} />
            )) : null}
          </>) : null),
              'plus-own': () => (asking ? null : !act ? acts.map((a) => (
            <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Btn style={styles.btnAt} onPress={() => (actRunsAtOnce(a) && typeof onRunAct === 'function' ? onRunAct(a) : setActId(a.id))} testID={`vandaag-plus-${a.id}`} label={plusLabel(t, a)} />
              {onTogglePin ? (
                <Pressable onPress={() => onTogglePin(a.id)} accessibilityRole="button" testID={`vandaag-plus-pin-${a.id}`}
                  accessibilityLabel={t(pinnedActIds.includes(a.id) ? 'circle.vandaag.unpin' : 'circle.vandaag.pin')} style={{ paddingHorizontal: 8 }}>
                  <Text style={styles.btnText}>{pinnedActIds.includes(a.id) ? '★' : '☆'}</Text>
                </Pressable>
              ) : null}
            </View>
          )) : (
            <View>
              {act.fields.map((f) => (
                <View key={f.name} style={styles.field}>
                  <Text style={styles.label}>{f.labelKey ? t(f.labelKey) : f.name}</Text>
                  {/* a day was said but no time: ask for it (web twin); Save waits until the time is there */}
                  {f.kind === 'datetime' && plusMomentNeedsTime(act, values) ? (
                    <Text style={styles.label} testID="vandaag-plus-ask-time">{plusAskTime(act, values, { t, lang: lang() })}</Text>
                  ) : null}
                  <ThemedTextInput style={styles.input} value={values[f.name] ?? ''} testID={`vandaag-plus-${f.name}`}
                    onChangeText={(v) => setValues((cur) => ({ ...cur, [f.name]: v }))} />
                </View>
              ))}
              <Btn disabled={busy || !!plusMomentNeedsTime(act, values)} onPress={save} testID="vandaag-plus-save" label={t('circle.vandaag.plus_save')} style={styles.btnAt} />
              {edit && onRemove ? (
                <Btn disabled={busy} onPress={remove} testID="vandaag-plus-remove" label={t('circle.vandaag.plus_remove')} style={styles.btnAt} />
              ) : null}
              {/* …and share it with a contact: one button per contact a pair circle connects */}
              {edit && act.share && onShare && Array.isArray(shareTargets) ? (
                <View testID="vandaag-plus-share">
                  <Text style={styles.label}>{t(`circle.button.${act.appOrigin}.${act.share}`)}</Text>
                  {shareTargets.length ? null : <Text style={styles.label}>{t('circle.vandaag.plus_share_none')}</Text>}
                  {shareTargets.map((c) => (
                    <Btn key={c.id} style={styles.btnAt} disabled={busy} onPress={() => share(c.id)} testID={`vandaag-plus-share-${c.id}`} label={c.label} />
                  ))}
                </View>
              ) : null}
            </View>
          )),
              // Vastgezet — on a fresh sheet: an own pin picks its act here; a bookmark OPENS its circle (never runs the op)
              'plus-pinned': () => (!edit && !act && !asking && pinned.length ? pinned.map((p) => (
                <View key={p.key} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Btn label={p.label} testID={`vandaag-plus-pinned-${p.key}`} style={styles.btnAt} onPress={async () => {
                    const r = await onOpenPin?.(p);
                    if (typeof r === 'string') setError(r);
                    else if (r?.actId) { setActId(r.actId); setError(null); }
                  }} />
                  {onUnpin ? (
                    <Pressable onPress={() => onUnpin(p.key)} accessibilityRole="button" accessibilityLabel={t('circle.vandaag.unpin')} testID={`vandaag-plus-unpin-${p.key}`} style={{ paddingHorizontal: 8 }}>
                      <Text style={styles.btnText}>×</Text>
                    </Pressable>
                  ) : null}
                </View>
              )) : null),
            }[d.id]?.();
            if (!piece) return null;
            return (
              <View key={d.id} testID={d.id} onLayout={d.id === 'plus-line' ? lineInView : undefined}>
                {d.titleKey ? <Text style={styles.label}>{t(d.titleKey)}</Text> : null}
                {piece}
              </View>
            );
          })}
          {card ? (
            <View testID="vandaag-plus-card">
              {/* the shared wording: the own place confirms the act; a choice of places asks which (web twin: vandaagPlus.js) */}
              <Text style={styles.label}>{plusCardWords(card, { t }).question}</Text>
              {card.to.map((r) => (
                <Btn key={r.circleId} label={plusCardWords(card, { t }).labelFor(r)}
                  onPress={() => runIn(r.circleId)} disabled={busy} testID={`vandaag-plus-card-in-${r.circleId}`} style={styles.btnAt} />
              ))}
              <Btn variant="ghost" label={t('circle.confirm.cancel')} onPress={() => { const c = card; setCard(null); onCircleCancel?.(c, asSelf); }} testID="vandaag-plus-card-no" style={styles.btnAt} />
            </View>
          ) : null}
          {/* an answer or error the thread already holds is not said twice (shared rule; web twin: the same call) */}
          {plusAnswerLineShown(done, shownTurns) ? <Text style={styles.label} testID="vandaag-plus-done">{done}</Text> : null}
          {plusAnswerLineShown(error, shownTurns) ? <Text style={styles.error} testID="vandaag-plus-error">{error}</Text> : null}
          {/* the way out, not one of the acts */}
          <Btn variant="ghost" onPress={closeSheet} testID="vandaag-plus-close" label={t('circle.vandaag.done')} style={styles.btnAt} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end', paddingHorizontal: 12 },
  card: { backgroundColor: theme.color.card, borderRadius: 16, padding: 16, elevation: 8 },
  cardBody: { gap: 8 },
  title: { fontSize: 17, fontWeight: '700', color: theme.color.ink, marginBottom: 4 },
  field: { gap: 4, marginBottom: 8 },
  label: { fontSize: 13, color: theme.color.inkSoft },
  route: { fontSize: 13, color: theme.color.inkSoft, marginBottom: 6 },
  tabs: { flexDirection: 'row', gap: 4, borderBottomWidth: 1, borderBottomColor: theme.color.line, marginBottom: 6 },
  tab: { paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: theme.color.accent },
  tabText: { fontSize: 14, color: theme.color.inkSoft },
  tabTextOn: { color: theme.color.accent, fontWeight: '600' },
  // a turn of the kept conversation: the assistant's on the left, the person's own to the right
  turn: { fontSize: 14, color: theme.color.ink, marginVertical: 2, alignSelf: 'flex-start' },
  turnYou: { alignSelf: 'flex-end', color: theme.color.inkSoft },
  input: { fontSize: 14, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, color: theme.color.ink },
  btnAt: { alignSelf: 'flex-start', marginTop: 6 },   // one button family (Btn), each at its own width as on web
  btnText: { color: theme.color.ink, fontSize: 14 },
  error: { color: theme.color.accent, fontSize: 13 },
});
