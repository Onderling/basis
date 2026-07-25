/**
 * basis-mobile v2 — "Mij → persona's" (RN, bulletin design language).
 *
 * RN mirror of web's circleMij.js over the SHARED read-model
 * (apps/basis/src/v2/personaView.js → buildMijViewModel; web ≡ mobile by
 * construction). Three stacked sections:
 *   1. MIJN ALGEMENE PERSONA — the default profile's properties as rows
 *      (mono key · value · ladder hint) + offerings/drivers as chips with a
 *      dashed "+ vaardigheid of drijfveer" inline form,
 *   2. PERSONA'S — one card per profile; the root card is the truth layer
 *      (rust border); other cards show per key: volgt-algemeen / EIGEN / ∅,
 *   3. PER KRING — who sees what, as stacked cards per circle (a table is
 *      cramped on mobile — listed web/mobile idiom difference): persona ·
 *      key · niveau · released value · charter line, with the share/withdraw
 *      actions and the dashed share-affordance.
 *
 * Thin shell: ALL model logic lives in the shared read-model; ALL op wiring
 * (the listAgents → getProfileProperties/getProfileDisclosure →
 * getPersonaRelease → buildMijViewModel sequence + the edit ops) lives in the
 * portable host module src/core/mijHost.js (tested in test/mijHost.test.js).
 * This file renders + re-loads after each edit (persisted state, not the tap).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { t, lang } from '../../core/localisation.js';
import { useTheme } from './themeContext.js';
import {
  loadMijModel, setGeneralProperty, addGeneralOffering, createPersona,
  toggleDisclosure, shareDisclosureToCircle,
} from '../../core/mijHost.js';

/* Mobile t() falls back to the FULL key on a miss (no defaultValue param like
 * web's t) — resolve with an explicit fallback so raw driver keys render as
 * themselves, exactly like web's { defaultValue } does. */
const trOr = (key, fallback, params) => {
  const v = t(key, params);
  return v === key ? fallback : v;
};
const keyLabel = (key) => trOr(`circle.aboutme.key.${key}`, key);
const rungLabel = (rung) => trOr(`circle.mij.rung.${rung}`, rung);

/** Localised finest→coarsest ladder hint, e.g. "ladder: wijk → gemeente → regio → ∅". */
const ladderHint = (ladder) => (Array.isArray(ladder) && ladder.length
  ? t('circle.mij.ladder_hint', { ladder: ladder.map(rungLabel).join(' → ') })
  : '');

/** Bulletin section chrome: rust mono eyebrow + italic tagline over a 3px ink top-rule. */
function Section({ eyebrowKey, taglineKey, children }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.eyebrow}>{t(eyebrowKey)}</Text>
        <Text style={styles.tagline}>{t(taglineKey)}</Text>
      </View>
      {children}
    </View>
  );
}

export default function CircleMijScreen({ callSkill, sendPersonaUpdate, lastShared = null, resealMediaForCircle = null, personaId, circles = [] }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [model, setModel] = useState(null);
  const [openEditor, setOpenEditor] = useState(null);     // property key whose inline editor is open
  const [propDrafts, setPropDrafts] = useState({});       // free-text property edits before save
  const [offeringForm, setOfferingForm] = useState(null);       // {text, tags} | null — the dashed add-offering form
  const [personaForm, setPersonaForm] = useState(null);   // {name} | null — the dashed new-persona form
  const [addShareFor, setAddShareFor] = useState(null);   // circleId whose share-affordance is open
  const [shareState, setShareState] = useState({});       // `${circleId}:${personaId}` → 'sharing' | 'ok' | reason

  const load = useCallback(async () => {
    setModel(await loadMijModel({ callSkill, personaId, circles }));
  }, [callSkill, personaId, circles]);

  useEffect(() => { load(); }, [load]);

  // ── the op callbacks — the same sequence the web host fires, then re-read ──
  const onSetProperty = useCallback(async (key, value) => {
    await setGeneralProperty({ callSkill, defaultId: model?.defaultId, key, value });
    setOpenEditor(null);
    await load();
  }, [callSkill, model?.defaultId, load]);

  const onAddOffering = useCallback(async () => {
    const text = (offeringForm?.text ?? '').trim();
    const tags = (offeringForm?.tags ?? '').trim();
    if (!text && !tags) return;                            // nothing to match on
    await addGeneralOffering({ callSkill, defaultId: model?.defaultId, text, tags });
    setOfferingForm(null);
    await load();
  }, [callSkill, model?.defaultId, offeringForm, load]);

  const onCreatePersona = useCallback(async () => {
    const name = (personaForm?.name ?? '').trim();
    if (!name) return;
    await createPersona({ callSkill, name });
    setPersonaForm(null);
    await load();
  }, [callSkill, personaForm, load]);

  const onToggleDisclosure = useCallback(async (contextId, key, enabled, forPersonaId) => {
    await toggleDisclosure({ callSkill, personaId: forPersonaId, defaultId: model?.defaultId, contextId, key, enabled });
    setAddShareFor(null);
    await load();
  }, [callSkill, model?.defaultId, load]);

  // personas#2 — push a persona's current disclosure for the circle up to its roster.
  const onShareToCircle = useCallback(async (circleId, forPersonaId) => {
    const k = `${circleId}:${forPersonaId}`;
    setShareState((s) => ({ ...s, [k]: 'sharing' }));
    let res;
    try { res = await shareDisclosureToCircle({ callSkill, sendPersonaUpdate, lastShared, resealMediaForCircle, circleId, personaId: forPersonaId }); }
    catch (err) { res = { ok: false, reason: err?.message ?? String(err) }; }
    setShareState((s) => ({ ...s, [k]: res?.ok ? 'ok' : (res?.reason ?? 'failed') }));
  }, [callSkill, sendPersonaUpdate, lastShared, resealMediaForCircle]);

  // A whenField property (availability) can carry an optional free-text "when" note (the
  // descriptor's finest 'detail' rung). Compose { state, when } when a when is present; a bare
  // state string otherwise — mirrors web's circleMij compose().
  const composeWhen = (p, state) => {
    const w = String(propDrafts[`${p.key}__when`] ?? p.when ?? '').trim();
    return (p.whenField && w) ? { state, when: w } : state;
  };

  if (!model || model.ok !== true) {
    return <Text style={styles.empty}>{t('circle.mij.unavailable')}</Text>;
  }

  return (
    <ScrollView contentContainerStyle={styles.root}>
      {/* ── 1 · MIJN ALGEMENE PERSONA — de waarheidslaag ─────────────────── */}
      <Section eyebrowKey="circle.mij.general_eyebrow" taglineKey="circle.mij.general_tagline">
        <View style={styles.panel}>
          {(model.general?.properties || []).map((p) => {
            // A property may carry an `l10n` prefix (e.g. availability) so its
            // value + bucket options localise; charter attributes show raw values.
            const valLabel = (v) => (p.l10n && v != null ? trOr(`${p.l10n}.${v}`, v) : v);
            return (
            <View key={p.key} style={styles.propRow} testID={`mij-prop-${p.key}`}>
              <View style={styles.propLine}>
                <Text style={styles.key}>{keyLabel(p.key)}</Text>
                <Pressable
                  accessibilityRole="button"
                  style={styles.valueBtn}
                  onPress={() => setOpenEditor((k) => (k === p.key ? null : p.key))}
                >
                  <Text style={[styles.value, p.value == null && styles.valueUnset]}>
                    {valLabel(p.value) ?? t('circle.mij.not_set')}
                  </Text>
                </Pressable>
                <Text style={styles.ladder}>{ladderHint(p.ladder)}</Text>
              </View>
              {openEditor === p.key ? (
                <View style={styles.editorRow}>
                  {p.free ? (
                    <>
                      <TextInput
                        style={styles.input}
                        defaultValue={p.value ?? ''}
                        placeholder={t('circle.aboutme.place_placeholder')}
                        placeholderTextColor={c.inkSoft}
                        onChangeText={(v) => setPropDrafts((d) => ({ ...d, [p.key]: v }))}
                      />
                      <Pressable
                        style={styles.btnPrimary}
                        accessibilityRole="button"
                        onPress={() => onSetProperty(p.key, String(propDrafts[p.key] ?? p.value ?? '').trim())}
                      >
                        <Text style={styles.btnPrimaryText}>{t('circle.aboutme.save')}</Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                      {(p.buckets || []).map((b) => {
                        const active = b === p.value;
                        return (
                          <Pressable
                            key={b}
                            style={[styles.bucket, active && styles.bucketActive]}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                            onPress={() => onSetProperty(p.key, composeWhen(p, b))}
                          >
                            <Text style={[styles.bucketText, active && styles.bucketTextActive]}>{valLabel(b)}</Text>
                          </Pressable>
                        );
                      })}
                      {p.whenField ? (
                        <>
                          <TextInput
                            style={styles.input}
                            defaultValue={p.when ?? ''}
                            placeholder={t('circle.mij.availability_when_ph')}
                            placeholderTextColor={c.inkSoft}
                            onChangeText={(v) => setPropDrafts((d) => ({ ...d, [`${p.key}__when`]: v }))}
                          />
                          <Pressable
                            style={styles.btnPrimary}
                            accessibilityRole="button"
                            onPress={() => onSetProperty(p.key, composeWhen(p, p.value ?? p.buckets[0]))}
                          >
                            <Text style={styles.btnPrimaryText}>{t('circle.aboutme.save')}</Text>
                          </Pressable>
                        </>
                      ) : null}
                    </>
                  )}
                </View>
              ) : null}
            </View>
            );
          })}

          {/* offerings & drivers — chips: bold text · mono tags · "≈ categorie" badge */}
          <View style={styles.propRow}>
            <View style={styles.propLine}>
              <Text style={styles.key}>{t('circle.mij.offerings_label')}</Text>
              <Text style={styles.ladder}>{ladderHint(['all', 'none'])}</Text>
            </View>
            <View style={styles.chips}>
              {(model.general?.drivers || []).map((d) => {
                // The coarse rung this item coarsens to under disclosure: for
                // offerings the taxonomy category (picked or derived), other
                // driver kinds show their kind label.
                const coarse = d.categoryId
                  ? ((d.categoryLabel && (d.categoryLabel[lang()] || d.categoryLabel.nl)) || d.categoryId)
                  : trOr(`circle.aboutme.driverkind.${d.kind}`, d.kind);
                return (
                  <View key={d.key} style={styles.chip} testID={`mij-chip-${d.key}`}>
                    <Text style={styles.chipText}>{d.text || d.tags.join(', ')}</Text>
                    {d.tags.map((tg) => <Text key={tg} style={styles.chipTag}>{tg}</Text>)}
                    <Text style={styles.chipBadge}>{t('circle.mij.approx', { category: coarse })}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* dashed add-affordance → the inline offering form (text + tags) */}
          {offeringForm ? (
            <View style={styles.form}>
              <TextInput
                style={styles.input}
                value={offeringForm.text}
                placeholder={t('circle.mij.offering_text_ph')}
                placeholderTextColor={c.inkSoft}
                onChangeText={(v) => setOfferingForm((s) => ({ ...s, text: v }))}
              />
              <TextInput
                style={styles.input}
                value={offeringForm.tags}
                placeholder={t('circle.mij.offering_tags_ph')}
                placeholderTextColor={c.inkSoft}
                onChangeText={(v) => setOfferingForm((s) => ({ ...s, tags: v }))}
              />
              <View style={styles.formActions}>
                <Pressable style={styles.btnPrimary} accessibilityRole="button" onPress={onAddOffering}>
                  <Text style={styles.btnPrimaryText}>{t('circle.mij.offering_save')}</Text>
                </Pressable>
                <Pressable style={styles.btnGhost} accessibilityRole="button" onPress={() => setOfferingForm(null)}>
                  <Text style={styles.btnGhostText}>{t('circle.mij.offering_cancel')}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable style={styles.addDashed} accessibilityRole="button" onPress={() => setOfferingForm({ text: '', tags: '' })}>
              <Text style={styles.addDashedText}>{t('circle.mij.offering_add')}</Text>
            </Pressable>
          )}
        </View>
      </Section>

      {/* ── 2 · PERSONA'S — filters + uitzonderingen op de algemene ───────── */}
      <Section eyebrowKey="circle.mij.personas_eyebrow" taglineKey="circle.mij.personas_tagline">
        {(model.personas || []).map((p) => (
          <View key={p.id} style={[styles.card, p.isDefault && styles.cardRoot]} testID={`mij-persona-${p.id}`}>
            <View style={styles.cardHead}>
              <Text style={styles.cardName}>{p.name}</Text>
              {p.isDefault ? <Text style={styles.cardTag}>{t('circle.mij.truth_tag')}</Text> : null}
            </View>
            {(p.entries || []).map((entry) => (
              <View key={entry.key} style={styles.entry}>
                <Text style={styles.entryKey}>{keyLabel(entry.key)}</Text>
                {entry.state === 'own' ? (
                  <View style={styles.entryOwn}>
                    {/* the root card's own values ARE the general truth — no EIGEN mark there */}
                    {!p.isDefault ? <Text style={styles.ownMark}>{t('circle.mij.own_mark')}</Text> : null}
                    {/* value-localised keys (availability) show their localised token, not a raw one */}
                    <Text style={styles.ownValue}>
                      {(entry.l10n && entry.value != null ? trOr(`${entry.l10n}.${entry.value}`, entry.value) : entry.value) ?? ''}
                    </Text>
                  </View>
                ) : entry.state === 'inherit' ? (
                  <Text style={styles.inherit}>{t('circle.mij.follows_general')}</Text>
                ) : (
                  <Text style={styles.absent}>{t('circle.mij.absent')}</Text>
                )}
              </View>
            ))}
          </View>
        ))}

        {/* dashed potential-action card: a new persona (createProfile) */}
        {personaForm ? (
          <View style={[styles.card, styles.form]}>
            <TextInput
              style={styles.input}
              value={personaForm.name}
              placeholder={t('circle.mij.new_persona_ph')}
              placeholderTextColor={c.inkSoft}
              onChangeText={(v) => setPersonaForm({ name: v })}
            />
            <View style={styles.formActions}>
              <Pressable style={styles.btnPrimary} accessibilityRole="button" onPress={onCreatePersona}>
                <Text style={styles.btnPrimaryText}>{t('circle.mij.new_persona_create')}</Text>
              </Pressable>
              <Pressable style={styles.btnGhost} accessibilityRole="button" onPress={() => setPersonaForm(null)}>
                <Text style={styles.btnGhostText}>{t('circle.mij.new_persona_cancel')}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable style={styles.addDashed} accessibilityRole="button" onPress={() => setPersonaForm({ name: '' })}>
            <Text style={styles.addDashedText}>{t('circle.mij.new_persona')}</Text>
          </Pressable>
        )}
      </Section>

      {/* ── 3 · PER KRING — wie ziet wat (stacked cards, mobile idiom) ────── */}
      <Section eyebrowKey="circle.mij.circles_eyebrow" taglineKey="circle.mij.circles_tagline">
        {!(model.circles || []).length ? (
          <Text style={styles.empty}>{t('circle.mij.no_circles')}</Text>
        ) : null}
        {(model.circles || []).map((circle) => {
          let prevPersona = null;
          return (
            <View key={circle.circleId} style={styles.card} testID={`mij-circle-${circle.circleId}`}>
              <Text style={styles.cardName}>{circle.name}</Text>
              {!circle.rows.length ? (
                <Text style={styles.empty}>{t('circle.mij.nothing_shared')}</Text>
              ) : null}
              {circle.rows.map((r, i) => {
                const firstOfGroup = r.personaId !== prevPersona;
                prevPersona = r.personaId;
                const sk = `${circle.circleId}:${r.personaId}`;
                const req = circle.charter?.requests.find((cr) => cr.key === r.key);
                return (
                  <View key={`${r.personaId}:${r.key}:${i}`} style={styles.shareRow}>
                    {firstOfGroup ? (
                      <View style={styles.sharePersonaLine}>
                        <Text style={styles.sharePersona}>{r.personaName}</Text>
                        <Pressable
                          style={styles.btnQuiet}
                          accessibilityRole="button"
                          disabled={shareState[sk] === 'sharing'}
                          onPress={() => onShareToCircle(circle.circleId, r.personaId)}
                        >
                          <Text style={styles.btnQuietText}>{t('circle.aboutme.share_to_circle')}</Text>
                        </Pressable>
                        {shareState[sk] ? (
                          <Text style={styles.shareStatus}>
                            {shareState[sk] === 'sharing' ? t('circle.aboutme.sharing_now')
                              : shareState[sk] === 'ok' ? t('circle.aboutme.shared_ok')
                              : t('circle.aboutme.share_failed', { reason: shareState[sk] })}
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                    <View style={styles.shareKeyLine}>
                      <Text style={styles.key}>{keyLabel(r.key)}</Text>
                      <Text style={styles.levelCell}>{r.rung ? rungLabel(r.rung) : t('circle.mij.level_all')}</Text>
                      <Text style={r.released != null ? styles.released : styles.releasedEmpty}>
                        {(r.l10n && r.released != null ? trOr(`${r.l10n}.${r.released}`, r.released) : r.released) ?? '—'}
                      </Text>
                      <Text style={styles.charterCell}>
                        {req
                          ? t('circle.mij.charter_max', { rung: req.maxRung ? rungLabel(req.maxRung) : '' }).trim()
                          : (circle.charter ? '' : t('circle.mij.charter_none'))}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('circle.mij.share_remove', { key: r.key })}
                        style={styles.removeBtn}
                        onPress={() => onToggleDisclosure(circle.circleId, r.key, false, r.personaId)}
                      >
                        <Text style={styles.removeText}>×</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}

              {/* dashed add-affordance: share one more general-persona property here */}
              {circle.addable.length ? (
                addShareFor === circle.circleId ? (
                  <View style={styles.editorRow}>
                    {circle.addable.map((key) => (
                      <Pressable
                        key={key}
                        style={styles.bucket}
                        accessibilityRole="button"
                        onPress={() => onToggleDisclosure(circle.circleId, key, true, model.defaultId)}
                      >
                        <Text style={styles.bucketText}>{keyLabel(key)}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <Pressable style={styles.addDashed} accessibilityRole="button" onPress={() => setAddShareFor(circle.circleId)}>
                    <Text style={styles.addDashedText}>{t('circle.mij.share_add')}</Text>
                  </Pressable>
                )
              ) : null}
            </View>
          );
        })}
      </Section>
    </ScrollView>
  );
}

const makeStyles = (theme) => {
  const c = theme.color;
  return StyleSheet.create({
  root: { gap: theme.space.xl, paddingBottom: theme.space.xl * 2, paddingHorizontal: 2 },
  empty: { fontSize: 13, color: c.inkSoft, fontStyle: 'italic' },

  /* bulletin section chrome */
  section: { gap: theme.space.sm + 2 },
  sectionHead: { borderTopWidth: 3, borderTopColor: c.ink, paddingTop: 6, flexDirection: 'row', alignItems: 'baseline', gap: theme.space.sm + 2, flexWrap: 'wrap' },
  eyebrow: { fontFamily: theme.font.mono, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.3, color: c.accentInk },
  tagline: { fontSize: 12, fontStyle: 'italic', color: c.inkSoft },

  /* section-1 panel */
  panel: { backgroundColor: c.card, borderWidth: 2, borderColor: c.ink, paddingVertical: theme.space.md, paddingHorizontal: theme.space.md + 2, gap: theme.space.sm },
  propRow: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.line, gap: 6 },
  propLine: { flexDirection: 'row', alignItems: 'baseline', gap: theme.space.sm + 2, flexWrap: 'wrap' },
  key: { fontFamily: theme.font.mono, fontSize: 10.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: c.ink },
  valueBtn: { flexShrink: 1 },
  value: { fontSize: 13.5, fontWeight: '700', color: c.ink },
  valueUnset: { fontWeight: '400', fontStyle: 'italic', color: c.inkSoft },
  ladder: { fontFamily: theme.font.mono, fontSize: 10, color: c.inkSoft, marginLeft: 'auto' },
  editorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', paddingVertical: 4 },
  input: { minWidth: 140, flexGrow: 1, fontSize: 13, paddingVertical: 6, paddingHorizontal: theme.space.sm, borderWidth: 1, borderColor: c.ink, backgroundColor: c.paper, color: c.ink },
  bucket: { paddingVertical: 5, paddingHorizontal: 10, borderWidth: 1, borderColor: c.line, backgroundColor: c.paper },
  bucketActive: { borderColor: c.accent, backgroundColor: c.accent },
  bucketText: { fontSize: 12, color: c.ink },
  bucketTextActive: { color: c.accentContrast, fontWeight: '600' },
  btnPrimary: { paddingVertical: 6, paddingHorizontal: theme.space.md, backgroundColor: c.accent, borderWidth: 1, borderColor: c.accent },
  btnPrimaryText: { fontSize: 12, fontWeight: '700', color: c.accentContrast },
  btnGhost: { paddingVertical: 6, paddingHorizontal: theme.space.md, borderWidth: 1, borderColor: c.line },
  btnGhostText: { fontSize: 12, color: c.inkSoft },
  btnQuiet: { paddingVertical: 3, paddingHorizontal: theme.space.sm, borderWidth: 1, borderColor: c.line },
  btnQuietText: { fontSize: 11, color: c.ink },

  /* offerings/driver chips */
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'baseline', gap: 6, borderWidth: 1, borderColor: c.ink, backgroundColor: c.paper, paddingVertical: 3, paddingHorizontal: theme.space.sm },
  chipText: { fontSize: 12.5, fontWeight: '700', color: c.ink },
  chipTag: { fontFamily: theme.font.mono, fontSize: 10, color: c.inkSoft },
  chipBadge: { fontFamily: theme.font.mono, fontSize: 10, color: c.accentInk },

  /* dashed add-affordances (potential-action grammar) */
  addDashed: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.inkSoft, paddingVertical: theme.space.sm, paddingHorizontal: theme.space.md, alignSelf: 'flex-start' },
  addDashedText: { fontSize: 12.5, color: c.inkSoft },
  form: { gap: 6 },
  formActions: { flexDirection: 'row', gap: 6 },

  /* section-2 persona cards */
  card: { backgroundColor: c.card, borderWidth: 2, borderColor: c.ink, paddingVertical: 10, paddingHorizontal: theme.space.md, gap: 6 },
  cardRoot: { borderColor: c.accentInk },
  cardHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.space.sm },
  cardName: { fontSize: 14, fontWeight: '800', color: c.ink },
  cardTag: { fontFamily: theme.font.mono, fontSize: 9.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: c.card, backgroundColor: c.accentInk, paddingVertical: 2, paddingHorizontal: 6, overflow: 'hidden' },
  entry: { flexDirection: 'row', alignItems: 'baseline', gap: theme.space.sm, paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: c.line },
  entryKey: { fontFamily: theme.font.mono, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, color: c.inkSoft, flexBasis: '38%' },
  entryOwn: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flexShrink: 1 },
  ownMark: { fontFamily: theme.font.mono, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.8, color: c.accentInk },
  ownValue: { fontSize: 12.5, fontWeight: '700', color: c.ink },
  inherit: { fontSize: 12.5, color: c.inkSoft },
  absent: { fontFamily: theme.font.mono, fontSize: 12.5, color: c.inkSoft },

  /* section-3 per-circle share cards */
  shareRow: { gap: 2, paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: c.line },
  sharePersonaLine: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, flexWrap: 'wrap' },
  sharePersona: { fontSize: 12.5, fontWeight: '700', color: c.ink },
  shareKeyLine: { flexDirection: 'row', alignItems: 'baseline', gap: theme.space.sm, flexWrap: 'wrap' },
  levelCell: { fontFamily: theme.font.mono, fontSize: 11, color: c.ink },
  released: { fontSize: 12.5, fontWeight: '700', color: c.ink },
  releasedEmpty: { fontSize: 12.5, fontStyle: 'italic', color: c.inkSoft },
  charterCell: { fontFamily: theme.font.mono, fontSize: 11, color: c.inkSoft },
  removeBtn: { marginLeft: 'auto', paddingHorizontal: 4 },
  removeText: { fontSize: 13, color: c.inkSoft },
  shareStatus: { fontSize: 11, color: c.inkSoft, flexShrink: 1 },
  });
};
