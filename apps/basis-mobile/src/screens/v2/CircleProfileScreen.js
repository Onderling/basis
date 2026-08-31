/**
 * basis-mobile v2 — profile (Mij) screen (RN, S2 parity).
 *
 * RN mirror of web's circleProfile: identity (handle + display name), personal
 * offerings (taxonomy picker as tappable chips), and coarse location (geocode).
 * Self-contained: loads getMyProfile/listOfferingCategories + dispatches the stoop
 * mutations via the injected `callSkill`. Availability/quiet-hours is a sub-screen
 * reached via `onAvailability`.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet } from 'react-native';
import { t, currentLang } from '../../core/localisation.js';
import { useTheme } from './themeContext.js';

export default function CircleProfileScreen({ callSkill, onAvailability, onMyData, onSharedWithMe, onOpenMij, onAdvanced }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [profile, setProfile] = useState({});
  const [categories, setCategories] = useState([]);
  const [handle, setHandle] = useState('');
  const [display, setDisplay] = useState('');
  const [geoQuery, setGeoQuery] = useState('');
  const [geoResult, setGeoResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (typeof callSkill !== 'function') return;
    const [prof, cats] = await Promise.all([
      callSkill('stoop', 'getMyProfile', {}).catch(() => null),
      callSkill('stoop', 'listOfferingCategories', { lang: currentLang() }).catch(() => null),
    ]);
    const entry = prof?.entry ?? {};
    setProfile(entry);
    setHandle(entry.handle ?? '');
    setDisplay(entry.displayName ?? '');
    setCategories(Array.isArray(cats?.categories) ? cats.categories : []);
  }, [callSkill]);

  useEffect(() => { load(); }, [load]);

  const saveIdentity = useCallback(async () => {
    setBusy(true);
    try {
      if (handle && handle !== profile.handle) await callSkill('stoop', 'setMyHandle', { handle: handle.trim() });
      if (display !== (profile.displayName ?? '')) await callSkill('stoop', 'setMyDisplayName', { displayName: display.trim() });
    } catch { /* surfaced on reload */ }
    setBusy(false); load();
  }, [handle, display, profile, callSkill, load]);

  const addOffering = useCallback(async (categoryId) => { try { await callSkill('stoop', 'addMyOffering', { categoryId }); } catch { /* */ } load(); }, [callSkill, load]);
  const removeOffering = useCallback(async (categoryId) => { try { await callSkill('stoop', 'removeMyOffering', { categoryId }); } catch { /* */ } load(); }, [callSkill, load]);
  const geocode = useCallback(async () => {
    const q = geoQuery.trim(); if (!q) return;
    try { const r = await callSkill('stoop', 'geocode', { query: q }); setGeoResult(r?.error ? null : r); } catch { setGeoResult(null); }
  }, [geoQuery, callSkill]);
  const saveLocation = useCallback(async () => {
    if (!geoResult) return;
    try { await callSkill('stoop', 'setMyLocation', { cell: geoResult.cell, label: geoResult.label, source: 'geocode' }); } catch { /* */ }
    setGeoResult(null); setGeoQuery(''); load();
  }, [geoResult, callSkill, load]);
  const clearLocation = useCallback(async () => { try { await callSkill('stoop', 'clearMyLocation', {}); } catch { /* */ } load(); }, [callSkill, load]);

  // Read-accept: prefer the new `offerings` field, fall back to legacy `skills`.
  const myOfferings = Array.isArray(profile.offerings) ? profile.offerings
    : (Array.isArray(profile.skills) ? profile.skills : []);
  const myIds = new Set(myOfferings.map((s) => s.categoryId));
  const catLabel = (id) => categories.find((c) => c.id === id)?.label ?? id;

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content} testID="circle-profile">
      <Text style={styles.title}>{t('circle.profile.title')}</Text>

      <Section title={t('circle.profile.identity')}>
        <Field label={t('circle.profile.handle')} value={handle} onChangeText={setHandle} testID="profile-handle" />
        <Field label={t('circle.profile.displayName')} value={display} onChangeText={setDisplay} testID="profile-display" />
        <Pressable style={styles.primary} onPress={saveIdentity} testID="profile-save"><Text style={styles.primaryText}>{t('circle.profile.save')}</Text></Pressable>
      </Section>

      {/* Fold-in phase C (web parity, circleProfile.js) — quiet pointer to the
          "Mij → persona's" surface where offerings live now. The legacy editor
          below stays functional on mobile until the fold-in completes here. */}
      {typeof onOpenMij === 'function' ? (
        <Pressable onPress={onOpenMij} accessibilityRole="button" testID="profile-offerings-moved">
          <Text style={styles.offeringsMoved}>{t('circle.profile.offerings_moved')}</Text>
        </Pressable>
      ) : (
        <Text style={styles.offeringsMoved} testID="profile-offerings-moved">{t('circle.profile.offerings_moved')}</Text>
      )}

      <Section title={t('circle.profile.offerings')}>
        {myOfferings.length === 0 ? <Text style={styles.muted}>{t('circle.profile.no_offerings')}</Text> : (
          <View style={styles.chips}>
            {myOfferings.map((s) => (
              <Pressable key={s.categoryId} style={styles.offeringChip} onPress={() => removeOffering(s.categoryId)} testID={`profile-offering-${s.categoryId}`}>
                <Text style={styles.offeringChipText}>{catLabel(s.categoryId)} ✕</Text>
              </Pressable>
            ))}
          </View>
        )}
        <Text style={styles.muted}>{t('circle.profile.pick_offering')}</Text>
        <View style={styles.chips}>
          {categories.filter((c) => !myIds.has(c.id)).map((c) => (
            <Pressable key={c.id} style={styles.catChip} onPress={() => addOffering(c.id)} testID={`profile-cat-${c.id}`}>
              <Text style={styles.catChipText}>+ {c.label}</Text>
            </Pressable>
          ))}
        </View>
      </Section>

      <Section title={t('circle.profile.location')}>
        <Text style={styles.locCurrent}>{profile.location?.label ? t('circle.profile.loc_current', { label: profile.location.label }) : t('circle.profile.loc_none')}</Text>
        <View style={styles.row}>
          <TextInput style={styles.input} value={geoQuery} onChangeText={setGeoQuery} placeholder={t('circle.profile.geo_placeholder')} placeholderTextColor={theme.color.inkSoft} testID="profile-geo" />
          <Pressable style={styles.primary} onPress={geocode}><Text style={styles.primaryText}>{t('circle.profile.geo_search')}</Text></Pressable>
        </View>
        {geoResult?.label && (
          <View style={styles.row}>
            <Text style={styles.locResult}>{geoResult.label}</Text>
            <Pressable style={styles.primary} onPress={saveLocation}><Text style={styles.primaryText}>{t('circle.profile.geo_use')}</Text></Pressable>
          </View>
        )}
        {profile.location?.label && <Pressable style={styles.secondary} onPress={clearLocation}><Text style={styles.secondaryText}>{t('circle.profile.loc_clear')}</Text></Pressable>}
        {/* The geo editor sets the coarse place; WHO sees it is a disclosure on the persona layer.
            A quiet pointer, exactly as web has had — mobile was missing it entirely. */}
        {typeof onOpenMij === 'function' ? (
          <Pressable onPress={onOpenMij} accessibilityRole="button" testID="profile-loc-disclosure">
            <Text style={styles.offeringsMoved}>{t('circle.profile.loc_disclosure_hint')}</Text>
          </Pressable>
        ) : (
          <Text style={styles.offeringsMoved} testID="profile-loc-disclosure">{t('circle.profile.loc_disclosure_hint')}</Text>
        )}
      </Section>

      {typeof onAvailability === 'function' && (
        <Pressable style={styles.secondary} onPress={onAvailability} testID="profile-availability"><Text style={styles.secondaryText}>{t('circle.profile.availability')}</Text></Pressable>
      )}
      {typeof onMyData === 'function' && (
        <Pressable style={styles.secondary} onPress={onMyData} testID="profile-mydata"><Text style={styles.secondaryText}>{t('circle.profile.mydata')}</Text></Pressable>
      )}
      {typeof onSharedWithMe === 'function' && (
        <Pressable style={styles.secondary} onPress={onSharedWithMe} testID="profile-shared-with-me"><Text style={styles.secondaryText}>{t('circle.profile.sharedWithMe')}</Text></Pressable>
      )}
      {typeof onAdvanced === 'function' && (
        <Pressable style={styles.secondary} onPress={onAdvanced} testID="profile-advanced"><Text style={styles.secondaryText}>{t('circle.advanced.title')}</Text></Pressable>
      )}
      {busy && <Text style={styles.muted}>{t('circle.profile.saving')}</Text>}
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
function Field({ label, value, onChangeText, testID }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.input} value={value} onChangeText={onChangeText} autoCapitalize="none" testID={testID} />
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.paper },
  content: { padding: 16, gap: 16, paddingBottom: 80 },
  title: { fontFamily: theme.font.serif, fontSize: 22, fontWeight: '600', color: theme.color.ink },
  section: { borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, padding: 12, gap: 10, backgroundColor: theme.color.paper },
  sectionTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, color: theme.color.inkSoft },
  field: { gap: 4 },
  fieldLabel: { fontSize: 13, color: theme.color.inkSoft },
  input: { flex: 1, fontSize: 14, paddingVertical: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, color: theme.color.ink, backgroundColor: theme.color.white },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  primary: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: theme.radius.md, backgroundColor: theme.color.accent, justifyContent: 'center', alignSelf: 'flex-start' },
  primaryText: { fontSize: 14, fontWeight: '600', color: theme.color.white },
  secondary: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.accent, alignSelf: 'flex-start' },
  secondaryText: { fontSize: 14, fontWeight: '600', color: theme.color.accent },
  muted: { fontSize: 13, color: theme.color.inkSoft },
  offeringsMoved: { fontSize: 12.5, fontStyle: 'italic', color: theme.color.inkSoft },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  offeringChip: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: theme.color.line },
  offeringChipText: { fontSize: 13, color: theme.color.ink },
  catChip: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: theme.color.accent },
  catChipText: { fontSize: 13, color: theme.color.accent },
  locCurrent: { fontSize: 14, color: theme.color.ink },
  locResult: { flex: 1, fontSize: 14, color: theme.color.ink },
});
