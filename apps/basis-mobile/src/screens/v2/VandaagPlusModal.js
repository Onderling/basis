/**
 * Vandaag's "+" (RN; web twin: web/v2/vandaagPlus.js): the person's own acts (the own-scope attach entries), a free
 * line at the top that fills them ("notitie: melk", "afspraak morgen 14:00 tandarts"), the fields, Save — and, opened on
 * an own row (`edit`), Remove (and, for an act that shares, the contacts to share it with). Painted from the shared model (`PLUS_ACTS`); what a save, a read or a removal does is the
 * host's (`onSave(actId, values, asSelf)` / `onRead(line)` / `onRemove(actId)` → null, or the line to show). A moment
 * is typed in words ("morgen om 14:00"), read by the shared bounded reader.
 */
import React, { useMemo, useState, useEffect } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { useTheme } from './themeContext.js';
import Btn from './Btn.js';
import { sectionsOf } from '../../../../basis/src/v2/screenSections.js';
import { t } from '../../core/localisation.js';
import { PLUS_ACTS, plusLabel } from '../../../../basis/src/v2/vandaagPlus.js';

export default function VandaagPlusModal({ visible, onSave, onClose, onRead = null, onRemove = null,
  // opened on an own row whose act shares ("Delen met…"): the contacts it can go to, and what a pick does → null, or the line
  shareTargets = null, onShare = null,
  // opened on an own row: `{ act, id, values, asSelf }` (the shared `plusEditFor`)
  edit = null,
  // several selves ticked in the header: the sheet asks which one this is written as; one ticked: `writeAsSelf`
  selves = [], writeAsSelf = null,
  // the line named something that lives in a circle: the sheet opens it there (`onOpenCircle(id)`), never acts on it
  onOpenCircle = null,
  // the own acts in the order to offer them (most used first: `orderedPlusActs`); absent, the declared order
  acts = PLUS_ACTS,
  // Vastgezet: the pins to paint (each with `label` and `key`); `onOpenPin(pin)` → `{actId}` (an own act), a line (why
  // nothing opened), or null (it opened a circle); × → `onUnpin(key)`; ☆/★ beside an own act → `onTogglePin(actId)`
  pinned = [], onOpenPin = null, onUnpin = null, pinnedActIds = [], onTogglePin = null }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [actId, setActId] = useState(null);
  const [values, setValues] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [asSelf, setAsSelf] = useState(writeAsSelf);
  const [line, setLine] = useState('');
  const [referral, setReferral] = useState(null);
  useEffect(() => {
    if (!visible) { setActId(null); setValues({}); setError(null); setBusy(false); setAsSelf(writeAsSelf); setLine(''); setReferral(null); return; }
    if (edit?.act) { setActId(edit.act.id); setValues(edit.values ?? {}); setAsSelf(edit.asSelf ?? 'default'); }  // changed as the self that made it
  }, [visible, writeAsSelf, edit]);
  if (!visible) return null;
  const act = PLUS_ACTS.find((a) => a.id === actId) ?? null;
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
  // the free line: what it understood picks the act and fills the fields below (editable before Save), never a circle
  const read = async () => {
    const r = await onRead?.(line);
    setReferral(Array.isArray(r?.referral) && r.referral.length ? r.referral : null);
    if (r?.referral) setError(null);
    else if (r?.actId) { setActId(r.actId); setValues((cur) => ({ ...cur, ...r.values })); setError(null); }
    else if (r?.error) setError(r.error);
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card} testID="vandaag-plus">
          <Text style={styles.title}>{t(edit ? 'circle.vandaag.plus_edit' : 'circle.vandaag.plus')}</Text>
          {/* the sheet's DECLARED sections (`screenSections.js` plusSheet), in order, each by its id (= the web data-section) */}
          {sectionsOf('plusSheet').map((d) => {
            const piece = {
              'plus-line': () => (!edit && onRead && !(selves.length > 1 && !asSelf) ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TextInput style={[styles.input, { flex: 1 }]} value={line} onChangeText={setLine} onSubmitEditing={read} returnKeyType="go" numberOfLines={1}
                placeholder={t('circle.vandaag.plus_line_ph')} accessibilityLabel={t('circle.vandaag.plus_line_ph')} testID="vandaag-plus-line" />
              {/* Enter reads it, and so does this (a phone keyboard's Enter is not where a person looks) */}
              <Btn variant="primary" onPress={read} testID="vandaag-plus-read" label={t('circle.vandaag.plus_line_read')} />
            </View>
          ) : null),
              'plus-own': () => (selves.length > 1 && !asSelf ? (
            <View>
              <Text style={styles.label}>{t('circle.vandaag.plus_as')}</Text>
              {selves.map((p) => (
                <Btn key={p.id} style={styles.btnAt} onPress={() => setAsSelf(p.id)} testID={`vandaag-plus-self-${p.id}`}
                  label={p.id === 'default' ? t('circle.switcher.you') : (p.name || p.id)} />
              ))}
            </View>
          ) : !act ? acts.map((a) => (
            <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Btn style={styles.btnAt} onPress={() => setActId(a.id)} testID={`vandaag-plus-${a.id}`} label={plusLabel(t, a)} />
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
                  <TextInput style={styles.input} value={values[f.name] ?? ''} testID={`vandaag-plus-${f.name}`}
                    onChangeText={(v) => setValues((cur) => ({ ...cur, [f.name]: v }))} />
                </View>
              ))}
              <Btn disabled={busy} onPress={save} testID="vandaag-plus-save" label={t('circle.vandaag.plus_save')} style={styles.btnAt} />
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
              'plus-pinned': () => (!edit && !act && !(selves.length > 1 && !asSelf) && pinned.length ? pinned.map((p) => (
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
              <View key={d.id} testID={d.id}>
                {d.titleKey ? <Text style={styles.label}>{t(d.titleKey)}</Text> : null}
                {piece}
              </View>
            );
          })}
          {referral ? referral.map((r) => (
            <Btn key={r.circleId} label={t('circle.vandaag.plus_referral', { name: r.name || t('circle.screens.untitled') })}
              onPress={() => onOpenCircle?.(r.circleId)} testID={`vandaag-plus-referral-${r.circleId}`} style={styles.btnAt} />
          )) : null}
          {error ? <Text style={styles.error} testID="vandaag-plus-error">{error}</Text> : null}
          {/* the way out, not one of the acts */}
          <Btn variant="ghost" onPress={onClose} testID="vandaag-plus-close" label={t('circle.vandaag.done')} style={styles.btnAt} />
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  card: { backgroundColor: theme.color.card, borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 16, gap: 8 },
  title: { fontSize: 17, fontWeight: '700', color: theme.color.ink, marginBottom: 4 },
  field: { gap: 4, marginBottom: 8 },
  label: { fontSize: 13, color: theme.color.inkSoft },
  input: { fontSize: 14, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, color: theme.color.ink },
  btnAt: { alignSelf: 'flex-start', marginTop: 6 },   // one button family (Btn), each at its own width as on web
  btnText: { color: theme.color.ink, fontSize: 14 },
  error: { color: theme.color.accent, fontSize: 13 },
});
