/**
 * Shared RN feedback bubbles — the Stage-1 review CARDS and the "Report a problem" PANEL, used by BOTH the
 * contact-thread `FeedbackThreadScreen` and the invite-circle CIRCLE (CircleLauncherScreen). One source so the
 * two mobile containers can't drift (repo invariant #1/#3). The feedback LOGIC is the shared
 * `createFeedbackSurface`; this is only the presentation of its `kind:'review'` / `kind:'report'` emits.
 *
 * Edit affordance is container-configurable:
 *   • contact-thread → INLINE card edit: pass `editing={id,text}` + `onChangeEditText/onSaveEdit/onCancelEdit`.
 *   • circle          → COMPOSER prefill (web parity): pass no `editing`; `onEditPoint(point)` fills the composer.
 */
import React from 'react';
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet } from 'react-native';
import { t } from '../core/localisation.js';
import { theme } from '../screens/v2/theme.js';

/**
 * @param {object} a
 * @param {string} [a.intro]                 the review intro line (first paragraph only is shown)
 * @param {Array<{id,text,raw?,edited?}>} a.points
 * @param {object} [a.labels]                bot-shipped labels (preferred over app locale)
 * @param {string} [a.botLang]              the bot's language for label fallback
 * @param {{id:string,text:string}|null} [a.editing]  the point being inline-edited (contact-thread only)
 * @param {(text:string)=>void} [a.onChangeEditText]
 * @param {()=>void} [a.onSaveEdit]
 * @param {()=>void} [a.onCancelEdit]
 * @param {(point:object)=>void} a.onEditPoint   ✏ tapped (inline-start on contact-thread; composer-prefill on circle)
 * @param {(pointId:string)=>void} a.onSend      send one point (fp:consent:<id>)
 * @param {()=>void} a.onSendAll                 send all (fp:consent:all)
 * @param {()=>void} a.onSendNone                send nothing (fp:cancel)
 */
export function FeedbackReviewCards({
  intro, points, labels, botLang,
  editing = null, onChangeEditText, onSaveEdit, onCancelEdit,
  onEditPoint, onSend, onSendAll, onSendNone,
}) {
  const L = (k, dv) => (labels && labels[k]) || t(`circle.feedback.${k}`, { defaultValue: dv }, botLang);
  return (
    <View style={s.reviewBlock} testID="feedback-review">
      {intro ? <Text style={s.reviewIntro}>{String(intro).split('\n\n')[0]}</Text> : null}
      {(points || []).map((p) => {
        const isEditing = editing && editing.id === p.id;
        const changed = p.raw && p.raw !== p.text;
        return (
          <View key={p.id} style={s.card} testID={`feedback-card-${p.id}`}>
            {isEditing ? (
              <>
                <TextInput
                  style={s.cardInput}
                  value={editing.text}
                  onChangeText={onChangeEditText}
                  multiline
                  autoFocus
                  testID={`feedback-card-input-${p.id}`}
                />
                <View style={s.cardBtns}>
                  <Pressable style={s.cardBtnMuted} onPress={onCancelEdit}>
                    <Text style={s.cardBtnMutedText}>{L('cancel_edit', 'Annuleer')}</Text>
                  </Pressable>
                  <Pressable style={s.cardBtn} onPress={onSaveEdit} testID={`feedback-card-save-${p.id}`}>
                    <Text style={s.cardBtnText}>{L('save_edit', 'Opslaan')}</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Pressable onPress={() => onEditPoint(p)}>
                  <Text style={s.cardText}>
                    {p.text}{p.edited ? ` ${L('edited', '(aangepast)')}` : ''}
                  </Text>
                </Pressable>
                {changed ? (
                  <View style={s.origRow}>
                    <Text style={s.origLabel}>{L('original', 'origineel')}</Text>
                    <Text style={s.origText}>{p.raw}</Text>
                  </View>
                ) : null}
                <View style={s.cardBtns}>
                  <Pressable style={s.cardBtnMuted} onPress={() => onEditPoint(p)} testID={`feedback-card-edit-${p.id}`}>
                    <Text style={s.cardBtnMutedText}>✏</Text>
                  </Pressable>
                  <Pressable style={s.cardBtn} onPress={() => onSend(p.id)}>
                    <Text style={s.cardBtnText}>{L('send_one', 'Verstuur')}</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        );
      })}
      <View style={s.reviewFooter}>
        <Pressable style={s.cardBtn} onPress={onSendAll}>
          <Text style={s.cardBtnText}>{L('send_all', 'Alles versturen')}</Text>
        </Pressable>
        <Pressable style={s.cardBtnMuted} onPress={onSendNone}>
          <Text style={s.cardBtnMutedText}>{L('send_none', 'Niets versturen')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The PII-safe on-device log panel. `selectable` → long-press to Copy (zero clipboard dep). The optional
 * `sendLabel` + `onSend` add an ANONYMOUS "send" button (web parity — the web bubble offers the same). The
 * send LOGIC is the shared surface (`fp:report:send`); this is only the button.
 */
export function FeedbackReportPanel({ intro, logText, sendLabel, onSend }) {
  return (
    <View style={s.reportBlock} testID="feedback-report-panel">
      {intro ? <Text style={s.reportIntro}>{intro}</Text> : null}
      <ScrollView style={s.reportLogWrap} nestedScrollEnabled>
        <Text style={s.reportLog} selectable testID="feedback-report-log">{logText || '—'}</Text>
      </ScrollView>
      {onSend && sendLabel ? (
        <View style={s.reportFooter}>
          <Pressable style={s.cardBtn} onPress={onSend} accessibilityRole="button" testID="feedback-report-send">
            <Text style={s.cardBtnText}>{sendLabel}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  reviewBlock: { gap: 8, marginVertical: 4 },
  reviewIntro: { fontSize: 13, color: theme.color.inkSoft, lineHeight: 18 },
  card: { backgroundColor: theme.color.white, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, padding: 12, gap: 8 },
  cardText: { fontSize: 15, color: theme.color.ink, lineHeight: 21 },
  origRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.color.line, paddingTop: 8 },
  origLabel: { fontSize: 10, fontWeight: '700', color: theme.color.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 3 },
  origText: { flex: 1, fontSize: 13, color: theme.color.inkSoft, fontStyle: 'italic', lineHeight: 18 },
  cardInput: { fontSize: 15, color: theme.color.ink, lineHeight: 21, borderWidth: 1.5, borderColor: theme.color.accent, borderRadius: theme.radius.md, padding: 10, minHeight: 64, textAlignVertical: 'top', backgroundColor: theme.color.paper },
  cardBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  cardBtn: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 12, backgroundColor: theme.color.accent },
  cardBtnText: { fontSize: 13, fontWeight: '600', color: theme.color.white },
  cardBtnMuted: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.color.line },
  cardBtnMutedText: { fontSize: 13, fontWeight: '600', color: theme.color.inkSoft },
  reviewFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 2 },
  reportBlock: { backgroundColor: theme.color.white, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, padding: 12, gap: 8, marginVertical: 4 },
  reportIntro: { fontSize: 13, color: theme.color.inkSoft, lineHeight: 18 },
  reportLogWrap: { maxHeight: 220, backgroundColor: theme.color.paper, borderRadius: theme.radius.sm ?? 6, padding: 8 },
  reportLog: { fontSize: 11, color: theme.color.ink, fontFamily: 'monospace', lineHeight: 15 },
  reportFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 2 },
});
