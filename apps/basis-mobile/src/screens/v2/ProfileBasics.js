/**
 * basis-mobile v2 — the person's own basics (RN; web: profileBasics.js): handle + display name, and the coarse
 * location. Painted at the top of the person's own editor (CircleMijScreen, the default persona), where Mij's "Edit"
 * door leads; Mij itself is the declared screen (name, readings, devices) and lists no section by hand. Loads
 * getMyProfile and dispatches the pinboard mutations through the injected `callSkill`.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { t } from '../../core/localisation.js';
import { useTheme } from './themeContext.js';
import { fieldAfterLoad } from '@onderling-app/basis';

export default function ProfileBasics({ callSkill }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [profile, setProfile] = useState({});
  // The identity fields are editable only once the profile has ANSWERED: before that they are empty, and what
  // someone typed there was overwritten when the load landed a few seconds later (seen on a phone, 2026-10-08).
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [handle, setHandle] = useState('');
  const [display, setDisplay] = useState('');
  const drawnRef = useRef({ handle: '', displayName: '' });   // the values the last load put in the fields
  const [geoQuery, setGeoQuery] = useState('');
  const [geoResult, setGeoResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (typeof callSkill !== 'function') return;
    const prof = await callSkill('pinboard', 'getMyProfile', {}).catch(() => null);
    const entry = prof?.entry ?? {};
    setProfile(entry);
    // a load keeps what the person typed: a field still showing the last loaded value takes the new one, an edited one
    // stays (a name typed while the profile was loading was wiped, and Save then sent nothing)
    const drawn = drawnRef.current;
    setHandle((cur) => fieldAfterLoad({ current: cur, drawn: drawn.handle, loaded: entry.handle ?? '' }));
    setDisplay((cur) => fieldAfterLoad({ current: cur, drawn: drawn.displayName, loaded: entry.displayName ?? '' }));
    drawnRef.current = { handle: entry.handle ?? '', displayName: entry.displayName ?? '' };
    if (prof) setProfileLoaded(true);
  }, [callSkill]);

  useEffect(() => { load(); }, [load]);

  const saveIdentity = useCallback(async () => {
    setBusy(true);
    try {
      if (handle && handle !== profile.handle) await callSkill('pinboard', 'setMyHandle', { handle: handle.trim() });
      if (display !== (profile.displayName ?? '')) await callSkill('pinboard', 'setMyDisplayName', { displayName: display.trim() });
    } catch { /* surfaced on reload */ }
    setBusy(false); load();
  }, [handle, display, profile, callSkill, load]);
  const geocode = useCallback(async () => {
    const q = geoQuery.trim(); if (!q) return;
    try { const r = await callSkill('pinboard', 'geocode', { query: q }); setGeoResult(r?.error ? null : r); } catch { setGeoResult(null); }
  }, [geoQuery, callSkill]);
  const saveLocation = useCallback(async () => {
    if (!geoResult) return;
    try { await callSkill('pinboard', 'setMyLocation', { cell: geoResult.cell, label: geoResult.label, source: 'geocode' }); } catch { /* */ }
    setGeoResult(null); setGeoQuery(''); load();
  }, [geoResult, callSkill, load]);
  const clearLocation = useCallback(async () => { try { await callSkill('pinboard', 'clearMyLocation', {}); } catch { /* */ } load(); }, [callSkill, load]);

  return (
    <View style={styles.wrap} testID="profile-basics">
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('circle.profile.identity')}</Text>
        <Field styles={styles} label={t('circle.profile.handle')} value={handle} onChangeText={setHandle} editable={profileLoaded} testID="profile-handle" />
        <Field styles={styles} label={t('circle.profile.displayName')} value={display} onChangeText={setDisplay} editable={profileLoaded} testID="profile-display" />
        <Pressable
          style={[styles.primary, (!profileLoaded || busy) && styles.primaryDisabled]}
          onPress={saveIdentity} disabled={!profileLoaded || busy}
          accessibilityState={{ disabled: !profileLoaded || busy }} testID="profile-save"
        ><Text style={styles.primaryText}>{t('circle.profile.save')}</Text></Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('circle.profile.location')}</Text>
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
        {/* WHO sees the location is a disclosure per circle — further down in this same editor */}
        <Text style={styles.muted} testID="profile-loc-disclosure">{t('circle.profile.loc_disclosure_hint')}</Text>
      </View>
      {busy && <Text style={styles.muted}>{t('circle.profile.saving')}</Text>}
    </View>
  );
}

function Field({ styles, label, value, onChangeText, editable = true, testID }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={[styles.input, !editable && styles.inputWaiting]} value={value} onChangeText={onChangeText} editable={editable} autoCapitalize="none" testID={testID} />
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  wrap: { gap: 16, marginBottom: 16 },
  section: { borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, padding: 12, gap: 10, backgroundColor: theme.color.paper },
  sectionTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, color: theme.color.inkSoft },
  field: { gap: 4 },
  fieldLabel: { fontSize: 13, color: theme.color.inkSoft },
  input: { flex: 1, fontSize: 14, paddingVertical: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, color: theme.color.ink, backgroundColor: theme.color.white },
  inputWaiting: { opacity: 0.5 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  primary: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: theme.radius.md, backgroundColor: theme.color.accent, justifyContent: 'center', alignSelf: 'flex-start' },
  primaryDisabled: { opacity: 0.4 },
  primaryText: { fontSize: 14, fontWeight: '600', color: theme.color.white },
  secondary: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.accent, alignSelf: 'flex-start' },
  secondaryText: { fontSize: 14, fontWeight: '600', color: theme.color.accent },
  muted: { fontSize: 13, color: theme.color.inkSoft },
  locCurrent: { fontSize: 14, color: theme.color.ink },
  locResult: { flex: 1, fontSize: 14, color: theme.color.ink },
});
