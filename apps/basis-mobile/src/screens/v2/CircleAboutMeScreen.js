/**
 * basis-mobile v2 — "About me" persona surface (RN, personas#1 parity).
 *
 * RN mirror of web's circleAboutMe: a read + edit view of ONE persona — its
 * coarse properties (place/ageBand/…) and, per circle, what it SHARES there.
 * The view-model + the default-WITHHOLD framing live in shared code
 * (apps/basis/src/v2/personaView.js — web ≡ mobile by construction); this
 * screen is a thin RN shell that renders it and fires the edit ops.
 *
 * Self-contained: loads via getPersonaView + edits via setProfileProperty /
 * setProfileDisclosure through the injected 3-arg `callSkill(origin, op, args)`.
 * Re-reads after each edit so the surface reflects the persisted state.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, TextInput, Switch } from 'react-native';
import { t } from '../../core/localisation.js';
import { useTheme } from './themeContext.js';
import { buildPersonaViewModel } from '../../../../basis/src/v2/personaView.js';
import { shareDisclosureToCircle } from '../../../../basis/src/core/handlers/personaPropsUpdate.js';
import { DRIVER_KINDS } from '@onderling/agent-registry';

const keyLabel = (key) => t(`circle.aboutme.key.${key}`, { defaultValue: key });
const kindLabel = (k) => t(`circle.aboutme.driverkind.${k}`, { defaultValue: k });

export default function CircleAboutMeScreen({ callSkill, emitMemberProps, lastShared = null, personaId, circles = [], onBack }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [model, setModel] = useState(null);
  const [placeDrafts, setPlaceDrafts] = useState({});   // free-text edits before save, keyed by property key
  const [shareState, setShareState] = useState({});     // circleId → 'sharing' | 'ok' | reason string
  const [driverDraft, setDriverDraft] = useState({ label: '', kind: 'driver', text: '', tags: '' });

  const load = useCallback(async () => {
    let view;
    try { view = await callSkill('agents', 'getPersonaView', { id: personaId }); }
    catch { view = { ok: false }; }
    setModel(buildPersonaViewModel({ view, circles }));
  }, [callSkill, personaId, circles]);

  useEffect(() => { load(); }, [load]);

  const setProperty = useCallback(async (key, value) => {
    try { await callSkill('agents', 'setProfileProperty', { id: personaId, key, value }); } catch { /* */ }
    await load();
  }, [callSkill, personaId, load]);

  const toggleDisclosure = useCallback(async (contextId, key, enabled) => {
    try { await callSkill('agents', 'setProfileDisclosure', { id: personaId, contextId, key, enabled }); } catch { /* */ }
    await load();
  }, [callSkill, personaId, load]);

  // personal drivers (#5) — author an open { kind, text, tags } driver on this persona.
  const addDriver = useCallback(async () => {
    const label = driverDraft.label.trim();
    const text = driverDraft.text.trim();
    if (!label || (!text && !driverDraft.tags.trim())) return;   // needs a label + something to match on
    try { await callSkill('agents', 'setProfileDriver', { id: personaId, key: label, kind: driverDraft.kind, text, tags: driverDraft.tags }); } catch { /* */ }
    setDriverDraft({ label: '', kind: 'driver', text: '', tags: '' });
    await load();
  }, [callSkill, personaId, driverDraft, load]);

  // personas#2 — push THIS persona's current disclosure for the circle up to its roster (post-join).
  const shareToCircle = useCallback(async (circleId) => {
    setShareState((s) => ({ ...s, [circleId]: 'sharing' }));
    let res;
    try { res = await shareDisclosureToCircle({ callSkill, emitMemberProps, lastShared, circleId, personaId }); }
    catch (err) { res = { ok: false, reason: err?.message ?? String(err) }; }
    setShareState((s) => ({ ...s, [circleId]: res?.ok ? 'ok' : (res?.reason ?? 'failed') }));
  }, [callSkill, emitMemberProps, lastShared, personaId]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        {typeof onBack === 'function' ? (
          <Pressable onPress={onBack} accessibilityRole="button"><Text style={styles.back}>{t('circle.aboutme.back')}</Text></Pressable>
        ) : null}
        <Text style={styles.title}>{personaId ? t('circle.aboutme.title_named', { name: personaId }) : t('circle.aboutme.title')}</Text>
      </View>

      {!model || model.ok !== true ? (
        <Text style={styles.empty}>{t('circle.aboutme.unavailable')}</Text>
      ) : (
        <ScrollView>
          {/* ── properties ─────────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('circle.aboutme.properties')}</Text>
            <Text style={styles.intro}>{t('circle.aboutme.properties_intro')}</Text>
            {model.properties.map((p) => (
              <View key={p.key} style={styles.prop}>
                <Text style={styles.propLabel}>{keyLabel(p.key)}</Text>
                <Text style={[styles.propValue, p.value == null && styles.propValueUnset]}>
                  {p.value != null ? p.value : t('circle.aboutme.not_set')}
                </Text>
                {p.free ? (
                  <View style={styles.editorRow}>
                    <TextInput
                      style={styles.input}
                      defaultValue={p.value ?? ''}
                      placeholder={t('circle.aboutme.place_placeholder')}
                      onChangeText={(v) => setPlaceDrafts((d) => ({ ...d, [p.key]: v }))}
                    />
                    <Pressable
                      style={styles.saveBtn}
                      accessibilityRole="button"
                      onPress={() => setProperty(p.key, String(placeDrafts[p.key] ?? p.value ?? '').trim())}
                    >
                      <Text style={styles.saveBtnText}>{t('circle.aboutme.save')}</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.editorRow}>
                    {(p.buckets || []).map((b) => {
                      const active = b === p.value;
                      return (
                        <Pressable
                          key={b}
                          style={[styles.bucket, active && styles.bucketActive]}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          onPress={() => setProperty(p.key, b)}
                        >
                          <Text style={[styles.bucketText, active && styles.bucketTextActive]}>{b}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
            ))}
          </View>

          {/* ── personal drivers (#5) ──────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('circle.aboutme.drivers')}</Text>
            <Text style={styles.intro}>{t('circle.aboutme.drivers_intro')}</Text>
            {(model.drivers || []).map((d) => (
              <View key={d.key} style={styles.driver}>
                <Text style={styles.driverHead}>{`${kindLabel(d.kind)}: ${d.text || d.tags.join(', ')}`}</Text>
                {d.tags.length ? (
                  <View style={styles.driverTags}>
                    {d.tags.map((tg) => (<Text key={tg} style={styles.driverTag}>{tg}</Text>))}
                  </View>
                ) : null}
              </View>
            ))}
            <TextInput
              style={styles.input}
              value={driverDraft.label}
              onChangeText={(v) => setDriverDraft((s) => ({ ...s, label: v }))}
              placeholder={t('circle.aboutme.driver_label_ph')}
            />
            <View style={styles.editorRow}>
              {DRIVER_KINDS.map((k) => {
                const active = k === driverDraft.kind;
                return (
                  <Pressable
                    key={k}
                    style={[styles.bucket, active && styles.bucketActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setDriverDraft((s) => ({ ...s, kind: k }))}
                  >
                    <Text style={[styles.bucketText, active && styles.bucketTextActive]}>{kindLabel(k)}</Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              style={styles.input}
              value={driverDraft.text}
              onChangeText={(v) => setDriverDraft((s) => ({ ...s, text: v }))}
              placeholder={t('circle.aboutme.driver_text_ph')}
            />
            <TextInput
              style={styles.input}
              value={driverDraft.tags}
              onChangeText={(v) => setDriverDraft((s) => ({ ...s, tags: v }))}
              placeholder={t('circle.aboutme.driver_tags_ph')}
            />
            <Pressable style={styles.saveBtn} accessibilityRole="button" onPress={addDriver}>
              <Text style={styles.saveBtnText}>{t('circle.aboutme.driver_add')}</Text>
            </Pressable>
          </View>

          {/* ── per-circle sharing ─────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('circle.aboutme.sharing')}</Text>
            <Text style={styles.intro}>{t('circle.aboutme.sharing_intro')}</Text>
            {!model.circles.length ? (
              <Text style={styles.empty}>{t('circle.aboutme.no_circles')}</Text>
            ) : null}
            {model.circles.map((c) => (
              <View key={c.circleId} style={styles.circle}>
                <Text style={styles.circleName}>{c.name}</Text>
                <Text style={styles.circleSummary}>
                  {c.sharedKeys.length
                    ? t('circle.aboutme.you_share', { keys: c.sharedKeys.join(', ') })
                    : t('circle.aboutme.you_share_nothing')}
                </Text>
                {!c.rows.length ? (
                  <Text style={styles.circleHint}>{t('circle.aboutme.set_a_property_first')}</Text>
                ) : null}
                {c.rows.map((r) => (
                  <View key={r.key} style={styles.toggleRow}>
                    <Switch value={r.enabled} onValueChange={(on) => toggleDisclosure(c.circleId, r.key, on)} />
                    <Text style={styles.toggleLabel}>{t('circle.aboutme.share_key', { key: keyLabel(r.key), value: r.value })}</Text>
                  </View>
                ))}
                {c.rows.length ? (
                  <View style={styles.shareRow}>
                    <Pressable
                      style={styles.shareBtn}
                      accessibilityRole="button"
                      disabled={shareState[c.circleId] === 'sharing'}
                      onPress={() => shareToCircle(c.circleId)}
                    >
                      <Text style={styles.shareBtnText}>
                        {/* with every toggle off, pressing this STOPS sharing — the word follows the act */}
                        {c.rows.some((r) => r.enabled) ? t('circle.aboutme.share_to_circle') : t('circle.mij.stop_sharing')}
                      </Text>
                    </Pressable>
                    {shareState[c.circleId] ? (
                      <Text style={styles.shareStatus}>
                        {shareState[c.circleId] === 'sharing' ? t('circle.aboutme.sharing_now')
                          : shareState[c.circleId] === 'ok' ? (c.rows.some((r) => r.enabled) ? t('circle.aboutme.shared_ok') : t('circle.mij.stopped_sharing'))
                          : t('circle.aboutme.share_failed', { reason: shareState[c.circleId] })}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (theme) => {
  const c = theme.color;
  return StyleSheet.create({
  root: { flex: 1, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  back: { fontSize: 12, color: c.inkSoft },
  title: { fontSize: 18, fontWeight: '700', color: c.ink },
  empty: { fontSize: 13, color: c.inkSoft, fontStyle: 'italic' },
  section: { borderWidth: 1, borderColor: c.line, borderRadius: theme.radius?.md ?? 8, padding: 12, marginBottom: 12, gap: 10, backgroundColor: c.paper },
  sectionTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, color: c.inkSoft },
  intro: { fontSize: 12, color: c.inkSoft, lineHeight: 17 },
  prop: { gap: 4, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: c.line },
  propLabel: { fontSize: 13, fontWeight: '600', color: c.ink },
  propValue: { fontSize: 13, color: c.ink },
  propValueUnset: { color: c.inkSoft, fontStyle: 'italic' },
  editorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  bucket: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: theme.radius?.sm ?? 6, borderWidth: 1, borderColor: c.line, backgroundColor: c.paper },
  bucketActive: { borderColor: c.accent, backgroundColor: c.accent },
  bucketText: { fontSize: 12, color: c.ink },
  bucketTextActive: { color: '#fff', fontWeight: '600' },
  input: { flex: 1, minWidth: 120, fontSize: 13, paddingVertical: 6, paddingHorizontal: 8, borderRadius: theme.radius?.sm ?? 6, borderWidth: 1, borderColor: c.line, backgroundColor: c.paper, color: c.ink },
  saveBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: theme.radius?.sm ?? 6, borderWidth: 1, borderColor: c.accent },
  saveBtnText: { fontSize: 12, fontWeight: '600', color: c.accentInk },
  circle: { borderWidth: 1, borderColor: c.line, borderRadius: theme.radius?.sm ?? 6, padding: 10, gap: 6 },
  circleName: { fontSize: 13, fontWeight: '700', color: c.ink },
  circleSummary: { fontSize: 12, color: c.inkSoft },
  circleHint: { fontSize: 12, color: c.inkSoft, fontStyle: 'italic' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toggleLabel: { fontSize: 13, color: c.ink, flex: 1 },
  driver: { gap: 4, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: c.line },
  driverHead: { fontSize: 13, color: c.ink },
  driverTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  driverTag: { fontSize: 11, color: c.inkSoft, paddingVertical: 2, paddingHorizontal: 8, borderRadius: theme.radius?.sm ?? 6, borderWidth: 1, borderColor: c.line },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  shareBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: theme.radius?.sm ?? 6, borderWidth: 1, borderColor: c.accent },
  shareBtnText: { fontSize: 12, fontWeight: '600', color: c.accentInk },
  shareStatus: { fontSize: 12, color: c.inkSoft, flexShrink: 1 },
  });
};
